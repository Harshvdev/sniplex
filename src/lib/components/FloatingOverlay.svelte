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
  import type { CaptureMode, SnipType, SnipDelay } from '../types';

  let {
    active = false,
    mode = 'snip',
    snipType = 'rectangle',
    delay = 0,
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
    onClose: () => void;
    onCapture: (rect: { x: number; y: number; w: number; h: number }) => void;
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
  });

  // Drag-to-snip interaction state
  let isDragging = $state(false);
  let startX = $state(0);
  let startY = $state(0);
  let currentX = $state(0);
  let currentY = $state(0);

  let selectionRect = $derived(
    isDragging
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

  function handleMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('.floating-pill')) return;

    if (currentSnipType === 'fullscreen') {
      onCapture({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
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
    if (!isDragging) return;
    currentX = e.clientX;
    currentY = e.clientY;
  }

  function handleMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    if (selectionRect && selectionRect.w > 20 && selectionRect.h > 20) {
      onCapture(selectionRect);
    }
  }

  function selectSnipType(type: SnipType) {
    currentSnipType = type;
    onSnipTypeChange(type);
    isSnipMenuOpen = false;
    if (type === 'fullscreen') {
      onCapture({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
    }
  }

  function selectDelay(d: SnipDelay) {
    currentDelay = d;
    onDelayChange(d);
    isDelayMenuOpen = false;
  }

  function handleScreenDrawClick() {
    onScreenDraw();
    onCapture({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
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
      onCapture({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
    }
  }

  function handleTextActionsClick() {
    onTextActions();
    onCapture({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
  }
</script>

<svelte:window onkeydown={(e) => {
  if (e.key === 'Escape' && active) onClose();
}} />

{#if active}
  <!-- Fullscreen Dimming Overlay & Drag Surface -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 select-none cursor-crosshair overflow-hidden"
    onmousedown={handleMouseDown}
    onmousemove={handleMouseMove}
    onmouseup={handleMouseUp}
  >
    <!-- Darkened translucent background with cutout -->
    {#if selectionRect !== null}
      <!-- SVG overlay for transparent cutout box -->
      <svg class="absolute inset-0 w-full h-full pointer-events-none">
        <defs>
          <mask id="snip-cutout-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect x={selectionRect.x} y={selectionRect.y} width={selectionRect.w} height={selectionRect.h} fill="black" />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.4)"
          mask="url(#snip-cutout-mask)"
        />
        <!-- Active crisp blue selection border -->
        <rect
          x={selectionRect.x}
          y={selectionRect.y}
          width={selectionRect.w}
          height={selectionRect.h}
          fill="none"
          stroke="#0067c0"
          stroke-width="1.5"
        />
      </svg>

      <!-- Resolution dimension badge -->
      <div
        class="absolute pointer-events-none bg-black/80 text-white text-[11px] font-mono px-2 py-0.5 rounded shadow-md border border-white/10"
        style="left: {selectionRect.x + selectionRect.w / 2 - 40}px; top: {selectionRect.y + selectionRect.h + 8}px;"
      >
        {selectionRect.w} × {selectionRect.h}
      </div>
    {:else}
      <div class="absolute inset-0 bg-black/35 pointer-events-none transition-opacity duration-200"></div>
    {/if}

    <!-- Floating capture toolbar pill (Matching Reference) -->
    <div
      class="floating-pill absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center bg-[#fdfdfd] dark:bg-[#161b26] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)] rounded-[10px] p-1 gap-1 text-neutral-800 dark:text-neutral-100 cursor-default"
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
      <div class="relative">
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
      <div class="relative">
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
