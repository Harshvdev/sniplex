<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowLeft, RotateCcw } from '@lucide/svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { settings, updateSettings, persistSettings } from '../settings.svelte';
  import { isTauriEnvironment } from '../capture';
  import {
    loadShortcuts,
    saveShortcuts,
    areKeysEqual,
    parseKeyEvent,
    DEFAULT_SHORTCUTS,
    type ShortcutItem,
  } from '../shortcuts';

  let {
    onClose = () => {},
    onShortcutsChange = (
      _s: ShortcutItem[],
      _changedId: string
    ): Promise<string | null> | void => {},
  }: {
    onClose: () => void;
    onShortcutsChange?: (
      shortcuts: ShortcutItem[],
      changedId: string
    ) => Promise<string | null> | void;
  } = $props();

  // Folder editors are transient UI state; the folder itself is persisted.
  let editingScreenshotFolder = $state(false);
  let screenshotDraft = $state('');
  let editingRecordingFolder = $state(false);
  let recordingDraft = $state('');

  async function pickFolder(kind: 'screenshot' | 'recording') {
    try {
      const selected = await invoke<string | null>('select_folder');
      if (selected) {
        if (kind === 'screenshot') {
          updateSettings({ screenshotFolder: selected });
        } else {
          updateSettings({ recordingFolder: selected });
        }
      }
    } catch {
      if (kind === 'screenshot') {
        screenshotDraft = settings.screenshotFolder;
        editingScreenshotFolder = true;
      } else {
        recordingDraft = settings.recordingFolder;
        editingRecordingFolder = true;
      }
    }
  }

  function commitFolder(kind: 'screenshot' | 'recording') {
    if (kind === 'screenshot') {
      const value = screenshotDraft.trim();
      if (value) updateSettings({ screenshotFolder: value });
      editingScreenshotFolder = false;
    } else {
      const value = recordingDraft.trim();
      if (value) updateSettings({ recordingFolder: value });
      editingRecordingFolder = false;
    }
  }

  // Customizable shortcuts reactive state
  let shortcuts = $state<ShortcutItem[]>(loadShortcuts());
  let recordingId = $state<string | null>(null);
  let tempModifiers = $state<string[]>([]);
  let shortcutError = $state<string | null>(null);
  // Which row keeps showing the message after recording has stopped. A refused
  // binding has to stay visible on the row it belongs to.
  let shortcutErrorId = $state<string | null>(null);

  let hasCustomShortcuts = $derived(
    shortcuts.some((s) => !areKeysEqual(s.keys, s.defaultKeys))
  );

  // Native key capture gives the full modifier mask to the Linux backend. It
  // is used when available; ordinary browser key events remain the fallback.
  const MODIFIER_ORDER = ['Ctrl', 'Shift', 'Alt', 'Super'] as const;
  const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta'];
  const STANDALONE_KEYS = [
    'PrintScreen',
    ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
  ];

  let nativeRecorderAvailable = $state(false);

  function orderedModifiers(modifiers: Iterable<string>): string[] {
    const found = new Set<string>(modifiers);
    return MODIFIER_ORDER.filter((modifier) => found.has(modifier));
  }

  function modifierFromEvent(e: KeyboardEvent): string[] {
    const found = new Set<string>();
    if (e.ctrlKey) found.add('Ctrl');
    if (e.shiftKey) found.add('Shift');
    if (e.altKey) found.add('Alt');
    if (e.metaKey) found.add('Super');

    if (typeof e.getModifierState === 'function') {
      if (e.getModifierState('Control')) found.add('Ctrl');
      if (e.getModifierState('Shift')) found.add('Shift');
      if (e.getModifierState('Alt')) found.add('Alt');
      if (
        e.getModifierState('Meta') ||
        e.getModifierState('Super') ||
        e.getModifierState('OS')
      ) {
        found.add('Super');
      }
    }

    return orderedModifiers(found);
  }

  function isModifierKey(key: string): boolean {
    return ['Ctrl', 'Shift', 'Alt', 'Super', 'Control', 'Meta'].includes(key);
  }

  function isStandaloneKey(key: string): boolean {
    return STANDALONE_KEYS.includes(key);
  }

  async function setNativeRecording(enabled: boolean): Promise<boolean> {
    if (!isTauriEnvironment()) return false;

    try {
      return await invoke<boolean>('set_shortcut_recording', { enabled });
    } catch {
      return false;
    }
  }

  function stopNativeRecording() {
    nativeRecorderAvailable = false;
    void setNativeRecording(false);
  }

  onMount(() => {
    const onRawKey = (event: Event) =>
      handleNativeKey(
        event as CustomEvent<{ key: string; modifiers: string[] }>
      );

    window.addEventListener('sniplex-raw-key', onRawKey as EventListener, true);

    return () => {
      window.removeEventListener('sniplex-raw-key', onRawKey as EventListener, true);
      void setNativeRecording(false);
    };
  });

  async function startRecording(id: string) {
    nativeRecorderAvailable = await setNativeRecording(true);
    recordingId = id;
    tempModifiers = [];
    shortcutError = null;
    shortcutErrorId = null;
  }

  function cancelRecording() {
    recordingId = null;
    tempModifiers = [];
    shortcutError = null;
    shortcutErrorId = null;
    stopNativeRecording();
  }

  /**
   * Applies an edit and reports what the desktop said about it. A refused
   * binding — most often a key another application already holds — rolls the
   * list back, so it never shows a shortcut the desktop is not listening for.
   */
  async function commitShortcut(
    next: ShortcutItem[],
    previous: ShortcutItem[],
    changedId: string
  ) {
    shortcuts = next;
    saveShortcuts(next);

    const error = (await onShortcutsChange(next, changedId)) ?? null;
    shortcutError = error;
    shortcutErrorId = error ? changedId : null;

    if (error) {
      shortcuts = previous;
      saveShortcuts(previous);
    }
  }

  function commitRecordedKey(
    modifiers: string[],
    primaryKey: string | null,
    isValidCombination: boolean
  ) {
    if (!recordingId) return;

    const changedId = recordingId;
    const previous = shortcuts;

    if (!primaryKey) {
      tempModifiers = modifiers;
      shortcutError = null;
      return;
    }

    if (!isValidCombination && modifiers.length === 0) {
      shortcutError = 'Shortcut must include Ctrl, Alt, Shift, or a function key';
      return;
    }

    const newKeys = [...modifiers, primaryKey];

    const next = shortcuts.map((s) => {
      if (s.id === changedId) {
        return { ...s, keys: newKeys };
      }
      if (areKeysEqual(s.keys, newKeys)) {
        return { ...s, keys: [] };
      }
      return s;
    });

    recordingId = null;
    tempModifiers = [];
    shortcutError = null;
    stopNativeRecording();
    void commitShortcut(next, previous, changedId);
  }

  function handleNativeKey(event: CustomEvent<{ key: string; modifiers: string[] }>) {
    if (!recordingId || !nativeRecorderAvailable) return;

    const { key, modifiers } = event.detail;
    const ordered = orderedModifiers(modifiers);

    if (key === 'Escape') {
      cancelRecording();
      return;
    }

    if (isModifierKey(key)) {
      tempModifiers = ordered;
      shortcutError = null;
      return;
    }

    const isValidCombination =
      ordered.length > 0 || isStandaloneKey(key);

    commitRecordedKey(ordered, key, isValidCombination);
  }

  async function handleRecordKey(e: KeyboardEvent) {
    if (!recordingId || nativeRecorderAvailable) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      cancelRecording();
      return;
    }

    const { primaryKey, isValidCombination } = parseKeyEvent(e);
    const modifiers = modifierFromEvent(e);
    commitRecordedKey(modifiers, primaryKey, isValidCombination);
  }

  async function resetShortcut(id: string) {
    const previous = shortcuts;
    const next = shortcuts.map((s) => {
      if (s.id === id) {
        return { ...s, keys: [...s.defaultKeys] };
      }
      return s;
    });
    await commitShortcut(next, previous, id);
  }

  async function resetAllShortcuts() {
    const previous = shortcuts;
    const next = DEFAULT_SHORTCUTS.map((s) => ({
      ...s,
      keys: [...s.defaultKeys],
      defaultKeys: [...s.defaultKeys],
    }));
    recordingId = null;
    stopNativeRecording();
    await commitShortcut(next, previous, 'all');
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
            class="flex items-center justify-between px-3.5 py-2.5 rounded-md border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0067c0] dark:focus-visible:ring-[#60cdff] focus-visible:ring-offset-2 {settings.theme === 'light' ? 'border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800' : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'}"
            onclick={() => updateSettings({ theme: 'light' })}
          >
            <div class="flex items-center gap-2.5">
              <svg class="w-4 h-4 shrink-0 drop-shadow-2xs" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" fill="#ffffff" stroke="currentColor" stroke-width="1.5" class="stroke-neutral-400 dark:stroke-neutral-500" />
              </svg>
              <span class="text-xs font-medium text-neutral-800 dark:text-neutral-200">Light</span>
            </div>

            {#if settings.theme === 'light'}
              <svg class="w-4 h-4 text-neutral-900 dark:text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
              </svg>
            {/if}
          </button>

          <!-- Dark Theme -->
          <button
            type="button"
            class="flex items-center justify-between px-3.5 py-2.5 rounded-md border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0067c0] dark:focus-visible:ring-[#60cdff] focus-visible:ring-offset-2 {settings.theme === 'dark' ? 'border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800' : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'}"
            onclick={() => updateSettings({ theme: 'dark' })}
          >
            <div class="flex items-center gap-2.5">
              <svg class="w-4 h-4 shrink-0 drop-shadow-2xs" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" fill="#181818" stroke="currentColor" stroke-width="1.5" class="stroke-neutral-400 dark:stroke-neutral-500" />
              </svg>
              <span class="text-xs font-medium text-neutral-800 dark:text-neutral-200">Dark</span>
            </div>

            {#if settings.theme === 'dark'}
              <svg class="w-4 h-4 text-neutral-900 dark:text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
              </svg>
            {/if}
          </button>

          <!-- System Theme -->
          <button
            type="button"
            class="flex items-center justify-between px-3.5 py-2.5 rounded-md border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0067c0] dark:focus-visible:ring-[#60cdff] focus-visible:ring-offset-2 {settings.theme === 'system' ? 'border-neutral-900 dark:border-white bg-neutral-100 dark:bg-neutral-800' : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'}"
            onclick={() => updateSettings({ theme: 'system' })}
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

            {#if settings.theme === 'system'}
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
        <!-- Include cursor -->
        <div class="flex items-center justify-between p-4 gap-4">
          <div>
            <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Include mouse pointer</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Draw the visible cursor into captures and recordings</div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={settings.includeCursor}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {settings.includeCursor ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => updateSettings({ includeCursor: !settings.includeCursor })}
            title="Toggle cursor inclusion"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {settings.includeCursor ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
            ></span>
          </button>
        </div>

        <!-- Automatically copy changes -->
        <div class="flex items-center justify-between p-4 gap-4">
          <div>
            <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Automatically copy changes</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Copy captures and markup edits directly to the clipboard</div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={settings.autoCopy}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {settings.autoCopy ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => updateSettings({ autoCopy: !settings.autoCopy })}
            title="Toggle automatic copy"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {settings.autoCopy ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
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
              aria-checked={settings.autoSaveScreenshots}
              class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {settings.autoSaveScreenshots ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
              onclick={() => updateSettings({ autoSaveScreenshots: !settings.autoSaveScreenshots })}
              title="Toggle automatic save"
            >
              <span
                class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {settings.autoSaveScreenshots ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
              ></span>
            </button>
          </div>

          {#if settings.autoSaveScreenshots}
            <div class="mt-3 pt-3 border-t border-black/5 dark:border-white/5 text-xs">
              {#if editingScreenshotFolder}
                <div class="flex items-center gap-2">
                  <input
                    type="text"
                    bind:value={screenshotDraft}
                    class="flex-1 px-2.5 py-1 text-xs rounded bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-neutral-800 dark:text-neutral-100 font-mono focus:outline-none focus:ring-1 focus:ring-[#0067c0]"
                    placeholder="e.g. ~/Pictures/Screenshots"
                  />
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded bg-[#0067c0] text-white font-medium hover:bg-[#005ea6] transition-colors cursor-pointer"
                    onclick={() => commitFolder('screenshot')}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    class="px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-neutral-600 dark:text-neutral-400 transition-colors cursor-pointer"
                    onclick={() => (editingScreenshotFolder = false)}
                  >
                    Cancel
                  </button>
                </div>
              {:else}
                <div class="flex items-center justify-between">
                  <span class="text-neutral-500 dark:text-neutral-400 font-mono truncate max-w-[280px]" title={settings.screenshotFolder}>
                    {settings.screenshotFolder}
                  </span>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="px-2.5 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-300 font-medium transition-colors border border-black/10 dark:border-white/10 cursor-pointer"
                      onclick={() => pickFolder('screenshot')}
                    >
                      Browse...
                    </button>
                    <button
                      type="button"
                      class="px-2.5 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-300 font-medium transition-colors border border-black/10 dark:border-white/10 cursor-pointer"
                      onclick={() => { screenshotDraft = settings.screenshotFolder; editingScreenshotFolder = true; }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Automatically save screen recordings -->
        <div class="p-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Automatically save screen recordings</div>
              <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Save finished recordings to Videos/Screen Recordings</div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={settings.autoSaveRecordings}
              class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {settings.autoSaveRecordings ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
              onclick={() => updateSettings({ autoSaveRecordings: !settings.autoSaveRecordings })}
              title="Toggle automatic recording save"
            >
              <span
                class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {settings.autoSaveRecordings ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
              ></span>
            </button>
          </div>

          {#if settings.autoSaveRecordings}
            <div class="mt-3 pt-3 border-t border-black/5 dark:border-white/5 text-xs">
              {#if editingRecordingFolder}
                <div class="flex items-center gap-2">
                  <input
                    type="text"
                    bind:value={recordingDraft}
                    class="flex-1 px-2.5 py-1 text-xs rounded bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-neutral-800 dark:text-neutral-100 font-mono focus:outline-none focus:ring-1 focus:ring-[#0067c0]"
                    placeholder="e.g. ~/Videos/Screen Recordings"
                  />
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded bg-[#0067c0] text-white font-medium hover:bg-[#005ea6] transition-colors cursor-pointer"
                    onclick={() => commitFolder('recording')}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    class="px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-neutral-600 dark:text-neutral-400 transition-colors cursor-pointer"
                    onclick={() => (editingRecordingFolder = false)}
                  >
                    Cancel
                  </button>
                </div>
              {:else}
                <div class="flex items-center justify-between">
                  <span class="text-neutral-500 dark:text-neutral-400 font-mono truncate max-w-[280px]" title={settings.recordingFolder}>
                    {settings.recordingFolder}
                  </span>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="px-2.5 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-300 font-medium transition-colors border border-black/10 dark:border-white/10 cursor-pointer"
                      onclick={() => pickFolder('recording')}
                    >
                      Browse...
                    </button>
                    <button
                      type="button"
                      class="px-2.5 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-300 font-medium transition-colors border border-black/10 dark:border-white/10 cursor-pointer"
                      onclick={() => { recordingDraft = settings.recordingFolder; editingRecordingFolder = true; }}
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
            aria-checked={settings.askToSave}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {settings.askToSave ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => updateSettings({ askToSave: !settings.askToSave })}
            title="Toggle confirmation prompt"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {settings.askToSave ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
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
            aria-checked={settings.multipleInstances}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {settings.multipleInstances ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => updateSettings({ multipleInstances: !settings.multipleInstances })}
            title="Toggle multiple instances"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {settings.multipleInstances ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
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
              aria-checked={settings.outlineEnabled}
              class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {settings.outlineEnabled ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
              onclick={() => updateSettings({ outlineEnabled: !settings.outlineEnabled })}
              title="Toggle snip outline"
            >
              <span
                class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {settings.outlineEnabled ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
              ></span>
            </button>
          </div>

          <!-- Border Customization -->
          {#if settings.outlineEnabled}
            <div class="mt-4 pt-3.5 border-t border-black/5 dark:border-white/5 flex flex-col gap-3">
              <!-- Color Selector -->
              <div class="flex items-center gap-3">
                <span class="text-xs text-neutral-500 dark:text-neutral-400">Color:</span>
                <div class="flex items-center gap-1.5 flex-wrap">
                  {#each presetColors as preset}
                    <button
                      type="button"
                      class="w-5 h-5 rounded-full border transition-transform hover:scale-110 cursor-pointer {settings.outlineColor === preset.hex ? 'ring-2 ring-offset-1 ring-neutral-900 dark:ring-white dark:ring-offset-[#1c1c1c] scale-110' : 'border-black/20 dark:border-white/20'}"
                      style="background-color: {preset.hex};"
                      onclick={() => updateSettings({ outlineColor: preset.hex })}
                      title={preset.name}
                    >
                    </button>
                  {/each}
                  <div class="relative w-5 h-5 rounded-full overflow-hidden border border-black/20 dark:border-white/20 cursor-pointer ml-1">
                    <input
                      type="color"
                      value={settings.outlineColor}
                      oninput={(e) => (settings.outlineColor = (e.currentTarget as HTMLInputElement).value)}
                      onchange={persistSettings}
                      class="absolute -inset-2 w-10 h-10 cursor-pointer opacity-0"
                      title="Custom color"
                    />
                    <div class="w-full h-full" style="background-color: {settings.outlineColor};"></div>
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
                  value={settings.outlineWidth} oninput={(e) => updateSettings({ outlineWidth: Number((e.currentTarget as HTMLInputElement).value) })}
                  class="flex-1 accent-neutral-900 dark:accent-white cursor-pointer"
                />
                <span class="text-xs font-mono font-medium w-8 text-right text-neutral-700 dark:text-neutral-300">{settings.outlineWidth}px</span>

                <div class="w-10 h-6 bg-neutral-100 dark:bg-neutral-800 rounded-xs flex items-center justify-center" style="border: {settings.outlineWidth}px solid {settings.outlineColor};">
                  <span class="text-[9px] text-neutral-400">Snip</span>
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- 3. ACCESSIBILITY & ASSISTANCE -->
    <div class="mb-5">
      <div class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2 px-1">
        Accessibility &amp; assistance
      </div>

      <div class="bg-white dark:bg-[#1c1c1c] rounded-lg border border-black/10 dark:border-white/10 shadow-xs divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
        <div class="flex items-center justify-between p-4 gap-4">
          <div>
            <div class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Screen reader announcements</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Announce captures, copies, and tool changes to the system screen reader</div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={settings.announcements}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {settings.announcements ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => updateSettings({ announcements: !settings.announcements })}
            title="Toggle screen reader announcements"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {settings.announcements ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
            ></span>
          </button>
        </div>
      </div>
    </div>

    <!-- 4. SHORTCUTS -->
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

            {#if recordingId === sc.id || shortcutErrorId === sc.id}
              <div class="mt-2 text-[11px] flex items-center justify-between {shortcutError ? 'text-neutral-900 dark:text-white font-medium' : 'text-neutral-500 dark:text-neutral-400'}">
                <span>{shortcutError || 'Press key combination on your keyboard (Esc to cancel)'}</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- 5. SCREEN RECORDING -->
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
            aria-checked={settings.recordMicrophone}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {settings.recordMicrophone ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => updateSettings({ recordMicrophone: !settings.recordMicrophone })}
            title="Toggle microphone recording"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {settings.recordMicrophone ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
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
            aria-checked={settings.recordSystemAudio}
            class="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none {settings.recordSystemAudio ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700'}"
            onclick={() => updateSettings({ recordSystemAudio: !settings.recordSystemAudio })}
            title="Toggle system audio recording"
          >
            <span
              class="pointer-events-none block h-4 w-4 transform rounded-full shadow-xs transition duration-200 ease-in-out {settings.recordSystemAudio ? 'translate-x-5 bg-white dark:bg-neutral-900' : 'translate-x-0 bg-white'}"
            ></span>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
