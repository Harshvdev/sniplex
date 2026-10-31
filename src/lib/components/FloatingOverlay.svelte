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

  let {
    active = false,
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

  $effect(() => {
    currentMode = mode;
    currentSnipType = snipType;
    currentDelay = delay;

    if (!active) {
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

  let selectionRect = $derived(
    isDragging && currentSnipType === 'rectangle'
      ? {
          x: Math.min(startX, currentX),
          y: Math.min(startY, currentY),
          w: Math.abs(currentX - startX),
          h: Math.abs(currentY - startY),
        }
      : null
  );

  const snipOptions: { id: SnipType; label: string }[] = [
    { id: 'rectangle', label: 'Rectangle' },
    { id: 'window', label: 'Window' },
    { id: 'fullscreen', label: 'Full screen' },
    { id: 'freeform', label: 'Freeform' },
  ];

  const delayOptions: { id: SnipDelay; label: string }[] = [
    { id: 0, label: 'No delay' },
    { id: 3, label: 'Snip in 3 seconds' },
    { id: 5, label: 'Snip in 5 seconds' },
    { id: 10, label: 'Snip in 10 seconds' },
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
    });
  }

  async function executeWindowCapture(win: WindowRect) {
    let cropped = '';
    const sourceImg = frozenCanvasEl;
    if (sourceImg && sourceImg.width > 0) {
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
      width: win.width,
      height: win.height,
      mode: 'window',
    });
  }

  function handleMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('.floating-pill')) return;

    if (isSnipMenuOpen || isDelayMenuOpen) {
      isSnipMenuOpen = false;
      isDelayMenuOpen = false;
      return;
    }

    if (currentSnipType === 'fullscreen') {
      executeFullscreenCapture();
      return;
    }

    if (currentSnipType === 'window') {
      if (hoveredWindow) {
        executeWindowCapture(hoveredWindow);
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
    if (isDraggingPill) {
      pillX = Math.max(10, Math.min(window.innerWidth - 300, e.clientX - dragOffset.x));
      pillY = Math.max(8, Math.min(window.innerHeight - 60, e.clientY - dragOffset.y));
      return;
    }

    if (currentSnipType === 'window') {
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

    if (currentSnipType === 'freeform') {
      freeformPoints = [...freeformPoints, { x: e.clientX, y: e.clientY }];
      return;
    }

    currentX = e.clientX;
    currentY = e.clientY;
  }

  async function handleMouseUp() {
    if (isDraggingPill) {
      isDraggingPill = false;
      return;
    }
    if (!isDragging) return;

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

  async function handleColorPickerClick() {
    if (typeof window !== 'undefined' && 'EyeDropper' in window) {
      try {
        // @ts-ignore
        const eyeDropper = new window.EyeDropper();
        const result = await eyeDropper.open();
        if (result?.sRGBHex) {
          await navigator.clipboard.writeText(result.sRGBHex);
          onColorPicker(result.sRGBHex);
          onClose();
        }
      } catch {
        // Cancelled by user
      }
    } else {
      onColorPicker();
      executeFullscreenCapture();
    }
  }

  function handleTextActionsClick() {
    onTextActions();
    executeFullscreenCapture();
  }
</script>

<svelte:window
  onpointerdown={handleWindowPointerDown}
  onmousemove={active ? handleMouseMove : undefined}
  onmouseup={active ? handleMouseUp : undefined}
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      if (isSnipMenuOpen || isDelayMenuOpen) {
        isSnipMenuOpen = false;
        isDelayMenuOpen = false;
      } else if (active) {
        onClose();
      }
    }
  }}
/>

{#if active}
  <!-- Fullscreen Dimming Overlay & Drag Surface -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 select-none cursor-crosshair overflow-hidden"
    style="cursor: crosshair !important;"
    onmousedown={handleMouseDown}
    onmousemove={handleMouseMove}
    onmouseup={handleMouseUp}
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
          {#if currentSnipType === 'rectangle' && selectionRect !== null}
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
      {#if currentSnipType === 'rectangle' && selectionRect !== null}
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
    {#if currentSnipType === 'rectangle' && selectionRect !== null}
      {@const { scaleX, scaleY } = getScale()}
      <div
        class="absolute pointer-events-none bg-black/80 text-white text-[11px] font-mono px-2 py-0.5 rounded shadow-md border border-white/10"
        style="left: {selectionRect.x + selectionRect.w / 2 - 40}px; top: {Math.min(window.innerHeight - 30, selectionRect.y + selectionRect.h + 8)}px;"
      >
        {Math.round(selectionRect.w * scaleX)} × {Math.round(selectionRect.h * scaleY)}
      </div>
    {/if}

    <!-- Window Badge (Window Mode) -->
    {#if currentSnipType === 'window' && clientHoveredWindow !== null && hoveredWindow !== null}
      <div
        class="absolute pointer-events-none bg-black/85 text-white text-[11px] font-medium px-2 py-0.5 rounded shadow-md border border-white/15 max-w-[320px] truncate"
        style="left: {Math.max(12, clientHoveredWindow.x)}px; top: {Math.max(12, clientHoveredWindow.y - 26)}px;"
      >
        {hoveredWindow.title || 'Application Window'} ({Math.round(hoveredWindow.width)} × {Math.round(hoveredWindow.height)})
      </div>
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
          class="relative h-full px-2.5 rounded-[4px] flex items-center justify-center transition-all cursor-pointer {currentMode === 'snip' ? 'bg-white dark:bg-[#252c3d] text-neutral-900 dark:text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}"
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
          class="relative h-full px-2.5 rounded-[4px] flex items-center justify-center transition-all cursor-pointer {currentMode === 'record' ? 'bg-white dark:bg-[#252c3d] text-neutral-900 dark:text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}"
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
          title={currentDelay === 0 ? 'Snip delay (No delay)' : `Snip delay (${currentDelay}s)`}
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

      <!-- 5. Color Picker Tool (Eyedropper) -->
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] flex items-center justify-center text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer"
        onclick={handleColorPickerClick}
        title="Color picker"
      >
        <Pipette class="w-4 h-4 stroke-[1.8]" />
      </button>

      <!-- 6. Text Actions / OCR Tool -->
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] flex items-center justify-center text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer"
        onclick={handleTextActionsClick}
        title="Text actions (OCR)"
      >
        <ScanText class="w-4 h-4 stroke-[1.8]" />
      </button>

      <!-- Vertical divider -->
      <div class="w-[1px] h-4 bg-black/[0.1] dark:bg-white/[0.1] mx-0.5"></div>

      <!-- 7. Close Button -->
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-[#c42b1c] hover:text-white transition-colors cursor-pointer"
        onclick={onClose}
        title="Cancel snip (Esc)"
      >
        <X class="w-4 h-4 stroke-[1.8]" />
      </button>
    </div>
  </div>
{/if}
