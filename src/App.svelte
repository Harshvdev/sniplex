<script lang="ts">
  import TitleBar from './lib/components/TitleBar.svelte';
  import CommandBar from './lib/components/CommandBar.svelte';
  import CanvasArea from './lib/components/CanvasArea.svelte';
  import EmptyState from './lib/components/EmptyState.svelte';
  import FloatingOverlay from './lib/components/FloatingOverlay.svelte';
  import SettingsModal from './lib/components/SettingsModal.svelte';
  import { loadShortcuts, matchesShortcut, type ShortcutItem } from './lib/shortcuts';
  import type { CaptureMode, SnipType, SnipDelay, ToolType, ShapeKind, AppTheme, TabItem, AppView } from './lib/types';

  // Svelte 5 Runes State
  let theme = $state<AppTheme>('light');
  let view = $state<AppView>('editor');
  let isOverlayActive = $state(false);
  let shortcuts = $state<ShortcutItem[]>(loadShortcuts());

  let mode = $state<CaptureMode>('snip');
  let snipType = $state<SnipType>('rectangle');
  let delay = $state<SnipDelay>(0);

  let activeTool = $state<ToolType>('pen');
  let penColor = $state('#0078d4');
  let penSize = $state(3);
  let highlighterColor = $state('#ffeb3b');
  let highlighterSize = $state(18);
  let shapeKind = $state<ShapeKind>('rectangle');
  let zoom = $state(100);
  let isCropping = $state(false);

  // Tabs
  let tabs = $state<TabItem[]>([
    {
      id: 'tab-1',
      title: 'Snip 2026-10-29 14.22.45',
      width: 960,
      height: 540,
      timestamp: '14:22',
    },
  ]);
  let activeTabId = $state('tab-1');

  function handleNewTab() {
    const newId = `tab-${Date.now()}`;
    const newTitle = `Snip ${new Date().toLocaleTimeString()}`;
    tabs = [...tabs, { id: newId, title: newTitle, width: 960, height: 540, timestamp: 'Now' }];
    activeTabId = newId;
    view = 'editor';
  }

  function handleCloseTab(id: string) {
    tabs = tabs.filter((t) => t.id !== id);
    if (tabs.length === 0) {
      view = 'empty';
    } else if (activeTabId === id) {
      activeTabId = tabs[tabs.length - 1].id;
    }
  }

  function handleTriggerNew() {
    if (delay > 0) {
      setTimeout(() => {
        isOverlayActive = true;
      }, delay * 1000);
    } else {
      isOverlayActive = true;
    }
  }

  function handleCapture(rect: { x: number; y: number; w: number; h: number }) {
    isOverlayActive = false;
    view = 'editor';
    const newId = `tab-${Date.now()}`;
    tabs = [
      ...tabs,
      {
        id: newId,
        title: `Snip ${rect.w}×${rect.h}`,
        width: rect.w,
        height: rect.h,
        timestamp: 'Just now',
      },
    ];
    activeTabId = newId;
  }

  function toggleTheme() {
    theme = theme === 'light' ? 'dark' : 'light';
  }

  function handleGlobalKeyDown(e: KeyboardEvent) {
    if (view === 'settings') return;

    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable)) {
      return;
    }

    // Direct PrintScreen key
    if (e.key === 'PrintScreen' || e.key === 'Snapshot') {
      e.preventDefault();
      mode = 'snip';
      handleTriggerNew();
      return;
    }

    // Check customizable shortcuts
    const overlayShortcut = shortcuts.find((s) => s.id === 'overlay');
    if (overlayShortcut && matchesShortcut(e, overlayShortcut.keys)) {
      e.preventDefault();
      mode = 'snip';
      handleTriggerNew();
      return;
    }

    const recordShortcut = shortcuts.find((s) => s.id === 'record');
    if (recordShortcut && matchesShortcut(e, recordShortcut.keys)) {
      e.preventDefault();
      mode = 'record';
      handleTriggerNew();
      return;
    }

    const fullscreenShortcut = shortcuts.find((s) => s.id === 'fullscreen');
    if (fullscreenShortcut && matchesShortcut(e, fullscreenShortcut.keys)) {
      e.preventDefault();
      snipType = 'fullscreen';
      handleCapture({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
      return;
    }

    const newCaptureShortcut = shortcuts.find((s) => s.id === 'newCapture');
    if (newCaptureShortcut && matchesShortcut(e, newCaptureShortcut.keys)) {
      e.preventDefault();
      handleNewTab();
      return;
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeyDown} />

<!-- Outer application shell with dynamic light/dark class -->
<div class="{theme} h-screen w-screen flex flex-col font-segoe select-none overflow-hidden transition-colors duration-150">
  <div class="h-full w-full flex flex-col bg-[#f3f4f6] dark:bg-[#0d0f14] text-neutral-800 dark:text-neutral-100">
    <!-- 1. Window TitleBar with Tabs -->
    <TitleBar
      {tabs}
      {activeTabId}
      {theme}
      onSelectTab={(id) => { activeTabId = id; view = 'editor'; }}
      onCloseTab={handleCloseTab}
      onNewTab={handleNewTab}
    />

    <!-- 2. CommandBar Toolbar -->
    <CommandBar
      {mode}
      {snipType}
      {delay}
      {activeTool}
      {penColor}
      {penSize}
      {highlighterColor}
      {highlighterSize}
      {shapeKind}
      {zoom}
      hasImage={view === 'editor' && tabs.length > 0}
      {isCropping}
      onTriggerNew={handleTriggerNew}
      onModeChange={(m) => mode = m}
      onSnipTypeChange={(t) => snipType = t}
      onDelayChange={(d) => delay = d}
      onToolChange={(t) => activeTool = t}
      onPenColorChange={(c) => penColor = c}
      onPenSizeChange={(s) => penSize = s}
      onHighlighterColorChange={(c) => highlighterColor = c}
      onHighlighterSizeChange={(s) => highlighterSize = s}
      onShapeKindChange={(s) => shapeKind = s}
      onZoomChange={(z) => zoom = z}
      onSave={() => alert('Screenshot saved to Pictures/Screenshots (Mock)')}
      onCopy={() => {}}
      onOpenSettings={() => view = 'settings'}
      onOpenFile={() => handleNewTab()}
      onToggleCrop={() => isCropping = !isCropping}
      onClearAll={() => {
        // Redraw canvas
        const canvas = document.querySelector('canvas');
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }}
    />

    <!-- 3. Main Body View (Canvas, Empty, or Settings) -->
    {#if view === 'settings'}
      <SettingsModal
        {theme}
        onClose={() => view = tabs.length > 0 ? 'editor' : 'empty'}
        onThemeChange={(t) => theme = t}
        onShortcutsChange={(s) => shortcuts = s}
      />
    {:else if view === 'empty' || tabs.length === 0}
      <EmptyState
        {snipType}
        {delay}
        onTriggerNew={handleTriggerNew}
        onSnipTypeChange={(t) => snipType = t}
        onDelayChange={(d) => delay = d}
      />
    {:else}
      <CanvasArea
        imageUrl=""
        {zoom}
        {activeTool}
        {penColor}
        {penSize}
        {highlighterColor}
        {highlighterSize}
        {isCropping}
        onApplyCrop={() => isCropping = false}
        onCancelCrop={() => isCropping = false}
      />
    {/if}

    <!-- 4. Floating Capture Overlay -->
    <FloatingOverlay
      active={isOverlayActive}
      {mode}
      {snipType}
      onClose={() => isOverlayActive = false}
      onCapture={handleCapture}
    />

    <!-- Quick Mode Switcher Dock (Bottom Left Floating Pill for easy testing) -->
    <aside aria-label="Demo controls" class="fixed bottom-3 left-3 z-40 flex items-center gap-1.5 bg-white/90 dark:bg-[#161b26]/90 border border-black/10 dark:border-white/10 shadow-[0_4px_16px_rgba(0,0,0,0.3)] rounded-full px-2.5 py-1 text-xs backdrop-blur-md">
      <span class="text-neutral-500 dark:text-neutral-400 font-medium">Demo:</span>
      <button
        type="button"
        class="px-2 py-0.5 rounded-full bg-[#0067c0] text-white hover:bg-[#1070c7] font-medium transition-colors"
        onclick={() => isOverlayActive = true}
        title="Open Floating Pill"
      >
        Open Floating Pill
      </button>
      <button
        type="button"
        class="px-2 py-0.5 rounded-full hover:bg-black/5 dark:hover:bg-white/5 text-neutral-700 dark:text-neutral-300 transition-colors"
        onclick={() => view = view === 'editor' ? 'empty' : 'editor'}
      >
        {view === 'editor' ? 'Show Empty View' : 'Show Canvas View'}
      </button>
    </aside>
  </div>
</div>
