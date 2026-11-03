<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Check, Minus, Plus, X } from '@lucide/svelte';
  import type { ToolType } from '../types';
  import { pixelLinePoints } from '../drawing';
  import { detectHeldShape, type HeldShape, type StrokePoint } from '../hold-snap';
  import { registerPinchBridge, type PinchPhase } from '../pinch';
  import {
    MAX_ZOOM,
    ZOOM_SLIDER_STEPS,
    clampZoom,
    computeFitZoom,
    nudgeZoom,
    parseZoomInput,
    scrollDeltaToAnchor,
    sliderPositionToZoom,
    wheelZoom,
    zoomToSliderPosition,
  } from '../viewport';

  let {
    imageUrl = '',
    width = 960,
    height = 540,
    zoom = 100,
    activeTool = 'pen',
    penColor = '#0078d4',
    penSize = 3,
    penOpacity = 100,
    highlighterColor = '#ffeb3b',
    highlighterSize = 18,
    isCropping = false,
    onApplyCrop = () => {},
    onCancelCrop = () => {},
    onZoomChange = (z: number) => {},
    onImageReady = () => {},
    onCanvasMutated = () => {},
  }: {
    imageUrl: string;
    width?: number;
    height?: number;
    zoom: number;
    activeTool: ToolType;
    penColor: string;
    penSize: number;
    penOpacity: number;
    highlighterColor: string;
    highlighterSize: number;
    isCropping: boolean;
    onApplyCrop: () => void;
    onCancelCrop: () => void;
    onZoomChange?: (z: number) => void;
    onImageReady?: () => void;
    onCanvasMutated?: () => void;
  } = $props();

  let viewportEl = $state<HTMLDivElement | null>(null);
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let inkEl = $state<HTMLCanvasElement | null>(null);
  let ctx = $state<CanvasRenderingContext2D | null>(null);
  let inkCtx: CanvasRenderingContext2D | null = null;
  let isDrawing = $state(false);
  let lastX = 0;
  let lastY = 0;
  let didStroke = false;

  // In-progress pen work lives on the overlay canvas so a held stroke can be
  // replaced by clean geometry before anything is committed to the capture.
  let strokePoints: StrokePoint[] = [];
  let strokeSnapped: HeldShape | null = null;
  let holdTimer: number | null = null;

  // Navigation state: Space or the middle mouse button drags the view.
  let pointerInside = $state(false);
  let spaceHeld = $state(false);
  let isPanning = $state(false);
  let panPointerId: number | null = null;
  let panStartX = 0;
  let panStartY = 0;
  let panScrollLeft = 0;
  let panScrollTop = 0;

  // Touchscreen state: one-finger pan/draw and two-finger pinch + pan.
  const touchPoints = new Map<number, { x: number; y: number }>();
  let touchGesture: {
    startDistance: number;
    startZoom: number;
    imageX: number;
    imageY: number;
    originX: number;
    originY: number;
  } | null = null;
  let suppressSingleTouch = false;
  let gestureScrollPending = false;
  let gestureToken = 0;
  let ignoreZoomCommit = false;

  // Trackpad pinch forwarded by the native shell.
  let nativePinch: {
    baseZoom: number;
    appliedZoom: number;
    imageX: number;
    imageY: number;
    originX: number;
    originY: number;
  } | null = null;

  // Canvas dimensions
  let canvasWidth = $state(960);
  let canvasHeight = $state(540);

  // The canvas is displayed at its true pixel size for the current zoom so the
  // viewport can scroll the whole capture at 100% and above.
  let displayWidth = $derived((canvasWidth * zoom) / 100);
  let displayHeight = $derived((canvasHeight * zoom) / 100);
  // Pixel edges stay crisp when magnifying past 2x so individual pixels are readable.
  let imageRendering = $derived(zoom >= 200 ? 'pixelated' : 'auto');
  let panCursor = $derived(spaceHeld);

  let imageLoadToken = 0;
  // Pristine capture kept aside so the eraser can restore the untouched pixels
  // under the brush instead of leaving transparent holes in the screenshot.
  let sourceImage: HTMLImageElement | null = null;

  onMount(() => {
    canvasWidth = width || 960;
    canvasHeight = height || 540;
    if (canvasEl) {
      canvasEl.width = canvasWidth;
      canvasEl.height = canvasHeight;
      ctx = canvasEl.getContext('2d');
      renderCanvas();
    }
    sizeInkCanvas();

    const viewport = viewportEl;
    if (!viewport) return;

    viewport.addEventListener('wheel', handleWheel, { passive: false });

    window.addEventListener('keydown', handleWindowKeyDown);
    window.addEventListener('keyup', handleWindowKeyUp);
    window.addEventListener('blur', resetInputState);

    const unregisterPinch = registerPinchBridge(handleNativePinch);

    return () => {
      unregisterPinch();
      viewport.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleWindowKeyDown);
      window.removeEventListener('keyup', handleWindowKeyUp);
      window.removeEventListener('blur', resetInputState);
    };
  });

  $effect(() => {
    const url = imageUrl;
    const token = ++imageLoadToken;

    if (url) {
      const img = new Image();
      img.onload = () => {
        if (token !== imageLoadToken) return;

        canvasWidth = img.naturalWidth || width || 960;
        canvasHeight = img.naturalHeight || height || 540;
        sourceImage = img;
        if (canvasEl) {
          const context = ctx || canvasEl.getContext('2d');
          if (context) {
            ctx = context;
            canvasEl.width = canvasWidth;
            canvasEl.height = canvasHeight;
            context.drawImage(img, 0, 0);
          }
        }
        sizeInkCanvas();
        onImageReady();
      };
      img.src = url;
    } else {
      canvasWidth = width || 960;
      canvasHeight = height || 540;
      sourceImage = null;
      if (canvasEl) {
        const context = ctx || canvasEl.getContext('2d');
        if (context) {
          ctx = context;
          canvasEl.width = canvasWidth;
          canvasEl.height = canvasHeight;
        }
      }
      sizeInkCanvas();
      renderCanvas();
    }
  });

  function sizeInkCanvas() {
    if (!inkEl) return;
    inkEl.width = canvasWidth;
    inkEl.height = canvasHeight;
    inkCtx = inkEl.getContext('2d');
    clearInk();
  }

  function renderCanvas() {
    if (!ctx || !canvasEl) return;
    if (!imageUrl) {
      // Clean white canvas for new markup
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element) return false;
    const tag = element.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      element.isContentEditable === true
    );
  }

  function handleWindowKeyDown(e: KeyboardEvent) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (!pointerInside || isTypingTarget(e.target)) return;
    spaceHeld = true;
    e.preventDefault();
  }

  function handleWindowKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space' || e.key === ' ') {
      spaceHeld = false;
    }
  }

  function resetInputState() {
    spaceHeld = false;
    finishStroke();
    stopPan();
    touchGesture = null;
    gestureToken += 1;
    suppressSingleTouch = false;
    touchPoints.clear();
  }

  function handleWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || !canvasEl) return;
    e.preventDefault();

    const canvasRect = canvasEl.getBoundingClientRect();
    if (canvasRect.width <= 0) return;

    const scale = zoom / 100;
    const imagePointX = (e.clientX - canvasRect.left) / scale;
    const imagePointY = (e.clientY - canvasRect.top) / scale;

    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    const next = clampZoom(wheelZoom(zoom, e.deltaY * unit));
    if (Math.abs(next - zoom) < 0.001) return;

    onZoomChange(next);
    const newScale = next / 100;

    void tick().then(() => {
      if (!viewportEl || !canvasEl) return;
      const nextRect = canvasEl.getBoundingClientRect();
      viewportEl.scrollLeft += scrollDeltaToAnchor(
        nextRect.left,
        e.clientX,
        imagePointX,
        newScale
      );
      viewportEl.scrollTop += scrollDeltaToAnchor(
        nextRect.top,
        e.clientY,
        imagePointY,
        newScale
      );
    });
  }

  function capturePointer(pointerId: number) {
    try {
      viewportEl?.setPointerCapture?.(pointerId);
    } catch {}
  }

  function releasePointer(pointerId: number) {
    try {
      if (viewportEl?.hasPointerCapture?.(pointerId)) {
        viewportEl.releasePointerCapture(pointerId);
      }
    } catch {}
  }

  function clientToImage(clientX: number, clientY: number) {
    const canvas = canvasEl;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvasWidth / rect.width),
      y: (clientY - rect.top) * (canvasHeight / rect.height),
    };
  }

  function isInsideCanvas(clientX: number, clientY: number): boolean {
    const canvas = canvasEl;
    if (!canvas) return false;

    const rect = canvas.getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  function isMarkupTool(): boolean {
    return (
      activeTool === 'pen' ||
      activeTool === 'touch' ||
      activeTool === 'highlighter' ||
      activeTool === 'eraser'
    );
  }

  function usesPixelBrush(): boolean {
    return (
      (activeTool === 'pen' || activeTool === 'touch') &&
      Math.max(1, Math.round(penSize)) <= 1
    );
  }

  function penAlpha(): number {
    const value = Number.isFinite(penOpacity) ? penOpacity : 100;
    return Math.min(1, Math.max(0.1, value / 100));
  }

  function clearInk() {
    if (inkCtx && inkEl) {
      inkCtx.clearRect(0, 0, inkEl.width, inkEl.height);
    }
  }

  function drawPixelDot(target: CanvasRenderingContext2D, x: number, y: number, color: string) {
    target.fillStyle = color;
    target.fillRect(Math.floor(x), Math.floor(y), 1, 1);
  }

  function drawPixelSegment(
    target: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: string
  ) {
    target.fillStyle = color;
    for (const point of pixelLinePoints(fromX, fromY, toX, toY)) {
      target.fillRect(point.x, point.y, 1, 1);
    }
  }

  function drawPixelStroke(
    target: CanvasRenderingContext2D,
    points: StrokePoint[],
    color: string
  ) {
    if (points.length === 0) return;
    if (points.length === 1) {
      drawPixelDot(target, points[0].x, points[0].y, color);
      return;
    }
    for (let i = 1; i < points.length; i++) {
      drawPixelSegment(target, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, color);
    }
  }

  /** Draws a rounded, midpoint-smoothed freehand path. */
  function drawSmoothPath(
    target: CanvasRenderingContext2D,
    points: StrokePoint[],
    color: string,
    width: number
  ) {
    if (points.length === 0) return;

    target.save();
    target.strokeStyle = color;
    target.fillStyle = color;
    target.lineWidth = width;
    target.lineCap = 'round';
    target.lineJoin = 'round';

    if (points.length === 1) {
      target.beginPath();
      target.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
      target.fill();
      target.restore();
      return;
    }

    target.beginPath();
    target.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      target.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    const last = points[points.length - 1];
    target.lineTo(last.x, last.y);
    target.stroke();
    target.restore();
  }

  function drawHeldShape(
    target: CanvasRenderingContext2D,
    shape: HeldShape,
    color: string,
    width: number
  ) {
    const left = Math.min(shape.x1, shape.x2);
    const top = Math.min(shape.y1, shape.y2);
    const right = Math.max(shape.x1, shape.x2);
    const bottom = Math.max(shape.y1, shape.y2);

    target.save();
    target.strokeStyle = color;
    target.lineWidth = width;
    target.lineCap = 'round';
    target.lineJoin = 'round';

    if (shape.kind === 'rectangle') {
      target.strokeRect(left, top, right - left, bottom - top);
      target.restore();
      return;
    }

    if (shape.kind === 'oval') {
      target.beginPath();
      target.ellipse(
        (left + right) / 2,
        (top + bottom) / 2,
        Math.max(0.5, (right - left) / 2),
        Math.max(0.5, (bottom - top) / 2),
        0,
        0,
        Math.PI * 2
      );
      target.stroke();
      target.restore();
      return;
    }

    target.beginPath();
    target.moveTo(shape.x1, shape.y1);
    target.lineTo(shape.x2, shape.y2);
    target.stroke();

    if (shape.kind === 'arrow') {
      const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
      const head = Math.max(12, width * 4);
      const spread = 0.5;
      target.beginPath();
      target.moveTo(shape.x2, shape.y2);
      target.lineTo(
        shape.x2 - Math.cos(angle - spread) * head,
        shape.y2 - Math.sin(angle - spread) * head
      );
      target.moveTo(shape.x2, shape.y2);
      target.lineTo(
        shape.x2 - Math.cos(angle + spread) * head,
        shape.y2 - Math.sin(angle + spread) * head
      );
      target.stroke();
    }

    target.restore();
  }

  function redrawInk() {
    if (!inkCtx) return;
    clearInk();

    if (strokeSnapped) {
      drawHeldShape(inkCtx, strokeSnapped, penColor, Math.max(1, penSize));
    } else if (usesPixelBrush()) {
      drawPixelStroke(inkCtx, strokePoints, penColor);
    } else {
      drawSmoothPath(inkCtx, strokePoints, penColor, Math.max(1, penSize));
    }
  }

  function clearHoldTimer() {
    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  /**
   * Starts the Draw & Hold window after the pointer stops moving. A recognised
   * stroke is replaced in place; moving again restores the freehand path.
   */
  function scheduleHoldSnap() {
    clearHoldTimer();
    holdTimer = window.setTimeout(() => {
      holdTimer = null;
      if (!isDrawing || strokeSnapped) return;
      if (activeTool !== 'pen' && activeTool !== 'touch') return;

      const shape = detectHeldShape(strokePoints);
      if (!shape) return;

      strokeSnapped = shape;
      redrawInk();
    }, 500);
  }

  function strokeSegment(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: string,
    lineWidth: number,
    cap: CanvasLineCap
  ) {
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = cap;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  /**
   * The eraser belongs to the annotations, not the screenshot: it paints the
   * untouched capture back over everything under the brush, which removes ink
   * while keeping the original pixels intact.
   */
  function eraseSegment(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    lineWidth: number
  ) {
    if (!ctx) return;

    const radius = Math.max(1, lineWidth / 2);
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius / 2)));

    ctx.save();
    ctx.beginPath();
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      const x = fromX + (toX - fromX) * progress;
      const y = fromY + (toY - fromY) * progress;
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    ctx.clip();

    if (sourceImage) {
      ctx.drawImage(sourceImage, 0, 0, canvasWidth, canvasHeight);
    } else {
      // No capture to restore: leave the blank canvas the annotations sat on.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
    ctx.restore();
  }

  function startStrokeAt(clientX: number, clientY: number) {
    if (!ctx || !canvasEl || !isMarkupTool()) return;

    const point = clientToImage(clientX, clientY);
    isDrawing = true;
    didStroke = false;
    lastX = point.x;
    lastY = point.y;

    if (activeTool === 'pen' || activeTool === 'touch') {
      strokePoints = [{ x: point.x, y: point.y }];
      strokeSnapped = null;
      clearInk();
      redrawInk();
      didStroke = true;
      scheduleHoldSnap();
    }
  }

  function drawStrokeTo(clientX: number, clientY: number) {
    if (!isDrawing || !ctx || !canvasEl) return;

    const point = clientToImage(clientX, clientY);

    if (activeTool === 'pen' || activeTool === 'touch') {
      const wasSnapped = strokeSnapped !== null;
      strokePoints.push({ x: point.x, y: point.y });
      didStroke = true;

      if (wasSnapped) {
        strokeSnapped = null;
        redrawInk();
      } else if (usesPixelBrush()) {
        if (inkCtx) {
          drawPixelSegment(inkCtx, lastX, lastY, point.x, point.y, penColor);
        }
      } else {
        redrawInk();
      }

      scheduleHoldSnap();
    } else if (activeTool === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply';
      strokeSegment(
        lastX,
        lastY,
        point.x,
        point.y,
        highlighterColor,
        highlighterSize,
        'square'
      );
      ctx.globalCompositeOperation = 'source-over';
      didStroke = true;
    } else if (activeTool === 'eraser') {
      eraseSegment(lastX, lastY, point.x, point.y, 20);
      didStroke = true;
    }

    lastX = point.x;
    lastY = point.y;
  }

  function finishStroke() {
    clearHoldTimer();
    const isPenStroke = activeTool === 'pen' || activeTool === 'touch';

    if (isDrawing && isPenStroke && inkEl && ctx && strokePoints.length > 0) {
      if (strokeSnapped) redrawInk();

      // The whole stroke is composited once, so a translucent pen never builds
      // up darker patches where the path crosses itself.
      ctx.save();
      ctx.globalAlpha = penAlpha();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(inkEl, 0, 0);
      ctx.restore();
      clearInk();

      if (didStroke) onCanvasMutated();
    } else if (isDrawing && didStroke) {
      onCanvasMutated();
    }

    isDrawing = false;
    didStroke = false;
    strokePoints = [];
    strokeSnapped = null;
  }

  function startPan(clientX: number, clientY: number, pointerId: number) {
    if (!viewportEl) return;
    isPanning = true;
    panPointerId = pointerId;
    panStartX = clientX;
    panStartY = clientY;
    panScrollLeft = viewportEl.scrollLeft;
    panScrollTop = viewportEl.scrollTop;
  }

  function panTo(clientX: number, clientY: number) {
    if (!isPanning || !viewportEl) return;
    viewportEl.scrollLeft = panScrollLeft - (clientX - panStartX);
    viewportEl.scrollTop = panScrollTop - (clientY - panStartY);
  }

  function stopPan() {
    isPanning = false;
    panPointerId = null;
  }

  function blockMiddleButton(e: MouseEvent | PointerEvent) {
    if (e.button === 1) e.preventDefault();
  }

  function touchMidpoint() {
    if (touchPoints.size < 2) return null;
    const [first, second] = [...touchPoints.values()];
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  }

  function touchDistance() {
    if (touchPoints.size < 2) return 0;
    const [first, second] = [...touchPoints.values()];
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  function beginTouchGesture() {
    if (!canvasEl || !viewportEl) return;
    const midpoint = touchMidpoint();
    if (!midpoint) return;

    const rect = canvasEl.getBoundingClientRect();
    const scale = rect.width / canvasWidth || zoom / 100;
    touchGesture = {
      startDistance: Math.max(1, touchDistance()),
      startZoom: zoom,
      // Image point under the two fingertips.
      imageX: (midpoint.x - rect.left) / scale,
      imageY: (midpoint.y - rect.top) / scale,
      // Canvas position in client space with the viewport at its origin, so
      // both the zoom focus and the pan offset can be derived in one step
      // without re-measuring the canvas while it is being resized.
      originX: rect.left + viewportEl.scrollLeft,
      originY: rect.top + viewportEl.scrollTop,
    };
    gestureToken += 1;
  }

  function gestureZoom(distance: number): number {
    const gesture = touchGesture;
    if (!gesture || distance <= 0) return zoom;
    return clampZoom(gesture.startZoom * (distance / gesture.startDistance));
  }

  function applyTouchGesture() {
    const gesture = touchGesture;
    if (!gesture || !viewportEl) return;

    const midpoint = touchMidpoint();
    if (!midpoint) return;

    const nextZoom = gestureZoom(touchDistance());
    const zoomChanged = Math.abs(nextZoom - zoom) > 0.001;
    if (zoomChanged) onZoomChange(nextZoom);

    const scale = nextZoom / 100;
    const targetLeft = gesture.originX + gesture.imageX * scale - midpoint.x;
    const targetTop = gesture.originY + gesture.imageY * scale - midpoint.y;

    // Two-finger drag without a scale change is a plain pan and can move the
    // viewport immediately.
    if (!zoomChanged) {
      viewportEl.scrollLeft = targetLeft;
      viewportEl.scrollTop = targetTop;
      return;
    }

    // After a zoom the canvas must be laid out at its new size before the
    // offset is applied, otherwise the browser clamps it to the old range.
    if (gestureScrollPending) return;
    const token = gestureToken;
    gestureScrollPending = true;

    void tick().then(() => {
      gestureScrollPending = false;
      const current = touchGesture;
      if (token !== gestureToken || !current || !viewportEl) return;

      const currentMidpoint = touchMidpoint();
      if (!currentMidpoint) return;

      const currentScale = gestureZoom(touchDistance()) / 100;
      viewportEl.scrollLeft =
        current.originX + current.imageX * currentScale - currentMidpoint.x;
      viewportEl.scrollTop = current.originY + current.imageY * currentScale - currentMidpoint.y;
    });
  }

  function handleNativePinch(phase: PinchPhase, scale: number, clientX: number, clientY: number) {
    if (phase === 'end') {
      nativePinch = null;
      return;
    }

    if (phase === 'start') {
      const canvas = canvasEl;
      const viewport = viewportEl;
      if (!canvas || !viewport) return;

      const rect = canvas.getBoundingClientRect();
      const currentScale = rect.width / canvasWidth || zoom / 100;
      nativePinch = {
        baseZoom: zoom,
        appliedZoom: zoom,
        imageX: (clientX - rect.left) / currentScale,
        imageY: (clientY - rect.top) / currentScale,
        originX: rect.left + viewport.scrollLeft,
        originY: rect.top + viewport.scrollTop,
      };
      return;
    }

    const gesture = nativePinch;
    if (!gesture || !viewportEl) return;

    const next = clampZoom(gesture.baseZoom * scale);
    if (Math.abs(next - gesture.appliedZoom) > 0.001) {
      gesture.appliedZoom = next;
      onZoomChange(next);
    }

    const nextScale = next / 100;
    const targetLeft = gesture.originX + gesture.imageX * nextScale - clientX;
    const targetTop = gesture.originY + gesture.imageY * nextScale - clientY;

    // The canvas is resized by the zoom, so the offset has to be applied after
    // it has been laid out or it is clamped against the old scroll range.
    void tick().then(() => {
      if (nativePinch !== gesture || !viewportEl) return;
      viewportEl.scrollLeft = targetLeft;
      viewportEl.scrollTop = targetTop;
    });
  }

  function handleViewportPointerDown(e: PointerEvent) {
    if (!viewportEl) return;

    if (e.pointerType === 'touch') {
      e.preventDefault();
      touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
      capturePointer(e.pointerId);

      if (touchPoints.size === 1) {
        if (suppressSingleTouch) return;

        // Touch Writing draws with one finger; otherwise one finger pans.
        if (activeTool === 'touch' && !isCropping && isInsideCanvas(e.clientX, e.clientY)) {
          startStrokeAt(e.clientX, e.clientY);
        } else {
          startPan(e.clientX, e.clientY, e.pointerId);
        }
      } else if (touchPoints.size === 2) {
        finishStroke();
        stopPan();
        beginTouchGesture();
      }
      return;
    }

    const wantsPan = e.button === 1 || (e.button === 0 && spaceHeld);
    if (wantsPan) {
      e.preventDefault();
      startPan(e.clientX, e.clientY, e.pointerId);
      capturePointer(e.pointerId);
      return;
    }

    // Ctrl is a zoom modifier here, never a drawing modifier; ignoring it keeps
    // the old Ctrl+drag habit from leaving a stray stroke.
    if (
      e.button === 0 &&
      !(e.ctrlKey || e.metaKey) &&
      !isCropping &&
      isMarkupTool() &&
      isInsideCanvas(e.clientX, e.clientY)
    ) {
      e.preventDefault();
      startStrokeAt(e.clientX, e.clientY);
      capturePointer(e.pointerId);
    }
  }

  function handleViewportPointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      if (!touchPoints.has(e.pointerId)) return;
      touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (touchGesture && touchPoints.size >= 2) {
        e.preventDefault();
        applyTouchGesture();
        return;
      }
      if (suppressSingleTouch) return;

      if (isDrawing) {
        e.preventDefault();
        drawStrokeTo(e.clientX, e.clientY);
      } else if (isPanning && panPointerId === e.pointerId) {
        e.preventDefault();
        panTo(e.clientX, e.clientY);
      }
      return;
    }

    if (isDrawing) {
      if ((e.buttons & 1) === 0) {
        finishStroke();
        return;
      }
      drawStrokeTo(e.clientX, e.clientY);
    } else if (isPanning && panPointerId === e.pointerId) {
      panTo(e.clientX, e.clientY);
    }
  }

  function handleViewportPointerUp(e: PointerEvent) {
    releasePointer(e.pointerId);

    if (e.pointerType === 'touch') {
      touchPoints.delete(e.pointerId);

      if (touchGesture) {
        touchGesture = null;
        gestureToken += 1;
        suppressSingleTouch = touchPoints.size > 0;
      }

      finishStroke();
      if (isPanning && (panPointerId === e.pointerId || touchPoints.size === 0)) {
        stopPan();
      }

      if (touchPoints.size === 0) {
        suppressSingleTouch = false;
        touchGesture = null;
        gestureToken += 1;
      }
      return;
    }

    finishStroke();
    stopPan();
  }

  /** Returns the flattened composite bitmap (base capture plus all markup). */
  export function exportPngBlob(): Promise<Blob | null> {
    const canvas = canvasEl;
    if (!canvas) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      } catch {
        resolve(null);
      }
    });
  }

  /** Scales the current image so the whole capture is visible in the viewport. */
  export function fitToViewport(): boolean {
    const viewport = viewportEl;
    if (!viewport) return false;

    const style = getComputedStyle(viewport);
    const padX =
      (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
    const padY =
      (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
    const availableWidth = viewport.clientWidth - padX;
    const availableHeight = viewport.clientHeight - padY;

    if (availableWidth <= 0 || availableHeight <= 0) return false;

    onZoomChange(
      computeFitZoom(
        availableWidth,
        availableHeight,
        width || canvasWidth,
        height || canvasHeight
      )
    );
    return true;
  }

  /** Moves the zoom by a single percentage point. */
  function handleZoomStep(delta: number) {
    onZoomChange(nudgeZoom(zoom, delta));
  }

  function handleZoomSliderInput(e: Event) {
    const position = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(position)) return;
    onZoomChange(sliderPositionToZoom(position));
  }

  function handleZoomInputFocus(e: FocusEvent) {
    const input = e.currentTarget as HTMLInputElement;
    requestAnimationFrame(() => input.select());
  }

  function handleZoomInputKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      ignoreZoomCommit = true;
      (e.currentTarget as HTMLInputElement).blur();
    }
  }

  function handleZoomInputBlur(e: FocusEvent) {
    const input = e.currentTarget as HTMLInputElement;

    if (ignoreZoomCommit) {
      ignoreZoomCommit = false;
      input.value = `${Math.round(zoom)}%`;
      return;
    }

    const parsed = parseZoomInput(input.value);
    if (parsed === null) {
      input.value = `${Math.round(zoom)}%`;
      return;
    }

    onZoomChange(parsed);
    input.value = `${Math.round(parsed)}%`;
  }
