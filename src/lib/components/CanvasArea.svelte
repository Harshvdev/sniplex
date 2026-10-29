<script lang="ts">
  import { onMount } from 'svelte';
  import { Check, X } from '@lucide/svelte';
  import type { ToolType, ShapeKind } from '../types';

  let {
    imageUrl = '',
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

  // Default mock image dimensions
  const imgWidth = 960;
  const imgHeight = 540;

  onMount(() => {
    if (canvasEl) {
      canvasEl.width = imgWidth;
      canvasEl.height = imgHeight;
      ctx = canvasEl.getContext('2d');
      drawMockScreenshot();
    }
  });

  function drawMockScreenshot() {
    if (!ctx || !canvasEl) return;
    // Render wallpaper preview
    const grad = ctx.createLinearGradient(0, 0, imgWidth, imgHeight);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#1e3a8a');
    grad.addColorStop(1, '#0284c7');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, imgWidth, imgHeight);

    // Subtle desktop bloom curves
    ctx.beginPath();
    ctx.arc(imgWidth * 0.5, imgHeight * 0.8, 300, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.filter = 'blur(40px)';
    ctx.fill();
    ctx.filter = 'none';

    // Mock window card in center
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.roundRect(140, 80, 680, 360, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Mock title in window card
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 20px "Segoe UI Variable", system-ui, sans-serif';
    ctx.fillText('Sniplex Captured Canvas', 180, 140);

    ctx.fillStyle = '#64748b';
    ctx.font = '14px "Segoe UI Variable", system-ui, sans-serif';
    ctx.fillText('Select the Pen or Highlighter tool above and draw directly on this screenshot.', 180, 180);
    ctx.fillText('Click "+ New" to experience the floating capture pill.', 180, 210);

    // Sample code/data box inside
    ctx.fillStyle = '#0f172a';
    ctx.roundRect(180, 240, 600, 140, 6);
    ctx.fill();

    ctx.fillStyle = '#38bdf8';
    ctx.font = '13px monospace';
    ctx.fillText('// Sniplex Screen Capture Tool', 200, 275);
    ctx.fillStyle = '#f1f5f9';
    ctx.fillText('const snip = { mode: "rectangle", delay: 0, theme: "fluent" };', 200, 305);
    ctx.fillStyle = '#a78bfa';
    ctx.fillText('captureScreen(snip).then(renderAnnotationCanvas);', 200, 335);
  }

  function startDrawing(e: MouseEvent) {
    if (isCropping || !ctx || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const scale = imgWidth / rect.width;
    isDrawing = true;
    lastX = (e.clientX - rect.left) * scale;
    lastY = (e.clientY - rect.top) * scale;
  }

  function draw(e: MouseEvent) {
    if (!isDrawing || !ctx || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const scale = imgWidth / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;

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

<div class="flex-1 overflow-auto bg-[#e8e8e8] dark:bg-[#1a1a1a] flex items-center justify-center p-8 relative select-none">
  <!-- Container with scaling for zoom -->
  <div
    class="relative transition-transform duration-100 ease-out"
    style="transform: scale({zoom / 100}); transform-origin: center center;"
  >
    <!-- Screenshot Canvas with Drop Shadow -->
    <div class="relative bg-white shadow-[0_12px_36px_rgba(0,0,0,0.25)] rounded-[4px] overflow-hidden border border-black/10 dark:border-white/10">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <canvas
        bind:this={canvasEl}
        class="block cursor-crosshair"
        style="width: {imgWidth}px; height: {imgHeight}px;"
        onmousedown={startDrawing}
        onmousemove={draw}
        onmouseup={stopDrawing}
        onmouseleave={stopDrawing}
      ></canvas>

      <!-- Crop HUD & Bounding Handles Overlay -->
      {#if isCropping}
        <div class="absolute inset-0 pointer-events-none">
          <!-- Darkened border mask -->
          <div class="absolute inset-0 border-[40px] border-black/40"></div>
          
          <!-- Crop border -->
          <div class="absolute inset-[40px] border-2 border-white shadow-sm pointer-events-auto">
            <!-- 8 Handles -->
            <div class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-black/40 rounded-sm"></div>
            <div class="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border border-black/40 rounded-sm"></div>
            <div class="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-black/40 rounded-sm"></div>
            <div class="absolute top-1/2 -translate-y-1/2 -right-1.5 w-3 h-3 bg-white border border-black/40 rounded-sm"></div>
            <div class="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-black/40 rounded-sm"></div>
            <div class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border border-black/40 rounded-sm"></div>
            <div class="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-black/40 rounded-sm"></div>
            <div class="absolute top-1/2 -translate-y-1/2 -left-1.5 w-3 h-3 bg-white border border-black/40 rounded-sm"></div>

            <!-- Floating Crop Action Controls -->
            <div class="absolute -top-12 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-white dark:bg-[#2c2c2c] px-2 py-1 rounded-[6px] shadow-lg border border-black/10 dark:border-white/10">
              <button
                type="button"
                class="flex items-center gap-1 px-2.5 py-1 bg-[#0067c0] text-white text-xs font-medium rounded hover:bg-[#1070c7] transition-colors"
                onclick={onApplyCrop}
              >
                <Check class="w-3.5 h-3.5" />
                <span>Apply</span>
              </button>
              <button
                type="button"
                class="flex items-center gap-1 px-2.5 py-1 hover:bg-black/5 dark:hover:bg-white/5 text-xs text-neutral-700 dark:text-neutral-300 rounded transition-colors"
                onclick={onCancelCrop}
              >
                <X class="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Bottom Dimensions Status Bar -->
  <div class="absolute bottom-2 right-3 text-[11px] font-mono text-neutral-500 dark:text-neutral-400 bg-white/70 dark:bg-black/40 px-2 py-0.5 rounded backdrop-blur-sm border border-black/5 dark:border-white/5">
    {imgWidth} × {imgHeight} px
  </div>
</div>

