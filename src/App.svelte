<script lang="ts">
  import TitleBar from './lib/components/TitleBar.svelte';
  import CommandBar from './lib/components/CommandBar.svelte';
  import CanvasArea from './lib/components/CanvasArea.svelte';
  import EmptyState from './lib/components/EmptyState.svelte';
  import FloatingOverlay from './lib/components/FloatingOverlay.svelte';
  import SettingsModal from './lib/components/SettingsModal.svelte';
  import { Timer } from '@lucide/svelte';
  import { loadShortcuts, matchesShortcut, type ShortcutItem } from './lib/shortcuts';
  import type {
    CaptureMode,
    SnipType,
    SnipDelay,
    ToolType,
    ShapeKind,
    AppTheme,
    TabItem,
    AppView,
    DesktopCapture,
    CapturePayload,
  } from './lib/types';
  import { captureDesktopDisplay, restoreDesktopWindow } from './lib/capture';

  // Svelte 5 Runes State
  let theme = $state<AppTheme>(
    (typeof localStorage !== 'undefined' && (localStorage.getItem('sniplex_theme') as AppTheme)) || 'dark'
  );

  $effect(() => {
    const isDark =
      theme === 'dark' ||
      (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (typeof document !== 'undefined') {
      if (isDark) {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      }
    }
    try {
      localStorage.setItem('sniplex_theme', theme);
    } catch {}
  });

  let view = $state<AppView>('empty');
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

  // Tabs - initially empty, starts in EmptyState view
  let tabs = $state<TabItem[]>([]);
  let activeTabId = $state('');
  let activeTab = $derived(tabs.find((t) => t.id === activeTabId));

  // Hidden file input element for image ingestion
  let fileInputEl = $state<HTMLInputElement | null>(null);

  function handleOpenFile() {
    fileInputEl?.click();
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const dataUrl = readerEvent.target?.result as string;
      if (!dataUrl) return;

      const img = new Image();
      img.onload = () => {
        const newId = `tab-${Date.now()}`;
        const newTab: TabItem = {
          id: newId,
          title: file.name,
          imageUrl: dataUrl,
          width: img.naturalWidth || 960,
          height: img.naturalHeight || 540,
          timestamp: 'Just now',
        };
        tabs = [...tabs, newTab];
        activeTabId = newId;
        view = 'editor';
        input.value = '';
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function handlePrint() {
    window.print();
  }

  function handleSave() {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `Sniplex_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  async function handleCopy() {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    try {
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
      });
    } catch (err) {
      console.warn('Clipboard write error', err);
    }
  }

  function handleNewTab() {
    handleTriggerNew();
  }

  function handleCloseTab(id: string) {
    tabs = tabs.filter((t) => t.id !== id);
    if (tabs.length === 0) {
      view = 'empty';
      activeTabId = '';
    } else if (activeTabId === id) {
      activeTabId = tabs[tabs.length - 1].id;
    }
  }

  let desktopCapture = $state<DesktopCapture | null>(null);
  let countdown = $state<number | null>(null);
  let countdownTimer: number | null = null;

  async function startCaptureFlow() {
    try {
      desktopCapture = await captureDesktopDisplay();
      isOverlayActive = true;
    } catch (err) {
      console.warn('Capture acquisition error:', err);
      isOverlayActive = true;
    }
  }

  function handleTriggerNew() {
    if (delay > 0) {
      if (countdownTimer) clearInterval(countdownTimer);
      countdown = delay;
      countdownTimer = window.setInterval(async () => {
        if (countdown !== null && countdown > 1) {
          countdown -= 1;
        } else {
          if (countdownTimer) clearInterval(countdownTimer);
          countdownTimer = null;
          countdown = null;
          await startCaptureFlow();
        }
      }, 1000);
    } else {
      startCaptureFlow();
    }
  }

  function handleCancelCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    countdown = null;
  }

  async function handleCloseOverlay() {
    isOverlayActive = false;
    desktopCapture = null;
    await restoreDesktopWindow();
  }

  async function handleCapture(
    payload: CapturePayload | { x?: number; y?: number; w?: number; h?: number; imageUrl?: string; width?: number; height?: number }
  ) {
    isOverlayActive = false;
    await restoreDesktopWindow();
    view = 'editor';
    const newId = `tab-${Date.now()}`;

    let imageUrl = '';
    let width = 960;
    let height = 540;

    if ('imageUrl' in payload && payload.imageUrl) {
      imageUrl = payload.imageUrl;
      width = payload.width || 960;
      height = payload.height || 540;
    } else if ('w' in payload && 'h' in payload && payload.w && payload.h) {
      width = payload.w;
      height = payload.h;
      if (desktopCapture?.image_data_url) {
        imageUrl = desktopCapture.image_data_url;
      }
    }

    tabs = [
      ...tabs,
      {
        id: newId,
        title: `Snip ${width}×${height}`,
        imageUrl,
        width,
        height,
        timestamp: 'Just now',
      },
    ];
    activeTabId = newId;
    desktopCapture = null;
  }

  function handleTriggerOcr() {
    activeTool = 'text';
    handleTriggerNew();
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
      captureDesktopDisplay().then((cap) => {
        handleCapture({
          imageUrl: cap.image_data_url,
          width: cap.width,
          height: cap.height,
          mode: 'fullscreen',
        });
      });
      return;
    }

    const newCaptureShortcut = shortcuts.find((s) => s.id === 'newCapture');
    if (newCaptureShortcut && matchesShortcut(e, newCaptureShortcut.keys)) {
      e.preventDefault();
      handleTriggerNew();
      return;
    }

    // Ctrl+O: Open image file
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      handleOpenFile();
      return;
    }

    // Ctrl+P: Print
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      handlePrint();
      return;
    }

    // Ctrl+S: Save screenshot
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      handleSave();
      return;
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeyDown} />

<!-- Outer application shell with dynamic light/dark class -->
<div class="{theme} h-screen w-screen flex flex-col font-segoe select-none overflow-hidden transition-colors duration-150">
  <div class="h-full w-full flex flex-col bg-[#f3f4f6] dark:bg-[#0d0f14] text-neutral-800 dark:text-neutral-100">
    <!-- 1. Window TitleBar with Draggable Region & Window Controls -->
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
      onTriggerOcr={handleTriggerOcr}
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
      onSave={handleSave}
      onCopy={handleCopy}
      onOpenSettings={() => view = 'settings'}
      onOpenFile={handleOpenFile}
      onPrint={handlePrint}
      onToggleCrop={() => isCropping = !isCropping}
      onClearAll={() => {
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
      <EmptyState />
    {:else}
      <CanvasArea
        imageUrl={activeTab?.imageUrl || ''}
        width={activeTab?.width || 960}
        height={activeTab?.height || 540}
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

    <!-- Hidden file input for opening local images -->
    <input
      bind:this={fileInputEl}
      type="file"
      accept="image/*"
      class="hidden"
      onchange={handleFileSelect}
    />

    <!-- 4. Floating Capture Overlay Bar -->
    <FloatingOverlay
      active={isOverlayActive}
      {mode}
      {snipType}
      {delay}
      {desktopCapture}
      onClose={handleCloseOverlay}
      onCapture={handleCapture}
      onModeChange={(m) => mode = m}
      onSnipTypeChange={(t) => snipType = t}
      onDelayChange={(d) => delay = d}
      onScreenDraw={() => {
        activeTool = 'pen';
      }}
      onTextActions={() => {
        activeTool = 'text';
      }}
      onColorPicker={(color) => {
        if (color) penColor = color;
      }}
    />

    <!-- Active Timer Countdown Toast -->
    {#if countdown !== null}
      <div class="fixed top-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2 bg-white/95 dark:bg-[#181d28]/95 border border-black/10 dark:border-white/10 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.3)] backdrop-blur-md text-xs font-medium text-neutral-800 dark:text-neutral-100 select-none animate-in fade-in zoom-in-95 duration-150">
        <Timer class="w-4 h-4 text-[#0067c0] dark:text-[#60cdff] animate-pulse" />
        <span>Snip in <strong class="font-bold font-mono text-[13px]">{countdown}</strong>s...</span>
        <button
          type="button"
          class="ml-1 text-[11px] px-2 py-0.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors cursor-pointer"
          onclick={handleCancelCountdown}
        >
          Cancel
        </button>
      </div>
    {/if}
  </div>
</div>