</script>

<div class="flex-1 relative flex flex-col overflow-hidden bg-[#e5e7eb] dark:bg-[#07090e]">
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={viewportEl}
  role="region"
  aria-label="Capture canvas viewport"
  class="flex-1 overflow-auto p-6 flex select-none overscroll-contain touch-none"
  class:cursor-grab={panCursor && !isPanning}
  class:cursor-grabbing={isPanning}
  onpointerenter={() => (pointerInside = true)}
  onpointerleave={() => {
    pointerInside = false;
    if (!isPanning && !isDrawing) spaceHeld = false;
  }}
  onpointerdown={handleViewportPointerDown}
  onpointermove={handleViewportPointerMove}
  onpointerup={handleViewportPointerUp}
  onpointercancel={handleViewportPointerUp}
  onmousedown={blockMiddleButton}
  onauxclick={blockMiddleButton}
>
  <!-- Interactive Viewport Wrapper with True Zoom Sizing -->
  <div
    class="m-auto relative shrink-0 shadow-[0_16px_48px_rgba(0,0,0,0.18)] dark:shadow-[0_16px_48px_rgba(0,0,0,0.45)] border border-black/10 dark:border-white/10 rounded-sm bg-white"
  >
    <canvas
      bind:this={canvasEl}
      class="block touch-none {isPanning || panCursor
        ? isPanning
          ? 'cursor-grabbing'
          : 'cursor-grab'
        : 'cursor-crosshair'}"
      style="width: {displayWidth}px; height: {displayHeight}px; image-rendering: {imageRendering};"
    ></canvas>

    <!-- In-progress pen preview: committed to the capture when the stroke ends -->
    <canvas
      bind:this={inkEl}
      aria-hidden="true"
      class="absolute inset-0 block pointer-events-none"
      style="width: {displayWidth}px; height: {displayHeight}px; image-rendering: {imageRendering};"
    ></canvas>

    <!-- Crop Overlay with 8-Handle Bounding Box -->
    {#if isCropping}
      <div class="absolute inset-0 border-2 border-dashed border-[#0067c0] pointer-events-none">
        <!-- 4 Corner Handles -->
        <div class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nwse-resize"></div>
        <div class="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nesw-resize"></div>
        <div class="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nesw-resize"></div>
        <div class="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nwse-resize"></div>

        <!-- 4 Edge Handles -->
        <div class="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-ns-resize"></div>
        <div class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-ns-resize"></div>
        <div class="absolute top-1/2 -left-1.5 -translate-y-1/2 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-ew-resize"></div>
        <div class="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-ew-resize"></div>

        <!-- Floating Apply / Cancel Buttons -->
        <div class="absolute -bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-white dark:bg-[#181d28] border border-black/10 dark:border-white/10 rounded-full px-2 py-1 shadow-lg pointer-events-auto">
          <button
            type="button"
            class="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-emerald-600 dark:text-emerald-400 transition-colors cursor-pointer"
            onclick={onApplyCrop}
            title="Apply Crop"
          >
            <Check class="w-4 h-4 stroke-[2.2]" />
          </button>
          <button
            type="button"
            class="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
            onclick={onCancelCrop}
            title="Cancel Crop"
          >
            <X class="w-4 h-4 stroke-[2.2]" />
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<!-- Zoom control -->
<div
  class="absolute bottom-3 right-4 flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 bg-white/90 dark:bg-[#181d28]/90 border border-black/[0.08] dark:border-white/[0.08] rounded-full shadow-sm text-[11px] font-mono text-neutral-600 dark:text-neutral-400 backdrop-blur-sm"
>
  <button
    type="button"
    class="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-neutral-600 dark:text-neutral-300 transition-colors cursor-pointer"
    title="Zoom out by 1%"
    aria-label="Zoom out by 1 percent"
    onclick={() => handleZoomStep(-1)}
  >
    <Minus class="w-3.5 h-3.5" />
  </button>

  <input
    type="range"
    min="0"
    max={ZOOM_SLIDER_STEPS}
    step="1"
    value={zoomToSliderPosition(zoom)}
    aria-label="Zoom level"
    aria-valuetext={`${Math.round(zoom)}%`}
    class="w-28 cursor-pointer accent-[#0067c0] dark:accent-[#60cdff]"
    oninput={handleZoomSliderInput}
  />

  <button
    type="button"
    class="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-neutral-600 dark:text-neutral-300 transition-colors cursor-pointer"
    title="Zoom in by 1%"
    aria-label="Zoom in by 1 percent"
    onclick={() => handleZoomStep(1)}
  >
    <Plus class="w-3.5 h-3.5" />
  </button>

  <input
    type="text"
    inputmode="numeric"
    value={`${Math.round(zoom)}%`}
    title="Click to type a zoom percentage"
    aria-label="Zoom percentage"
    class="w-12 px-1 py-0.5 bg-transparent border-0 outline-none rounded-[4px] text-right tabular-nums select-text cursor-text hover:bg-black/[0.05] focus:bg-black/[0.07] dark:hover:bg-white/[0.07] dark:focus:bg-white/[0.1] text-neutral-600 dark:text-neutral-300 font-mono text-[11px] transition-colors"
    onfocus={handleZoomInputFocus}
    onblur={handleZoomInputBlur}
    onkeydown={handleZoomInputKeyDown}
  />
</div>
</div>
