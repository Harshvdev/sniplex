<script lang="ts">
  import { Plus, ChevronDown } from '@lucide/svelte';
  import SnipIcons from '../icons/SnipIcons.svelte';
  import SniplexLogo from './SniplexLogo.svelte';
  import type { SnipType, SnipDelay } from '../types';

  let {
    snipType = 'rectangle',
    delay = 0,
    onTriggerNew = () => {},
    onSnipTypeChange = (t: SnipType) => {},
    onDelayChange = (d: SnipDelay) => {},
  }: {
    snipType: SnipType;
    delay: SnipDelay;
    onTriggerNew: () => void;
    onSnipTypeChange: (t: SnipType) => void;
    onDelayChange: (d: SnipDelay) => void;
  } = $props();

  let isDelayOpen = $state(false);
  let isTypeOpen = $state(false);

  const delays: { id: SnipDelay; label: string }[] = [
    { id: 0, label: 'No delay' },
    { id: 3, label: 'Snip in 3 seconds' },
    { id: 5, label: 'Snip in 5 seconds' },
    { id: 10, label: 'Snip in 10 seconds' },
  ];

  const types: { id: SnipType; label: string }[] = [
    { id: 'rectangle', label: 'Rectangle' },
    { id: 'window', label: 'Window' },
    { id: 'fullscreen', label: 'Full screen' },
    { id: 'freeform', label: 'Freeform' },
  ];
</script>

<div class="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#f3f4f6] dark:bg-[#0d0f14] text-neutral-800 dark:text-neutral-100 select-none transition-colors duration-150">
  <!-- Brand Logo Lockup -->
  <div class="mb-6 flex flex-col items-center">
    <div class="w-32 h-32 rounded-3xl bg-white/80 dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_8px_30px_rgba(0,0,0,0.06)] flex items-center justify-center backdrop-blur-md mb-3 transition-transform hover:scale-105 duration-200">
      <SniplexLogo size={72} showText={false} />
    </div>
    <span class="text-2xl font-semibold tracking-[-0.02em] text-neutral-800 dark:text-neutral-100">
      Sniplex
    </span>
  </div>

  <!-- Primary Prompt Text -->
  <h2 class="text-base font-medium mb-1 text-neutral-700 dark:text-neutral-300">
    Press the Print Screen key to start a snip
  </h2>
  <p class="text-neutral-500 dark:text-neutral-400 text-[13px] mb-8">
    Or click New to capture what's on your screen.
  </p>

  <!-- Big Central "+ New" Pill Control -->
  <div class="flex items-center gap-2">
    <!-- Elevated + New Button -->
    <button
      type="button"
      class="h-9 flex items-center justify-center gap-2 px-4 bg-[#0067c0] hover:bg-[#1070c7] text-white text-[13px] font-medium rounded-[6px] shadow-[0_4px_12px_rgba(0,103,192,0.25)] transition-all transform active:scale-95"
      onclick={onTriggerNew}
    >
      <Plus class="w-4 h-4 stroke-[2.2]" />
      <span>New snip</span>
    </button>

    <!-- Snip Mode Dropdown -->
    <div class="relative">
      <button
        type="button"
        class="h-9 flex items-center justify-center gap-2 px-3 bg-white dark:bg-[#181d28] hover:bg-neutral-50 dark:hover:bg-[#222938] border border-black/10 dark:border-white/10 rounded-[6px] text-[13px] text-neutral-700 dark:text-neutral-200 transition-colors shadow-sm"
        onclick={() => isTypeOpen = !isTypeOpen}
      >
        <SnipIcons type={snipType} className="w-4 h-4 text-neutral-600 dark:text-neutral-300" />
        <span class="capitalize">{snipType === 'fullscreen' ? 'Full screen' : snipType}</span>
        <ChevronDown class="w-3.5 h-3.5 text-neutral-400" />
      </button>

      {#if isTypeOpen}
        <div class="absolute top-full mt-1.5 left-0 z-50 min-w-[150px] bg-white dark:bg-[#181d28] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_10px_25px_rgba(0,0,0,0.4)] py-1 flex flex-col text-left">
          {#each types as t}
            <button
              type="button"
              class="flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors"
              onclick={() => { onSnipTypeChange(t.id); isTypeOpen = false; }}
            >
              <SnipIcons type={t.id} className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Delay Dropdown -->
    <div class="relative">
      <button
        type="button"
        class="h-9 flex items-center justify-center gap-2 px-3 bg-white dark:bg-[#181d28] hover:bg-neutral-50 dark:hover:bg-[#222938] border border-black/10 dark:border-white/10 rounded-[6px] text-[13px] text-neutral-700 dark:text-neutral-200 transition-colors shadow-sm"
        onclick={() => isDelayOpen = !isDelayOpen}
      >
        <span>{delays.find(d => d.id === delay)?.label}</span>
        <ChevronDown class="w-3.5 h-3.5 text-neutral-400" />
      </button>

      {#if isDelayOpen}
        <div class="absolute top-full mt-1.5 left-0 z-50 min-w-[160px] bg-white dark:bg-[#181d28] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_10px_25px_rgba(0,0,0,0.4)] py-1 flex flex-col text-left">
          {#each delays as d}
            <button
              type="button"
              class="px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors"
              onclick={() => { onDelayChange(d.id); isDelayOpen = false; }}
            >
              <span>{d.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

