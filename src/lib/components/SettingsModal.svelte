<script lang="ts">
  import { ArrowLeft, RotateCcw } from '@lucide/svelte';
  import { invoke } from '@tauri-apps/api/core';
  import type { AppTheme } from '../types';
  import {
    loadShortcuts,
    saveShortcuts,
    areKeysEqual,
    parseKeyEvent,
    DEFAULT_SHORTCUTS,
    type ShortcutItem,
  } from '../shortcuts';

  let {
    theme = 'dark',
    onClose = () => {},
    onThemeChange = (t: AppTheme) => {},
    onShortcutsChange = (s: ShortcutItem[]) => {},
  }: {
    theme: AppTheme;
    onClose: () => void;
    onThemeChange: (t: AppTheme) => void;
    onShortcutsChange?: (s: ShortcutItem[]) => void;
  } = $props();

  // Settings reactive state
  let autoCopy = $state(true);
  let autoSave = $state(true);
  let askToSave = $state(true);
  let multipleInstances = $state(false);
  let addOutline = $state(false);
  let outlineColor = $state('#d13438');
  let outlineWidth = $state(2);
  let prtScnShortcut = $state(true);
  let recordMic = $state(false);
  let recordSystemAudio = $state(true);

  // Screenshots save directory state
  let saveFolder = $state<string>(
    (typeof localStorage !== 'undefined' && localStorage.getItem('sniplex_save_folder')) || '~/Pictures/Screenshots'
  );
  let isEditingFolder = $state(false);
  let tempFolder = $state('');

  async function handlePickFolder() {
    try {
      const selected = await invoke<string | null>('select_folder');
      if (selected) {
        saveFolder = selected;
        tempFolder = selected;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('sniplex_save_folder', selected);
        }
      }
    } catch {
      isEditingFolder = true;
    }
  }

  function handleSaveCustomFolder() {
    if (tempFolder.trim()) {
      saveFolder = tempFolder.trim();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('sniplex_save_folder', saveFolder);
      }
    }
    isEditingFolder = false;
  }

  // Customizable shortcuts reactive state
  let shortcuts = $state<ShortcutItem[]>(loadShortcuts());
  let recordingId = $state<string | null>(null);
  let tempModifiers = $state<string[]>([]);
  let shortcutError = $state<string | null>(null);

  let hasCustomShortcuts = $derived(
    shortcuts.some((s) => !areKeysEqual(s.keys, s.defaultKeys))
  );

  function startRecording(id: string) {
    recordingId = id;
    tempModifiers = [];
    shortcutError = null;
  }

  function cancelRecording() {
    recordingId = null;
    tempModifiers = [];
    shortcutError = null;
  }

  function handleRecordKey(e: KeyboardEvent) {
    if (!recordingId) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      cancelRecording();
      return;
    }

    const { modifiers, primaryKey, isValidCombination } = parseKeyEvent(e);

    if (!primaryKey) {
      tempModifiers = modifiers;
      shortcutError = null;
      return;
    }

    if (!isValidCombination) {
      shortcutError = 'Shortcut must include Ctrl, Alt, Shift, or a function key';
      return;
    }

    const newKeys = [...modifiers, primaryKey];

    shortcuts = shortcuts.map((s) => {
      if (s.id === recordingId) {
        return { ...s, keys: newKeys };
      }
      if (areKeysEqual(s.keys, newKeys)) {
        return { ...s, keys: [] };
      }
      return s;
    });

    saveShortcuts(shortcuts);
    onShortcutsChange(shortcuts);
    recordingId = null;
    tempModifiers = [];
    shortcutError = null;
  }

  function resetShortcut(id: string) {
    shortcuts = shortcuts.map((s) => {
      if (s.id === id) {
        return { ...s, keys: [...s.defaultKeys] };
      }
      return s;
    });
    saveShortcuts(shortcuts);
    onShortcutsChange(shortcuts);
  }

  function resetAllShortcuts() {
    shortcuts = DEFAULT_SHORTCUTS.map((s) => ({
      ...s,
      keys: [...s.defaultKeys],
      defaultKeys: [...s.defaultKeys],
    }));
    saveShortcuts(shortcuts);
    onShortcutsChange(shortcuts);
    shortcutError = null;
    recordingId = null;
  }

  const presetColors = [
    { name: 'Red', hex: '#d13438' },
    { name: 'Blue', hex: '#0078d4' },
    { name: 'Green', hex: '#107c41' },
    { name: 'Yellow', hex: '#ffb900' },
    { name: 'Purple', hex: '#881798' },
    { name: 'White', hex: '#ffffff' },
    { name: 'Black', hex: '#000000' },
  ];
