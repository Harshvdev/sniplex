<script lang="ts">
  import { ArrowLeft, Moon, Sun, Monitor, Check } from '@lucide/svelte';
  import SniplexLogo from './SniplexLogo.svelte';
  import type { AppTheme } from '../types';

  let {
    theme = 'light',
    onClose = () => {},
    onThemeChange = (t: AppTheme) => {},
  }: {
    theme: AppTheme;
    onClose: () => void;
    onThemeChange: (t: AppTheme) => void;
  } = $props();

  let autoSave = $state(true);
  let autoCopy = $state(true);
  let askToSave = $state(true);
  let addOutline = $state(false);
  let outlineColor = $state('#d13438');
  let outlineWidth = $state(2);
</script>

<div class="flex-1 overflow-auto bg-[#f3f3f3] dark:bg-[#202020] text-neutral-800 dark:text-neutral-100 p-8 select-none">
  <div class="max-w-2xl mx-auto">
    <!-- Header with Back Button -->
    <div class="flex items-center gap-3 mb-6">
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        onclick={onClose}
        title="Back"
      >
        <ArrowLeft class="w-4 h-4 stroke-[2]" />
      </button>
      <h1 class="text-xl font-semibold">Settings</h1>
    </div>

    <!-- Section 1: Appearance -->
    <div class="bg-white dark:bg-[#2c2c2c] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-sm p-4 mb-4">
      <div class="text-[13px] font-semibold mb-3">App theme</div>
      <div class="grid grid-cols-3 gap-3">
        <button
          type="button"
          class="flex items-center gap-2 p-3 rounded-[6px] border transition-all {theme === 'light' ? 'border-[#0067c0] bg-blue-50/40 dark:bg-blue-950/20' : 'border-black/10 dark:border-white/10 hover:bg-black/[0.02]'}"
          onclick={() => onThemeChange('light')}
        >
          <Sun class="w-4 h-4 text-amber-500" />
          <span class="text-xs">Light</span>
          {#if theme === 'light'}
            <Check class="w-3.5 h-3.5 text-[#0067c0] ml-auto" />
          {/if}
        </button>

        <button
          type="button"
          class="flex items-center gap-2 p-3 rounded-[6px] border transition-all {theme === 'dark' ? 'border-[#0067c0] bg-blue-50/40 dark:bg-blue-950/20' : 'border-black/10 dark:border-white/10 hover:bg-black/[0.02]'}"
          onclick={() => onThemeChange('dark')}
        >
          <Moon class="w-4 h-4 text-indigo-400" />
          <span class="text-xs">Dark</span>
          {#if theme === 'dark'}
            <Check class="w-3.5 h-3.5 text-[#0067c0] ml-auto" />
          {/if}
        </button>

        <button
          type="button"
          class="flex items-center gap-2 p-3 rounded-[6px] border transition-all {theme === 'system' ? 'border-[#0067c0] bg-blue-50/40 dark:bg-blue-950/20' : 'border-black/10 dark:border-white/10 hover:bg-black/[0.02]'}"
          onclick={() => onThemeChange('system')}
        >
          <Monitor class="w-4 h-4 text-neutral-500" />
          <span class="text-xs">System</span>
          {#if theme === 'system'}
            <Check class="w-3.5 h-3.5 text-[#0067c0] ml-auto" />
          {/if}
        </button>
      </div>
    </div>

    <!-- Section 2: Capture Preferences -->
    <div class="bg-white dark:bg-[#2c2c2c] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-sm divide-y divide-black/[0.06] dark:divide-white/[0.06] mb-4">
      <!-- Auto Save -->
      <div class="flex items-center justify-between p-4">
        <div>
          <div class="text-[13px] font-medium">Automatically save screenshots</div>
          <div class="text-[12px] text-neutral-500 dark:text-neutral-400">Save original captures to Pictures/Screenshots</div>
        </div>
        <input
          type="checkbox"
          checked={autoSave}
          onchange={() => autoSave = !autoSave}
          class="w-9 h-5 rounded-full accent-[#0067c0] cursor-pointer"
        />
      </div>

      <!-- Auto Copy -->
      <div class="flex items-center justify-between p-4">
        <div>
          <div class="text-[13px] font-medium">Automatically copy to clipboard</div>
          <div class="text-[12px] text-neutral-500 dark:text-neutral-400">Copy every new capture directly to the clipboard</div>
        </div>
        <input
          type="checkbox"
          checked={autoCopy}
          onchange={() => autoCopy = !autoCopy}
          class="w-9 h-5 rounded-full accent-[#0067c0] cursor-pointer"
        />
      </div>

      <!-- Ask to save -->
      <div class="flex items-center justify-between p-4">
        <div>
          <div class="text-[13px] font-medium">Ask to save before closing</div>
          <div class="text-[12px] text-neutral-500 dark:text-neutral-400">Prompt to save unsaved markup changes</div>
        </div>
        <input
          type="checkbox"
          checked={askToSave}
          onchange={() => askToSave = !askToSave}
          class="w-9 h-5 rounded-full accent-[#0067c0] cursor-pointer"
        />
      </div>

      <!-- Capture Outline -->
      <div class="p-4">
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="text-[13px] font-medium">Capture outline</div>
            <div class="text-[12px] text-neutral-500 dark:text-neutral-400">Add an outline border to every new capture</div>
          </div>
          <input
            type="checkbox"
            checked={addOutline}
            onchange={() => addOutline = !addOutline}
            class="w-9 h-5 rounded-full accent-[#0067c0] cursor-pointer"
          />
        </div>

        {#if addOutline}
          <div class="flex items-center gap-4 mt-3 pt-3 border-t border-black/[0.05] dark:border-white/[0.05]">
            <div class="flex items-center gap-2">
              <span class="text-xs text-neutral-500">Color:</span>
              <input type="color" bind:value={outlineColor} class="w-6 h-6 rounded cursor-pointer border-0 bg-transparent" />
            </div>
            <div class="flex items-center gap-2 flex-1">
              <span class="text-xs text-neutral-500">Thickness:</span>
              <input type="range" min="1" max="10" bind:value={outlineWidth} class="flex-1 accent-[#0067c0]" />
              <span class="text-xs font-mono">{outlineWidth}px</span>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Section 3: About -->
    <div class="bg-white dark:bg-[#2c2c2c] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-sm p-4">
      <div class="flex items-center gap-3 mb-2">
        <SniplexLogo size={36} showText={false} />
        <div>
          <div class="text-[15px] font-semibold tracking-[-0.01em]">Sniplex</div>
          <div class="text-[12px] text-neutral-500">Version 1.0.0 (Screen Capture & Markup Tool)</div>
        </div>
      </div>
      <p class="text-[12px] text-neutral-500 dark:text-neutral-400 mt-2">
        A lightweight, modern open-source screen capture and markup utility built with Svelte 5 and Fluent Design principles.
      </p>
    </div>
  </div>
</div>

