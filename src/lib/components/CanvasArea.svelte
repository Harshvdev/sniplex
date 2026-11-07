<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Check, Minus, Plus, X, Copy } from '@lucide/svelte';
  import type { ToolType } from '../types';
  import type { OcrWord, ScanRect } from '../scan-text';
  import { marqueeSelect, wordAtPoint } from '../scan-text';
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
  import {
    clampTextSize,
    cornerScale,
    createTextLabel,
    estimateTextWidth,
    hitTextLabel,
    isCommittableText,
    labelHeight,
    labelLineHeight,
    labelWidth,
    textBoxZone,
    textLines,
    textZoneCursor,
    wrappedTextLines,
    type TextAlign,
    type TextLabel,
    type TextZone,
  } from '../text-label';
  import DraftingOverlay from './DraftingOverlay.svelte';
  import {
    RULER_SNAP_DISTANCE,
    rulerProjection,
    rulerEdgeProjection,
    rotateAroundHinge,
    type DraftingTool,
  } from '../drafting';
  import {
    clampCropRect,
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

  type ScanStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

  let {
    imageUrl = '',
    width = 960,
    height = 540,
    zoom = 100,
    activeTool = 'pen',
    penColor = '#0078d4',
    penSize = 3,
    highlighterColor = '#ffeb3b',
    highlighterSize = 18,
    shapeKind = 'rectangle',
    shapeOutlineColor = SHAPE_DEFAULT_OUTLINE,
    shapeFillColor = SHAPE_DEFAULT_FILL,
    shapeStrokeWidth = 3,
    shapeOutlineOpacity = 1,
    shapeFillOpacity = 1,
    emojiGlyph = null,
    textFontFamily = 'Segoe UI Variable',
    textFontSize = 24,
    textBold = false,
    textItalic = false,
    textUnderline = false,
    textColor = '#000000',
    textHighlight = false,
    textAlign = 'left',
    draftingTool = 'off',
    touchWritingEnabled = false,
    isCropping = false,
    onApplyCrop = () => {},
    onCancelCrop = () => {},
    /** Phase 21: Scan Text overlay state & callbacks. */
    isScanActive = false,
    scanWords = [],
    scanSelectedIds = new Set<string>(),
    scanStatus = 'idle' as ScanStatus,
    scanProgress = 0,
    scanError = null as string | null,
    onScanMarquee = (_rect: ScanRect) => {},
    onScanClearSelection = () => {},
    onScanCancel = () => {},
    onScanRetry = () => {},
    onScanCopySelection = () => {},
    onScanSelectAll = () => {},
    onZoomChange = (z: number) => {},
    onImageReady = () => {},
    onCanvasMutated = () => {},
    onHistoryPush = (_label: string, _before: HistorySnapshot, _after: HistorySnapshot) => {},
    onHistoryBoundary = () => {},
    onHistoryAmend = (_after: HistorySnapshot) => {},
  }: {
    imageUrl: string;
    width?: number;
    height?: number;
    zoom: number;
    activeTool: ToolType;
    penColor: string;
    penSize: number;
    highlighterColor: string;
    highlighterSize: number;
    /** Phase 13: selected shape and its outline/fill style. */
    shapeKind: ShapeKind;
    shapeOutlineColor: string;
    shapeFillColor: string;
    shapeStrokeWidth: number;
    shapeOutlineOpacity: number;
    shapeFillOpacity: number;
    /** Phase 13: armed emoji stamp glyph, if any. */
    textFontFamily: string;
    textFontSize: number;
    textBold: boolean;
    textItalic: boolean;
    textUnderline: boolean;
    textColor: string;
    textHighlight: boolean;
    textAlign: TextAlign;
    emojiGlyph: string | null;
    /** Phase 18: active drafting overlay (ruler / off). */
    draftingTool: DraftingTool;
    /** Phase 8 toggle: one finger inks when on, pans when off. */
    touchWritingEnabled: boolean;
    isCropping: boolean;
    onApplyCrop: () => void;
    onCancelCrop: () => void;
    /** Phase 21: Scan Text overlay state & callbacks. */
    isScanActive?: boolean;
    scanWords?: OcrWord[];
    scanSelectedIds?: Set<string>;
    scanStatus?: ScanStatus;
    scanProgress?: number;
    scanError?: string | null;
    onScanMarquee?: (rect: ScanRect) => void;
    onScanClearSelection?: () => void;
    onScanCancel?: () => void;
    onScanRetry?: () => void;
    onScanCopySelection?: () => void;
    onScanSelectAll?: () => void;
    onZoomChange?: (z: number) => void;
    onImageReady?: () => void;
    onCanvasMutated?: () => void;
    /** Phase 9: fired when a committed stroke should enter history. */
    onHistoryPush?: (
      label: string,
      before: HistorySnapshot,
      after: HistorySnapshot
    ) => void;
    /** Fired at a non-undoable boundary (crop) so undo cannot cross it. */
    onHistoryBoundary?: () => void;
    /** Wet-ink edits amend the latest entry instead of pushing a new one. */
    onHistoryAmend?: (after: HistorySnapshot) => void;
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

  // Phase 21: Scan Text marquee drag + context menu (image coords).
  let scanDrag = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  let scanDragStart = $state<{ x: number; y: number } | null>(null);
  let scanMenu = $state<{ x: number; y: number } | null>(null);

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
   * Begins a zone drag from a visible text-box handle dot. Works for the
   * box being edited as well as committed boxes: while editing, the drag
   * updates the editing label live and the edit session (with its history
   * snapshot) stays open until click-away/Esc commits it. preventDefault
   * also keeps the editor focused instead of blurring it first.
   */
  function beginTextZoneDrag(label: TextLabel, zone: TextZone, e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (zone === 'interior') return;
    const point = clientToImage(e.clientX, e.clientY);
    // Editing drags are part of the edit session; keep its original snapshot.
    if (editingLabel?.id !== label.id) textStrokeSnapshot = captureSnapshot();
    textResize = {
      id: label.id,
      zone,
      startX: point.x,
      startY: point.y,
      originalX: label.x,
      originalY: label.y,
      origW: editingLabel?.id === label.id ? editingBoxWidth(label) : labelWidth(label),
      origH: editingLabel?.id === label.id ? (editingBoxHeight ?? labelHeight(label)) : labelHeight(label),
      origFontSize: label.fontSize,
      origMaxWidth: label.maxWidth ?? 0,
      moved: false,
    };
    isDrawing = true;
    capturePointer(e.pointerId);
  }

  /**
   * Phase 14: applies the crop non-destructively. Crop is NOT undoable
   * (Phase 9 crop-isolation rule) — instead of pushing history, the original
   * buffer is preserved so re-entering Crop restores it.
   */
  function applyCrop() {
    if (!ctx || !canvasEl) { onApplyCrop(); return; }
    const rect = cropRect;
    if (rect.width <= 0 || rect.height <= 0) { onApplyCrop(); return; }

    // A full-frame Apply when a restore snapshot exists means "un-crop".
    const restoring = cropOriginal !== null && !isEffectiveCrop(rect, cropOriginal.width, cropOriginal.height);

    if (!cropOriginal) {
      cropOriginal = {
        source: sourceImage,
        width: canvasWidth,
        height: canvasHeight,
        ops: cloneMarkupOps(ops),
      };
    }

    if (restoring) {
      const original = cropOriginal;
      sourceImage = original.source;
      canvasWidth = original.width;
      canvasHeight = original.height;
      canvasEl.width = canvasWidth;
      canvasEl.height = canvasHeight;
      ops = cloneMarkupOps(original.ops);
      cropOriginal = null;
      lastCropRect = null;
    } else if (!isEffectiveCrop(rect, canvasWidth, canvasHeight)) {
      resetCropFrame();
      onApplyCrop();
      return;
    } else {
      const croppedSource = document.createElement('canvas');
      croppedSource.width = Math.max(1, Math.round(rect.width));
      croppedSource.height = Math.max(1, Math.round(rect.height));
      const croppedCtx = croppedSource.getContext('2d');
      if (croppedCtx && sourceImage) {
        croppedCtx.drawImage(
          sourceImage,
          rect.x, rect.y, rect.width, rect.height,
          0, 0, croppedSource.width, croppedSource.height
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
      lastCropRect = { ...rect };
    }

    sizeInkCanvas();
    resetCropFrame();
    cropDrag = null;
    renderComposite();
    // Crop is a history boundary: Undo must never restore pre-crop state.
    onHistoryBoundary();
    onCanvasMutated();
    onApplyCrop();
  }

  // Markup ops — the single source of truth for committed ink. Undo/Redo,
  // the eraser, crop and label/emoji edits all re-render from this list.
  let ops = $state<MarkupOp[]>([]);
  // Non-destructive crop: the pre-crop source + ops, preserved for the session
  // so re-entering Crop can show/restore the full original.
  let cropOriginal = $state<{ source: CanvasImageSource | null; width: number; height: number; ops: MarkupOp[] } | null>(null);
  // Last applied crop rect (image pixels, relative to the original buffer).
  let lastCropRect = $state<CropRect | null>(null);

  // Re-entering Crop after an applied crop shows the preserved original
  // buffer with the last crop box indicated (non-destructive restore).
  $effect(() => {
    if (isCropping && cropOriginal && lastCropRect) {
      const original = cropOriginal;
      sourceImage = original.source;
      canvasWidth = original.width;
      canvasHeight = original.height;
      if (canvasEl) {
        canvasEl.width = canvasWidth;
        canvasEl.height = canvasHeight;
      }
      ops = cloneMarkupOps(original.ops);
      cropRect = { ...lastCropRect };
      cropOriginal = null;
      sizeInkCanvas();
      renderComposite();
    }
  });

  // Phase 13: the wet emoji (selected until deselected).
  let selectedEmojiId = $state<string | null>(null);
  // Phase 13: drag state for the selected emoji's bounding frame.
  let emojiDrag: {
    id: string;
    mode: 'move' | 'scale';
    startX: number;
    startY: number;
    original: { x: number; y: number; size: number; rotation: number };
  } | null = null;
  // Phase 11/13: live path of the stroke currently being drawn.
  let currentStrokePath: { x: number; y: number }[] = [];

  // Phase 13: in-progress drag-drawn shape (live preview on the ink overlay).
  let shapeDrag: ShapeGeometry | null = null;
  // Phase 13 wet ink: the shape just drawn, still selected until dry merge.
  let wetShapeId = $state<string | null>(null);
  let wetShapeDrag: {
    id: string;
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se';
    startX: number;
    startY: number;
    original: ShapeGeometry;
  } | null = null;

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
      target.globalAlpha = shape.fillOpacity ?? 1;
      target.fillStyle = shape.fillColor;
      if (shape.kind === 'rectangle') {
        target.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
      } else if (shape.kind === 'oval') {
        target.beginPath();
        target.ellipse((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2, Math.max(0.5, (bounds.right - bounds.left) / 2), Math.max(0.5, (bounds.bottom - bounds.top) / 2), 0, 0, Math.PI * 2);
        target.fill();
      }
    }

    target.globalAlpha = shape.outlineOpacity ?? 1;
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

  /** Stamps an emoji glyph at the canvas center, through history. */
  export function stampEmoji(glyph: string) {
    if (!ctx) return;
    const before = captureSnapshot();
    const op: MarkupOp = {
      type: 'emoji',
      id: createMarkupOpId('emoji'),
      glyph,
      x: canvasWidth / 2,
      y: canvasHeight / 2,
      size: EMOJI_DEFAULT_SIZE,
      rotation: 0,
    };
    ops = [...ops, op];
    selectedEmojiId = op.id;
    wetShapeId = null;
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

  /** Phase 13: the wet shape, still movable/resizable until deselected. */
  const wetShapeOp = $derived(ops.find((op) => op.type === 'shape' && op.id === wetShapeId) ?? null);

  /** Applies the current flyout style to the wet shape (wet edits, pre-merge). */
  $effect(() => {
    if (!wetShapeOp || wetShapeOp.type !== 'shape' || wetShapeDrag) return;
    const next = {
      ...wetShapeOp.shape,
      outlineColor: shapeOutlineColor,
      fillColor: shapeFillColor,
      strokeWidth: clampShapeWidth(shapeStrokeWidth),
      outlineOpacity: shapeOutlineOpacity,
      fillOpacity: shapeFillOpacity,
    };
    if (
      next.outlineColor !== wetShapeOp.shape.outlineColor ||
      next.fillColor !== wetShapeOp.shape.fillColor ||
      next.strokeWidth !== wetShapeOp.shape.strokeWidth ||
      next.outlineOpacity !== wetShapeOp.shape.outlineOpacity ||
      next.fillOpacity !== wetShapeOp.shape.fillOpacity
    ) {
      ops = ops.map((op) => (op.id === wetShapeOp.id && op.type === 'shape' ? { ...op, shape: next } : op));
      renderComposite();
      const after = captureSnapshot();
      if (after) onHistoryAmend(after);
    }
  });

  /** Live drag of the wet shape (move or corner resize). */
  function updateWetShapeDrag(clientX: number, clientY: number) {
    if (!wetShapeDrag) return;
    const point = clientToImage(clientX, clientY);
    const op = ops.find((o) => o.id === wetShapeDrag!.id);
    if (!op || op.type !== 'shape') return;
    const original = wetShapeDrag.original;
    const dx = point.x - wetShapeDrag.startX;
    const dy = point.y - wetShapeDrag.startY;

    if (wetShapeDrag.mode === 'move') {
      ops = ops.map((o) =>
        o.id === op.id && o.type === 'shape'
          ? { ...o, shape: { ...original, start: { x: original.start.x + dx, y: original.start.y + dy }, end: { x: original.end.x + dx, y: original.end.y + dy } } }
          : o
      );
    } else {
      // Resize one corner; line/arrow scale their two endpoints by the bounding box.
      const bounds = shapeBounds(original);
      let { left, top, right, bottom } = bounds;
      if (wetShapeDrag.mode === 'nw') { left += dx; top += dy; }
      if (wetShapeDrag.mode === 'ne') { right += dx; top += dy; }
      if (wetShapeDrag.mode === 'sw') { left += dx; bottom += dy; }
      if (wetShapeDrag.mode === 'se') { right += dx; bottom += dy; }
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);
      const start = original.start;
      const end = original.end;
      ops = ops.map((o) =>
        o.id === op.id && o.type === 'shape'
          ? {
              ...o,
              shape: {
                ...original,
                start: {
                  x: left + ((start.x - bounds.left) * width) / Math.max(1, bounds.right - bounds.left),
                  y: top + ((start.y - bounds.top) * height) / Math.max(1, bounds.bottom - bounds.top),
                },
                end: {
                  x: left + ((end.x - bounds.left) * width) / Math.max(1, bounds.right - bounds.left),
                  y: top + ((end.y - bounds.top) * height) / Math.max(1, bounds.bottom - bounds.top),
                },
              },
            }
          : o
      );
    }
    renderComposite();
  }

  /** Begins a wet-shape frame drag. */
  function beginWetShapeDrag(mode: 'move' | 'nw' | 'ne' | 'sw' | 'se', e: PointerEvent) {
    const op = wetShapeOp;
    if (!op || op.type !== 'shape') return;
    e.preventDefault();
    e.stopPropagation();
    const point = clientToImage(e.clientX, e.clientY);
    wetShapeDrag = {
      id: op.id,
      mode,
      startX: point.x,
      startY: point.y,
      original: { ...op.shape, start: { ...op.shape.start }, end: { ...op.shape.end } },
    };
    strokeStartSnapshot = captureSnapshot();
    capturePointer(e.pointerId);
  }

  /** Dries the wet shape/emoji: merges it into the ink layer. */
  function dryWetInk() {
    wetShapeId = null;
    selectedEmojiId = null;
    wetShapeDrag = null;
  }

  // Switching tools dries the wet ink.
  $effect(() => {
    if (activeTool !== 'shapes') {
      dryWetInk();
    }
  });

  /** Phase 13: live drag of the wet emoji (move / scale). */
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
    }
    renderComposite();
  }

  /** Phase 13: begins a bounding-frame drag from one of its handles. */
  function beginEmojiDrag(mode: 'move' | 'scale', e: PointerEvent) {
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

  /**
   * Visible width of the editing box. An explicit line width (set by a
   * side/corner drag) wins so the box can grow *and* shrink; otherwise the
   * editor keeps a 120px floor for typing space.
   */
  function editingBoxWidth(l: TextLabel): number {
    return l.maxWidth > 0 ? l.maxWidth : Math.max(120, labelWidth(l));
  }
  // Typography state is owned by the App shell (secondary toolbar).
  let textResize: {
    id: string;
    zone: TextZone;
    startX: number;
    startY: number;
    originalX: number;
    originalY: number;
    origW: number;
    origH: number;
    origFontSize: number;
    origMaxWidth: number;
    moved: boolean;
  } | null = null;
  let hoverZone = $state<TextZone | null>(null);

  /**
   * Measured height (image px) of the open editor's rendered text, taken
   * from the textarea itself. The estimate can disagree with the browser
   * (weights, widths), which would leave wrapped lines cut off below the
   * border — the measured value is the source of truth while editing.
   */
  let editingBoxHeight = $state<number | null>(null);
  let measuredEditingId: string | null = null;
  /** Editor id already focused once (so toolbar styling keeps its focus). */
  let focusedEditingId: string | null = null;
  /** Last toolbar typography seen, so only real toolbar changes apply live. */
  let lastToolbarStyle: {
    fontSize: number;
    color: string;
    fontFamily: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    highlight: boolean;
    align: TextAlign;
  } | null = null;

  // Zone + cursor mapping lives in text-label.ts (Canva-style edge bands:
  // corners resize, left/right edges change width, top/bottom edges move,
  // strictly inside stays interior/edit).

  /**
   * Every label that shows handle dots: committed labels plus the label
   * currently being edited (including a brand-new one with no committed
   * op yet), so the dots are visible as soon as the box spawns — not only
   * after click-away commits it. The editing box uses the textarea width
   * (120px floor), matching the editor the user sees.
   */
  let textHandleItems = $derived.by((): { label: TextLabel; dw: number; dh: number }[] => {
    if (activeTool !== 'text' || isCropping) return [];
    const items: { label: TextLabel; dw: number; dh: number }[] = [];
    for (const op of ops) {
      if (op.type !== 'label' || op.label.id === editingLabel?.id) continue;
      items.push({ label: op.label, dw: Math.max(labelWidth(op.label), 8), dh: Math.max(labelHeight(op.label), 8) });
    }
    if (editingLabel) {
      items.push({
        label: editingLabel,
        dw: editingBoxWidth(editingLabel),
        dh: Math.max(editingBoxHeight ?? labelHeight(editingLabel), 8),
      });
    }
    return items;
  });

  let textInputEl = $state<HTMLTextAreaElement | null>(null);

  // Focus the inline editor when it first appears so typing starts at once.
  // Only the first appearance focuses: refocusing on every change would
  // steal focus back from the toolbar while styling size/color from above.
  $effect(() => {
    const id = editingLabel?.id ?? null;
    if (!id) {
      focusedEditingId = null;
      return;
    }
    if (textInputEl && focusedEditingId !== id) {
      focusedEditingId = id;
      textInputEl.focus();
    }
  });

  // Keep the borders fitted to the rendered text: measure the textarea's
  // real content height (at auto height) and drive both the editor height
  // and the dashed border from it, so wrapped lines are never cut off.
  $effect(() => {
    const label = editingLabel;
    const el = textInputEl;
    if (!label || !el) return;
    // Re-measure whenever the rendered shape changes.
    void label.text;
    void label.fontSize;
    void label.maxWidth;
    void label.fontFamily;
    void label.bold;
    void label.italic;
    void zoom;
    if (label.id !== measuredEditingId) {
      measuredEditingId = label.id;
      editingBoxHeight = null;
    }
    const previousHeight = el.style.height;
    el.style.height = 'auto';
    const measured = el.scrollHeight / (zoom / 100);
    el.style.height = previousHeight;
    if (editingBoxHeight === null || Math.abs(editingBoxHeight - measured) > 0.5) {
      editingBoxHeight = measured;
    }
  });

  // Apply toolbar typography live to the open editor. Only real toolbar
  // changes apply — typing or corner drags never trigger a revert.
  $effect(() => {
    const next = {
      fontSize: clampTextSize(textFontSize),
      color: textColor,
      fontFamily: textFontFamily,
      bold: textBold,
      italic: textItalic,
      underline: textUnderline,
      highlight: textHighlight,
      align: textAlign,
    };
    if (lastToolbarStyle === null) {
      lastToolbarStyle = next;
      return;
    }
    const prev = lastToolbarStyle;
    const changed =
      next.fontSize !== prev.fontSize ||
      next.color !== prev.color ||
      next.fontFamily !== prev.fontFamily ||
      next.bold !== prev.bold ||
      next.italic !== prev.italic ||
      next.underline !== prev.underline ||
      next.highlight !== prev.highlight ||
      next.align !== prev.align;
    lastToolbarStyle = next;
    if (!changed || !editingLabel) return;
    editingLabel = { ...editingLabel, ...next };
  });

  /** True when focus is moving to a control in the secondary toolbar. */
  function isSecondaryToolbarTarget(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest('[data-testid^="secondary-toolbar"]');
  }

  /** Draws one text label onto a 2d context at image-pixel coordinates. */
  function drawTextLabel(target: CanvasRenderingContext2D, label: TextLabel) {
    target.save();
    const weight = label.bold ? '700' : '400';
    const style = label.italic ? 'italic' : 'normal';
    target.font = `${style} ${weight} ${label.fontSize}px '${label.fontFamily}', 'Segoe UI', system-ui, sans-serif`;
    target.textAlign = 'left';
    target.textBaseline = 'top';
    const width = labelWidth(label);
    const lineHeight = labelLineHeight(label.fontSize);
    for (const [index, line] of wrappedTextLines(label).entries()) {
      const lineWidth = estimateTextWidth(label.fontSize, line, label);
      const offset =
        label.align === 'center'
          ? (width - lineWidth) / 2
          : label.align === 'right'
            ? width - lineWidth
            : 0;
      const y = label.y + index * lineHeight;
      const x = label.x + offset;
      if (label.highlight) {
        target.fillStyle = '#fff100';
        target.globalAlpha = 0.45;
        target.fillRect(x - 1, y, Math.max(1, lineWidth + 2), label.fontSize * 1.1);
        target.globalAlpha = 1;
      }
      target.fillStyle = label.color;
      target.fillText(line, x, y);
      if (label.underline) {
        target.fillRect(x, y + label.fontSize, Math.max(1, lineWidth), Math.max(1, label.fontSize / 12));
      }
    }
    target.restore();
  }

  function commitEditing() {
    if (!editingLabel || !ctx) {
      editingLabel = null;
      editingBoxHeight = null;
      return;
    }
    const label = editingLabel;
    editingLabel = null;
    editingBoxHeight = null;
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
    rulerOriginX: number;
    rulerOriginY: number;
    rulerAngle: number;
    startMidY: number;
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
  let canvasCursor = $derived(
    isPanning || panCursor
      ? isPanning
        ? 'cursor-grabbing'
        : 'cursor-grab'
      : (textZoneCursor(hoverZone) ?? 'cursor-crosshair')
  );


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
        wetShapeId = null;
        editingLabel = null;
        textResize = null;
        emojiDrag = null;
        strokeStartSnapshot = null;
        textStrokeSnapshot = null;
        cropOriginal = null;
        lastCropRect = null;
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
      wetShapeId = null;
      editingLabel = null;
      textResize = null;
      emojiDrag = null;
      strokeStartSnapshot = null;
      textStrokeSnapshot = null;
      cropOriginal = null;
      lastCropRect = null;
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
    // Crop mode keys (spec): Enter applies, Esc cancels, arrows pan the frame.
    if (isCropping && !editingLabel && !isTypingTarget(e.target)) {
      if (e.key === 'Enter') { e.preventDefault(); applyCrop(); return; }
      if (e.key === 'Escape') { e.preventDefault(); cancelCrop(); return; }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        cropRect = clampCropRect({ ...cropRect, x: cropRect.x + dx, y: cropRect.y + dy }, canvasWidth, canvasHeight);
        return;
      }
    }
    if (e.key === 'Shift') shiftHeld = true;
    if (e.key === 'Escape') {
      selectedEmojiId = null;
      wetShapeId = null;
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
    // Behavioral plan: pen strokes are always fully opaque.
    return 1;
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
   * Phase 18: magnetic snap onto the ruler's four edges. In ruler-local
   * space the strip has two long edges and two short edges; the nearest
   * edge within the snap radius wins. The eraser is guided the same way.
   */
  function snapDraftingPoint(point: { x: number; y: number }): { x: number; y: number } {
    if (draftingTool !== 'ruler') return point;
    if (activeTool !== 'pen' && activeTool !== 'highlighter' && activeTool !== 'eraser') return point;
    const scale = zoom / 100;
    const threshold = RULER_SNAP_DISTANCE / scale;
    const edge = rulerEdgeProjection({ x: draftingX, y: draftingY }, draftingAngle, point, threshold);
    return edge ? edge.projected : point;
  }

  function startStrokeAt(clientX: number, clientY: number, viaTouch = false) {
    if (!ctx || !canvasEl || !isMarkupTool()) return;
    if (viaTouch && activeTool === 'eraser') return;

    // Phase 13 wet-to-dry: clicking away outside the wet object merges it.
    {
      const point = clientToImage(clientX, clientY);
      let dry = false;
      if (selectedEmojiId) {
        const op = ops.find((o) => o.type === 'emoji' && o.id === selectedEmojiId);
        if (!op || op.type !== 'emoji' || Math.hypot(point.x - op.x, point.y - op.y) > op.size / 2 + 4) dry = true;
      }
      if (wetShapeId) {
        const op = ops.find((o) => o.type === 'shape' && o.id === wetShapeId);
        if (!op || op.type !== 'shape') dry = true;
        else {
          const b = shapeBounds(op.shape);
          if (point.x < b.left - 4 || point.x > b.right + 4 || point.y < b.top - 4 || point.y > b.bottom + 4) dry = true;
        }
      }
      if (dry) dryWetInk();
    }

    // History: snapshot the composite before this stroke touches it.
    strokeStartSnapshot = captureSnapshot();
    // Phase 13: an armed emoji stamps on click (no drag).
    if (activeTool === 'shapes' && emojiGlyph && !isCropping) {
      // Spec: emojis drop directly into the center of the canvas.
      stampEmoji(emojiGlyph);
      return;
    }
    // Phase 13 wet-to-dry: a deselected emoji is merged ink. Clicking it
    // does not reselect it — only the Eraser or Undo can affect it now.
    if (activeTool === 'shapes' && !emojiGlyph && !isCropping) {
      selectedEmojiId = null;
    }
    // Phase 12: clicking an existing label selects it for dragging/editing
    // instead of inking a new stroke over it.
    if (activeTool === 'text' && !isCropping) {
      const point = clientToImage(clientX, clientY);
      // Topmost label wins; the hit zone decides edit vs resize vs move.
      const hit = [...ops].reverse().find((op) => op.type === 'label' && hitTextLabel(op.label, point.x, point.y));
      if (hit && hit.type === 'label') {
        const label = hit.label;
        const zone = textBoxZone(label, point.x, point.y) ?? 'interior';
        textStrokeSnapshot = captureSnapshot();
        if (zone === 'interior') {
          // Interior click: edit the text (never moves the box). Freeze the
          // width for this edit session: typing keeps the box's width
          // constant and the height grows downward as lines wrap.
          editingLabel = {
            ...label,
            maxWidth: label.maxWidth > 0 ? label.maxWidth : Math.max(120, labelWidth(label)),
          };
          return;
        }
        textResize = {
          id: label.id,
          zone,
          startX: point.x,
          startY: point.y,
          originalX: label.x,
          originalY: label.y,
          origW: labelWidth(label),
          origH: labelHeight(label),
          origFontSize: label.fontSize,
          origMaxWidth: label.maxWidth ?? 0,
          moved: false,
        };
        // Route pointermove through drawStrokeTo for the zone drag.
        isDrawing = true;
        return;
      }
      // No label here: open the inline text editor, centered on this spot.
      // The new box starts at a fixed width (120px): while typing the width
      // (x) stays constant and the height (y) grows downward as text wraps,
      // matching the Canva behavior.
      textStrokeSnapshot = captureSnapshot();
      const label = createTextLabel({
        text: '',
        x: point.x,
        y: point.y,
        fontSize: clampTextSize(textFontSize),
        color: textColor,
        align: textAlign,
        fontFamily: textFontFamily,
        bold: textBold,
        italic: textItalic,
        underline: textUnderline,
        highlight: textHighlight,
        maxWidth: 120,
      });
      // The box's middle lands on the click point (clamped to the canvas).
      const initialWidth = Math.max(120, labelWidth(label));
      const initialHeight = labelHeight(label);
      label.x = Math.max(0, Math.min(point.x - initialWidth / 2, Math.max(0, canvasWidth - initialWidth)));
      label.y = Math.max(0, Math.min(point.y - initialHeight / 2, Math.max(0, canvasHeight - initialHeight)));
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
        outlineOpacity: shapeOutlineOpacity,
        fillOpacity: shapeFillOpacity,
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

    if (wetShapeDrag) {
      updateWetShapeDrag(clientX, clientY);
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

    // Phase 12: zone drags on a label (committed, or the one being edited) —
    // corners scale the font, left/right edges change the line width,
    // top/bottom edges move the box. Editing drags update the editor live.
    if (textResize) {
      const point = clientToImage(clientX, clientY);
      const dx = point.x - textResize.startX;
      const dy = point.y - textResize.startY;
      const op = ops.find((o) => o.type === 'label' && o.label.id === textResize!.id);
      const editing = editingLabel && editingLabel.id === textResize.id ? editingLabel : null;
      const current = editing ?? (op && op.type === 'label' ? op.label : null);
      if (current) {
        // Display width matches the visible box: the textarea box while
        // editing, the wrapped text width once committed.
        const dispW = (l: TextLabel) => (editing ? editingBoxWidth(l) : labelWidth(l));
        const orig = { ...current, fontSize: textResize.origFontSize, maxWidth: textResize.origMaxWidth };
        let next = { ...current, x: textResize.originalX, y: textResize.originalY };
        const zone = textResize.zone;
        if (zone === 'nw' || zone === 'ne' || zone === 'sw' || zone === 'se') {
          // Uniform scale around the opposite corner: box width, height and
          // font all grow/shrink by one ratio, so the aspect stays constant.
          const scaled = cornerScale(
            zone,
            point,
            { x: textResize.originalX, y: textResize.originalY, width: textResize.origW, height: textResize.origH },
            textResize.origFontSize
          );
          next = {
            ...next,
            fontSize: scaled.fontSize,
            maxWidth: Math.min(1600, Math.max(24, scaled.width)),
            x: scaled.x,
            y: scaled.y,
          };
        } else if (zone === 'w' || zone === 'e') {
          const base = textResize.origMaxWidth > 0 ? textResize.origMaxWidth : Math.max(48, dispW(orig));
          const newMax = Math.min(1600, Math.max(48, base + (zone === 'e' ? dx : -dx)));
          next = { ...next, maxWidth: newMax };
          if (zone === 'w') {
            const right = textResize.originalX + dispW(orig);
            next.x = right - dispW(next);
          }
        } else {
          // 'n' / 's': move the box around.
          next.x = textResize.originalX + dx;
          next.y = textResize.originalY + dy;
        }
        if (next.x !== current.x || next.y !== current.y || next.fontSize !== current.fontSize || next.maxWidth !== current.maxWidth) {
          textResize.moved = true;
        }
        if (editing) {
          editingLabel = next;
        } else if (op && op.type === 'label') {
          ops = ops.map((o) => (o.id === op.id && o.type === 'label' ? { ...o, label: next } : o));
          renderComposite();
        }
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

    // Phase 13: commit the wet emoji frame drag (move / scale).
    if (emojiDrag) {
      const drag = emojiDrag;
      emojiDrag = null;
      const op = ops.find((o) => o.id === drag.id);
      const changed =
        op && op.type === 'emoji' &&
        (op.x !== drag.original.x || op.y !== drag.original.y || op.size !== drag.original.size);
      if (changed) {
        const after = captureSnapshot();
        if (after) onHistoryAmend(after);
        onCanvasMutated();
      }
      strokeStartSnapshot = null;
      return;
    }

    if (wetShapeDrag) {
      const drag = wetShapeDrag;
      wetShapeDrag = null;
      const op = ops.find((o) => o.id === drag.id);
      const changed = op && op.type === 'shape' && JSON.stringify(op.shape) !== JSON.stringify(drag.original);
      if (changed) {
        const after = captureSnapshot();
        if (after) onHistoryAmend(after);
        onCanvasMutated();
      }
      strokeStartSnapshot = null;
      return;
    }

    // Phase 12: a zone drag on a label commits to history. An editing drag
    // stays in the edit session (history is pushed on commit), so just
    // end the drag and keep the editor focused.
    if (textResize) {
      const drag = textResize;
      textResize = null;
      isDrawing = false;
      if (editingLabel?.id === drag.id) {
        textInputEl?.focus();
        return;
      }
      const op = ops.find((o) => o.type === 'label' && o.label.id === drag.id);
      if (!op || op.type !== 'label') return;
      if (drag.moved) {
        const before = textStrokeSnapshot;
        const after = captureSnapshot();
        const moving = drag.zone === 'n' || drag.zone === 's';
        if (before && after) onHistoryPush?.(moving ? 'move text label' : 'resize text label', before, after);
        onCanvasMutated();
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
      const shapeId = createMarkupOpId('shape');
      ops = [...ops, { type: 'shape', id: shapeId, shape }];
      wetShapeId = shapeId;
      selectedEmojiId = null;
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
      rulerOriginX: draftingX,
      rulerOriginY: draftingY,
      rulerAngle: draftingAngle,
      startMidY: midpoint.y,
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

    // Phase 8 + 18: with Touch Writing on and the ruler visible, a two-finger
    // swipe rotates the ruler (swipe down = clockwise, swipe up = counter).
    if (draftingTool === 'ruler' && touchWritingEnabled) {
      const deltaY = midpoint.y - gesture.startMidY;
      const rect = canvasEl?.getBoundingClientRect();
      const scale = rect ? rect.width / canvasWidth || zoom / 100 : zoom / 100;
      const hinge = {
        x: (midpoint.x - (rect ? rect.left : 0)) / scale,
        y: (midpoint.y - (rect ? rect.top : 0)) / scale,
      };
      const rotated = rotateAroundHinge(
        { x: gesture.rulerOriginX, y: gesture.rulerOriginY },
        gesture.rulerAngle,
        hinge,
        -deltaY * 0.5
      );
      draftingX = rotated.origin.x;
      draftingY = rotated.origin.y;
      draftingAngle = rotated.angle;
      return;
    }

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

    // Phase 21: Scan Text — marquee selection replaces markup/pan.
    if (isScanActive) {
      if (scanMenu) { scanMenu = null; return; }
      if (e.button !== 0 && e.button !== 1) return;
      if (!isInsideCanvas(e.clientX, e.clientY)) return;
      e.preventDefault();
      const pt = clientToImage(e.clientX, e.clientY);
      scanDragStart = { x: pt.x, y: pt.y };
      scanDrag = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
      capturePointer(e.pointerId);
      return;
    }

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
    // Phase 21: Scan Text marquee tracking.
    if (isScanActive && scanDrag && scanDragStart) {
      const pt = clientToImage(e.clientX, e.clientY);
      scanDrag = { ...scanDrag, x1: pt.x, y1: pt.y };
      return;
    }
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
    } else if (activeTool === 'text' && !isCropping && !textResize) {
      // Hover cursors name the zone under the pointer (Canva-style).
      const point = clientToImage(e.clientX, e.clientY);
      const hit = [...ops].reverse().find((op) => op.type === 'label' && hitTextLabel(op.label, point.x, point.y));
      hoverZone = hit && hit.type === 'label' ? textBoxZone(hit.label, point.x, point.y) : null;
    } else {
      hoverZone = null;
    }
  }

  function handleViewportPointerUp(e: PointerEvent) {
    releasePointer(e.pointerId);

    // Phase 21: finalize scan marquee (click = single word, drag = marquee).
    if (isScanActive && scanDrag && scanDragStart) {
      const rect: ScanRect = { x0: scanDrag.x0, y0: scanDrag.y0, x1: scanDrag.x1, y1: scanDrag.y1 };
      const dist = Math.hypot(scanDrag.x1 - scanDragStart.x, scanDrag.y1 - scanDragStart.y);
      if (dist < 4) {
        const w = wordAtPoint(scanWords, scanDragStart.x, scanDragStart.y);
        if (w) {
          onScanMarquee({ x0: w.bbox.x0 - 2, y0: w.bbox.y0 - 2, x1: w.bbox.x1 + 2, y1: w.bbox.y1 + 2 });
        } else {
          onScanClearSelection();
        }
      } else {
        // Touch intersect check happens App-side via marqueeSelect; forward rect.
        void marqueeSelect;
        onScanMarquee(rect);
      }
      scanDrag = null;
      scanDragStart = null;
      return;
    }

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
      wetShapeId = null;
      editingLabel = null;
      textResize = null;
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

  /** Docked secondary-toolbar Apply: commits the current crop frame. */
  export function commitCrop(): void {
    applyCrop();
  }
  /** Docked secondary-toolbar Cancel: exits crop, restoring previous view. */
  export function cancelCrop(): void {
    resetCropFrame();
    onCancelCrop();
  }

  /** Returns the flattened composite canvas (base capture plus all markup). */
  export function compositeCanvas(): HTMLCanvasElement | null {
    return canvasEl;
  }

  /** Phase 21: snapshot of the composite for OCR (originals preserved). */
  export function getScanSourceCanvas(maxEdge = 2000): HTMLCanvasElement | null {
    if (!canvasEl || canvasEl.width <= 0 || canvasEl.height <= 0) return null;
    const src = canvasEl;
    const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(src.width * scale));
    canvas.height = Math.max(1, Math.round(src.height * scale));
    const ctx2 = canvas.getContext('2d');
    if (!ctx2) return src;
    ctx2.fillStyle = '#ffffff';
    ctx2.fillRect(0, 0, canvas.width, canvas.height);
    ctx2.drawImage(src, 0, 0, canvas.width, canvas.height);
    return canvas;
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
  oncontextmenu={(e) => {
    if (!isScanActive) return;
    e.preventDefault();
    scanMenu = { x: e.clientX, y: e.clientY };
  }}
>
  <!-- Interactive Viewport Wrapper with True Zoom Sizing -->
  <div
    class="m-auto relative shrink-0 shadow-[0_16px_48px_rgba(0,0,0,0.18)] dark:shadow-[0_16px_48px_rgba(0,0,0,0.45)] border border-black/10 dark:border-white/10 rounded-sm bg-white"
  >
    <canvas
      bind:this={canvasEl}
      class="block touch-none {canvasCursor}"
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
        class="absolute z-10 box-border select-text bg-transparent p-0 outline-none resize-none border-0 overflow-hidden"
        style="left: {editingLabel.x * scale}px; top: {editingLabel.y * scale}px; width: {editingBoxWidth(editingLabel) * scale}px; height: {(editingBoxHeight ?? labelHeight(editingLabel)) * scale}px; font-size: {editingLabel.fontSize * scale}px; color: {editingLabel.color}; text-align: {editingLabel.align}; font-family: 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif; font-weight: {editingLabel.bold ? '700' : '400'}; font-style: {editingLabel.italic ? 'italic' : 'normal'}; text-decoration: {editingLabel.underline ? 'underline' : 'none'};"
        onpointerdown={(e) => e.stopPropagation()}
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
        onblur={(e) => {
          // Styling from the toolbar above must not end the edit: moving
          // focus to the secondary toolbar keeps the box open/editable,
          // with the toolbar changes applied live to it.
          if (isSecondaryToolbarTarget(e.relatedTarget)) return;
          commitEditing();
        }}
      ></textarea>
    {/if}

    <!-- Phase 12 handles: Canva-style dots on every text box while the
         Text tool is active — corner dots scale the whole box, side dots
         change width. Top/bottom edges carry no dots: hovering them shows
         the move cursor and dragging them moves the box. Interior stays
         edit-only. Includes the box being edited. -->
    {#if activeTool === 'text' && !isCropping}
      {@const hScale = zoom / 100}
      {#each textHandleItems as item}
        {@const u = item.label}
        {@const bw = item.dw * hScale}
        {@const bh = item.dh * hScale}
        {@const bx = u.x * hScale}
        {@const by = u.y * hScale}
        {@const tolPx = 8 * hScale}
        <div class="absolute z-10 border-2 border-dashed border-[#0067c0]/70 rounded-sm pointer-events-none" style="left: {bx}px; top: {by}px; width: {bw}px; height: {bh}px;"></div>
        <!-- Top/bottom move strips: invisible, corner-excluded bands centered
             on the border. They provide the move cursor + drag over the
             editor/canvas, so no dots are needed there. -->
        {#if bw > tolPx * 2}
          <div aria-hidden="true" class="absolute z-10 cursor-move" style="left: {bx + tolPx}px; top: {by - tolPx}px; width: {bw - tolPx * 2}px; height: {tolPx * 2}px;" onpointerdown={(e) => beginTextZoneDrag(u, 'n', e)}></div>
          <div aria-hidden="true" class="absolute z-10 cursor-move" style="left: {bx + tolPx}px; top: {by + bh - tolPx}px; width: {bw - tolPx * 2}px; height: {tolPx * 2}px;" onpointerdown={(e) => beginTextZoneDrag(u, 's', e)}></div>
        {/if}
        <div role="button" aria-label="Resize text box (northwest)" tabindex="0" class="absolute z-10 h-[11px] w-[11px] rounded-full border-2 border-[#0067c0] bg-white cursor-nwse-resize" style="left: {bx - 5.5}px; top: {by - 5.5}px;" onpointerdown={(e) => beginTextZoneDrag(u, 'nw', e)}></div>
        <div role="button" aria-label="Resize text box (northeast)" tabindex="0" class="absolute z-10 h-[11px] w-[11px] rounded-full border-2 border-[#0067c0] bg-white cursor-nesw-resize" style="left: {bx + bw - 5.5}px; top: {by - 5.5}px;" onpointerdown={(e) => beginTextZoneDrag(u, 'ne', e)}></div>
        <div role="button" aria-label="Resize text box (southwest)" tabindex="0" class="absolute z-10 h-[11px] w-[11px] rounded-full border-2 border-[#0067c0] bg-white cursor-nesw-resize" style="left: {bx - 5.5}px; top: {by + bh - 5.5}px;" onpointerdown={(e) => beginTextZoneDrag(u, 'sw', e)}></div>
        <div role="button" aria-label="Resize text box (southeast)" tabindex="0" class="absolute z-10 h-[11px] w-[11px] rounded-full border-2 border-[#0067c0] bg-white cursor-nwse-resize" style="left: {bx + bw - 5.5}px; top: {by + bh - 5.5}px;" onpointerdown={(e) => beginTextZoneDrag(u, 'se', e)}></div>
        <div role="button" aria-label="Change text box width (left)" tabindex="0" class="absolute z-10 h-[11px] w-[11px] rounded-full border-2 border-[#0067c0] bg-white cursor-ew-resize" style="left: {bx - 5.5}px; top: {by + bh / 2 - 5.5}px;" onpointerdown={(e) => beginTextZoneDrag(u, 'w', e)}></div>
        <div role="button" aria-label="Change text box width (right)" tabindex="0" class="absolute z-10 h-[11px] w-[11px] rounded-full border-2 border-[#0067c0] bg-white cursor-ew-resize" style="left: {bx + bw - 5.5}px; top: {by + bh / 2 - 5.5}px;" onpointerdown={(e) => beginTextZoneDrag(u, 'e', e)}></div>
      {/each}
    {/if}

    <!-- Phase 13: bounding frame for the wet emoji (move / resize) -->
    {#if selectedEmojiOp && selectedEmojiOp.type === 'emoji' && !isCropping}
      {@const op = selectedEmojiOp}
      {@const scale = zoom / 100}
      {@const box = op.size * scale}
      <div class="absolute z-10" style="left: {op.x * scale}px; top: {op.y * scale}px;">
        <div
          role="button" aria-label="Move emoji" tabindex="0" class="absolute border-2 border-dashed border-[#0067c0] rounded-sm cursor-move"
          style="width: {box}px; height: {box}px; transform: translate(-50%, -50%) rotate({op.rotation}rad);"
          onpointerdown={(e) => beginEmojiDrag('move', e)}
        >
          <!-- 4 corner scale handles (uniform resize around the center) -->
          <div class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nwse-resize rounded-sm" role="button" aria-label="Emoji handle" tabindex="0" onpointerdown={(e) => beginEmojiDrag('scale', e)}></div>
          <div class="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nesw-resize rounded-sm" role="button" aria-label="Emoji handle" tabindex="0" onpointerdown={(e) => beginEmojiDrag('scale', e)}></div>
          <div class="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nesw-resize rounded-sm" role="button" aria-label="Emoji handle" tabindex="0" onpointerdown={(e) => beginEmojiDrag('scale', e)}></div>
          <div class="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] pointer-events-auto cursor-nwse-resize rounded-sm" role="button" aria-label="Emoji handle" tabindex="0" onpointerdown={(e) => beginEmojiDrag('scale', e)}></div>
        </div>
      </div>
    {/if}

    <!-- Phase 13: bounding frame for the wet shape (move / resize) -->
    {#if wetShapeOp && wetShapeOp.type === 'shape' && !isCropping}
      {@const shape = wetShapeOp.shape}
      {@const scale = zoom / 100}
      {@const bounds = shapeBounds(shape)}
      {@const frameL = bounds.left * scale}
      {@const frameT = bounds.top * scale}
      {@const frameW = Math.max(4, (bounds.right - bounds.left) * scale)}
      {@const frameH = Math.max(4, (bounds.bottom - bounds.top) * scale)}
      <div class="absolute z-10 border-2 border-dashed border-[#0067c0] rounded-sm cursor-move" role="button" aria-label="Move shape" tabindex="0" style="left: {frameL}px; top: {frameT}px; width: {frameW}px; height: {frameH}px;" onpointerdown={(e) => beginWetShapeDrag('move', e)}>
        <div class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] rounded-sm cursor-nwse-resize" role="button" aria-label="Shape handle" tabindex="0" onpointerdown={(e) => beginWetShapeDrag('nw', e)}></div>
        <div class="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] rounded-sm cursor-nesw-resize" role="button" aria-label="Shape handle" tabindex="0" onpointerdown={(e) => beginWetShapeDrag('ne', e)}></div>
        <div class="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] rounded-sm cursor-nesw-resize" role="button" aria-label="Shape handle" tabindex="0" onpointerdown={(e) => beginWetShapeDrag('sw', e)}></div>
        <div class="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-[#0067c0] rounded-sm cursor-nwse-resize" role="button" aria-label="Shape handle" tabindex="0" onpointerdown={(e) => beginWetShapeDrag('se', e)}></div>
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
      <div class="absolute border-2 border-dashed border-[#0067c0]" style="left: {cropRect.x * cropScale}px; top: {cropRect.y * cropScale}px; width: {frameW}px; height: {frameH}px;" role="button" aria-label="Move crop frame" tabindex="0" onpointerdown={(e) => beginCropDrag('move', e)}>
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
      </div>
    {/if}

    <!-- Phase 21: Scan Text overlay (dim + selectable word boxes + marquee) -->
    {#if isScanActive}
      {@const sScale = zoom / 100}
      {#if scanStatus === 'ready' || scanStatus === 'empty'}
        <div class="absolute inset-0 bg-black/[0.35] pointer-events-none" style="width: {displayWidth}px; height: {displayHeight}px;"></div>
      {/if}
      {#if scanStatus === 'ready'}
        {#each scanWords as w}
          {@const sel = scanSelectedIds.has(w.id)}
          <div
            class="absolute pointer-events-none rounded-sm {sel ? 'bg-[#0067c0]/35 border border-[#0067c0]' : 'border border-[#60cdff]/50 bg-white/5'}"
            style="left: {w.bbox.x0 * sScale}px; top: {w.bbox.y0 * sScale}px; width: {Math.max(2, (w.bbox.x1 - w.bbox.x0) * sScale)}px; height: {Math.max(2, (w.bbox.y1 - w.bbox.y0) * sScale)}px;"
            title={w.text}
            aria-hidden="true"
          ></div>
        {/each}
      {/if}
      {#if scanDrag && scanDragStart}
        {@const mx0 = Math.min(scanDrag.x0, scanDrag.x1) * sScale}
        {@const my0 = Math.min(scanDrag.y0, scanDrag.y1) * sScale}
        {@const mw = Math.abs(scanDrag.x1 - scanDrag.x0) * sScale}
        {@const mh = Math.abs(scanDrag.y1 - scanDrag.y0) * sScale}
        <div class="absolute pointer-events-none border border-dashed border-[#0067c0] bg-[#0067c0]/20" style="left: {mx0}px; top: {my0}px; width: {mw}px; height: {mh}px;"></div>
      {/if}
      {#if scanStatus === 'loading'}
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 text-white" style="width: {displayWidth}px; height: {displayHeight}px;">
          <div class="text-xs font-medium">Scanning for text…</div>
          <div class="w-48 h-1.5 rounded bg-white/20 overflow-hidden"><div class="h-full bg-white transition-all" style="width: {Math.round((scanProgress || 0.05) * 100)}%;"></div></div>
          <button type="button" class="rounded-md bg-white/15 px-3 py-1 text-xs hover:bg-white/25 cursor-pointer" onclick={onScanCancel}>Cancel</button>
        </div>
      {:else if scanStatus === 'empty'}
        <div class="absolute inset-0 flex items-center justify-center text-white" style="width: {displayWidth}px; height: {displayHeight}px;">
          <span class="rounded-full bg-black/50 px-3 py-1.5 text-xs">No text detected</span>
        </div>
      {:else if scanStatus === 'error'}
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 text-white" style="width: {displayWidth}px; height: {displayHeight}px;">
          <span class="text-xs">{scanError || 'Scan failed'}</span>
          <button type="button" class="rounded-md bg-white/15 px-3 py-1 text-xs hover:bg-white/25 cursor-pointer" onclick={onScanRetry}>Retry</button>
        </div>
      {/if}
    {/if}

    <!-- Phase 18: draggable ruler overlay -->
    <DraftingOverlay
      tool={draftingTool}
      x={draftingX}
      y={draftingY}
      angle={draftingAngle}
      scale={zoom / 100}
      onDrag={(nx, ny) => { draftingX = nx; draftingY = ny; }}
      onRotate={(angle, hx, hy) => { draftingAngle = angle; draftingX = hx; draftingY = hy; }}
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

<!-- Phase 21: Scan Text context menu (Copy text / Select all / Redact disabled) -->
{#if scanMenu}
  <div class="fixed inset-0 z-40" onpointerdown={() => { scanMenu = null; }} oncontextmenu={(e) => { e.preventDefault(); scanMenu = null; }} role="presentation"></div>
  <div class="fixed z-50 min-w-[160px] rounded-lg border border-black/10 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-[#181d28]" style="left: {scanMenu.x}px; top: {scanMenu.y}px;" role="menu" aria-label="Scan text menu">
    <button type="button" class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer" role="menuitem" disabled={scanSelectedIds.size === 0} onclick={() => { scanMenu = null; onScanCopySelection(); }}><Copy class="w-3.5 h-3.5" /> Copy text <kbd class="ml-auto text-[10px] font-mono text-neutral-400">Ctrl+C</kbd></button>
    <button type="button" class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer" role="menuitem" onclick={() => { scanMenu = null; onScanSelectAll(); }}>Select all <kbd class="ml-auto text-[10px] font-mono text-neutral-400">Ctrl+A</kbd></button>
    <button type="button" class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-400 cursor-not-allowed" role="menuitem" disabled title="Available in a later phase">Redact text</button>
  </div>
{/if}
</div>
