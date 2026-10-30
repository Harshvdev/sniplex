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

  async function handleMinimize() {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
    } catch (e) {
      console.warn('Minimize only available in desktop environment', e);
    }
  }

  async function handleToggleMaximize() {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().toggleMaximize();
    } catch (e) {
      console.warn('Maximize only available in desktop environment', e);
    }
  }

  async function handleClose() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('exit_app');
    } catch {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      } catch (e) {
        window.close();
      }
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-tauri-drag-region
  ondblclick={handleToggleMaximize}
  class="h-10 border-b border-black/[0.06] dark:border-white/[0.07] bg-[#f9fafb] dark:bg-[#131720] flex items-center justify-between pl-2 pr-0 select-none transition-colors duration-150 cursor-default"
>
  <!-- Left: App Icon & Tab Strip -->
  <div class="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-[70%]" data-tauri-drag-region>
    <div class="flex items-center px-1.5 py-1 mr-1 select-none pointer-events-none">
      <SniplexLogo size={18} showText={true} />
    </div>

    <!-- Tabs Strip (if any tabs are open) -->
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
  </div>

  <!-- Draggable spacer area -->
  <div class="flex-1 h-full" data-tauri-drag-region></div>

  <!-- Right: Window Controls (Minimize, Maximize, Close - flush to top & right edges) -->
  <div class="flex items-stretch h-full">
    <!-- Minimize -->
    <button
      type="button"
      class="w-[46px] h-full flex items-center justify-center text-neutral-600 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] active:bg-black/[0.1] dark:active:bg-white/[0.1] transition-colors cursor-pointer"
      onclick={handleMinimize}
      title="Minimize"
    >
      <svg class="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2">
        <path d="M0 5h10" />
      </svg>
    </button>

    <!-- Maximize / Restore -->
    <button
      type="button"
      class="w-[46px] h-full flex items-center justify-center text-neutral-600 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] active:bg-black/[0.1] dark:active:bg-white/[0.1] transition-colors cursor-pointer"
      onclick={handleToggleMaximize}
      title="Maximize"
    >
      <svg class="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2">
        <rect x="0.6" y="0.6" width="8.8" height="8.8" />
      </svg>
    </button>

    <!-- Close Window -->
    <button
      type="button"
      class="w-[46px] h-full flex items-center justify-center text-neutral-600 dark:text-neutral-400 hover:bg-[#c42b1c] hover:text-white active:bg-[#a82315] transition-colors cursor-pointer"
      onclick={handleClose}
      title="Close"
    >
      <svg class="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2">
        <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
      </svg>
    </button>
  </div>
</div>