</script>

<svelte:window onkeydown={handleRecordKey} />

<div class="flex-1 overflow-y-auto bg-[#f4f4f4] dark:bg-[#121212] text-neutral-800 dark:text-neutral-100 p-6 sm:p-8 select-none transition-colors duration-150">
  <div class="max-w-2xl mx-auto pb-10">
    <!-- Header with Back Button -->
    <div class="flex items-center gap-3 mb-6">
      <button
        type="button"
        class="w-8 h-8 rounded-md flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-300 transition-colors cursor-pointer"
        onclick={onClose}
        title="Back"
      >
        <ArrowLeft class="w-4 h-4 stroke-[2]" />
      </button>
      <h1 class="text-xl font-semibold tracking-tight text-neutral-900 dark:text-white">Settings</h1>
    </div>

    <!-- 1. APPEARANCE -->
    <div class="mb-5">
      <div class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2 px-1">
        Appearance
      </div>

      <div class="bg-white dark:bg-[#1c1c1c] rounded-lg border border-black/10 dark:border-white/10 p-4 shadow-xs">
        <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 mb-0.5">App theme</div>
        <p class="text-xs text-neutral-500 dark:text-neutral-400 mb-3">Select which theme to display</p>

        <!-- 3-Column Theme Selector (Circle Icons) -->
        <div class="grid grid-cols-3 gap-2.5">
          <!-- Light Theme -->
          <button
            type="button"
            class="flex items-center justify-between px-3.5 py-2.5 rounded-md border text-left transition-colors cursor-pointer outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 {theme === 'light' ? 'border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800' : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'}"
            onclick={() => onThemeChange('light')}
          >
            <div class="flex items-center gap-2.5">
              <svg class="w-4 h-4 shrink-0 drop-shadow-2xs" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" fill="#ffffff" stroke="currentColor" stroke-width="1.5" class="stroke-neutral-400 dark:stroke-neutral-500" />
              </svg>
              <span class="text-xs font-medium text-neutral-800 dark:text-neutral-200">Light</span>
            </div>

            {#if theme === 'light'}
              <svg class="w-4 h-4 text-neutral-900 dark:text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
              </svg>
            {/if}
          </button>

          <!-- Dark Theme -->
          <button
            type="button"
            class="flex items-center justify-between px-3.5 py-2.5 rounded-md border text-left transition-colors cursor-pointer outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 {theme === 'dark' ? 'border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800' : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'}"
            onclick={() => onThemeChange('dark')}
          >
            <div class="flex items-center gap-2.5">
              <svg class="w-4 h-4 shrink-0 drop-shadow-2xs" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" fill="#181818" stroke="currentColor" stroke-width="1.5" class="stroke-neutral-400 dark:stroke-neutral-500" />
              </svg>
              <span class="text-xs font-medium text-neutral-800 dark:text-neutral-200">Dark</span>
            </div>

            {#if theme === 'dark'}
              <svg class="w-4 h-4 text-neutral-900 dark:text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
              </svg>
            {/if}
          </button>

          <!-- System Theme -->
          <button
            type="button"
            class="flex items-center justify-between px-3.5 py-2.5 rounded-md border text-left transition-colors cursor-pointer outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 {theme === 'system' ? 'border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800' : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'}"
            onclick={() => onThemeChange('system')}
          >
            <div class="flex items-center gap-2.5">
              <svg class="w-4 h-4 shrink-0 drop-shadow-2xs" viewBox="0 0 16 16" fill="none">
                <path d="M8 1.5 A6.5 6.5 0 0 0 8 14.5 Z" fill="#ffffff" />
                <path d="M8 1.5 A6.5 6.5 0 0 1 8 14.5 Z" fill="#181818" />
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5" class="stroke-neutral-400 dark:stroke-neutral-500" />
                <line x1="8" y1="1.5" x2="8" y2="14.5" stroke="currentColor" stroke-width="0.8" class="stroke-neutral-400 dark:stroke-neutral-500" />
              </svg>
              <span class="text-xs font-medium text-neutral-800 dark:text-neutral-200">System</span>
            </div>

            {#if theme === 'system'}
              <svg class="w-4 h-4 text-neutral-900 dark:text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
              </svg>
            {/if}
          </button>
        </div>
      </div>
    </div>

    <!-- 2. CAPTURE PREFERENCES -->
    <div class="mb-5">
      <div class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2 px-1">
        Capture
      </div>

      <div class="bg-white dark:bg-[#1c1c1c] rounded-lg border border-black/10 dark:border-white/10 shadow-xs divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
        <!-- Automatically copy changes -->
        <div class="flex items-center justify-between p-4 gap-4">
          <div>
            <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Automatically copy changes</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Copy captures and markup edits directly to the clipboard</div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={autoCopy}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {autoCopy ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => autoCopy = !autoCopy}
            title="Toggle automatic copy"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {autoCopy ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
            ></span>
          </button>
        </div>

        <!-- Automatically save screenshots -->
        <div class="p-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Automatically save screenshots</div>
              <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Save original captures to Pictures/Screenshots</div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={autoSave}
              class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {autoSave ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
              onclick={() => autoSave = !autoSave}
              title="Toggle automatic save"
            >
              <span
                class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {autoSave ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
              ></span>
            </button>
          </div>

          {#if autoSave}
            <div class="mt-3 pt-3 border-t border-black/5 dark:border-white/5 text-xs">
              {#if isEditingFolder}
                <div class="flex items-center gap-2">
                  <input
                    type="text"
                    bind:value={tempFolder}
                    class="flex-1 px-2.5 py-1 text-xs rounded bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-neutral-800 dark:text-neutral-100 font-mono focus:outline-none focus:ring-1 focus:ring-[#0067c0]"
                    placeholder="e.g. ~/Pictures/Screenshots"
                  />
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded bg-[#0067c0] text-white font-medium hover:bg-[#005ea6] transition-colors cursor-pointer"
                    onclick={handleSaveCustomFolder}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    class="px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-neutral-600 dark:text-neutral-400 transition-colors cursor-pointer"
                    onclick={() => { isEditingFolder = false; tempFolder = saveFolder; }}
                  >
                    Cancel
                  </button>
                </div>
              {:else}
                <div class="flex items-center justify-between">
                  <span class="text-neutral-500 dark:text-neutral-400 font-mono truncate max-w-[280px]" title={saveFolder}>
                    {saveFolder}
                  </span>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="px-2.5 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-300 font-medium transition-colors border border-black/10 dark:border-white/10 cursor-pointer"
                      onclick={handlePickFolder}
                    >
                      Browse...
                    </button>
                    <button
                      type="button"
                      class="px-2.5 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-300 font-medium transition-colors border border-black/10 dark:border-white/10 cursor-pointer"
                      onclick={() => { isEditingFolder = true; tempFolder = saveFolder; }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Ask to save edited screenshots -->
        <div class="flex items-center justify-between p-4 gap-4">
          <div>
            <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Ask to save edited screenshots</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Prompt to save unsaved markup changes before closing</div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={askToSave}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {askToSave ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => askToSave = !askToSave}
            title="Toggle confirmation prompt"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {askToSave ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
            ></span>
          </button>
        </div>

        <!-- Multiple instances -->
        <div class="flex items-center justify-between p-4 gap-4">
          <div>
            <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Multiple instances</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Open each new capture in its own separate instance</div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={multipleInstances}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {multipleInstances ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => multipleInstances = !multipleInstances}
            title="Toggle multiple instances"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {multipleInstances ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
            ></span>
          </button>
        </div>

        <!-- Snip outline -->
        <div class="p-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Snip outline</div>
              <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Add a border to each screenshot</div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={addOutline}
              class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {addOutline ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
              onclick={() => addOutline = !addOutline}
              title="Toggle snip outline"
            >
              <span
                class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {addOutline ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
              ></span>
            </button>
          </div>

          <!-- Border Customization -->
          {#if addOutline}
            <div class="mt-4 pt-3.5 border-t border-black/5 dark:border-white/5 flex flex-col gap-3">
              <!-- Color Selector -->
              <div class="flex items-center gap-3">
                <span class="text-xs text-neutral-500 dark:text-neutral-400">Color:</span>
                <div class="flex items-center gap-1.5 flex-wrap">
                  {#each presetColors as preset}
                    <button
                      type="button"
                      class="w-5 h-5 rounded-full border transition-transform hover:scale-110 cursor-pointer {outlineColor === preset.hex ? 'ring-2 ring-offset-1 ring-neutral-900 dark:ring-white dark:ring-offset-[#1c1c1c] scale-110' : 'border-black/20 dark:border-white/20'}"
                      style="background-color: {preset.hex};"
                      onclick={() => outlineColor = preset.hex}
                      title={preset.name}
                    >
                    </button>
                  {/each}
                  <div class="relative w-5 h-5 rounded-full overflow-hidden border border-black/20 dark:border-white/20 cursor-pointer ml-1">
                    <input
                      type="color"
                      bind:value={outlineColor}
                      class="absolute -inset-2 w-10 h-10 cursor-pointer opacity-0"
                      title="Custom color"
                    />
                    <div class="w-full h-full" style="background-color: {outlineColor};"></div>
                  </div>
                </div>
              </div>

              <!-- Thickness Slider -->
              <div class="flex items-center gap-4">
                <span class="text-xs text-neutral-500 dark:text-neutral-400">Thickness:</span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  bind:value={outlineWidth}
                  class="flex-1 accent-neutral-900 dark:accent-white cursor-pointer"
                />
                <span class="text-xs font-mono font-medium w-8 text-right text-neutral-700 dark:text-neutral-300">{outlineWidth}px</span>

                <div class="w-10 h-6 bg-neutral-100 dark:bg-neutral-800 rounded-xs flex items-center justify-center" style="border: {outlineWidth}px solid {outlineColor};">
                  <span class="text-[9px] text-neutral-400">Snip</span>
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- 3. SHORTCUTS -->
    <div class="mb-5">
      <div class="flex items-center justify-between mb-2 px-1">
        <div class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          Shortcuts
        </div>
        {#if hasCustomShortcuts}
          <button
            type="button"
            class="text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors cursor-pointer"
            onclick={resetAllShortcuts}
          >
            Reset all to defaults
          </button>
        {/if}
      </div>

      <div class="bg-white dark:bg-[#1c1c1c] rounded-lg border border-black/10 dark:border-white/10 shadow-xs divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
        <!-- Print screen key shortcut toggle -->
        <div class="flex items-center justify-between p-4 gap-4">
          <div>
            <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Print screen key shortcut</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Use the Print screen key to open the screen capture overlay</div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={prtScnShortcut}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {prtScnShortcut ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => prtScnShortcut = !prtScnShortcut}
            title="Toggle Print Screen shortcut"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {prtScnShortcut ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
            ></span>
          </button>
        </div>

        <!-- Customizable shortcuts list -->
        {#each shortcuts as sc (sc.id)}
          <div class="p-4">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1 min-w-0 pr-2">
                <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">{sc.label}</div>
                <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">{sc.description}</div>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                {#if recordingId === sc.id}
                  <!-- Active Recording State -->
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="h-8 px-3 rounded-md text-xs font-mono font-medium border border-neutral-400 dark:border-neutral-500 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 flex items-center gap-2 ring-2 ring-neutral-400/40 dark:ring-neutral-500/40 animate-pulse cursor-default"
                      title="Press keys on your keyboard"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-neutral-900 dark:bg-white"></span>
                      <span>
                        {#if tempModifiers.length > 0}
                          {tempModifiers.join(' + ')} + ...
                        {:else}
                          Press shortcut keys...
                        {/if}
                      </span>
                    </button>

                    <button
                      type="button"
                      class="h-8 px-2.5 rounded-md text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                      onclick={cancelRecording}
                    >
                      Cancel
                    </button>
                  </div>
                {:else}
                  <!-- Shortcut Key Badges / Edit Trigger Button -->
                  <button
                    type="button"
                    class="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-black/10 dark:border-white/10 bg-neutral-50 dark:bg-[#252525] hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] hover:border-black/20 dark:hover:border-white/20 transition-all text-xs cursor-pointer shadow-2xs"
                    onclick={() => startRecording(sc.id)}
                    title="Click to customize shortcut"
                  >
                    {#if sc.keys.length > 0}
                      {#each sc.keys as k, idx}
                        {#if idx > 0}
                          <span class="text-[11px] text-neutral-400 dark:text-neutral-500 font-medium">+</span>
                        {/if}
                        <kbd class="px-2 py-0.5 text-[11px] font-mono font-medium rounded bg-white dark:bg-[#1a1a1a] border border-black/15 dark:border-white/15 text-neutral-800 dark:text-neutral-200 shadow-2xs">
                          {k}
                        </kbd>
                      {/each}
                    {:else}
                      <span class="text-xs text-neutral-400 italic">None</span>
                    {/if}

                    <span class="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity">
                      Edit
                    </span>
                  </button>

                  {#if !areKeysEqual(sc.keys, sc.defaultKeys)}
                    <button
                      type="button"
                      class="p-1.5 rounded-md text-neutral-400 hover:text-neutral-800 dark:text-neutral-500 dark:hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                      onclick={() => resetShortcut(sc.id)}
                      title="Reset to default ({sc.defaultKeys.join(' + ')})"
                    >
                      <RotateCcw class="w-3.5 h-3.5 stroke-[2]" />
                    </button>
                  {/if}
                {/if}
              </div>
            </div>

            {#if recordingId === sc.id}
              <div class="mt-2 text-[11px] flex items-center justify-between {shortcutError ? 'text-neutral-900 dark:text-white font-medium' : 'text-neutral-500 dark:text-neutral-400'}">
                <span>{shortcutError || 'Press key combination on your keyboard (Esc to cancel)'}</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- 4. SCREEN RECORDING -->
    <div class="mb-5">
      <div class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2 px-1">
        Screen recording
      </div>

      <div class="bg-white dark:bg-[#1c1c1c] rounded-lg border border-black/10 dark:border-white/10 shadow-xs divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
        <!-- Include microphone audio by default -->
        <div class="flex items-center justify-between p-4 gap-4">
          <div>
            <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Include microphone input by default</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Record microphone audio automatically when a screen recording starts</div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={recordMic}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {recordMic ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => recordMic = !recordMic}
            title="Toggle microphone recording"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {recordMic ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
            ></span>
          </button>
        </div>

        <!-- Include system audio by default -->
        <div class="flex items-center justify-between p-4 gap-4">
          <div>
            <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Include system audio by default</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Record system sounds automatically when a screen recording starts</div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={recordSystemAudio}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {recordSystemAudio ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => recordSystemAudio = !recordSystemAudio}
            title="Toggle system audio recording"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {recordSystemAudio ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
            ></span>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
