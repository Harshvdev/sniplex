<script lang="ts">
  import { Square, Circle, Minus, ArrowUpRight, Star } from '@lucide/svelte';
  import type { ShapeKind } from '../types';

  let {
    shape = 'rectangle',
    strokeColor = '#d13438',
    fillColor = 'transparent',
    strokeWidth = 3,
    onSelectShape = () => {},
    onStrokeColorChange = () => {},
    onFillColorChange = () => {},
    onStrokeWidthChange = () => {},
  }: {
    shape: ShapeKind;
    strokeColor?: string;
    fillColor?: string;
    strokeWidth?: number;
    onSelectShape?: (s: ShapeKind) => void;
    onStrokeColorChange?: (c: string) => void;
    onFillColorChange?: (c: string) => void;
    onStrokeWidthChange?: (w: number) => void;
  } = $props();

  const shapeList: { kind: ShapeKind; label: string; icon: any }[] = [
    { kind: 'rectangle', label: 'Rectangle', icon: Square },
    { kind: 'oval', label: 'Oval', icon: Circle },
    { kind: 'line', label: 'Line', icon: Minus },
    { kind: 'arrow', label: 'Arrow', icon: ArrowUpRight },
    { kind: 'star', label: 'Star', icon: Star },
  ];

  const quickColors = ['#000000', '#ffffff', '#d13438', '#0078d4', '#107c41', '#ffb900', '#ea4c89'];
</script>

<div class="p-3 w-64 bg-white dark:bg-[#181d28] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_12px_32px_rgba(0,0,0,0.45)] text-neutral-800 dark:text-neutral-100 select-none">
  <div class="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 mb-2">Shape</div>
  <div class="flex items-center gap-1.5 mb-3">
    {#each shapeList as s}
      {@const Icon = s.icon}
      <button
        type="button"
        class="flex-1 py-1.5 rounded-[5px] flex items-center justify-center transition-colors {shape === s.kind ? 'bg-[#0067c0] text-white shadow-sm' : 'bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200'}"
        onclick={() => onSelectShape(s.kind)}
        title={s.label}
      >
        <Icon class="w-4 h-4 stroke-[2]" />
      </button>
    {/each}
  </div>

  <div class="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">Outline Color</div>
  <div class="flex items-center gap-1.5 mb-3">
    {#each quickColors as c}
      <button
        type="button"
        aria-label={c}
        class="w-6 h-6 rounded-full border border-black/15 dark:border-white/15 flex items-center justify-center {strokeColor === c ? 'ring-2 ring-[#0067c0]' : ''}"
        style="background-color: {c};"
        onclick={() => onStrokeColorChange(c)}
      ></button>
    {/each}
  </div>

  <div class="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 mb-1 flex items-center justify-between">
    <span>Outline Thickness</span>
    <span class="font-mono text-neutral-700 dark:text-neutral-200">{strokeWidth}px</span>
  </div>
  <input
    type="range"
    min="1"
    max="20"
    value={strokeWidth}
    oninput={(e) => onStrokeWidthChange(Number((e.target as HTMLInputElement).value))}
    class="w-full accent-[#0067c0] h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-lg cursor-pointer"
  />
</div>
