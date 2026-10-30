<script lang="ts">
  import { onMount } from 'svelte';
  import { Check, X } from '@lucide/svelte';
  import type { ToolType, ShapeKind } from '../types';

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
    isCropping = false,
    onApplyCrop = () => {},
    onCancelCrop = () => {},
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
    isCropping: boolean;
    onApplyCrop: () => void;
    onCancelCrop: () => void;
  } = $props();

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let ctx = $state<CanvasRenderingContext2D | null>(null);
  let isDrawing = $state(false);
  let lastX = $state(0);
  let lastY = $state(0);

  // Canvas dimensions
  let canvasWidth = $state(960);
  let canvasHeight = $state(540);

  onMount(() => {
    canvasWidth = width || 960;
    canvasHeight = height || 540;
    if (canvasEl) {
      canvasEl.width = canvasWidth;
      canvasEl.height = canvasHeight;
      ctx = canvasEl.getContext('2d');
      renderCanvas();
    }
  });

  $effect(() => {
    if (imageUrl) {
      const img = new Image();
      img.onload = () => {
        canvasWidth = img.naturalWidth || width || 960;
        canvasHeight = img.naturalHeight || height || 540;
        if (canvasEl && ctx) {
          canvasEl.width = canvasWidth;
          canvasEl.height = canvasHeight;
          ctx.drawImage(img, 0, 0);
        }
      };
      img.src = imageUrl;
    } else {
      canvasWidth = width || 960;
      canvasHeight = height || 540;
      if (canvasEl && ctx) {
        canvasEl.width = canvasWidth;
        canvasEl.height = canvasHeight;
      }
      renderCanvas();
    }
  });

  function renderCanvas() {
    if (!ctx || !canvasEl) return;
    if (!imageUrl) {
      // Clean white canvas for new markup
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
  }

  function startDrawing(e: MouseEvent) {
    if (isCropping || !ctx || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    isDrawing = true;
    lastX = (e.clientX - rect.left) * scaleX;
    lastY = (e.clientY - rect.top) * scaleY;
  }

  function draw(e: MouseEvent) {
    if (!isDrawing || !ctx || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);

    if (activeTool === 'pen') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    } else if (activeTool === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = highlighterColor;
      ctx.lineWidth = highlighterSize;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    } else if (activeTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 20;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }

    lastX = x;
    lastY = y;
  }

  function stopDrawing() {
    isDrawing = false;
  }
</script>

<div class="flex-1 overflow-auto bg-[#e5e7eb] dark:bg-[#07090e] p-6 flex relative select-none">
  <!-- Interactive Viewport Wrapper with Dynamic Zoom -->
  <div
    class="m-auto relative shadow-[0_16px_48px_rgba(0,0,0,0.18)] dark:shadow-[0_16px_48px_rgba(0,0,0,0.45)] border border-black/10 dark:border-white/10 rounded-sm transition-transform duration-100 ease-out bg-white"
    style="transform: scale({zoom / 100}); transform-origin: center center;"
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <canvas
      bind:this={canvasEl}
      class="block cursor-crosshair"
      style="max-width: min({canvasWidth}px, calc(100vw - 64px)); max-height: min({canvasHeight}px, calc(100vh - 150px)); width: auto; height: auto;"
      onmousedown={startDrawing}
      onmousemove={draw}
      onmouseup={stopDrawing}
      onmouseleave={stopDrawing}
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

  <!-- Resolution & Zoom Status Bar at bottom right -->
  <div class="absolute bottom-3 right-4 flex items-center gap-2 px-2.5 py-1 bg-white/80 dark:bg-[#181d28]/80 border border-black/[0.08] dark:border-white/[0.08] rounded-[6px] shadow-sm text-[11px] font-mono text-neutral-600 dark:text-neutral-400 backdrop-blur-sm pointer-events-none">
    <span>{canvasWidth} × {canvasHeight} px</span>
    <span class="text-neutral-300 dark:text-neutral-600">|</span>
    <span>{zoom}%</span>
  </div>
</div>
