<script lang="ts">
  import { Plus, X, Minus, Square } from '@lucide/svelte';
  import SniplexLogo from './SniplexLogo.svelte';
  import type { TabItem, AppTheme } from '../types';

  let {
    tabs = [],
    activeTabId = '',
    theme = 'light',
    onSelectTab = (id: string) => {},
    onCloseTab = (id: string) => {},
    onNewTab = () => {},
  }: {
    tabs: TabItem[];
    activeTabId: string;
    theme: AppTheme;
    onSelectTab: (id: string) => void;
    onCloseTab: (id: string) => void;
    onNewTab: () => void;
  } = $props();
</script>

<div class="h-10 border-b border-black/[0.06] dark:border-white/[0.07] bg-[#f9fafb] dark:bg-[#131720] flex items-center justify-between px-2 select-none transition-colors duration-150">
  <!-- Left: App Icon & Tab Strip -->
  <div class="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-[75%]">
    <div class="flex items-center px-1.5 py-1 mr-1">
      <SniplexLogo size={18} showText={true} />
    </div>

    <!-- Tabs Strip -->
    {#each tabs as tab}
      <div
        role="button"
        tabindex="0"
        class="group relative flex items-center gap-2 px-3 py-1.5 text-[12px] rounded-t-[6px] border-b-2 transition-all cursor-pointer {activeTabId === tab.id ? 'bg-white dark:bg-[#1c2230] text-neutral-800 dark:text-neutral-100 border-[#0067c0] dark:border-[#0078d4] shadow-sm font-medium' : 'text-neutral-600 dark:text-neutral-400 border-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'}"
        onclick={() => onSelectTab(tab.id)}
        onkeydown={(e) => { if (e.key === 'Enter') onSelectTab(tab.id); }}
      >
        <span class="truncate max-w-[140px]">{tab.title}</span>
        <button
          type="button"
          class="w-4 h-4 rounded-full flex items-center justify-center opacity-70 group-hover:opacity-100 hover:bg-black/[0.1] dark:hover:bg-white/[0.1] text-neutral-500 hover:text-neutral-800 dark:hover:text-white transition-colors"
          onclick={(e) => {
            e.stopPropagation();
            onCloseTab(tab.id);
          }}
          title="Close tab"
        >
          <X class="w-3 h-3 stroke-[2]" />
        </button>
      </div>
    {/each}

    <!-- New Tab (+) Button -->
    <button
      type="button"
      class="w-7 h-7 rounded-[5px] flex items-center justify-center text-neutral-600 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
      onclick={onNewTab}
      title="New tab (Ctrl+T)"
    >
      <Plus class="w-3.5 h-3.5 stroke-[2]" />
    </button>
  </div>

  <!-- Right: Window Controls (Minimize, Maximize, Close) -->
  <div class="flex items-center">
    <!-- Minimize -->
    <button
      type="button"
      class="w-10 h-8 flex items-center justify-center text-neutral-600 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
      title="Minimize"
    >
      <Minus class="w-3.5 h-3.5 stroke-[1.8]" />
    </button>

    <!-- Maximize / Restore -->
    <button
      type="button"
      class="w-10 h-8 flex items-center justify-center text-neutral-600 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
      title="Maximize"
    >
      <Square class="w-3 h-3 stroke-[1.8]" />
    </button>

    <!-- Close Window -->
    <button
      type="button"
      class="w-10 h-8 flex items-center justify-center text-neutral-600 dark:text-neutral-400 hover:bg-[#c42b1c] hover:text-white transition-colors"
      title="Close"
    >
      <X class="w-3.5 h-3.5 stroke-[1.8]" />
    </button>
  </div>
</div>
