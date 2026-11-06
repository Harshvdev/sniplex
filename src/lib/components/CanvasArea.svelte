<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Check, Minus, Plus, X } from '@lucide/svelte';
  import type { ToolType } from '../types';
  import { pixelLinePoints } from '../drawing';
  import { detectHeldShape, type HeldShape, type StrokePoint } from '../hold-snap';
  import { registerPinchBridge, type PinchPhase } from '../pinch';
  import { isFingerMarkupTool, touchActionFor } from '../touch-writing';
  import { HIGHLIGHTER_ALPHA, constrainStraightLine } from '../highlighter';
  import { ERASER_BRUSH_SIZE } from '../eraser';
  import type { EditorModel, MarkupOp } from '../markup';
  import {
    cloneEditorModel,
    cloneMarkupOps,
    createMarkupOpId,
    hitTestOp,
    opIntersectsRect,
    translateOp,
  } from '../markup';
  import type { HistorySnapshot } from '../history';
  import TextEditorBar from './TextEditorBar.svelte';
  import {
    clampTextSize,
    createTextLabel,
    estimateTextWidth,
    hitTextLabel,
    isCommittableText,
    labelHeight,
    labelLineHeight,
    labelWidth,
    textLines,
    type TextAlign,
    type TextLabel,
  } from '../text-label';
  import DraftingOverlay from './DraftingOverlay.svelte';
  import {
    PROTRACTOR_RADIUS,
    PROTRACTOR_SNAP_DISTANCE,
    RULER_SNAP_DISTANCE,
    rulerProjection,
    shouldSnapToProtractor,
    shouldSnapToRuler,
    type DraftingTool,
  } from '../drafting';
  import {
    fullCropRect,
    isEffectiveCrop,
    resizeCropRect,
    type CropHandle,
    type CropRect,
  } from '../crop';
  import type { ShapeKind } from '../types';
  import {
    EMOJI_DEFAULT_SIZE,
    SHAPE_DEFAULT_FILL,
    SHAPE_DEFAULT_OUTLINE,
    clampShapeWidth,
    constrainShapeEnd,
    shapeBounds,
    type ShapeGeometry,
  } from '../shapes';
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
    shapeKind = 'rectangle',
    shapeOutlineColor = SHAPE_DEFAULT_OUTLINE,
    shapeFillColor = SHAPE_DEFAULT_FILL,
    shapeStrokeWidth = 3,
    emojiGlyph = null,
    draftingTool = 'off',
    touchWritingEnabled = false,
    isCropping = false,
    onApplyCrop = () => {},
    onCancelCrop = () => {},
    onZoomChange = (z: number) => {},
    onImageReady = () => {},
    onCanvasMutated = () => {},
    onHistoryPush = (_label: string, _before: HistorySnapshot, _after: HistorySnapshot) => {},
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
    /** Phase 13: selected shape and its outline/fill style. */
    shapeKind: ShapeKind;
    shapeOutlineColor: string;
    shapeFillColor: string;
    shapeStrokeWidth: number;
    /** Phase 13: armed emoji stamp glyph, if any. */
    emojiGlyph: string | null;
    /** Phase 18: active drafting overlay (ruler / protractor / off). */
    draftingTool: DraftingTool;
    /** Phase 8 toggle: one finger inks when on, pans when off. */
    touchWritingEnabled: boolean;
    isCropping: boolean;
    onApplyCrop: () => void;
    onCancelCrop: () => void;
    onZoomChange?: (z: number) => void;
    onImageReady?: () => void;
    onCanvasMutated?: () => void;
    /** Phase 9: fired when a committed stroke should enter history. */
    onHistoryPush?: (
      label: string,
      before: HistorySnapshot,
      after: HistorySnapshot
    ) => void;
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
  // Phase 9: snapshot taken when the current edit began, pushed as the
  // history `before` state when the edit commits.
  let strokeStartSnapshot: HistorySnapshot | null = null;
  // Phase 12: snapshot taken when a label drag/commit started.
  let textStrokeSnapshot: HistorySnapshot | null = null;

  // Phase 18: draggable drafting overlay position and rotation.
  let draftingX = $state(200);
  let draftingY = $state(200);
  let draftingAngle = $state(0);

  // Phase 14: the active crop frame (full canvas by default, reset on load).
  let cropRect = $state<CropRect>(fullCropRect(960, 540));
  let cropDrag: { handle: CropHandle; startClientX: number; startClientY: number; original: CropRect } | null = null;

  /** Phase 14: resets the crop frame to the full canvas. */
  function resetCropFrame() {
    cropRect = fullCropRect(canvasWidth, canvasHeight);
  }

  /** Phase 14: begins resizing the crop frame from one handle. */
  function beginCropDrag(handle: CropHandle, e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    cropDrag = { handle, startClientX: e.clientX, startClientY: e.clientY, original: cropRect };
    capturePointer(e.pointerId);
  }

  /**
   * Phase 14: applies the crop. Re-renders from the *pristine* source cropped
   * to the frame plus translated markup ops, through history — so undo keeps
   * the pre-crop canvas alive and the cropped base stays truly pristine.
   */
  function applyCrop() {
    if (!ctx || !canvasEl) { onApplyCrop(); return; }
    const rect = cropRect;
    if (rect.width <= 0 || rect.height <= 0) { onApplyCrop(); return; }
    // A full-canvas frame changes nothing — close without a history entry.
    if (!isEffectiveCrop(rect, canvasWidth, canvasHeight)) {
      resetCropFrame();
      onApplyCrop();
      return;
    }

    const before = captureSnapshot();

    const croppedSource = document.createElement('canvas');
    croppedSource.width = Math.max(1, Math.round(rect.width));
    croppedSource.height = Math.max(1, Math.round(rect.height));
    const croppedCtx = croppedSource.getContext('2d');
    if (croppedCtx && sourceImage) {
      croppedCtx.drawImage(
        sourceImage,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        croppedSource.width,
        croppedSource.height
      );
    } else if (croppedCtx) {
      croppedCtx.fillStyle = '#ffffff';
      croppedCtx.fillRect(0, 0, croppedSource.width, croppedSource.height);
    }

    canvasWidth = croppedSource.width;
    canvasHeight = croppedSource.height;
    sourceImage = croppedSource;
    canvasEl.width = canvasWidth;
    canvasEl.height = canvasHeight;
    ops = ops
      .filter((op) => opIntersectsRect(op, rect))
      .map((op) => translateOp(op, -rect.x, -rect.y));

    sizeInkCanvas();
    resetCropFrame();
    cropDrag = null;
    renderComposite();

    const after = captureSnapshot();
    if (before && after) onHistoryPush?.('crop image', before, after);
    onCanvasMutated();
    onApplyCrop();
  }

  // Markup ops — the single source of truth for committed ink. Undo/Redo,
  // the eraser, crop and label/emoji edits all re-render from this list.
  let ops = $state<MarkupOp[]>([]);
  // Phase 13: the emoji op selected for move/resize/rotate.
  let selectedEmojiId = $state<string | null>(null);
  // Phase 13: drag state for the selected emoji's bounding frame.
  let emojiDrag: {
    id: string;
    mode: 'move' | 'scale' | 'rotate';
    startX: number;
    startY: number;
    original: { x: number; y: number; size: number; rotation: number };
  } | null = null;
  // Phase 11/13: live path of the stroke currently being drawn.
  let currentStrokePath: { x: number; y: number }[] = [];

  // Phase 13: in-progress drag-drawn shape (live preview on the ink overlay).
  let shapeDrag: ShapeGeometry | null = null;

  /** Drawable when the shapes tool is active and no emoji stamp is armed. */
  function isShapeDragActive(): boolean {
    return activeTool === 'shapes' && !emojiGlyph;
  }

  /** Draws one committed shape onto a 2d context (image coordinates). */
  function drawShape(target: CanvasRenderingContext2D, shape: ShapeGeometry) {
    const bounds = shapeBounds(shape);
    target.save();
    target.strokeStyle = shape.outlineColor;
    target.lineWidth = clampShapeWidth(shape.strokeWidth);
    target.lineJoin = 'round';
    target.lineCap = 'round';

    if (shape.fillColor !== 'transparent') {
      target.fillStyle = shape.fillColor;
      if (shape.kind === 'rectangle') {
        target.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
      } else if (shape.kind === 'oval') {
        target.beginPath();
        target.ellipse((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2, Math.max(0.5, (bounds.right - bounds.left) / 2), Math.max(0.5, (bounds.bottom - bounds.top) / 2), 0, 0, Math.PI * 2);
        target.fill();
      }
    }

    if (shape.kind === 'rectangle') {
      target.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    } else if (shape.kind === 'oval') {
      target.beginPath();
      target.ellipse((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2, Math.max(0.5, (bounds.right - bounds.left) / 2), Math.max(0.5, (bounds.bottom - bounds.top) / 2), 0, 0, Math.PI * 2);
      target.stroke();
    } else if (shape.kind === 'line') {
      target.beginPath();
      target.moveTo(shape.start.x, shape.start.y);
      target.lineTo(shape.end.x, shape.end.y);
      target.stroke();
    } else if (shape.kind === 'arrow') {
      target.beginPath();
      target.moveTo(shape.start.x, shape.start.y);
      target.lineTo(shape.end.x, shape.end.y);
      target.stroke();
      const angle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
      const head = Math.max(12, clampShapeWidth(shape.strokeWidth) * 4);
      target.beginPath();
      target.moveTo(shape.end.x, shape.end.y);
      target.lineTo(shape.end.x - Math.cos(angle - 0.5) * head, shape.end.y - Math.sin(angle - 0.5) * head);
      target.moveTo(shape.end.x, shape.end.y);
      target.lineTo(shape.end.x - Math.cos(angle + 0.5) * head, shape.end.y - Math.sin(angle + 0.5) * head);
      target.stroke();
    }
    target.restore();
  }

  /** Redraws the live shape preview on the ink overlay. */
  function redrawShapePreview() {
    if (!inkCtx) return;
    clearInk();
    if (shapeDrag) drawShape(inkCtx, shapeDrag);
  }

  /** Draws one committed markup op onto a 2d context (image coordinates). */
  function drawMarkupOp(target: CanvasRenderingContext2D, op: MarkupOp) {
    switch (op.type) {
      case 'stroke': {
        target.save();
        if (op.snapped) {
          drawHeldShape(target, op.snapped, op.color, Math.max(1, op.size));
        } else if (op.tool === 'pen') {
          target.globalAlpha = op.opacity;
          if (op.size <= 1) drawPixelStroke(target, op.points, op.color);
          else drawSmoothPath(target, op.points, op.color, Math.max(1, op.size));
        } else {
          // Highlighter: translucent, multiply-blended, square-cap chisel strokes.
          target.globalAlpha = HIGHLIGHTER_ALPHA;
          target.globalCompositeOperation = 'multiply';
          target.strokeStyle = op.color;
          target.lineWidth = op.size;
          target.lineCap = 'square';
          target.lineJoin = 'round';
          if (op.points.length === 1) {
            const p = op.points[0];
            target.beginPath();
            target.moveTo(p.x - 0.01, p.y);
            target.lineTo(p.x + 0.01, p.y);
            target.stroke();
          }
          for (let i = 1; i < op.points.length; i += 1) {
            target.beginPath();
            target.moveTo(op.points[i - 1].x, op.points[i - 1].y);
            target.lineTo(op.points[i].x, op.points[i].y);
            target.stroke();
          }
        }
        target.restore();
        return;
      }
      case 'shape':
        drawShape(target, op.shape);
        return;
      case 'emoji': {
        target.save();
        target.translate(op.x, op.y);
        target.rotate(op.rotation);
        target.font = `${op.size}px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif`;
        target.textAlign = 'center';
        target.textBaseline = 'middle';
        target.fillText(op.glyph, 0, 0);
        target.restore();
        return;
      }
      case 'label':
        drawTextLabel(target, op.label);
        return;
    }
  }

  /** Re-renders the composite from the pristine source plus all markup ops. */
  function renderComposite() {
    if (!ctx || !canvasEl) return;
    if (canvasEl.width !== canvasWidth) canvasEl.width = canvasWidth;
    if (canvasEl.height !== canvasHeight) canvasEl.height = canvasHeight;
    if (sourceImage) {
      ctx.drawImage(sourceImage, 0, 0, canvasWidth, canvasHeight);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
    for (const op of ops) drawMarkupOp(ctx, op);
  }

  /** Stamps an emoji glyph onto the composite, through history. */
  function stampEmoji(glyph: string, x: number, y: number) {
    if (!ctx) return;
    const before = captureSnapshot();
    const op: MarkupOp = {
      type: 'emoji',
      id: createMarkupOpId('emoji'),
      glyph,
      x,
      y,
      size: EMOJI_DEFAULT_SIZE,
      rotation: 0,
    };
    ops = [...ops, op];
    selectedEmojiId = op.id;
    renderComposite();
    const after = captureSnapshot();
    if (before && after) onHistoryPush?.('emoji stamp', before, after);
    onCanvasMutated();
  }

  /** Markup tools whose strokes the eraser registers for hit-testing. */
  function enabledMarkupPath(tool: ToolType): boolean {
    return tool === 'pen' || tool === 'highlighter';
  }

  /**
   * Phase 11: vector eraser. Removes every markup op the brush touches —
   * whole elements, never brush-sized fragments — and re-renders.
   * Returns true when at least one element was removed.
   */
  function eraseOpsAt(point: { x: number; y: number }): boolean {
    const hits = ops.filter((op) => hitTestOp(op, point, ERASER_BRUSH_SIZE / 2));
    if (hits.length === 0) return false;
    const hitIds = new Set(hits.map((op) => op.id));
    ops = ops.filter((op) => !hitIds.has(op.id));
    if (selectedEmojiId && hitIds.has(selectedEmojiId)) selectedEmojiId = null;
    renderComposite();
    return true;
  }

  /**
   * Sweeps the brush from one move point to the next, sampling along the
   * segment so a fast swipe can't tunnel through a thin element.
   */
  function eraseOpsAlongSegment(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const step = Math.max(1, ERASER_BRUSH_SIZE / 2);
    const steps = Math.max(1, Math.ceil(distance / step));
    let erased = false;
    for (let i = 1; i <= steps; i += 1) {
      const point = {
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      };
      if (eraseOpsAt(point)) erased = true;
    }
    return erased;
  }

  /** Phase 13: scaled selection for the emoji bounding-frame overlay. */
  const selectedEmojiOp = $derived(
    ops.find((op) => op.type === 'emoji' && op.id === selectedEmojiId) ?? null
  );

  /** Phase 13: live drag of the selected emoji (move / scale / rotate). */
  function updateEmojiDrag(clientX: number, clientY: number) {
    if (!emojiDrag) return;
    const point = clientToImage(clientX, clientY);
    const op = ops.find((o) => o.id === emojiDrag!.id);
    if (!op || op.type !== 'emoji') return;
    const original = emojiDrag.original;

    if (emojiDrag.mode === 'move') {
      const dx = point.x - emojiDrag.startX;
      const dy = point.y - emojiDrag.startY;
      ops = ops.map((o) =>
        o.id === op.id && o.type === 'emoji' ? { ...o, x: original.x + dx, y: original.y + dy } : o
      );
    } else if (emojiDrag.mode === 'scale') {
      const startDist = Math.hypot(emojiDrag.startX - original.x, emojiDrag.startY - original.y);
      const nowDist = Math.hypot(point.x - original.x, point.y - original.y);
      if (startDist > 1) {
        const size = Math.max(8, Math.min(512, original.size * (nowDist / startDist)));
        ops = ops.map((o) =>
          o.id === op.id && o.type === 'emoji' ? { ...o, size } : o
        );
      }
    } else {
      const angleStart = Math.atan2(emojiDrag.startY - original.y, emojiDrag.startX - original.x);
      const angleNow = Math.atan2(point.y - original.y, point.x - original.x);
      ops = ops.map((o) =>
        o.id === op.id && o.type === 'emoji' ? { ...o, rotation: original.rotation + (angleNow - angleStart) } : o
      );
    }
    renderComposite();
  }

  /** Phase 13: begins a bounding-frame drag from one of its handles. */
  function beginEmojiDrag(mode: 'move' | 'scale' | 'rotate', e: PointerEvent) {
    const op = selectedEmojiOp;
    if (!op || op.type !== 'emoji') return;
    e.preventDefault();
    e.stopPropagation();
    const point = clientToImage(e.clientX, e.clientY);
    emojiDrag = {
      id: op.id,
      mode,
      startX: point.x,
      startY: point.y,
      original: { x: op.x, y: op.y, size: op.size, rotation: op.rotation },
    };
    capturePointer(e.pointerId);
  }

  // Phase 12: inline editor state for the label currently being typed, plus
  // typography state. Committed labels live in `ops`.
  let editingLabel = $state<TextLabel | null>(null);
  let textFontSize = $state(24);
  let textColor = $state('#000000');
  let textAlign = $state<TextAlign>('left');
  let textDrag: {
    id: string;
    startX: number;
    startY: number;
    originalX: number;
    originalY: number;
    moved: boolean;
  } | null = null;
  let textInputEl = $state<HTMLTextAreaElement | null>(null);

  /** Draws one text label onto a 2d context at image-pixel coordinates. */
  function drawTextLabel(target: CanvasRenderingContext2D, label: TextLabel) {
    target.save();
    target.fillStyle = label.color;
    target.font = `${label.fontSize}px 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif`;
    target.textAlign = 'left';
    target.textBaseline = 'top';
    const width = labelWidth(label);
    const lineHeight = labelLineHeight(label.fontSize);
    for (const [index, line] of textLines(label.text).entries()) {
      const lineWidth = estimateTextWidth(label.fontSize, line);
      const offset =
        label.align === 'center'
          ? (width - lineWidth) / 2
          : label.align === 'right'
            ? width - lineWidth
            : 0;
      target.fillText(line, label.x + offset, label.y + index * lineHeight);
    }
    target.restore();
  }

  function commitEditing() {
    if (!editingLabel || !ctx) {
      editingLabel = null;
      return;
    }
    const label = editingLabel;
    editingLabel = null;
    const opIndex = ops.findIndex((op) => op.type === 'label' && op.label.id === label.id);
    const existed = opIndex >= 0;
    const before = textStrokeSnapshot;

    if (isCommittableText(label.text)) {
      const updated: MarkupOp = { type: 'label', id: label.id, label };
      ops = existed ? ops.map((op, i) => (i === opIndex ? updated : op)) : [...ops, updated];
      renderComposite();
      const after = captureSnapshot();
      if (before && after) onHistoryPush?.('text label', before, after);
      onCanvasMutated();
      return;
    }

    if (existed) {
      // Erasing the whole label (emptied it) is a real, reversible edit.
      ops = ops.filter((op) => !(op.type === 'label' && op.label.id === label.id));
      renderComposite();
      const after = captureSnapshot();
      if (before && after) onHistoryPush?.('text label', before, after);
      onCanvasMutated();
    }
    // A brand-new blank label is simply dropped — nothing to record.
  }

  // Navigation state: Space or the middle mouse button drags the view.
  let pointerInside = $state(false);
  let spaceHeld = $state(false);
  // Phase 10: keyboard modifiers tracked so highlighter drawing can
  // request a Shift-locked straight line at move time.
  let shiftHeld = $state(false);
  // Anchor of an in-progress highlighter stroke (image coordinates).
  let highlightAnchorX = 0;
  let highlightAnchorY = 0;
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
  // Pristine capture kept aside; the composite is re-rendered from it plus
  // the markup op list whenever anything changes.
  let sourceImage: CanvasImageSource | null = null;

  onMount(() => {
    canvasWidth = width || 960;
    canvasHeight = height || 540;
    if (canvasEl) {
      canvasEl.width = canvasWidth;
      canvasEl.height = canvasHeight;
      ctx = canvasEl.getContext('2d');
      renderComposite();
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
          }
        }
        // A fresh document: drop every bit of prior editing state.
        ops = [];
        selectedEmojiId = null;
        editingLabel = null;
        textDrag = null;
        emojiDrag = null;
        strokeStartSnapshot = null;
        textStrokeSnapshot = null;
        sizeInkCanvas();
        resetCropFrame();
        renderComposite();
        onImageReady();
      };
      img.src = url;
    } else {
      canvasWidth = width || 960;
      canvasHeight = height || 540;
      sourceImage = null;
      ops = [];
      selectedEmojiId = null;
      editingLabel = null;
      textDrag = null;
      emojiDrag = null;
      strokeStartSnapshot = null;
      textStrokeSnapshot = null;
      if (canvasEl) {
        const context = ctx || canvasEl.getContext('2d');
        if (context) {
          ctx = context;
          canvasEl.width = canvasWidth;
          canvasEl.height = canvasHeight;
        }
      }
      sizeInkCanvas();
      resetCropFrame();
      renderComposite();
      onImageReady();
    }
  });

  function sizeInkCanvas() {
    if (!inkEl) return;
    inkEl.width = canvasWidth;
    inkEl.height = canvasHeight;
    inkCtx = inkEl.getContext('2d');
    clearInk();
  }

  function currentModel(): EditorModel {
    return cloneEditorModel({ sourceImage, width: canvasWidth, height: canvasHeight, ops });
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
    if (e.key === 'Shift') shiftHeld = true;
    if (e.key === 'Escape') {
      selectedEmojiId = null;
      return;
    }
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (!pointerInside || isTypingTarget(e.target)) return;
    spaceHeld = true;
    e.preventDefault();
  }

  function handleWindowKeyUp(e: KeyboardEvent) {
    if (e.key === 'Shift') shiftHeld = false;
    if (e.code === 'Space' || e.key === ' ') {
      spaceHeld = false;
    }
  }

  function resetInputState() {
    spaceHeld = false;
    shiftHeld = false;
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
      activeTool === 'highlighter' ||
      activeTool === 'eraser' ||
      activeTool === 'text' ||
      activeTool === 'shapes'
    );
  }

  function usesPixelBrush(): boolean {
    return activeTool === 'pen' && Math.max(1, Math.round(penSize)) <= 1;
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
      if (activeTool !== 'pen') return;

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
   * Phase 18: magnetic snap onto the active ruler or protractor arc.
   * Scoped to pen/highlighter only. The snap radii are specified in display
   * pixels, so they are converted into image pixels using the current zoom.
   */
  function snapDraftingPoint(point: { x: number; y: number }): { x: number; y: number } {
    if (activeTool !== 'pen' && activeTool !== 'highlighter') return point;
    const scale = zoom / 100;
    const rulerThreshold = RULER_SNAP_DISTANCE / scale;
    const protractorThreshold = PROTRACTOR_SNAP_DISTANCE / scale;
    if (draftingTool === 'ruler' && shouldSnapToRuler({ x: draftingX, y: draftingY }, draftingAngle, point, rulerThreshold)) {
      return rulerProjection({ x: draftingX, y: draftingY }, draftingAngle, point).projected;
    }
    if (draftingTool === 'protractor' && shouldSnapToProtractor({ x: draftingX, y: draftingY }, PROTRACTOR_RADIUS, point, protractorThreshold)) {
      const angleFromCenter = Math.atan2(point.y - draftingY, point.x - draftingX);
      return {
        x: draftingX + Math.cos(angleFromCenter) * PROTRACTOR_RADIUS,
        y: draftingY + Math.sin(angleFromCenter) * PROTRACTOR_RADIUS,
      };
    }
    return point;
  }

  function startStrokeAt(clientX: number, clientY: number, viaTouch = false) {
    if (!ctx || !canvasEl || !isMarkupTool()) return;
    if (viaTouch && activeTool === 'eraser') return;

    // History: snapshot the composite before this stroke touches it.
    strokeStartSnapshot = captureSnapshot();
    // Phase 13: an armed emoji stamps on click (no drag).
    if (activeTool === 'shapes' && emojiGlyph && !isCropping) {
      const point = clientToImage(clientX, clientY);
      stampEmoji(emojiGlyph, point.x, point.y);
      return;
    }
    // Phase 13: clicking an existing emoji selects it for move/resize/rotate.
    if (activeTool === 'shapes' && !emojiGlyph && !isCropping) {
      const point = clientToImage(clientX, clientY);
      const hit = [...ops].reverse().find((op) => op.type === 'emoji' && hitTestOp(op, point, 4));
      if (hit && hit.type === 'emoji') {
        strokeStartSnapshot = captureSnapshot();
        selectedEmojiId = hit.id;
        isDrawing = true;
        didStroke = false;
        emojiDrag = {
          id: hit.id,
          mode: 'move',
          startX: point.x,
          startY: point.y,
          original: { x: hit.x, y: hit.y, size: hit.size, rotation: hit.rotation },
        };
        return;
      }
      selectedEmojiId = null;
    }
    // Phase 12: clicking an existing label selects it for dragging/editing
    // instead of inking a new stroke over it.
    if (activeTool === 'text' && !isCropping) {
      const point = clientToImage(clientX, clientY);
      const hit = ops.find((op) => op.type === 'label' && hitTextLabel(op.label, point.x, point.y));
      if (hit && hit.type === 'label') {
        // Start a potential drag; finishing without movement reopens the editor.
        textStrokeSnapshot = captureSnapshot();
        const label = hit.label;
        textDrag = { id: label.id, startX: point.x, startY: point.y, originalX: label.x, originalY: label.y, moved: false };
        return;
      }
      // No label here: open the inline text editor at this spot.
      textStrokeSnapshot = captureSnapshot();
      const label = createTextLabel({
        text: '',
        x: point.x,
        y: point.y,
        fontSize: clampTextSize(textFontSize),
        color: textColor,
        align: textAlign,
      });
      editingLabel = label;
      return;
    }

    // Snap the stroke's first point too, so the initial segment doesn't
    // kink from an unsnapped anchor to snapped points.
    const point = snapDraftingPoint(clientToImage(clientX, clientY));
    isDrawing = true;
    didStroke = false;
    lastX = point.x;
    lastY = point.y;
    highlightAnchorX = point.x;
    highlightAnchorY = point.y;
    currentStrokePath = enabledMarkupPath(activeTool) ? [{ x: point.x, y: point.y }] : [];

    // Phase 11: the eraser hit-tests the brush against markup ops, removing
    // whole elements (vector, undoable). Checked after `didStroke` resets so
    // the flag survives.
    if (activeTool === 'eraser') {
      if (eraseOpsAt(point)) didStroke = true;
    }

    // Phase 13: a shapes drag starts a live shape preview.
    if (isShapeDragActive()) {
      shapeDrag = {
        kind: shapeKind,
        start: { x: point.x, y: point.y },
        end: { x: point.x, y: point.y },
        outlineColor: shapeOutlineColor,
        fillColor: shapeFillColor,
        strokeWidth: clampShapeWidth(shapeStrokeWidth),
      };
      didStroke = true;
      redrawShapePreview();
    }

    if (activeTool === 'pen') {
      strokePoints = [{ x: point.x, y: point.y }];
      strokeSnapped = null;
      clearInk();
      redrawInk();
      didStroke = true;
      scheduleHoldSnap();
    }
  }

  function drawStrokeTo(clientX: number, clientY: number) {
    // Phase 13: bounding-frame drag for the selected emoji.
    if (emojiDrag) {
      updateEmojiDrag(clientX, clientY);
      return;
    }

    // Phase 14: dragging a crop handle resizes the crop frame.
    if (cropDrag) {
      const imagePoint = clientToImage(clientX, clientY);
      const startPoint = clientToImage(cropDrag.startClientX, cropDrag.startClientY);
      cropRect = resizeCropRect(
        cropDrag.original,
        cropDrag.handle,
        imagePoint.x - startPoint.x,
        imagePoint.y - startPoint.y,
        canvasWidth,
        canvasHeight
      );
      return;
    }

    // Phase 13: live shape preview while dragging.
    if (shapeDrag && isDrawing) {
      const point = clientToImage(clientX, clientY);
      shapeDrag = {
        ...shapeDrag,
        end: constrainShapeEnd(shapeDrag.start, point, shapeDrag.kind, shiftHeld),
      };
      redrawShapePreview();
      return;
    }

    // Phase 12: dragging a committed label moves it live.
    if (textDrag) {
      const point = clientToImage(clientX, clientY);
      const op = ops.find((o) => o.type === 'label' && o.label.id === textDrag!.id);
      if (op && op.type === 'label') {
        const movedLabel = {
          ...op.label,
          x: textDrag.originalX + (point.x - textDrag.startX),
          y: textDrag.originalY + (point.y - textDrag.startY),
        };
        textDrag.moved = true;
        ops = ops.map((o) => (o.id === op.id && o.type === 'label' ? { ...o, label: movedLabel } : o));
        renderComposite();
      }
      return;
    }

    if (!isDrawing || !ctx || !canvasEl) return;

    let point = snapDraftingPoint(clientToImage(clientX, clientY));

    if (activeTool === 'pen') {
      const wasSnapped = strokeSnapped !== null;
      strokePoints.push({ x: point.x, y: point.y });
      currentStrokePath.push({ x: point.x, y: point.y });
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
      // Phase 10: Shift constrains the stroke to a horizontal/vertical line
      // through its anchor; otherwise the freehand chisel stroke applies.
      let endX = point.x;
      let endY = point.y;
      if (shiftHeld) {
        const constrained = constrainStraightLine(
          { x: highlightAnchorX, y: highlightAnchorY },
          { x: point.x, y: point.y }
        );
        endX = constrained.x;
        endY = constrained.y;
      }
      ctx.save();
      ctx.globalAlpha = HIGHLIGHTER_ALPHA;
      ctx.globalCompositeOperation = 'multiply';
      strokeSegment(lastX, lastY, endX, endY, highlighterColor, highlighterSize, 'square');
      ctx.restore();
      currentStrokePath.push({ x: endX, y: endY });
      lastX = endX;
      lastY = endY;
      didStroke = true;
    } else if (activeTool === 'eraser') {
      if (eraseOpsAlongSegment({ x: lastX, y: lastY }, point)) didStroke = true;
    }

    // Highlighter already advanced lastX/lastY to the constrained endpoint.
    if (activeTool !== 'highlighter') {
      lastX = point.x;
      lastY = point.y;
    }
  }

  function finishStroke() {
    clearHoldTimer();
    const isPenStroke = activeTool === 'pen';

    // Phase 13: commit the bounding-frame drag (move / scale / rotate).
    if (emojiDrag) {
      const drag = emojiDrag;
      emojiDrag = null;
      const op = ops.find((o) => o.id === drag.id);
      const changed =
        op && op.type === 'emoji' &&
        (op.x !== drag.original.x || op.y !== drag.original.y || op.size !== drag.original.size || op.rotation !== drag.original.rotation);
      if (changed) {
        const before = strokeStartSnapshot;
        const after = captureSnapshot();
        if (before && after) onHistoryPush?.('emoji transform', before, after);
        onCanvasMutated();
      }
      strokeStartSnapshot = null;
      return;
    }

    // Phase 12: a drag that moved a label commits it to history;
    // a press that never moved reopens the label editor.
    if (textDrag) {
      const drag = textDrag;
      textDrag = null;
      const op = ops.find((o) => o.type === 'label' && o.label.id === drag.id);
      if (!op || op.type !== 'label') return;
      if (drag.moved) {
        const before = textStrokeSnapshot;
        const after = captureSnapshot();
        if (before && after) onHistoryPush?.('move text label', before, after);
        onCanvasMutated();
      } else {
        textStrokeSnapshot = captureSnapshot();
        editingLabel = { ...op.label };
      }
      return;
    }

    // History label for the stroke that just committed. Shapes push their
    // entry in the commit block below instead of this generic path.
    const committed =
      isDrawing && didStroke && (isPenStroke || activeTool === 'highlighter' || activeTool === 'eraser')
        ? activeTool === 'pen'
          ? 'pen stroke'
          : activeTool === 'highlighter'
            ? 'highlight stroke'
            : 'erase'
        : null;

    // Phase 13: commit the dragged shape as an op, through history.
    // Only a click with no movement (zero extent) creates no shape.
    const hasShapeExtent =
      shapeDrag !== null &&
      Math.hypot(shapeDrag.end.x - shapeDrag.start.x, shapeDrag.end.y - shapeDrag.start.y) > 0;
    if (isDrawing && didStroke && hasShapeExtent && activeTool === 'shapes' && !emojiGlyph && shapeDrag && ctx && inkEl) {
      const before = strokeStartSnapshot;
      const shape = shapeDrag;
      ops = [...ops, { type: 'shape', id: createMarkupOpId('shape'), shape }];
      renderComposite();
      clearInk();
      const after = captureSnapshot();
      if (before && after) onHistoryPush?.('shape', before, after);
      shapeDrag = null;
      onCanvasMutated();
    }

    if (isDrawing && isPenStroke && inkEl && ctx && strokePoints.length > 0) {
      if (didStroke) {
        ops = [
          ...ops,
          {
            type: 'stroke',
            id: createMarkupOpId('stroke'),
            tool: 'pen',
            points: currentStrokePath.map((point) => ({ ...point })),
            color: penColor,
            size: Math.max(1, Math.round(penSize)),
            opacity: penAlpha(),
            snapped: strokeSnapped,
          },
        ];
        renderComposite();
        onCanvasMutated();
      }
      clearInk();
    } else if (isDrawing && didStroke && activeTool === 'highlighter') {
      // The composite already holds the ink (drawn incrementally); push the
      // op and re-render deterministically so all tools share one model.
      ops = [
        ...ops,
        {
          type: 'stroke',
          id: createMarkupOpId('stroke'),
          tool: 'highlighter',
          points: currentStrokePath.map((point) => ({ ...point })),
          color: highlighterColor,
          size: highlighterSize,
          opacity: 1,
          snapped: null,
        },
      ];
      renderComposite();
      onCanvasMutated();
    } else if (isDrawing && didStroke) {
      onCanvasMutated();
    }

    // Phase 13: the shape commit above already pushed its history entry.
    if (committed && strokeStartSnapshot) {
      const afterSnapshot = captureSnapshot();
      if (afterSnapshot) {
        onHistoryPush?.(committed, strokeStartSnapshot, afterSnapshot);
      }
    }

    strokeStartSnapshot = null;
    currentStrokePath = [];
    if (activeTool === 'shapes') { shapeDrag = null; clearInk(); }

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

    // Phase 14: viewport presses never ink while a crop is active; only
    // the frame handles (which stop propagation) move the rectangle.
    if (isCropping) return;

    if (e.pointerType === 'touch') {
      e.preventDefault();
      touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
      capturePointer(e.pointerId);

      if (touchPoints.size === 1) {
        if (suppressSingleTouch) return;

        // Phase 8: one finger inks (active pen/highlighter) when the
        // Touch Writing toggle is on; otherwise it pans the viewport.
        const action = touchActionFor({
          activeTool,
          touchWritingEnabled,
          isCropping,
          insideCanvas: isInsideCanvas(e.clientX, e.clientY),
        });
        if (action === 'draw' && isFingerMarkupTool(activeTool)) {
          startStrokeAt(e.clientX, e.clientY, true);
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
      if (emojiDrag || cropDrag) {
        e.preventDefault();
        drawStrokeTo(e.clientX, e.clientY);
        return;
      }
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

    if (emojiDrag || cropDrag) {
      drawStrokeTo(e.clientX, e.clientY);
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
      cropDrag = null;

      if (touchPoints.size === 0) {
        suppressSingleTouch = false;
        touchGesture = null;
        gestureToken += 1;
      }
      return;
    }

    finishStroke();
    stopPan();
    cropDrag = null;
  }

  /** Phase 9: captures the current editor model (and composite bitmap) for history. */
  export function captureSnapshot(): HistorySnapshot | null {
    if (!ctx || !canvasEl) return null;
    return { data: new Uint8ClampedArray(0), width: canvasWidth, height: canvasHeight, model: currentModel() };
  }

  /** Phase 9: restores a history snapshot onto the composite canvas. */
  export function restoreSnapshot(data: Uint8ClampedArray, width: number, height: number, model?: EditorModel): void {
    if (!ctx || !canvasEl || width <= 0 || height <= 0) return;
    if (model) {
      sourceImage = model.sourceImage;
      canvasWidth = model.width;
      canvasHeight = model.height;
      canvasEl.width = canvasWidth;
      canvasEl.height = canvasHeight;
      ops = cloneMarkupOps(model.ops);
      selectedEmojiId = null;
      editingLabel = null;
      textDrag = null;
      emojiDrag = null;
      sizeInkCanvas();
      resetCropFrame();
      renderComposite();
      return;
    }
    // Legacy bitmap path: resize first so partial/mismatched restores are exact.
    canvasEl.width = width;
    canvasEl.height = height;
    canvasWidth = width;
    canvasHeight = height;
    if (data.length < width * height * 4) return;
    const imageData = new ImageData(new Uint8ClampedArray(data), width, height);
    ctx.putImageData(imageData, 0, 0);
    clearInk();
    sizeInkCanvas();
    resetCropFrame();
  }

  /**
   * Phase 11: Erase all ink. Removes every markup op — pen, highlighter,
   * shapes, emojis, labels — while keeping the pristine capture, reversible
   * with Undo.
   */
  export function eraseAllInk(): void {
    if (!ctx || !canvasEl) return;
    if (ops.length === 0) return;
    const before = captureSnapshot();
    if (!before) return;

    ops = [];
    selectedEmojiId = null;
    didStroke = false;
    sizeInkCanvas();
    renderComposite();

    const after = captureSnapshot();
    if (after) onHistoryPush?.('erase all ink', before, after);
    onCanvasMutated();
  }

  /** Returns the flattened composite canvas (base capture plus all markup). */
  export function compositeCanvas(): HTMLCanvasElement | null {
    return canvasEl;
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
  <!-- Phase 12: floating typography controls while a label is being edited -->
  {#if editingLabel}
    <TextEditorBar
      fontSize={textFontSize}
      color={textColor}
      align={textAlign}
      onFontSizeChange={(size) => {
        textFontSize = clampTextSize(size);
        if (editingLabel) editingLabel = { ...editingLabel, fontSize: textFontSize };
      }}
      onColorChange={(colorValue) => {
        textColor = colorValue;
        if (editingLabel) editingLabel = { ...editingLabel, color: textColor };
      }}
      onAlignChange={(alignValue) => {
        textAlign = alignValue;
        if (editingLabel) editingLabel = { ...editingLabel, align: textAlign };
      }}
    />
  {/if}
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

    <!-- Phase 12: inline text editor (click to type, Esc / click-away commits) -->
    {#if editingLabel}
      {@const scale = zoom / 100}
      <textarea
        bind:this={textInputEl}
        data-testid="text-label-editor"
        value={editingLabel.text}
        placeholder="Type label…"
        aria-label="Text label"
        class="absolute z-10 box-border select-text rounded-sm border border-[#0067c0] bg-transparent p-0 outline-none"
        style="left: {editingLabel.x * scale}px; top: {editingLabel.y * scale}px; width: {Math.max(120, labelWidth(editingLabel)) * scale}px; min-height: {labelHeight(editingLabel) * scale}px; font-size: {editingLabel.fontSize * scale}px; color: {editingLabel.color}; text-align: {editingLabel.align}; font-family: 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;"
        oninput={(e) => {
          if (editingLabel) editingLabel = { ...editingLabel, text: (e.target as HTMLTextAreaElement).value };
        }}
        onkeydown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            commitEditing();
          }
          e.stopPropagation();
        }}
        onblur={() => commitEditing()}
      ></textarea>
    {/if}

    <!-- Phase 13: bounding frame for the selected emoji (move / resize / rotate) -->
    {#if selectedEmojiOp && selectedEmojiOp.type === 'emoji' && !isCropping}
      {@const op = selectedEmojiOp}
      {@const scale = zoom / 100}
      {@const box = op.size * scale}
      <div class="absolute z-10" style="left: {op.x * scale}px; top: {op.y * scale}px;">
        <div
          class="absolute border-2 border-dashed border-[#0067c0] rounded-sm pointer-events-none"
          style="width: {box}px; height: {box}px; transform: translate(-50%, -50%) rotate({op.rotation}rad);"
        >
          <!-- Connector line to the rotate handle -->
          <div class="absolute left-1/2 top-0 h-5 w-px -translate-x-1/2 -translate-y-full bg-[#0067c0]"></div>
          <div
            class="absolute left-1/2 top-0 h-3.5 w-3.5 -translate-x-1/2 -translate-y-[calc(100%+1.1rem)] rounded-full bg-white border-2 border-[#0067c0] pointer-events-auto cursor-grab"
            role="button"
            aria-label="Rotate emoji"
            tabindex="0"
            onpointerdown={(e) => beginEmojiDrag('rotate', e)}
          ></div>
          <!-- 4 corner scale handles (uniform resize around the center) -->
          <div class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nwse-resize rounded-sm" role="button" aria-label="Emoji handle" tabindex="0" onpointerdown={(e) => beginEmojiDrag('scale', e)}></div>
          <div class="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nesw-resize rounded-sm" role="button" aria-label="Emoji handle" tabindex="0" onpointerdown={(e) => beginEmojiDrag('scale', e)}></div>
          <div class="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nesw-resize rounded-sm" role="button" aria-label="Emoji handle" tabindex="0" onpointerdown={(e) => beginEmojiDrag('scale', e)}></div>
          <div class="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nwse-resize rounded-sm" role="button" aria-label="Emoji handle" tabindex="0" onpointerdown={(e) => beginEmojiDrag('scale', e)}></div>
        </div>
      </div>
    {/if}

    <!-- Crop Overlay with 8-Handle Bounding Box -->
    {#if isCropping}
      {@const cropScale = zoom / 100}
      {@const frameW = cropRect.width * cropScale}
      {@const frameH = cropRect.height * cropScale}
      {@const frameL = cropRect.x * cropScale}
      {@const frameT = cropRect.y * cropScale}
      <!-- Dim only the exterior: an even-odd clip punches a hole for the frame. -->
      <div
        class="absolute inset-0 bg-black/45 pointer-events-none"
        style="clip-path: polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, {frameL}px {frameT}px, {frameL}px {frameT + frameH}px, {frameL + frameW}px {frameT + frameH}px, {frameL + frameW}px {frameT}px)"
      ></div>
      <div class="absolute border-2 border-dashed border-[#0067c0] pointer-events-none" style="left: {cropRect.x * cropScale}px; top: {cropRect.y * cropScale}px; width: {frameW}px; height: {frameH}px;">
        <!-- 4 Corner Handles -->
        <div class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nwse-resize" role="button" aria-label="Crop handle" tabindex="0" onpointerdown={(e) => beginCropDrag('nw', e)}></div>
        <div class="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nesw-resize" role="button" aria-label="Crop handle" tabindex="0" onpointerdown={(e) => beginCropDrag('ne', e)}></div>
        <div class="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nesw-resize" role="button" aria-label="Crop handle" tabindex="0" onpointerdown={(e) => beginCropDrag('sw', e)}></div>
        <div class="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nwse-resize" role="button" aria-label="Crop handle" tabindex="0" onpointerdown={(e) => beginCropDrag('se', e)}></div>

        <!-- 4 Edge Handles -->
        <div class="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-ns-resize" role="button" aria-label="Crop handle" tabindex="0" onpointerdown={(e) => beginCropDrag('n', e)}></div>
        <div class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-ns-resize" role="button" aria-label="Crop handle" tabindex="0" onpointerdown={(e) => beginCropDrag('s', e)}></div>
        <div class="absolute top-1/2 -left-1.5 -translate-y-1/2 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-ew-resize" role="button" aria-label="Crop handle" tabindex="0" onpointerdown={(e) => beginCropDrag('w', e)}></div>
        <div class="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-ew-resize" role="button" aria-label="Crop handle" tabindex="0" onpointerdown={(e) => beginCropDrag('e', e)}></div>

        <!-- Floating Apply / Cancel Buttons -->
        <div class="absolute -bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-white dark:bg-[#181d28] border border-black/10 dark:border-white/10 rounded-full px-2 py-1 shadow-lg pointer-events-auto">
          <button
            type="button"
            class="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-emerald-600 dark:text-emerald-400 transition-colors cursor-pointer"
            onclick={() => applyCrop()}
            title="Apply Crop"
          >
            <Check class="w-4 h-4 stroke-[2.2]" />
          </button>
          <button
            type="button"
            class="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
            onclick={() => { resetCropFrame(); onCancelCrop(); }}
            title="Cancel Crop"
          >
            <X class="w-4 h-4 stroke-[2.2]" />
          </button>
        </div>
      </div>
    {/if}

    <!-- Phase 18: draggable ruler / protractor overlay -->
    <DraftingOverlay
      tool={draftingTool}
      x={draftingX}
      y={draftingY}
      angle={draftingAngle}
      scale={zoom / 100}
      onDrag={(nx, ny) => { draftingX = nx; draftingY = ny; }}
      onRotate={(angle) => { draftingAngle = angle; }}
    />
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
