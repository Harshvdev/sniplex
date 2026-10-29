<script lang="ts">
  let {
    color = '#ffeb3b',
    size = 18,
    onColorChange = (c: string) => {},
    onSizeChange = (s: number) => {},
  }: {
    color: string;
    size: number;
    onColorChange: (c: string) => void;
    onSizeChange: (s: number) => void;
  } = $props();

  const highlighterColors = [
    { color: '#ffeb3b', name: 'Yellow' },
    { color: '#69f0ae', name: 'Green' },
    { color: '#ff80ab', name: 'Pink' },
    { color: '#80d8ff', name: 'Blue' },
    { color: '#ffd180', name: 'Orange' },
    { color: '#ea80fc', name: 'Purple' },
  ];
</script>

<div class="p-3 w-56 bg-white dark:bg-[#2c2c2c] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_10px_25px_rgba(0,0,0,0.2)] text-neutral-800 dark:text-neutral-100 select-none">
  <div class="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 mb-2">Highlighter Color</div>
  <div class="grid grid-cols-6 gap-1.5 mb-4">
    {#each highlighterColors as h}
      <button
        type="button"
        class="w-7 h-7 rounded-full border flex items-center justify-center transition-transform hover:scale-110 {color === h.color ? 'ring-2 ring-[#0067c0] dark:ring-[#60cdff] border-white' : 'border-black/10 dark:border-white/10'}"
        style="background-color: {h.color};"
        onclick={() => onColorChange(h.color)}
        title={h.name}
      >
        {#if color === h.color}
          <div class="w-2 h-2 rounded-full bg-neutral-900/60"></div>
        {/if}
      </button>
    {/each}
  </div>

  <div class="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 mb-1 flex items-center justify-between">
    <span>Thickness</span>
    <span class="font-mono text-neutral-700 dark:text-neutral-200">{size}px</span>
  </div>
  <div class="flex items-center gap-3">
    <input
      type="range"
      min="6"
      max="48"
      value={size}
      oninput={(e) => onSizeChange(Number((e.target as HTMLInputElement).value))}
      class="flex-1 accent-[#0067c0] h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-lg cursor-pointer"
    />
    <div
      class="w-6 h-6 rounded flex items-center justify-center bg-neutral-100 dark:bg-neutral-800 border border-black/10 dark:border-white/10"
    >
      <div
        class="rounded-sm opacity-60"
        style="width: 14px; height: {Math.max(4, size / 4)}px; background-color: {color};"
      ></div>
    </div>
  </div>
</div>

