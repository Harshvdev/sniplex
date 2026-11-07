<script lang="ts">
  import {
    Camera,
    Video,
    ChevronDown,
    X,
    Timer,
    TimerOff,
    Pipette,
    ScanText,
    Check,
  } from '@lucide/svelte';
  import SnipIcons from '../icons/SnipIcons.svelte';
  import type {
    CaptureMode,
    SnipType,
    SnipDelay,
    DesktopCapture,
    WindowRect,
    CapturePayload,
  } from '../types';
  import {
    findHoveredWindow,
    cropRectangle,
    cropFreeform,
    cropFromDataUrl,
    cropFreeformFromDataUrl,
  } from '../capture';
  import {
    COLOR_PICKER_FORMATS,
    formatColor,
    wheelLoupeZoom,
  } from '../color-picker';
  import type { ColorFormat, RgbColor } from '../color-picker';
  import type { ScanResult } from '../scan-text';
  import { runOcr } from '../scan-text-runner';
  import { copyTextToClipboard } from '../clipboard';
  import { Copy, Table2 } from '@lucide/svelte';

  let {
    active = false,
    visible = true,
    mode = 'snip',
    snipType = 'rectangle',
    delay = 0,
    frameBitmap = null,
    desktopCapture = null,
    onClose = () => {},
    onCapture = () => {},
    onModeChange = (m: CaptureMode) => {},
    onSnipTypeChange = (t: SnipType) => {},
    onDelayChange = (d: SnipDelay) => {},
    onScreenDraw = () => {},
    onTextActions = () => {},
    onColorPicker = () => {},
  }: {
    active: boolean;
    /**
     * Kept mounted but transparent until the capture surface has its final
     * size, so the first composite is paid for off-screen instead of showing a
     * shrunken frame in the corner.
     */
    visible?: boolean;
    mode: CaptureMode;
    snipType: SnipType;
    delay?: SnipDelay;
    frameBitmap?: ImageBitmap | null;
    desktopCapture?: DesktopCapture | null;
    onClose: () => void;
    onCapture: (payload: CapturePayload) => void;
    onModeChange?: (m: CaptureMode) => void;
    onSnipTypeChange?: (t: SnipType) => void;
    onDelayChange?: (d: SnipDelay) => void;
    onScreenDraw?: () => void;
    onTextActions?: () => void;
    onColorPicker?: (color?: string) => void;
  } = $props();

  let currentMode = $state<CaptureMode>('snip');
  let currentSnipType = $state<SnipType>('rectangle');
  let currentDelay = $state<SnipDelay>(0);
  let isSnipMenuOpen = $state(false);
  let isDelayMenuOpen = $state(false);
  let isCloseHovered = $state(false);

  $effect(() => {
    currentMode = mode;
    currentSnipType = snipType;
    currentDelay = delay;

    if (!active || !visible) {
      isCloseHovered = false;
      isDragging = false;
      isDraggingPill = false;
      freeformPoints = [];
      startX = 0;
      startY = 0;
      currentX = 0;
      currentY = 0;
      hoveredWindow = null;
      isSnipMenuOpen = false;
      isDelayMenuOpen = false;
      // OCR mode does not persist across overlay opens.
      if (isOcrMode) exitOcrMode();
      if (isPickingColor) isPickingColor = false;
    } else if (currentSnipType === 'window' && !hoveredWindow && desktopCapture && desktopCapture.windows.length > 0) {
      hoveredWindow = desktopCapture.windows[0];
    }
  });

  // Canvas holding the frozen frame, at native pixel dimensions.
  let frozenCanvasEl = $state<HTMLCanvasElement | null>(null);

  // Inline data URL used only by the browser preview fallback; the desktop
  // overlay always arrives as a decoded bitmap.
  const frameSrc = $derived(desktopCapture?.image_data_url || '');

  // Paints whatever frame is available into the canvas once, so every crop
  // reads from one place regardless of how the frame arrived.
  $effect(() => {
    const canvas = frozenCanvasEl;
    const bitmap = frameBitmap;
    const source = frameSrc;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    if (bitmap) {
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      context.drawImage(bitmap, 0, 0);
      return;
    }

    if (!source) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
    };
    image.src = source;

    return () => {
      cancelled = true;
    };
  });

  // Phase 15: color picker loupe state.
  let isPickingColor = $state(false);
  let pickX = $state(0);
  let pickY = $state(0);
  let pickFormat = $state<ColorFormat>('HEX');
  let loupeZoom = $state(6);
  let loupeUrl = $state('');

  /** Reads the pixel under the pointer from the frozen frame. */
  function pickColorAt(clientX: number, clientY: number): RgbColor | null {
    const canvas = frozenCanvasEl;
    if (!canvas || canvas.width === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width || 1);
    const scaleY = canvas.height / (rect.height || 1);
    const x = Math.floor((clientX - rect.left) * scaleX);
    const y = Math.floor((clientY - rect.top) * scaleY);
    try {
      const context = canvas.getContext('2d');
      if (!context) return null;
      const imageData = context.getImageData(x, y, 1, 1);
      return { r: imageData.data[0], g: imageData.data[1], b: imageData.data[2] };
    } catch {
      return null;
    }
  }

  /** Renders the magnified loupe region as a data URL. */
  function renderLoupe() {
    const canvas = frozenCanvasEl;
    if (!canvas || canvas.width === 0) { loupeUrl = ''; return; }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width || 1);
    const scaleY = canvas.height / (rect.height || 1);
    const cx = Math.floor((pickX - rect.left) * scaleX);
    const cy = Math.floor((pickY - rect.top) * scaleY);
    const size = 40;
    // Magnification follows the wheel-selected zoom (2x–16x), in image pixels.
    const srcSize = Math.max(1, size / loupeZoom);
    const loupe = document.createElement('canvas');
    loupe.width = size;
    loupe.height = size;
    const context = loupe.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.drawImage(canvas, cx - srcSize / 2, cy - srcSize / 2, srcSize, srcSize, 0, 0, size, size);
    loupeUrl = loupe.toDataURL();
  }

  /** Copies the picked color in the selected format and closes the overlay. */
  async function commitPickedColor() {
    const color = pickColorAt(pickX, pickY);
    if (!color) { onClose(); return; }
    const value = formatColor(color, pickFormat);
    try {
      await navigator.clipboard.writeText(value);
    } catch {}
    isPickingColor = false;
    onColorPicker(value);
    onClose();
  }

  function handleLoupeWheel(e: WheelEvent) {
    // Keep Ctrl+wheel from leaking into browser/app page zoom. The handler
    // is bound on both the window and the overlay div, so stop propagation
    // to avoid applying one notch twice.
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) e.preventDefault();
    loupeZoom = wheelLoupeZoom(loupeZoom, e.deltaY, e.ctrlKey || e.metaKey);
    renderLoupe();
  }

  // Overlay OCR mode: selected via the ScanText pill button; drag selects a
  // rectangle, OCR runs without closing, results render in place.
  let isOcrMode = $state(false);
  let ocrResult = $state<ScanResult | null>(null);
  let ocrStatus = $state<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  let ocrProgress = $state(0);
  let ocrError = $state<string | null>(null);
  let ocrSelectedIds = $state<Set<string>>(new Set());
  let ocrOrigin = $state({ x: 0, y: 0 }); // image-pixel origin of the cropped region
  let ocrRect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let ocrSelecting = $state(false);
  let ocrHoverText = $state(false);
  let ocrToast = $state<string | null>(null);
  let ocrRunId = 0;

  function exitOcrMode() {
    isOcrMode = false;
    ocrResult = null;
    ocrStatus = 'idle';
    ocrError = null;
    ocrSelectedIds = new Set();
    ocrOrigin = { x: 0, y: 0 };
    ocrRect = null;
    ocrSelecting = false;
    ocrHoverText = false;
    ocrRunId += 1;
    if (ocrToastTimer) { clearTimeout(ocrToastTimer); ocrToastTimer = null; }
    ocrToast = null;
  }

  let ocrToastTimer: number | null = null;
  function showOcrToast(msg: string) {
    ocrToast = msg;
    if (ocrToastTimer) clearTimeout(ocrToastTimer);
    ocrToastTimer = window.setTimeout(() => { ocrToast = null; ocrToastTimer = null; }, 1800);
  }

  async function copyOcrText(text: string) {
    if (!text) { showOcrToast('Nothing to copy'); return; }
    const r = await copyTextToClipboard(text);
    showOcrToast(r.ok ? 'Copied to clipboard' : 'Copy failed');
  }

  // Drag-to-snip interaction state
  let isDragging = $state(false);
  let startX = $state(0);
  let startY = $state(0);
  let currentX = $state(0);
  let currentY = $state(0);

  // Freeform lasso points
  let freeformPoints = $state<Array<{ x: number; y: number }>>([]);

  // Window Mode hover detection
  let hoveredWindow = $state<WindowRect | null>(null);

  // Pill drag position state
  let pillX = $state<number | null>(null);
  let pillY = $state<number>(12);
  let isDraggingPill = $state(false);
  let dragOffset = $state({ x: 0, y: 0 });

  function getScale() {
    if (!desktopCapture) return { scaleX: 1, scaleY: 1 };
    const winW = window.innerWidth || desktopCapture.width || 1920;
    const winH = window.innerHeight || desktopCapture.height || 1080;
    const scaleX = (desktopCapture.width || winW) / winW;
    const scaleY = (desktopCapture.height || winH) / winH;
    return { scaleX, scaleY };
  }

  let clientHoveredWindow = $derived.by(() => {
    if (!hoveredWindow) return null;
    const { scaleX, scaleY } = getScale();
    return {
      x: hoveredWindow.x / scaleX,
      y: hoveredWindow.y / scaleY,
      w: hoveredWindow.width / scaleX,
      h: hoveredWindow.height / scaleY,
    };
  });

  function handlePillMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) return;
    isDraggingPill = true;
    const pill = target.closest('.floating-pill') as HTMLElement;
    const rect = pill.getBoundingClientRect();
    dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  let dragRect = $derived(
    isDragging && !ocrSelecting && (currentSnipType === 'rectangle' || isOcrMode)
      ? {
          x: Math.min(startX, currentX),
          y: Math.min(startY, currentY),
          w: Math.abs(currentX - startX),
          h: Math.abs(currentY - startY),
        }
      : null
  );
  // Border stays visible after OCR: live drag while drawing a region, else the saved region.
  let selectionRect = $derived(dragRect ?? (isOcrMode ? ocrRect : null));

  const snipOptions: { id: SnipType; label: string }[] = [
    { id: 'rectangle', label: 'Rectangle' },
    { id: 'window', label: 'Window' },
    { id: 'fullscreen', label: 'Full screen' },
    { id: 'freeform', label: 'Freeform' },
  ];

  const delayOptions: { id: SnipDelay; label: string }[] = [
    { id: 0, label: 'No delay' },
    { id: 3, label: '3-second delay' },
    { id: 5, label: '5-second delay' },
    { id: 10, label: '10-second delay' },
  ];

  function handleWindowPointerDown(e: PointerEvent) {
    if (!isSnipMenuOpen && !isDelayMenuOpen) return;
    const target = e.target as Element | null;
    if (isSnipMenuOpen && !target?.closest?.('.snip-menu-container')) {
      isSnipMenuOpen = false;
    }
    if (isDelayMenuOpen && !target?.closest?.('.delay-menu-container')) {
      isDelayMenuOpen = false;
    }
  }

  function executeFullscreenCapture() {
    // Re-encode the frozen frame so the editor window can display it as a tab
    let imageUrl = '';
    const sourceCanvas = frozenCanvasEl;
    if (sourceCanvas && sourceCanvas.width > 0) {
      try {
        imageUrl = sourceCanvas.toDataURL('image/png');
      } catch (err) {
        console.error('Failed to export full screen frame:', err);
      }
    }

    onCapture({
      imageUrl,
      width: desktopCapture?.width || window.innerWidth,
      height: desktopCapture?.height || window.innerHeight,
      mode: 'fullscreen',
      delay: currentDelay,
    });
  }

  async function executeWindowCapture(win: WindowRect) {
    let cropped = '';
    let sourceImg: CanvasImageSource | null = frozenCanvasEl;
    if ((!sourceImg || (sourceImg as HTMLCanvasElement).width === 0) && frameBitmap) {
      sourceImg = frameBitmap;
    }

    const srcW = sourceImg && 'width' in sourceImg ? (sourceImg as { width: number }).width : (desktopCapture?.width || 1920);
    const srcH = sourceImg && 'height' in sourceImg ? (sourceImg as { height: number }).height : (desktopCapture?.height || 1080);
    let finalW = Math.max(1, Math.min(srcW - Math.max(0, Math.round(win.x)), Math.round(win.width)));
    let finalH = Math.max(1, Math.min(srcH - Math.max(0, Math.round(win.y)), Math.round(win.height)));

    if (sourceImg) {
      try {
        cropped = cropRectangle(sourceImg, {
          x: win.x,
          y: win.y,
          w: win.width,
          h: win.height,
        });
      } catch (err) {
        console.error('Failed to crop window frame from source image:', err);
      }
    }

    if (!cropped && frameSrc) {
      cropped = await cropFromDataUrl(frameSrc, {
        x: win.x,
        y: win.y,
        w: win.width,
        h: win.height,
      });
    }

    onCapture({
      imageUrl: cropped || frameSrc,
      width: finalW,
      height: finalH,
      mode: 'window',
      delay: currentDelay,
    });
  }

  function handleMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('.floating-pill')) return;

    // Phase 15: in the picker, left-click copies the color and closes.
    if (isPickingColor) {
      pickX = e.clientX;
      pickY = e.clientY;
      void commitPickedColor();
      return;
    }

    if (isSnipMenuOpen || isDelayMenuOpen) {
      isSnipMenuOpen = false;
      isDelayMenuOpen = false;
      return;
    }

    // Overlay OCR mode: drag always draws a rectangle, regardless of snip type.
    if (isOcrMode) {
      // Drag inside the saved region = word selection; outside = new OCR region.
      const inside =
        ocrRect !== null &&
        e.clientX >= ocrRect.x && e.clientX <= ocrRect.x + ocrRect.w &&
        e.clientY >= ocrRect.y && e.clientY <= ocrRect.y + ocrRect.h;
      ocrSelecting = inside && ocrStatus === 'ready';
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      currentX = e.clientX;
      currentY = e.clientY;
      isSnipMenuOpen = false;
      isDelayMenuOpen = false;
      return;
    }

    if (currentSnipType === 'fullscreen') {
      executeFullscreenCapture();
      return;
    }

    if (currentSnipType === 'window') {
      let targetWin = hoveredWindow;
      if (!targetWin && desktopCapture && desktopCapture.windows.length > 0) {
        const { scaleX, scaleY } = getScale();
        targetWin = findHoveredWindow(
          desktopCapture.windows,
          e.clientX * scaleX,
          e.clientY * scaleY
        );
      }
      if (targetWin) {
        executeWindowCapture(targetWin);
      } else {
        executeFullscreenCapture();
      }
      return;
    }

    if (currentSnipType === 'freeform') {
      isDragging = true;
      freeformPoints = [{ x: e.clientX, y: e.clientY }];
      return;
    }

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    currentX = e.clientX;
    currentY = e.clientY;
    isSnipMenuOpen = false;
    isDelayMenuOpen = false;
  }

  function handleMouseMove(e: MouseEvent) {
    // Phase 15: the loupe follows the pointer while picking.
    if (isPickingColor) {
      pickX = e.clientX;
      pickY = e.clientY;
      renderLoupe();
      return;
    }

    // I-beam cursor over scanned text (persisted region), crosshair elsewhere.
    if (isOcrMode && ocrStatus === 'ready' && ocrRect !== null) {
      ocrHoverText =
        e.clientX >= ocrRect.x && e.clientX <= ocrRect.x + ocrRect.w &&
        e.clientY >= ocrRect.y && e.clientY <= ocrRect.y + ocrRect.h;
    } else {
      ocrHoverText = false;
    }

    if (isDraggingPill) {
      pillX = Math.max(10, Math.min(window.innerWidth - 300, e.clientX - dragOffset.x));
      pillY = Math.max(8, Math.min(window.innerHeight - 60, e.clientY - dragOffset.y));
      return;
    }

    if (currentSnipType === 'window' && !isOcrMode) {
      if (desktopCapture && desktopCapture.windows.length > 0) {
        const { scaleX, scaleY } = getScale();
        hoveredWindow = findHoveredWindow(
          desktopCapture.windows,
          e.clientX * scaleX,
          e.clientY * scaleY
        );
      }
      return;
    }

    if (!isDragging) return;

    if (currentSnipType === 'freeform' && !isOcrMode) {
      freeformPoints = [...freeformPoints, { x: e.clientX, y: e.clientY }];
      return;
    }

    currentX = e.clientX;
    currentY = e.clientY;

    // Live word highlight while dragging inside the saved region (no rectangle spawned).
    if (ocrSelecting && ocrResult) {
      const rect = {
        x: Math.min(startX, e.clientX),
        y: Math.min(startY, e.clientY),
        w: Math.abs(e.clientX - startX),
        h: Math.abs(e.clientY - startY),
      };
      const { scaleX, scaleY } = getScale();
      const ix0 = rect.x * scaleX - ocrOrigin.x;
      const iy0 = rect.y * scaleY - ocrOrigin.y;
      const ix1 = (rect.x + rect.w) * scaleX - ocrOrigin.x;
      const iy1 = (rect.y + rect.h) * scaleY - ocrOrigin.y;
      const picked = new Set<string>();
      for (const w of ocrResult.words) {
        const cx = (w.bbox.x0 + w.bbox.x1) / 2;
        const cy = (w.bbox.y0 + w.bbox.y1) / 2;
        const iw = Math.max(0, Math.min(w.bbox.x1, ix1) - Math.max(w.bbox.x0, ix0));
        const ih = Math.max(0, Math.min(w.bbox.y1, iy1) - Math.max(w.bbox.y0, iy0));
        const area = Math.max(1e-9, (w.bbox.x1 - w.bbox.x0) * (w.bbox.y1 - w.bbox.y0));
        if ((cx >= ix0 && cx <= ix1 && cy >= iy0 && cy <= iy1) || (iw * ih) / area >= 0.3) picked.add(w.id);
      }
      ocrSelectedIds = picked;
    }
  }

  function ocrCropCanvas(clientRect: { x: number; y: number; w: number; h: number }): HTMLCanvasElement | null {
    const source = frozenCanvasEl;
    if (!source || source.width === 0) return null;
    const { scaleX, scaleY } = getScale();
    const sx = Math.max(0, Math.round(clientRect.x * scaleX));
    const sy = Math.max(0, Math.round(clientRect.y * scaleY));
    const sw = Math.max(1, Math.round(clientRect.w * scaleX));
    const sh = Math.max(1, Math.round(clientRect.h * scaleY));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas;
  }

  async function runOverlayOcr(clientRect: { x: number; y: number; w: number; h: number }) {
    const canvas = ocrCropCanvas(clientRect);
    if (!canvas) {
      ocrStatus = 'error';
      ocrError = 'Capture not ready yet';
      return;
    }
    const { scaleX, scaleY } = getScale();
    const runId = ++ocrRunId;
    ocrStatus = 'loading';
    ocrProgress = 0;
    ocrError = null;
    ocrResult = null;
    ocrSelectedIds = new Set();
    try {
      const cropped = await runOcr(canvas, { onProgress: (p) => { if (runId === ocrRunId) ocrProgress = p; } });
      if (runId !== ocrRunId || !isOcrMode) return;
      ocrOrigin = { x: Math.round(clientRect.x * scaleX), y: Math.round(clientRect.y * scaleY) };
      ocrResult = cropped;
      ocrStatus = cropped.words.length > 0 ? 'ready' : 'empty';
    } catch (err) {
      if (runId !== ocrRunId) return;
      console.warn('Overlay OCR failed:', err);
      ocrStatus = 'error';
      ocrError = 'Scan failed — try again';
    }
  }

  function handleOcrWordClick(clientX: number, clientY: number) {
    if (!ocrResult) return;
    const { scaleX, scaleY } = getScale();
    const ix = clientX * scaleX - ocrOrigin.x;
    const iy = clientY * scaleY - ocrOrigin.y;
    const w = ocrResult.words.find((wd) => ix >= wd.bbox.x0 && ix <= wd.bbox.x1 && iy >= wd.bbox.y0 && iy <= wd.bbox.y1);
    if (!w) return;
    const next = new Set(ocrSelectedIds);
    if (next.has(w.id)) next.delete(w.id); else next.add(w.id);
    ocrSelectedIds = next;
  }

  async function handleMouseUp() {
    if (isDraggingPill) {
      isDraggingPill = false;
      return;
    }
    if (!isDragging) return;

    // Overlay OCR: inside region selects words; outside drags run OCR.
    if (isOcrMode) {
      const rect = {
        x: Math.min(startX, currentX),
        y: Math.min(startY, currentY),
        w: Math.abs(currentX - startX),
        h: Math.abs(currentY - startY),
      };
      const wasSelecting = ocrSelecting;
      isDragging = false;
      ocrSelecting = false;
      if (wasSelecting && ocrResult) {
        // Click toggles one word; drag selects intersecting words.
        if (rect.w < 4 && rect.h < 4) {
          handleOcrWordClick(startX, startY);
        } else {
          const { scaleX, scaleY } = getScale();
          const ix0 = rect.x * scaleX - ocrOrigin.x;
          const iy0 = rect.y * scaleY - ocrOrigin.y;
          const ix1 = (rect.x + rect.w) * scaleX - ocrOrigin.x;
          const iy1 = (rect.y + rect.h) * scaleY - ocrOrigin.y;
          const picked = new Set<string>();
          for (const w of ocrResult.words) {
            const cx = (w.bbox.x0 + w.bbox.x1) / 2;
            const cy = (w.bbox.y0 + w.bbox.y1) / 2;
            const iw = Math.max(0, Math.min(w.bbox.x1, ix1) - Math.max(w.bbox.x0, ix0));
            const ih = Math.max(0, Math.min(w.bbox.y1, iy1) - Math.max(w.bbox.y0, iy0));
            const area = Math.max(1e-9, (w.bbox.x1 - w.bbox.x0) * (w.bbox.y1 - w.bbox.y0));
            if ((cx >= ix0 && cx <= ix1 && cy >= iy0 && cy <= iy1) || (iw * ih) / area >= 0.3) picked.add(w.id);
          }
          ocrSelectedIds = picked;
        }
        return;
      }
      if (rect.w > 8 && rect.h > 8) {
        ocrRect = rect;
        void runOverlayOcr(rect);
      }
      return;
    }

    if (currentSnipType === 'rectangle') {
      const rect = {
        x: Math.min(startX, currentX),
        y: Math.min(startY, currentY),
        w: Math.abs(currentX - startX),
        h: Math.abs(currentY - startY),
      };
      isDragging = false;

      if (rect.w > 10 && rect.h > 10) {
        const { scaleX, scaleY } = getScale();
        const scaledRect = {
          x: rect.x * scaleX,
          y: rect.y * scaleY,
          w: rect.w * scaleX,
          h: rect.h * scaleY,
        };

        let cropped = '';
        const sourceImg = frozenCanvasEl;
        if (sourceImg && sourceImg.width > 0) {
          try {
            cropped = cropRectangle(sourceImg, scaledRect);
          } catch (err) {
            console.error('Failed to crop rectangle from source image:', err);
          }
        }

        if (!cropped && frameSrc) {
          cropped = await cropFromDataUrl(frameSrc, scaledRect);
        }

        onCapture({
          imageUrl: cropped || frameSrc,
          width: Math.round(scaledRect.w),
          height: Math.round(scaledRect.h),
          mode: 'rectangle',
          delay: currentDelay,
        });
      }
    } else if (currentSnipType === 'freeform') {
      const pts = [...freeformPoints];
      isDragging = false;
      freeformPoints = [];

      if (pts.length >= 3) {
        const { scaleX, scaleY } = getScale();
        const scaledPoints = pts.map((p) => ({
          x: p.x * scaleX,
          y: p.y * scaleY,
        }));

        let cropResult = { dataUrl: '', width: 0, height: 0 };
        const sourceImg = frozenCanvasEl;
        if (sourceImg && sourceImg.width > 0) {
          try {
            cropResult = cropFreeform(sourceImg, scaledPoints);
          } catch (err) {
            console.error('Failed to crop freeform from source image:', err);
          }
        }

        if (!cropResult.dataUrl && frameSrc) {
          cropResult = await cropFreeformFromDataUrl(
            frameSrc,
            scaledPoints
          );
        }

        if (cropResult.dataUrl) {
          onCapture({
            imageUrl: cropResult.dataUrl,
            width: cropResult.width,
            height: cropResult.height,
            mode: 'freeform',
            delay: currentDelay,
          });
        }
      }
    } else {
      isDragging = false;
    }
  }

  function selectSnipType(type: SnipType) {
    currentSnipType = type;
    onSnipTypeChange(type);
    isSnipMenuOpen = false;
    if (type === 'fullscreen') {
      executeFullscreenCapture();
    }
  }

  function selectDelay(d: SnipDelay) {
    currentDelay = d;
    onDelayChange(d);
    isDelayMenuOpen = false;
  }

  function handleScreenDrawClick() {
    onScreenDraw();
    executeFullscreenCapture();
  }

  // Phase 15: the eyedropper enters the loupe picker: circular magnifying
  // cursor, Ctrl+wheel zoom, format toggle, click to copy and close.
  function handleColorPickerClick() {
    isPickingColor = true;
    isSnipMenuOpen = false;
    isDelayMenuOpen = false;
  }

  function exitColorPicker() {
    isPickingColor = false;
  }

  function handleTextActionsClick() {
    // Select the OCR tool; dragging now OCRs a region in place.
    // Do NOT capture — results stay on the frozen frame.
    if (isOcrMode) {
      exitOcrMode();
      return;
    }
    isOcrMode = true;
    ocrStatus = 'idle';
    ocrResult = null;
    ocrError = null;
    ocrSelectedIds = new Set();
    ocrRect = null;
    ocrSelecting = false;
    isPickingColor = false;
    isSnipMenuOpen = false;
    isDelayMenuOpen = false;
    onTextActions();
  }
