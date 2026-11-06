<script lang="ts">
  import { PROTRACTOR_RADIUS, normalizeAngle, type DraftingTool } from '../drafting';

  let {
    tool = 'ruler',
    x = 200,
    y = 200,
    angle = 0,
    scale = 1,
    onDrag = (_x: number, _y: number) => {},
    onRotate = (_angle: number) => {},
  }: {
    tool: DraftingTool;
    x: number;
    y: number;
    angle: number;
    /** Display pixels per image pixel (zoom). */
    scale: number;
    onDrag: (x: number, y: number) => void;
    onRotate: (angle: number) => void;
  } = $props();

  // Drag to move the tool; the parent converts client deltas to image space.
  let dragStart: { clientX: number; clientY: number; toolX: number; toolY: number } | null = null;

  function handlePointerDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragStart = { clientX: e.clientX, clientY: e.clientY, toolX: x, toolY: y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragStart) return;
    const dx = (e.clientX - dragStart.clientX) / scale;
    const dy = (e.clientY - dragStart.clientY) / scale;
    onDrag(dragStart.toolX + dx, dragStart.toolY + dy);
  }

  function handlePointerUp(e: PointerEvent) {
    dragStart = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 15 : 1;
    onRotate(normalizeAngle(angle + (e.deltaY < 0 ? step : -step)));
  }

  const half = 160;
  // Ruler: ticks every 20 image-px across the full 320 px straightedge.
  const rulerTicks = Array.from({ length: 17 }, (_, i) => -half + i * 20);
  // Protractor: ticks every 5° around the full circle; majors every 30°.
  const protractorTicks = Array.from({ length: 72 }, (_, i) => i * 5);
</script>

{#if tool !== 'off'}
  <div
    class="absolute z-10 cursor-move"
    style="left: {x * scale}px; top: {y * scale}px; width: {half * 2 * scale}px; height: {half * 2 * scale}px; transform: translate(-50%, -50%);"
    role="slider"
    aria-label={tool === 'ruler' ? 'Ruler' : 'Protractor'}
    aria-valuemin={0}
    aria-valuemax={359}
    aria-valuenow={Math.round(normalizeAngle(angle))}
    aria-valuetext={`${Math.round(normalizeAngle(angle))} degrees`}
    tabindex="0"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onwheel={handleWheel}
  >
    <svg viewBox="{-half} {-half} {half * 2} {half * 2}" class="h-full w-full" style="transform: rotate({-angle}deg);">
      {#if tool === 'ruler'}
        <rect x="{-half}" y="-16" width="{half * 2}" height="32" rx="4" fill="rgba(255,255,255,0.85)" stroke="rgba(0,0,0,0.35)" stroke-width="1" />
        {#each rulerTicks as tick}
          <line x1={tick} y1="-16" x2={tick} y2={tick % 80 === 0 ? "6" : tick % 40 === 0 ? "0" : "-6"} stroke="rgba(0,0,0,0.5)" stroke-width={tick % 80 === 0 ? "1.4" : "0.8"} />
        {/each}
        <text x="0" y="28" text-anchor="middle" font-size="11" fill="rgba(0,0,0,0.6)">{Math.round(angle)}°</text>
      {:else}
        <circle cx="0" cy="0" r="{PROTRACTOR_RADIUS}" fill="rgba(255,255,255,0.35)" stroke="rgba(0,0,0,0.45)" stroke-width="1.5" />
        <circle cx="0" cy="0" r="10" fill="rgba(0,0,0,0.35)" />
        {#each protractorTicks as tick}
          {@const rad = (tick * Math.PI) / 180}
          <line
            x1={Math.cos(rad) * (PROTRACTOR_RADIUS - (tick % 30 === 0 ? 18 : tick % 15 === 0 ? 13 : 9))}
            y1={Math.sin(rad) * (PROTRACTOR_RADIUS - (tick % 30 === 0 ? 18 : tick % 15 === 0 ? 13 : 9))}
            x2={Math.cos(rad) * PROTRACTOR_RADIUS}
            y2={Math.sin(rad) * PROTRACTOR_RADIUS}
            stroke="rgba(0,0,0,0.55)"
            stroke-width={tick % 30 === 0 ? "2" : "1"}
          />
        {/each}
        <line x1="0" y1="0" x2={PROTRACTOR_RADIUS} y2="0" stroke="#0067c0" stroke-width="2" />
        <text x="0" y="-{PROTRACTOR_RADIUS + 8}" text-anchor="middle" font-size="11" fill="rgba(0,0,0,0.7)">{Math.round(angle)}°</text>
      {/if}
    </svg>
  </div>
{/if}
