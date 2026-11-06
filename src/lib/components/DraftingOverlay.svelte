<script lang="ts">
  import { RULER_HALF_LENGTH, clampRulerAngle, type DraftingTool } from '../drafting';
  import { rotateAroundHinge } from '../drafting';

  let {
    tool = 'ruler',
    x = 200,
    y = 200,
    angle = 0,
    scale = 1,
    onDrag = (_x: number, _y: number) => {},
    onRotate = (_angle: number, _hx: number, _hy: number) => {},
  }: {
    tool: DraftingTool;
    x: number;
    y: number;
    angle: number;
    scale: number;
    onDrag: (x: number, y: number) => void;
    onRotate: (angle: number, hx: number, hy: number) => void;
  } = $props();

  const half = RULER_HALF_LENGTH;
  const rulerTicks = Array.from({ length: 17 }, (_, i) => -half + i * 20);

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
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const svg = (e.currentTarget as HTMLElement).querySelector('svg');
    const ctm = svg?.getScreenCTM();
    const point = svg?.createSVGPoint();
    if (point && ctm) {
      point.x = e.clientX;
      point.y = e.clientY;
      const location = point.matrixTransform(ctm.inverse());
      if (location) {
        const step = 1;
        const rotated = rotateAroundHinge({ x, y }, angle, { x: x + location.x, y: y + location.y }, e.deltaY < 0 ? step : -step);
        onRotate(rotated.angle, rotated.origin.x, rotated.origin.y);
        return;
      }
    }
    onRotate(clampRulerAngle(angle + (e.deltaY < 0 ? 1 : -1)), x, y);
  }
</script>

{#if tool === 'ruler'}
  <div
    class="absolute z-10 cursor-move"
    style="left: {x * scale}px; top: {y * scale}px; width: {half * 2 * scale}px; height: {half * 2 * scale}px; transform: translate(-50%, -50%);"
    role="slider"
    aria-label="Ruler"
    aria-valuemin={0}
    aria-valuemax={90}
    aria-valuenow={Math.round(angle)}
    aria-valuetext={`${Math.round(angle)} degrees`}
    tabindex="0"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onwheel={handleWheel}
  >
    <svg viewBox="{-half} {-half} {half * 2} {half * 2}" class="h-full w-full" style="transform: rotate({-angle}deg);">
      <rect x="{-half}" y="-16" width="{half * 2}" height="32" rx="4" fill="rgba(255,255,255,0.85)" stroke="rgba(0,0,0,0.35)" stroke-width="1" />
      {#each rulerTicks as tick}
        <line x1={tick} y1="-16" x2={tick} y2={tick % 80 === 0 ? "6" : tick % 40 === 0 ? "0" : "-6"} stroke="rgba(0,0,0,0.5)" stroke-width={tick % 80 === 0 ? "1.4" : "0.8"} />
      {/each}
      <text x="0" y="28" text-anchor="middle" font-size="11" fill="rgba(0,0,0,0.6)">{Math.round(angle)}°</text>
    </svg>
  </div>
{/if}