</script>

<svelte:window
  onpointerdown={handleWindowPointerDown}
  onmousemove={active ? handleMouseMove : undefined}
  onmouseup={active ? handleMouseUp : undefined}
  onwheel={isPickingColor ? handleLoupeWheel : undefined}
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      if (isPickingColor) {
        exitColorPicker();
      } else if (isOcrMode) {
        exitOcrMode();
      } else if (isSnipMenuOpen || isDelayMenuOpen) {
        isSnipMenuOpen = false;
        isDelayMenuOpen = false;
      } else if (active) {
        isCloseHovered = false;
        onClose();
      }
    }
    if (isOcrMode && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      if (ocrResult) ocrSelectedIds = new Set(ocrResult.words.map((w) => w.id));
    }
    if (isOcrMode && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      if (ocrSelectedIds.size > 0 && ocrResult) {
        e.preventDefault();
        void copyOcrText(ocrResult.words.filter((w) => ocrSelectedIds.has(w.id)).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0).map((w) => w.text).join(' '));
      }
    }
  }}
/>

{#if active}
  <!-- Fullscreen Dimming Overlay & Drag Surface -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 select-none overflow-hidden"
    class:opacity-0={!visible}
    style={isPickingColor ? 'cursor: none !important;' : ocrHoverText ? 'cursor: text !important;' : 'cursor: crosshair !important;'}
    onmousedown={handleMouseDown}
    onmousemove={handleMouseMove}
    onmouseup={handleMouseUp}
    onwheel={isPickingColor ? handleLoupeWheel : undefined}
  >
    <!-- Frozen display screenshot layer -->
    {#if frameSrc || frameBitmap}
      <canvas
        bind:this={frozenCanvasEl}
        class="absolute inset-0 w-full h-full pointer-events-none select-none"
      ></canvas>
    {/if}

    <!-- SVG Mask with live shape cutouts -->
    <svg class="absolute inset-0 w-full h-full pointer-events-none">
      <defs>
        <mask id="snip-cutout-mask">
          <rect width="100%" height="100%" fill="white" />
          {#if (currentSnipType === 'rectangle' || isOcrMode) && selectionRect !== null}
            <rect
              x={selectionRect.x}
              y={selectionRect.y}
              width={selectionRect.w}
              height={selectionRect.h}
              fill="black"
            />
          {:else if currentSnipType === 'freeform' && freeformPoints.length > 2}
            <polygon
              points={freeformPoints.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="black"
            />
          {:else if currentSnipType === 'window' && clientHoveredWindow !== null}
            <rect
              x={clientHoveredWindow.x}
              y={clientHoveredWindow.y}
              width={clientHoveredWindow.w}
              height={clientHoveredWindow.h}
              fill="black"
            />
          {/if}
        </mask>
      </defs>

      <!-- Translucent darkened background with cutout mask -->
      <rect
        width="100%"
        height="100%"
        fill="rgba(0, 0, 0, 0.45)"
        mask="url(#snip-cutout-mask)"
      />

      <!-- Rectangle Mode Border -->
      {#if (currentSnipType === 'rectangle' || isOcrMode) && selectionRect !== null}
        <rect
          x={selectionRect.x}
          y={selectionRect.y}
          width={selectionRect.w}
          height={selectionRect.h}
          fill="none"
          stroke="#0067c0"
          stroke-width="1.5"
        />
      {/if}

      <!-- Freeform Mode Path -->
      {#if currentSnipType === 'freeform' && freeformPoints.length > 1}
        <polyline
          points={freeformPoints.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="#0067c0"
          stroke-width="2"
          stroke-dasharray="4 2"
        />
      {/if}

      <!-- Window Mode Accent Frame & Tint -->
      {#if currentSnipType === 'window' && clientHoveredWindow !== null}
        <rect
          x={clientHoveredWindow.x}
          y={clientHoveredWindow.y}
          width={clientHoveredWindow.w}
          height={clientHoveredWindow.h}
          fill="rgba(0, 103, 192, 0.12)"
          stroke="#0067c0"
          stroke-width="2"
        />
      {/if}
    </svg>

    <!-- Dimension Badge (Rectangle Mode) -->
    {#if (currentSnipType === 'rectangle' || isOcrMode) && selectionRect !== null}
      {@const { scaleX, scaleY } = getScale()}
      <div
        class="absolute pointer-events-none bg-black/80 text-white text-[11px] font-mono px-2 py-0.5 rounded shadow-md border border-white/10"
        style="left: {selectionRect.x + selectionRect.w / 2 - 40}px; top: {Math.min(window.innerHeight - 30, selectionRect.y + selectionRect.h + 8)}px;"
      >
        {Math.round(selectionRect.w * scaleX)} × {Math.round(selectionRect.h * scaleY)}
      </div>
    {/if}

    <!-- Window Badge (Window Mode) -->
    {#if currentSnipType === 'window' && !isOcrMode && clientHoveredWindow !== null && hoveredWindow !== null}
      <div
        class="absolute pointer-events-none bg-black/85 text-white text-[11px] font-medium px-2 py-0.5 rounded shadow-md border border-white/15 max-w-[320px] truncate"
        style="left: {Math.max(12, clientHoveredWindow.x)}px; top: {Math.max(12, clientHoveredWindow.y - 26)}px;"
      >
        {hoveredWindow.title || 'Application Window'} ({Math.round(hoveredWindow.width)} × {Math.round(hoveredWindow.height)})
      </div>
    {/if}

    <!-- Overlay OCR: persistent border + highlighted words (no panel) -->
    {#if isOcrMode && ocrRect !== null && ocrStatus !== 'loading'}
      <div
        class="absolute pointer-events-none border border-[#0067c0]"
        style="left: {ocrRect.x}px; top: {ocrRect.y}px; width: {ocrRect.w}px; height: {ocrRect.h}px;"
      ></div>
    {/if}
    {#if isOcrMode && ocrStatus === 'ready' && ocrResult}
      {@const { scaleX: oxScaleX, scaleY: oxScaleY } = getScale()}
      {#each ocrResult.words as w}
        {@const sel = ocrSelectedIds.has(w.id)}
        <div
          class="absolute pointer-events-none rounded-[2px] {sel ? 'bg-[#0067c0]/60' : 'bg-[#0067c0]/25'}"
          style="left: {(ocrOrigin.x + w.bbox.x0) / oxScaleX}px; top: {(ocrOrigin.y + w.bbox.y0) / oxScaleY}px; width: {Math.max(2, (w.bbox.x1 - w.bbox.x0) / oxScaleX)}px; height: {Math.max(2, (w.bbox.y1 - w.bbox.y0) / oxScaleY)}px;"
          title={w.text}
          aria-hidden="true"
        ></div>
      {/each}
    {/if}
    {#if isOcrMode && ocrStatus === 'loading' && ocrRect !== null}
      <div class="absolute pointer-events-none border border-[#0067c0]" style="left: {ocrRect.x}px; top: {ocrRect.y}px; width: {ocrRect.w}px; height: {ocrRect.h}px;">
        <div class="absolute inset-x-0 bottom-0 h-0.5 bg-white/20"><div class="h-full bg-white transition-all" style="width: {Math.round((ocrProgress || 0.05) * 100)}%;"></div></div>
      </div>
    {/if}
    <!-- Compact copy pill anchored to the region (no bottom sheet) -->
    {#if isOcrMode && ocrStatus === 'ready' && ocrResult && ocrRect !== null}
      {@const currentResult = ocrResult}
      <div
        class="absolute z-50 flex items-center gap-1 rounded-[10px] border border-black/[0.08] bg-[#fdfdfd] p-1 shadow-[0_8px_32px_rgba(0,0,0,0.4)] dark:bg-[#161b26]"
        style="left: {ocrRect.x + ocrRect.w - 150}px; top: {Math.min(window.innerHeight - 56, ocrRect.y + ocrRect.h + 8)}px;"
        onmousedown={(e) => e.stopPropagation()}
      >
        <button type="button" class="flex h-8 items-center gap-1 rounded-[6px] px-2 text-[11px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] cursor-pointer" title="Copy all" onclick={() => copyOcrText(currentResult.plainText)}><Copy class="w-3.5 h-3.5" />Copy</button>
        <button type="button" class="flex h-8 items-center gap-1 rounded-[6px] px-2 text-[11px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer" title={currentResult.hasTable ? 'Copy as table' : 'No table detected'} disabled={!currentResult.hasTable} onclick={() => copyOcrText(currentResult.tableTsv)}><Table2 class="w-3.5 h-3.5" />Table</button>
        <button type="button" class="flex h-8 items-center rounded-[6px] px-2 text-[11px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer" title="Copy selection" disabled={ocrSelectedIds.size === 0} onclick={() => {
          const sorted = currentResult.words.filter((w) => ocrSelectedIds.has(w.id)).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
          copyOcrText(sorted.map((w) => w.text).join(' '));
        }}>Sel</button>
        <button type="button" class="flex h-8 items-center rounded-[6px] px-2 text-[11px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] cursor-pointer" title="Select all" onclick={() => { ocrSelectedIds = new Set(currentResult.words.map((w) => w.id)); }}>All</button>
      </div>
      {#if ocrToast}
        <div class="absolute z-50 -translate-x-1/2 rounded-full bg-black/85 px-2.5 py-1 text-[11px] text-white" style="left: {ocrRect.x + ocrRect.w / 2}px; top: {ocrRect.y + ocrRect.h + 44}px;">{ocrToast}</div>
      {/if}
    {/if}

    <!-- Floating capture toolbar pill (Matching Reference, Draggable) -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="floating-pill fixed z-50 flex items-center bg-[#fdfdfd] dark:bg-[#161b26] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)] rounded-[10px] p-1 gap-1 text-neutral-800 dark:text-neutral-100 cursor-move"
      style={pillX !== null
        ? `left: ${pillX}px; top: ${pillY}px;`
        : `left: 50%; top: ${pillY}px; transform: translateX(-50%);`}
      onmousedown={handlePillMouseDown}
    >
      <!-- 1. Camera & Video Segmented Box -->
      <div class="flex items-center h-8 bg-black/[0.04] dark:bg-white/[0.06] rounded-[6px] p-0.5 border border-black/[0.05] dark:border-white/[0.05]">
        <!-- Camera Button (Snip Mode) -->
        <button
          type="button"
          class="relative h-full px-2.5 rounded-[4px] flex items-center justify-center transition-colors cursor-pointer {currentMode === 'snip' ? 'bg-white dark:bg-[#252c3d] text-neutral-900 dark:text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}"
          onclick={() => { currentMode = 'snip'; onModeChange('snip'); }}
          title="Snip mode"
        >
          <Camera class="w-4 h-4 text-neutral-700 dark:text-neutral-200 stroke-[1.6]" />
          {#if currentMode === 'snip'}
            <div class="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3.5 h-[2.5px] rounded-full bg-[#0067c0] dark:bg-[#60cdff]"></div>
          {/if}
        </button>

        <!-- Video Button (Record Mode) -->
        <button
          type="button"
          class="relative h-full px-2.5 rounded-[4px] flex items-center justify-center transition-colors cursor-pointer {currentMode === 'record' ? 'bg-white dark:bg-[#252c3d] text-neutral-900 dark:text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}"
          onclick={() => { currentMode = 'record'; onModeChange('record'); }}
          title="Record mode"
        >
          <Video class="w-4 h-4 text-neutral-700 dark:text-neutral-200 stroke-[1.6]" />
          {#if currentMode === 'record'}
            <div class="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3.5 h-[2.5px] rounded-full bg-[#0067c0] dark:bg-[#60cdff]"></div>
          {/if}
        </button>
      </div>

      <!-- 2. Snip Mode Selector with Dropdown Chevron -->
      <div class="relative snip-menu-container">
        <button
          type="button"
          class="h-8 px-2 rounded-[6px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] flex items-center justify-center gap-1 text-neutral-800 dark:text-neutral-100 transition-colors cursor-pointer"
          onclick={() => { isSnipMenuOpen = !isSnipMenuOpen; isDelayMenuOpen = false; }}
          title="Snip shape"
        >
          <SnipIcons type={currentSnipType} className="w-4 h-4 text-neutral-700 dark:text-neutral-200" />
          <ChevronDown class="w-3 h-3 text-neutral-500 stroke-[1.8]" />
        </button>

        <!-- Snip Mode Dropdown Menu -->
        {#if isSnipMenuOpen}
          <div
            class="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 min-w-[160px] bg-[#fbfbfb] dark:bg-[#181d28] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_12px_32px_rgba(0,0,0,0.45)] py-1 flex flex-col"
          >
            {#each snipOptions as opt}
              <button
                type="button"
                class="relative flex items-center gap-3 px-3 py-2 text-[13px] font-normal text-left text-neutral-800 dark:text-neutral-100 rounded-[5px] mx-1 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.06] cursor-pointer"
                onclick={() => selectSnipType(opt.id)}
              >
                {#if currentSnipType === opt.id}
                  <div class="absolute left-1 w-[3px] h-4 rounded-full bg-[#0067c0] dark:bg-[#60cdff]"></div>
                {/if}

                <div class="w-4 h-4 flex items-center justify-center ml-1 text-neutral-700 dark:text-neutral-200">
                  <SnipIcons type={opt.id} className="w-4 h-4" />
                </div>
                <span>{opt.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- 3. Timer Delay Option with Dropdown Chevron -->
      <div class="relative delay-menu-container">
        <button
          type="button"
          class="h-8 px-2 rounded-[6px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] flex items-center justify-center gap-1 text-neutral-800 dark:text-neutral-100 transition-colors cursor-pointer"
          onclick={() => { isDelayMenuOpen = !isDelayMenuOpen; isSnipMenuOpen = false; }}
          title={currentDelay === 0 ? 'Snip delay (No delay)' : `Snip delay (${currentDelay}-second delay)`}
        >
          {#if currentDelay === 0}
            <TimerOff class="w-4 h-4 text-neutral-700 dark:text-neutral-200 stroke-[1.8]" />
          {:else}
            <div class="relative flex items-center">
              <Timer class="w-4 h-4 text-[#0067c0] dark:text-[#60cdff] stroke-[1.8]" />
              <span class="absolute -bottom-1 -right-1 text-[9px] font-bold font-mono px-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-100 leading-none">{currentDelay}</span>
            </div>
          {/if}
          <ChevronDown class="w-3 h-3 text-neutral-500 stroke-[1.8]" />
        </button>

        <!-- Delay Dropdown Menu -->
        {#if isDelayMenuOpen}
          <div
            class="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 min-w-[160px] bg-[#fbfbfb] dark:bg-[#181d28] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_12px_32px_rgba(0,0,0,0.45)] py-1 flex flex-col"
          >
            {#each delayOptions as opt}
              <button
                type="button"
                class="relative flex items-center justify-between px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors text-neutral-800 dark:text-neutral-200 cursor-pointer"
                onclick={() => selectDelay(opt.id)}
              >
                <span>{opt.label}</span>
                {#if currentDelay === opt.id}
                  <Check class="w-3.5 h-3.5 text-[#0067c0] dark:text-[#60cdff]" />
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- 4. Screen Draw / Annotation Button (Rectangle part aligned with other icons) -->
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] flex items-center justify-center text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer"
        onclick={handleScreenDrawClick}
        title="Draw on screen"
      >
        <SnipIcons type="screen-markup" className="w-4 h-4" />
      </button>

      <!-- Vertical divider -->
      <div class="w-[1px] h-4 bg-black/[0.1] dark:bg-white/[0.1] mx-0.5"></div>

      <!-- 5. Color Picker Tool (Eyedropper, Phase 15) -->
      <button
        type="button"
        aria-pressed={isPickingColor}
        class="w-8 h-8 rounded-[6px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] flex items-center justify-center transition-colors cursor-pointer {isPickingColor ? 'bg-[#0067c0] text-white' : 'text-neutral-700 dark:text-neutral-200'}"
        onclick={handleColorPickerClick}
        title="Color picker"
      >
        <Pipette class="w-4 h-4 stroke-[1.8]" />
      </button>

      <!-- 6. Text Actions / OCR Tool -->
      <button
        type="button"
        aria-pressed={isOcrMode}
        class="w-8 h-8 rounded-[6px] flex items-center justify-center transition-colors cursor-pointer {isOcrMode ? 'bg-[#0067c0] text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-200'}"
        onclick={handleTextActionsClick}
        title={isOcrMode ? 'OCR: drag to scan a region (Esc to exit)' : 'Text actions (OCR)'}
      >
        <ScanText class="w-4 h-4 stroke-[1.8]" />
      </button>

      <!-- Vertical divider -->
      <div class="w-[1px] h-4 bg-black/[0.1] dark:bg-white/[0.1] mx-0.5"></div>

      <!-- 7. Close Button -->
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] flex items-center justify-center cursor-pointer {isCloseHovered ? 'bg-[#c42b1c] text-white' : 'text-neutral-600 dark:text-neutral-300'}"
        onmouseenter={(e) => {
          if (!active || !visible) return;
          const rect = (e.currentTarget as HTMLElement)?.getBoundingClientRect();
          if (
            rect &&
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom
          ) {
            isCloseHovered = true;
          }
        }}
        onmouseleave={() => { isCloseHovered = false; }}
        onmousedown={() => { isCloseHovered = false; }}
        onclick={(e) => {
          (e.currentTarget as HTMLElement)?.blur();
          isCloseHovered = false;
          onClose();
        }}
        title="Cancel snip (Esc)"
      >
        <X class="w-4 h-4 stroke-[1.8]" />
      </button>
    </div>
  </div>
{/if}

<!-- Phase 15: circular magnifying loupe following the pointer -->
{#if isPickingColor}
  {@const picked = pickColorAt(pickX, pickY)}
  <div
    class="fixed z-[60] pointer-events-none -translate-x-1/2 -translate-y-1/2"
    style="left: {pickX}px; top: {pickY}px;"
    data-testid="color-picker-loupe"
  >
    <div class="relative rounded-full border-2 border-white shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden bg-black" style="width: 144px; height: 144px;">
      {#if loupeUrl}
        <img src={loupeUrl} alt="" class="absolute inset-0 h-full w-full" style="image-rendering: pixelated;" />
      {/if}
      <div class="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-white/80"></div>
      <div class="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 bg-white/80"></div>
    </div>
    <!-- Format toggle + picked value -->
    <div class="absolute left-1/2 top-full mt-2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/85 px-2 py-1 text-[11px] font-mono text-white shadow-lg pointer-events-auto" role="group" aria-label="Color format" tabindex="-1" onpointerdown={(e) => e.stopPropagation()}>
      {#each COLOR_PICKER_FORMATS as fmt}
        <button
          type="button"
          aria-pressed={pickFormat === fmt}
          class="rounded px-1.5 py-0.5 {pickFormat === fmt ? 'bg-white text-black' : 'text-white/70 hover:text-white'}"
          onclick={() => { pickFormat = fmt; }}
        >
          {fmt}
        </button>
      {/each}
      <span class="ml-1">{picked ? formatColor(picked, pickFormat) : ''}</span>
      <span class="text-white/50">· {loupeZoom}x</span>
    </div>
  </div>
{/if}
