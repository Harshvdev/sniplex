<script lang="ts">
  let {
    color = '#000000',
    size = 4,
    opacity = 100,
    onColorChange = (c: string) => {},
    onSizeChange = (s: number) => {},
    onOpacityChange = (o: number) => {},
  }: {
    color: string;
    size: number;
    opacity: number;
    onColorChange: (c: string) => void;
    onSizeChange: (s: number) => void;
    onOpacityChange: (o: number) => void;
  } = $props();

  const colors = [
    '#000000', '#ffffff', '#767676', '#a6a6a6', '#d2d2d2',
    '#7f0000', '#d13438', '#ff4343', '#ea4c89', '#b4009e',
    '#4f2d7f', '#5c2d91', '#881798', '#002050', '#0078d4',
    '#00bcf2', '#00b7c3', '#038387', '#004e8c', '#107c41',
    '#bad80a', '#10893e', '#ffaa44', '#ff8c00', '#d83b01',
    '#fff100', '#ffb900', '#986f09', '#69797e', '#498205'
  ];
</script>

<div class="p-3 w-64 bg-white dark:bg-[#181d28] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_12px_32px_rgba(0,0,0,0.45)] text-neutral-800 dark:text-neutral-100 select-none">
  <div class="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 mb-2">Color</div>
  <div class="grid grid-cols-5 gap-1.5 mb-4">
    {#each colors as c}
      <button
        type="button"
        class="w-8 h-8 rounded-full border flex items-center justify-center transition-transform hover:scale-110 {color === c ? 'ring-2 ring-[#0067c0] dark:ring-[#60cdff] border-white' : 'border-black/10 dark:border-white/10'}"
        style="background-color: {c};"
        onclick={() => onColorChange(c)}
        title={c}
      >
        {#if color === c}
          <div class="w-2 h-2 rounded-full {c === '#ffffff' ? 'bg-black' : 'bg-white'}"></div>
        {/if}
      </button>
    {/each}
  </div>

  <div class="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 mb-1 flex items-center justify-between">
    <span>Size</span>
    <span class="font-mono text-neutral-700 dark:text-neutral-200">{size}px</span>
  </div>
  <div class="flex items-center gap-3">
    <input
      type="range"
      min="1"
      max="36"
      value={size}
      oninput={(e) => onSizeChange(Number((e.target as HTMLInputElement).value))}
      class="flex-1 accent-[#0067c0] h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-lg cursor-pointer"
    />
    <div
      class="w-6 h-6 rounded-full border border-black/10 dark:border-white/10 flex items-center justify-center"
    >
      <div
        class="rounded-full"
        style="width: {Math.max(2, size / 2)}px; height: {Math.max(2, size / 2)}px; background-color: {color}; opacity: {opacity / 100};"
      ></div>
    </div>
  </div>

  <div class="mt-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.08]">
    <div class="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 mb-1 flex items-center justify-between">
      <span>Opacity</span>
      <span class="font-mono text-neutral-700 dark:text-neutral-200">{opacity}%</span>
    </div>
    <div class="flex items-center gap-3">
      <input
        type="range"
        min="10"
        max="100"
        step="1"
        value={opacity}
        oninput={(e) => onOpacityChange(Number((e.target as HTMLInputElement).value))}
        class="flex-1 accent-[#0067c0] h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-lg cursor-pointer"
        aria-label="Pen opacity"
      />
      <div class="w-6 h-6 rounded-full border border-black/10 dark:border-white/10 flex items-center justify-center bg-[linear-gradient(45deg,#d4d4d4_25%,transparent_25%,transparent_75%,#d4d4d4_75%),linear-gradient(45deg,#d4d4d4_25%,transparent_25%,transparent_75%,#d4d4d4_75%)] bg-[length:6px_6px] bg-[position:0_0,3px_3px]">
        <div
          class="w-4 h-4 rounded-full"
          style="background-color: {color}; opacity: {opacity / 100};"
        ></div>
      </div>
    </div>
  </div>
</div>

