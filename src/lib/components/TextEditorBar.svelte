<script lang="ts">
  import { TEXT_MAX_SIZE, TEXT_MIN_SIZE, type TextAlign } from '../text-label';

  let {
    fontSize = 24,
    color = '#000000',
    align = 'left',
    onFontSizeChange = (_s: number) => {},
    onColorChange = (_c: string) => {},
    onAlignChange = (_a: TextAlign) => {},
  }: {
    fontSize: number;
    color: string;
    align: TextAlign;
    onFontSizeChange: (s: number) => void;
    onColorChange: (c: string) => void;
    onAlignChange: (a: TextAlign) => void;
  } = $props();

  const alignments: { id: TextAlign; label: string }[] = [
    { id: 'left', label: 'Left' },
    { id: 'center', label: 'Center' },
    { id: 'right', label: 'Right' },
  ];

  const palette = ['#000000', '#ffffff', '#d13438', '#0078d4', '#107c10', '#8a6d00'];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-black/10 bg-white/95 px-3 py-1.5 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-[#181d28]/95"
  data-testid="text-editor-bar"
  onpointerdown={(e) => e.preventDefault()}
>
  <label class="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
    <span>Size</span>
    <input
      type="range"
      min={TEXT_MIN_SIZE}
      max={TEXT_MAX_SIZE}
      value={fontSize}
      aria-label="Text size"
      class="w-20 accent-[#0067c0]"
      oninput={(e) => onFontSizeChange(Number((e.target as HTMLInputElement).value))}
    />
    <span class="w-8 font-mono text-neutral-700 dark:text-neutral-200">{fontSize}px</span>
  </label>

  <div class="h-4 w-px bg-black/10 dark:bg-white/10"></div>

  <div class="flex items-center gap-1" role="group" aria-label="Text color">
    {#each palette as swatch}
      <button
        type="button"
        aria-label={`Text color ${swatch}`}
        class="h-4 w-4 rounded-full border transition-transform hover:scale-110 {color === swatch
          ? 'ring-2 ring-[#0067c0] ring-offset-1 dark:ring-offset-[#181d28]'
          : 'border-black/15 dark:border-white/15'}"
        style="background-color: {swatch};"
        onclick={() => onColorChange(swatch)}
      ></button>
    {/each}
    <input
      type="color"
      value={color}
      aria-label="Custom text color"
      class="ml-1 h-5 w-5 cursor-pointer rounded border border-black/15 bg-transparent dark:border-white/15"
      oninput={(e) => onColorChange((e.target as HTMLInputElement).value)}
    />
  </div>

  <div class="h-4 w-px bg-black/10 dark:bg-white/10"></div>

  <div class="flex items-center gap-1" role="group" aria-label="Text alignment">
    {#each alignments as option}
      <button
        type="button"
        aria-pressed={align === option.id}
        class="rounded px-2 py-0.5 text-[11px] transition-colors {align === option.id
          ? 'bg-[#0067c0] font-medium text-white'
          : 'text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10'}"
        onclick={() => onAlignChange(option.id)}
      >
        {option.label}
      </button>
    {/each}
  </div>
</div>
