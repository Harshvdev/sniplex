<script lang="ts">
  import { tick, onMount } from 'svelte';
  import TitleBar from './lib/components/TitleBar.svelte';
  import CommandBar from './lib/components/CommandBar.svelte';
  import CanvasArea from './lib/components/CanvasArea.svelte';
  import EmptyState from './lib/components/EmptyState.svelte';
  import FloatingOverlay from './lib/components/FloatingOverlay.svelte';
  import SettingsModal from './lib/components/SettingsModal.svelte';
  import { AlertCircle, Check, Timer } from '@lucide/svelte';
  import { loadShortcuts, matchesShortcut, saveShortcuts, type ShortcutItem } from './lib/shortcuts';
  import type {
    CaptureMode,
    SnipType,
    SnipDelay,
    ToolType,
    ShapeKind,
    TabItem,
    AppView,
    DesktopCapture,
    CapturePayload,
    WindowRect,
    ZoomCommand,
    CanvasAreaApi,
  } from './lib/types';
  import { captureDesktopDisplay, restoreDesktopWindow, isTauriEnvironment } from './lib/capture';
  import { initTiming, mark } from './lib/timing';
  import { playTimerChime } from './lib/audio';
  import { clampZoom, zoomIn, zoomOut } from './lib/viewport';
  import { clampHighlighterSize } from './lib/highlighter';
  import { copyImageToClipboard } from './lib/clipboard';
  import { settings } from './lib/settings.svelte';
  import { applyCaptureOutline } from './lib/outline';
  import { normalizeTouchWriting } from './lib/touch-writing';
  import { HistoryStack, copySnapshot, type HistorySnapshot } from './lib/history';
  import SecondaryToolbar from './lib/components/SecondaryToolbar.svelte';
  import { SHAPE_DEFAULT_FILL, SHAPE_DEFAULT_OUTLINE, SHAPE_DEFAULT_WIDTH, clampShapeWidth } from './lib/shapes';
  import { TEXT_DEFAULT_FONT_FAMILY, clampTextSize, type TextAlign } from './lib/text-label';
  import {
    buildSaveFileName,
    downloadBlob,
    encodeCanvasToFormat,
    isValidSaveFormat,
    saveFormatsForImage,
    type SaveFormat,
  } from './lib/file-ops';
  import { handoffFileName, sharePayload } from './lib/handoff';
  import type { DraftingTool } from './lib/drafting';
  import { applySystemShortcuts, readSystemShortcuts, syncGlobalShortcuts } from './lib/global-shortcuts';

  // Svelte 5 Runes State
  let theme = $derived(settings.theme);

  $effect(() => {
    const activeTheme = settings.theme;
    const isDark =
      activeTheme === 'dark' ||
      (activeTheme === 'system' &&
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (typeof document !== 'undefined') {
      if (isDark) {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      }
    }
  });

  let view = $state<AppView>('empty');
  let isOverlayActive = $state(false);
  let shortcuts = $state<ShortcutItem[]>(loadShortcuts());
  /** True when the desktop entry owns the keys, so edits go to the desktop. */
  let desktopOwnsShortcuts = false;

  const savedMode =
    typeof localStorage !== 'undefined'
      ? (localStorage.getItem('sniplex_mode') as CaptureMode)
      : 'snip';
  let mode = $state<CaptureMode>(['snip', 'record'].includes(savedMode) ? savedMode : 'snip');

  $effect(() => {
    try {
      localStorage.setItem('sniplex_mode', mode);
    } catch {}
  });

  const savedSnipType =
    typeof localStorage !== 'undefined'
      ? (localStorage.getItem('sniplex_snip_type') as SnipType)
      : 'rectangle';
  let snipType = $state<SnipType>(
    ['rectangle', 'window', 'fullscreen', 'freeform'].includes(savedSnipType)
      ? savedSnipType
      : 'rectangle'
  );

  $effect(() => {
    try {
      localStorage.setItem('sniplex_snip_type', snipType);
    } catch {}
  });

  const savedDelay =
    typeof localStorage !== 'undefined'
      ? (Number(localStorage.getItem('sniplex_delay')) as SnipDelay)
      : 0;
  let delay = $state<SnipDelay>([0, 3, 5, 10].includes(savedDelay) ? savedDelay : 0);

  $effect(() => {
    try {
      localStorage.setItem('sniplex_delay', String(delay));
    } catch {}
  });

  function handleModeChange(m: CaptureMode) {
    mode = m;
    try {
      localStorage.setItem('sniplex_mode', m);
    } catch {}
  }

  function handleSnipTypeChange(t: SnipType) {
    snipType = t;
    try {
      localStorage.setItem('sniplex_snip_type', t);
    } catch {}
  }

  function handleDelayChange(d: SnipDelay) {
    delay = d;
    try {
      localStorage.setItem('sniplex_delay', String(d));
    } catch {}
  }

  // Phase 8: the Touch Writing toggle is independent of the markup tool.
  // Older sessions stored Touch Writing as the `touch` tool selection;
  // normalizeTouchWriting migrates that representation.
  const rawSavedTool: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem('sniplex_tool') : null;
  const rawStoredToggle = typeof localStorage !== 'undefined' ? localStorage.getItem('sniplex_touch_writing') === '1' : false;
  const migrated = normalizeTouchWriting((rawSavedTool as ToolType | 'touch' | null) ?? 'pen', rawStoredToggle);
  let activeTool = $state<ToolType>(migrated.activeTool);
  let touchWritingEnabled = $state(migrated.touchWritingEnabled);

  $effect(() => {
    try {
      localStorage.setItem('sniplex_tool', activeTool);
      localStorage.setItem('sniplex_touch_writing', touchWritingEnabled ? '1' : '0');
    } catch {}
  });
  let penColor = $state('#0078d4');
  let penSize = $state(3);
  let highlighterColor = $state('#ffeb3b');
  let highlighterSize = $state(18);
  let shapeKind = $state<ShapeKind>('rectangle');
  // Phase 13: selected shape style and the armed emoji stamp.
  let shapeOutlineColor = $state(SHAPE_DEFAULT_OUTLINE);
  let shapeFillColor = $state(SHAPE_DEFAULT_FILL);
  let shapeStrokeWidth = $state(SHAPE_DEFAULT_WIDTH);
  let shapeFillOpacity = $state(1);
  let shapeOutlineOpacity = $state(1);
  let emojiGlyph = $state<string | null>(null);
  // Phase 12 secondary-toolbar text state.
  let textFontFamily = $state(TEXT_DEFAULT_FONT_FAMILY);
  let textFontSize = $state(24);
  let textBold = $state(false);
  let textItalic = $state(false);
  let textUnderline = $state(false);
  let textColor = $state('#000000');
  let textHighlight = $state(false);
  let textAlign = $state<TextAlign>('left');
  // Phase 18: active drafting overlay.
  let draftingTool = $state<DraftingTool>('off');
  let zoom = $state(100);
  let isCropping = $state(false);

  // Canvas viewport handoff for zoom, fit, and composited exports.
  let canvasArea = $state<CanvasAreaApi | null>(null);

  // Phase 9: reversible edit history (pen / highlighter / eraser strokes).
  // One stack per tab, so switching tabs never loses a document's undo.
  const historyByTab = new Map<string, HistoryStack>();
  let history = new HistoryStack();
  let lastHistoryTabId = '';
  function historyForTab(tabId: string): HistoryStack {
    let existing = historyByTab.get(tabId);
    if (!existing) {
      existing = new HistoryStack();
      historyByTab.set(tabId, existing);
    }
    return existing;
  }
  // Reactive mirror of the stack, refreshed on every mutation so the
  // toolbar always reflects the real state.
  let historyState = $state({
    canUndo: false,
    canRedo: false,
    undoLabel: null as string | null,
    redoLabel: null as string | null,
  });
  function refreshHistoryState() {
    historyState = {
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undoLabel: history.nextUndoLabel,
      redoLabel: history.nextRedoLabel,
    };
  }
  const canUndo = $derived(historyState.canUndo);
  const canRedo = $derived(historyState.canRedo);
  const undoLabel = $derived(historyState.undoLabel);
  const redoLabel = $derived(historyState.redoLabel);

  function handleHistoryPush(label: string, before: HistorySnapshot, after: HistorySnapshot) {
    history.push(label, copySnapshot(before), copySnapshot(after));
    refreshHistoryState();
  }

  // Crop is a history boundary — Undo never crosses it.
  function handleHistoryBoundary() {
    history.clear();
    refreshHistoryState();
  }

  // Wet-ink edits amend the latest entry rather than pushing a new one.
  function handleHistoryAmend(after: HistorySnapshot) {
    history.replaceLastAfter(copySnapshot(after));
    refreshHistoryState();
  }

  // Phase 11: Erase all ink — clears annotations, keeps the capture,
  // and stays reversible via Undo.
  function handleEraseAllInk() {
    if (!canvasArea) return;
    canvasArea.eraseAllInk();
    announce('All ink erased');
  }

  let openFlyoutSignal = $state<{ name: string; nonce: number } | null>(null);
  let openFlyoutNonce = 0;
  function openFlyout(name: string) {
    openFlyoutNonce += 1;
    openFlyoutSignal = { name, nonce: openFlyoutNonce };
  }

  function handleUndo() {
    const snapshot = history.undo();
    if (snapshot && canvasArea) {
      canvasArea.restoreSnapshot(snapshot.data, snapshot.width, snapshot.height, snapshot.model);
      announce(`Undid ${history.nextRedoLabel ?? 'edit'}`);
    }
    refreshHistoryState();
  }

  function handleRedo() {
    const snapshot = history.redo();
    if (snapshot && canvasArea) {
      canvasArea.restoreSnapshot(snapshot.data, snapshot.width, snapshot.height, snapshot.model);
      announce(`Redid ${history.nextUndoLabel ?? 'edit'}`);
    }
    refreshHistoryState();
  }

  // Clipboard synchronization state.
  let autoCopy = $derived(settings.autoCopy);
  let pendingAutoCopy = false;
  let isCopying = false;

  let copyToast = $state<{ message: string; ok: boolean } | null>(null);
  let copyToastTimer: number | null = null;
  let copyAnnouncement = $state('');
  let announceTimer: number | null = null;
  let autoCopyTimer: number | null = null;
  let autoCopyTabId = '';

  // Unsaved-changes prompt (Surface G). Set on any canvas mutation,
  // cleared on save / tab switch / close / fresh capture.
  let hasUnsavedEdits = $state(false);
  let unsavedDialogOpen = $state(false);
  let pendingCloseTabId = $state<string | null>(null);
  let pendingWindowClose = $state(false);
  /** Replacement-capture in single-window mode: proceed with triggerNew after choice. */
  let pendingReplaceCapture = $state(false);

  // Tabs - initially empty, starts in EmptyState view
  let tabs = $state<TabItem[]>([]);
  let activeTabId = $state('');
  let activeTab = $derived(tabs.find((t) => t.id === activeTabId));

  // Hidden file input element for image ingestion
  let fileInputEl = $state<HTMLInputElement | null>(null);

  function handleOpenFile() {
    fileInputEl?.click();
  }

  /** Every new capture/file starts with a fresh, default tool state. */
  function resetToolStateForNewCapture() {
    activeTool = 'pen';
    touchWritingEnabled = false;
    isCropping = false;
    emojiGlyph = null;
    draftingTool = 'off';
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
      img.onload = async () => {
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
        resetToolStateForNewCapture();
        view = 'editor';
        input.value = '';
        await tick();
        canvasArea?.fitToViewport();
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  // Phase 16: print the composite capture through the system dialog.
  function handlePrint() {
    window.print();
  }

  async function handleOpenScreenshotsFolder() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_folder', { path: settings.screenshotFolder });
    } catch (err) {
      console.warn('Could not open screenshots folder:', err);
      announce('Could not open the screenshots folder');
    }
  }

  // Phase 16: Save As — encodes the composite to PNG/JPG/GIF/MP4.
  let saveDialogOpen = $state(false);
  let saveFormat = $state<SaveFormat>('png');

  function handleSave() {
    if (!activeTab) return;
    saveDialogOpen = true;
  }

  async function confirmSave() {
    if (!activeTab || !canvasArea) return;
    const canvas = canvasArea.compositeCanvas();
    if (!canvas) return;
    const format: SaveFormat = isValidSaveFormat(saveFormat) ? saveFormat : 'png';
    const blob = await encodeCanvasToFormat(canvas, format);
    if (!blob) {
      announce('Could not encode the image for saving');
      showCopyToast(false, 'Could not save the image');
      return;
    }
    const fileName = buildSaveFileName(activeTab.title, format);
    downloadBlob(blob, fileName);
    saveDialogOpen = false;
    hasUnsavedEdits = false;
    announce(`Saved as ${fileName}`);
    showCopyToast(true, `Saved as ${fileName}`);
  }

  function captureFileName(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `Sniplex_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.png`;
  }

  /** Writes an automatically saved capture to the configured folder. */
  async function saveCaptureToDisk(imageUrl: string, width: number, height: number): Promise<void> {
    if (!settings.autoSaveScreenshots || !imageUrl || !isTauriEnvironment()) return;

    const comma = imageUrl.indexOf(',');
    if (comma < 0) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string>('save_screenshot', {
        folder: settings.screenshotFolder,
        fileName: captureFileName(),
        pngBase64: imageUrl.slice(comma + 1),
      });
      if (path) console.info(`Capture saved to ${path}`);
    } catch (err) {
      console.warn('Failed to save capture:', err);
      if (settings.announcements) announce('Could not save the screenshot to disk');
    }
  }

  /** Applies the optional screenshot frame and persists the original capture. */
  async function prepareCapturedImage(
    imageUrl: string,
    width: number,
    height: number
  ): Promise<{ imageUrl: string; width: number; height: number }> {
    if (!imageUrl) return { imageUrl, width, height };

    const outlined = await applyCaptureOutline(imageUrl, width, height, {
      enabled: settings.outlineEnabled,
      color: settings.outlineColor,
      width: settings.outlineWidth,
    });

    void saveCaptureToDisk(outlined.imageUrl, outlined.width, outlined.height);
    return outlined;
  }

  function announce(message: string) {
    if (!settings.announcements) {
      copyAnnouncement = '';
      return;
    }
    copyAnnouncement = '';
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      copyAnnouncement = message;
      announceTimer = null;
    }, 60);
  }

  function showCopyToast(ok: boolean, message?: string) {
    copyToast = { message: message ?? (ok ? 'Copied to clipboard' : 'Copy failed'), ok };
    if (copyToastTimer) clearTimeout(copyToastTimer);
    copyToastTimer = window.setTimeout(() => {
      copyToast = null;
      copyToastTimer = null;
    }, 2200);
  }

  // Phase 17: Share — hands the composite to the native share sheet,
  // falling back to the clipboard (reported honestly) and then a download.
  async function handleShare() {
    if (!activeTab || !canvasArea) return;
    const blob = await canvasArea.exportPngBlob();
    if (!blob) {
      announce('Could not share image');
      showCopyToast(false);
      return;
    }
    const outcome = await sharePayload({ title: handoffFileName(activeTab.title, '.png'), mime: 'image/png', blob });
    if (outcome === 'native') {
      announce('Shared image');
      showCopyToast(true, 'Shared image');
    } else if (outcome === 'clipboard') {
      announce('Image copied to clipboard (share unavailable)');
      showCopyToast(true, 'Copied to clipboard');
    } else {
      // Fallback: offer the file as a download so the handoff still lands.
      downloadBlob(blob, handoffFileName(activeTab.title, '.png'));
      announce('Shared image saved as download');
      showCopyToast(true, 'Saved as download');
    }
  }

  /** Copies the flattened composite bitmap from the editor canvas. */
  async function copyComposite(): Promise<boolean> {
    if (!activeTab || !canvasArea || isCopying) return false;

    isCopying = true;
    try {
      const blob = await canvasArea.exportPngBlob();
      if (!blob) {
        announce('Could not copy image to clipboard');
        showCopyToast(false);
        return false;
      }

      const result = await copyImageToClipboard(blob);
      if (result.ok) {
        announce('Composite image copied to clipboard');
        showCopyToast(true);
        return true;
      }

      console.warn('Clipboard copy error:', result.error);
      announce('Could not copy image to clipboard');
      showCopyToast(false);
      return false;
    } finally {
      isCopying = false;
    }
  }

  function handleCanvasImageReady() {
    // A new document starts with an empty stack; switching back to a tab
    // restores that tab's own undo history.
    if (activeTabId && activeTabId !== lastHistoryTabId) {
      history = activeTabId ? historyForTab(activeTabId) : new HistoryStack();
      lastHistoryTabId = activeTabId;
    }
    refreshHistoryState();
    if (!pendingAutoCopy) return;
    pendingAutoCopy = false;
    if (autoCopy) void copyComposite();
  }

  function handleCanvasMutated() {
    hasUnsavedEdits = true;
    if (!autoCopy || !activeTab) return;

    autoCopyTabId = activeTabId;
    if (autoCopyTimer) clearTimeout(autoCopyTimer);
    autoCopyTimer = window.setTimeout(() => {
      autoCopyTimer = null;
      if (activeTabId === autoCopyTabId) void copyComposite();
    }, 700);
  }

  function handleCanvasZoom(next: number) {
    zoom = clampZoom(next);
  }

  function handleZoomCommand(command: ZoomCommand) {
    if (!activeTab) return;

    if (command === 'in') {
      zoom = clampZoom(zoomIn(zoom));
    } else if (command === 'out') {
      zoom = clampZoom(zoomOut(zoom));
    } else if (command === 'actual') {
      zoom = 100;
    } else {
      canvasArea?.fitToViewport();
    }
  }

  function handleNewTab() {
    handleTriggerNew();
  }

  async function closeTabNow(id: string) {
    historyByTab.delete(id);
    hasUnsavedEdits = false;
    if (lastHistoryTabId === id) lastHistoryTabId = '__closed__';
    tabs = tabs.filter((t) => t.id !== id);
    if (tabs.length === 0) {
      view = 'empty';
      activeTabId = '';
    } else if (activeTabId === id) {
      activeTabId = tabs[tabs.length - 1].id;
    }
  }

  function handleCloseTab(id: string) {
    if (settings.askToSaveScreenshots && hasUnsavedEdits && tabs.some((tb) => tb.id === id)) {
      pendingCloseTabId = id;
      pendingWindowClose = false;
      unsavedDialogOpen = true;
      return;
    }
    void closeTabNow(id);
  }

  function requestWindowClose() {
    if (settings.askToSaveScreenshots && hasUnsavedEdits && tabs.length > 0) {
      pendingCloseTabId = null;
      pendingWindowClose = true;
      unsavedDialogOpen = true;
      return;
    }
    void doWindowClose();
  }

  async function doWindowClose() {
    unsavedDialogOpen = false;
    hasUnsavedEdits = false;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const current = getCurrentWindow();
      if (current.label !== 'main') {
        await current.close();
        return;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('exit_app');
    } catch {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      } catch {
        window.close();
      }
    }
  }

  function resolveUnsaved(choice: 'save' | 'dont' | 'cancel') {
    unsavedDialogOpen = false;
    if (choice === 'cancel') {
      pendingCloseTabId = null;
      pendingWindowClose = false;
      pendingReplaceCapture = false;
      return;
    }
    if (choice === 'save') {
      saveDialogOpen = true;
      // After saving, proceed with the pending action.
      const closeId = pendingCloseTabId;
      const win = pendingWindowClose;
      const rep = pendingReplaceCapture;
      pendingCloseTabId = null;
      pendingWindowClose = false;
      pendingReplaceCapture = false;
      const proceed = () => {
        hasUnsavedEdits = false;
        if (win) void doWindowClose();
        else if (rep) triggerNewNow();
        else if (closeId) void closeTabNow(closeId);
      };
      const check = window.setInterval(() => {
        if (!saveDialogOpen) {
          window.clearInterval(check);
          if (!hasUnsavedEdits) proceed();
        }
      }, 150);
      return;
    }
    // don't save
    hasUnsavedEdits = false;
    if (pendingWindowClose) {
      pendingWindowClose = false;
      void doWindowClose();
    } else if (pendingReplaceCapture) {
      pendingReplaceCapture = false;
      triggerNewNow();
    } else if (pendingCloseTabId) {
      const id = pendingCloseTabId;
      pendingCloseTabId = null;
      void closeTabNow(id);
    }
  }

  let desktopCapture = $state<DesktopCapture | null>(null);
  let wasWindowMaximized = $state(true);
  let countdown = $state<number | null>(null);
  let countdownTimer: number | null = null;

  // Dedicated overlay instance states
  const isOverlayInstance = typeof window !== 'undefined' && window.location.hash === '#overlay';
  const captureHash = typeof window !== 'undefined' ? window.location.hash : '';
  const isCaptureInstance = captureHash.startsWith('#capture=');
  const captureToken = isCaptureInstance ? captureHash.slice('#capture='.length) : '';
  let overlayCapture = $state<DesktopCapture | null>(null);
  let overlayFrameBitmap = $state<ImageBitmap | null>(null);
  let overlayMode = $state<CaptureMode>('snip');
  let overlaySnipType = $state<SnipType>('rectangle');
  let overlayDelay = $state<SnipDelay>(0);
  let isOverlayReady = $state(false);
  // WebKitGTK lays the webview out at its 800x600 default the first time the
  // overlay window is mapped, then resizes it. Content stays hidden until that
  // settles so the frozen frame never appears shrunken in the corner.
  let overlaySized = $state(false);

  function releaseOverlayFrame() {
    if (overlayFrameBitmap) {
      overlayFrameBitmap.close();
      overlayFrameBitmap = null;
    }
  }

  // Zoom shortcuts and Ctrl+wheel scale the capture inside the canvas. The
  // platform page zoom is disabled natively; these guards keep the webview from
  // ever acting on the same input as a page-level zoom.
  onMount(() => {
    const blockZoomWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const blockZoomKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key;
      if (key === '+' || key === '=' || key === '-' || key === '_' || key === '0' || key === '1') {
        e.preventDefault();
      }
    };

    window.addEventListener('wheel', blockZoomWheel, { passive: false, capture: true });
    window.addEventListener('keydown', blockZoomKey, { capture: true });

    return () => {
      window.removeEventListener('wheel', blockZoomWheel, { capture: true });
      window.removeEventListener('keydown', blockZoomKey, { capture: true });
    };
  });

  /** Blocks OS-level close (Alt+F4 / dock) while unsaved edits need a choice. */
  $effect(() => {
    const block = (e: BeforeUnloadEvent) => {
      if (settings.askToSaveScreenshots && hasUnsavedEdits && tabs.length > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', block);
    return () => window.removeEventListener('beforeunload', block);
  });

  onMount(async () => {
    // The capture overlay is a full-screen capture surface, so it is always
    // dark; this also keeps the brief first-map layout pass from flashing the
    // theme background across the screen.
    if (isOverlayInstance) {
      document.documentElement.classList.add('overlay-surface');
    }

    if (isTauriEnvironment()) {
      if (isOverlayInstance) {
        await initTiming();
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');

        let pendingWindows: WindowRect[] | null = null;

        function waitForOverlayLayout(): Promise<void> {
          return new Promise((resolve) => {
            const deadline = Date.now() + 200;
            const check = () => {
              const laidOut =
                (window.innerWidth !== 800 || window.innerHeight !== 600) && window.innerWidth > 0;
              if (laidOut || Date.now() >= deadline) {
                resolve();
                return;
              }
              requestAnimationFrame(check);
            };
            check();
          });
        }

        async function fetchSession() {
          try {
            mark('overlay.fetch_start');
            const session = await invoke<{
              capture: DesktopCapture;
              mode: CaptureMode;
              snip_type: SnipType;
              delay: SnipDelay;
            } | null>('get_capture_session');
            mark('overlay.session_meta');

            if (session) {
              isOverlayReady = false;
              overlaySized = false;
              // The window's translucent backdrop covers the desktop the moment
              // it maps, so the screen is dimmed while the frame is still being
              // transferred. The request goes out first so the transfer runs
              // while the webview is mapping instead of after it.
              //
              // The compositor hands over raw RGBA pixels; the external fallback
              // hands over an encoded file. Both become a bitmap/canvas source.
              const frameRequest = invoke<ArrayBuffer>('get_capture_frame');
              mark('overlay.show_call');
              const shown = invoke('show_capture_overlay');

              const frame = await frameRequest;
              mark('overlay.frame_bytes');

              const header = new Uint8Array(frame, 0, Math.min(4, frame.byteLength));
              const isRawFrame =
                header[0] === 0x53 && header[1] === 0x4c && header[2] === 0x58 && header[3] === 0x52;

              let frameBitmap: ImageBitmap;
              if (isRawFrame) {
                const meta = new DataView(frame, 4, 8);
                const width = meta.getUint32(0, true);
                const height = meta.getUint32(4, true);
                const pixels = new Uint8ClampedArray(frame, 12, width * height * 4);
                frameBitmap = await createImageBitmap(new ImageData(pixels, width, height));
              } else {
                frameBitmap = await createImageBitmap(new Blob([frame], { type: 'image/png' }));
              }

              mark('overlay.frame_decoded');
              releaseOverlayFrame();

              overlayCapture = session.capture;
              overlayMode = session.mode;
              overlaySnipType = session.snip_type;
              overlayDelay = session.delay;
              overlayFrameBitmap = frameBitmap;

              if (pendingWindows) {
                overlayCapture = { ...overlayCapture, windows: pendingWindows };
                pendingWindows = null;
              }

              isOverlayReady = true;

              await waitForOverlayLayout();
              mark('overlay.sized');
              overlaySized = true;

              await tick();
              mark('overlay.tick');

              await shown;
              mark('overlay.show_returned');
              requestAnimationFrame(() => mark('overlay.first_raf'));
            }
          } catch (err) {
            console.warn('Failed to fetch capture session:', err);
          }
        }

        // Attach listeners before the first read so no session event is missed
        listen<WindowRect[]>('windows-ready', (event) => {
          if (overlayCapture) {
            overlayCapture = { ...overlayCapture, windows: event.payload };
          } else {
            pendingWindows = event.payload;
          }
        });

        listen('session-ready', () => {
          void fetchSession();
        });

        await fetchSession();
      } else {
        await initTiming();

        if (typeof localStorage !== 'undefined') {
          const sm = localStorage.getItem('sniplex_mode') as CaptureMode;
          if (['snip', 'record'].includes(sm)) mode = sm;
          const st = localStorage.getItem('sniplex_snip_type') as SnipType;
          if (['rectangle', 'window', 'fullscreen', 'freeform'].includes(st)) snipType = st;
          const sd = Number(localStorage.getItem('sniplex_delay')) as SnipDelay;
          if ([0, 3, 5, 10].includes(sd)) delay = sd;
        }

        if (isCaptureInstance && captureToken) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const payload = await invoke<{
              imageUrl: string;
              width: number;
              height: number;
              title?: string;
            } | null>('take_capture_payload', { token: captureToken });

            if (payload) {
              const sized = await prepareCapturedImage(
                payload.imageUrl,
                payload.width,
                payload.height
              );
              const id = `tab-${Date.now()}`;
              tabs = [
                ...tabs,
                {
                  id,
                  title: payload.title || `Snip ${sized.width}×${sized.height}`,
                  imageUrl: sized.imageUrl,
                  width: sized.width,
                  height: sized.height,
                  timestamp: 'Just now',
                },
              ];
              activeTabId = id;
              view = 'editor';
              pendingAutoCopy = true;
              announce(`Screenshot opened, ${sized.width} by ${sized.height} pixels`);
              await tick();
              canvasArea?.fitToViewport();
            }
          } catch (err) {
            console.warn('Failed to open the capture in this window:', err);
          }
        }

        // Main editor window: listen for snip completion and delay synchronization from overlay window
        const { listen } = await import('@tauri-apps/api/event');
        listen<CapturePayload>('snip-captured', (event) => {
          handleCapture(event.payload);
        });
        listen<{ delay: SnipDelay }>('snip-delay-changed', (event) => {
          if (event.payload && typeof event.payload.delay === 'number') {
            handleDelayChange(event.payload.delay);
          }
        });
        listen<{ mode: CaptureMode }>('snip-mode-changed', (event) => {
          if (event.payload && ['snip', 'record'].includes(event.payload.mode)) {
            handleModeChange(event.payload.mode);
          }
        });
        listen<{ snipType: SnipType }>('snip-type-changed', (event) => {
          if (
            event.payload &&
            ['rectangle', 'window', 'fullscreen', 'freeform'].includes(event.payload.snipType)
          ) {
            handleSnipTypeChange(event.payload.snipType);
          }
        });

        if (typeof window !== 'undefined') {
          window.addEventListener('storage', (e) => {
            if (e.key === 'sniplex_delay' && e.newValue !== null) {
              const val = Number(e.newValue) as SnipDelay;
              if ([0, 3, 5, 10].includes(val)) {
                delay = val;
              }
            }
            if (e.key === 'sniplex_mode' && e.newValue !== null) {
              const val = e.newValue as CaptureMode;
              if (['snip', 'record'].includes(val)) {
                mode = val;
              }
            }
            if (e.key === 'sniplex_snip_type' && e.newValue !== null) {
              const val = e.newValue as SnipType;
              if (['rectangle', 'window', 'fullscreen', 'freeform'].includes(val)) {
                snipType = val;
              }
            }
          });
        }

        // Only the editor window answers desktop activations; a capture window
        // must not handle the same request a second time.
        if (!isCaptureInstance) {
          window.addEventListener('sniplex-global-shortcut', handleGlobalShortcutEvent);
          await syncGlobalShortcuts(shortcuts);

          // Where the desktop owns the keys, its bindings are what actually
          // fires, so the in-app handler and the settings list follow them
          // instead of a private copy that would drift on the first change.
          const desktopBindings = await readSystemShortcuts();
          if (desktopBindings) {
            desktopOwnsShortcuts = true;
            shortcuts = shortcuts.map((shortcut) =>
              desktopBindings[shortcut.id]
                ? { ...shortcut, keys: desktopBindings[shortcut.id] }
                : shortcut
            );
            saveShortcuts(shortcuts);
          }

          listen('sniplex-capture-request', async () => {
            const { invoke } = await import('@tauri-apps/api/core');
            const action = await invoke<string | null>('take_launch_action');
            if (action) runCaptureAction(action);
          });

          // A shortcut press that started this process is waiting already.
          const { invoke } = await import('@tauri-apps/api/core');
          const pendingAction = await invoke<string | null>('take_launch_action');
          if (pendingAction) runCaptureAction(pendingAction);
        }
      }
    }
  });

  async function handleOverlayCapture(payload: CapturePayload) {
    isOverlayReady = false;
    overlaySized = false;
    overlayCapture = null;
    releaseOverlayFrame();
    await tick();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
    if (isTauriEnvironment()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('complete_capture', {
        payload,
        openInNewWindow: settings.multipleInstances,
      });
    }
  }

  async function handleOverlayDelayChange(d: SnipDelay) {
    overlayDelay = d;
    try {
      localStorage.setItem('sniplex_delay', String(d));
    } catch {}
    if (isTauriEnvironment()) {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('snip-delay-changed', { delay: d });
    }
  }

  async function handleOverlayModeChange(m: CaptureMode) {
    overlayMode = m;
    try {
      localStorage.setItem('sniplex_mode', m);
    } catch {}
    if (isTauriEnvironment()) {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('snip-mode-changed', { mode: m });
    }
  }

  async function handleOverlaySnipTypeChange(t: SnipType) {
    overlaySnipType = t;
    try {
      localStorage.setItem('sniplex_snip_type', t);
    } catch {}
    if (isTauriEnvironment()) {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('snip-type-changed', { snipType: t });
    }
  }

  async function handleOverlayClose() {
    isOverlayReady = false;
    overlaySized = false;
    overlayCapture = null;
    releaseOverlayFrame();
    await tick();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
    try {
      localStorage.setItem('sniplex_delay', String(overlayDelay));
      localStorage.setItem('sniplex_mode', overlayMode);
      localStorage.setItem('sniplex_snip_type', overlaySnipType);
    } catch {}
    if (isTauriEnvironment()) {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('snip-delay-changed', { delay: overlayDelay });
      await emit('snip-mode-changed', { mode: overlayMode });
      await emit('snip-type-changed', { snipType: overlaySnipType });
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('cancel_capture');
    }
  }

  async function startCaptureFlow() {
    try {
      if (isTauriEnvironment()) {
        mark('main.hide_call');
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();
        const originLabel = currentWindow.label;
        await currentWindow.hide();
        mark('main.hidden');

        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('start_capture_session', {
          mode,
          snipType,
          delay,
          includeCursor: false,
          originLabel,
        });
        mark('main.command_done');
      } else {
        const res = await captureDesktopDisplay(false);
        desktopCapture = res.capture;
        wasWindowMaximized = res.wasMaximized;

        if (snipType === 'fullscreen') {
          await handleCapture({
            imageUrl: res.capture.image_data_url,
            width: res.capture.width,
            height: res.capture.height,
            mode: 'fullscreen',
          });
          return;
        }

        isOverlayActive = true;
      }
    } catch (err) {
      console.warn('Capture acquisition error:', err);
      if (isTauriEnvironment()) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('cancel_capture');
      }
      isOverlayActive = false;
    }
  }

  function handleTriggerNew() {
    // Single-window replacement capture prompts when there are unsaved edits.
    if (!settings.multipleInstances && settings.askToSaveScreenshots && hasUnsavedEdits && tabs.length > 0) {
      pendingReplaceCapture = true;
      unsavedDialogOpen = true;
      return;
    }
    triggerNewNow();
  }

  function triggerNewNow() {
    hasUnsavedEdits = false;
    if (delay > 0) {
      if (countdownTimer) clearInterval(countdownTimer);
      countdown = delay;
      playTimerChime(countdown === 1 ? 'high' : 'normal');
      countdownTimer = window.setInterval(async () => {
        if (countdown !== null && countdown > 1) {
          countdown -= 1;
          playTimerChime(countdown === 1 ? 'high' : 'normal');
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
    if (!isTauriEnvironment()) {
      await restoreDesktopWindow(wasWindowMaximized);
    }
  }

  /** Pulls the frozen frame and re-encodes it for the editor window. */
  async function frameToDataUrl(): Promise<{ imageUrl: string; width: number; height: number } | null> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const frame = await invoke<ArrayBuffer>('get_capture_frame');
      const header = new Uint8Array(frame, 0, Math.min(4, frame.byteLength));
      const isRawFrame =
        header[0] === 0x53 && header[1] === 0x4c && header[2] === 0x58 && header[3] === 0x52;

      let source: CanvasImageSource;
      let width: number;
      let height: number;
      let release: (() => void) | null = null;

      if (isRawFrame) {
        const meta = new DataView(frame, 4, 8);
        width = meta.getUint32(0, true);
        height = meta.getUint32(4, true);
        const bitmap = await createImageBitmap(
          new ImageData(new Uint8ClampedArray(frame, 12, width * height * 4), width, height)
        );
        source = bitmap;
        release = () => bitmap.close();
      } else {
        const bitmap = await createImageBitmap(new Blob([frame], { type: 'image/png' }));
        width = bitmap.width;
        height = bitmap.height;
        source = bitmap;
        release = () => bitmap.close();
      }

      if (!width || !height) return null;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(source, 0, 0);
      release?.();

      return { imageUrl: canvas.toDataURL('image/png'), width, height };
    } catch (err) {
      console.warn('Failed to read the frozen frame:', err);
      return null;
    }
  }

  async function handleCapture(
    payload: CapturePayload | { x?: number; y?: number; w?: number; h?: number; imageUrl?: string; width?: number; height?: number }
  ) {
    isOverlayActive = false;
    if (!isTauriEnvironment()) {
      await restoreDesktopWindow(wasWindowMaximized);
    }
    view = 'editor';
    const newId = `tab-${Date.now()}`;

    let imageUrl = '';
    let width = 960;
    let height = 540;

    const payloadUrl = 'imageUrl' in payload ? payload.imageUrl : '';
    const isInstantFullscreen = 'mode' in payload && payload.mode === 'fullscreen';

    if (!payloadUrl && isInstantFullscreen && isTauriEnvironment()) {
      // The backend handed the frame over unpainted so no image encoding sits on
      // the capture path; encode it here, once.
      const frame = await frameToDataUrl();
      if (frame) {
        imageUrl = frame.imageUrl;
        width = frame.width;
        height = frame.height;
      }
    } else if (payloadUrl) {
      imageUrl = payloadUrl;
      width = payload.width || 960;
      height = payload.height || 540;
    } else if ('w' in payload && 'h' in payload && payload.w && payload.h) {
      width = payload.w;
      height = payload.h;
      if (desktopCapture?.image_data_url) {
        imageUrl = desktopCapture.image_data_url;
      }
    }

    if ('delay' in payload && typeof payload.delay === 'number') {
      handleDelayChange(payload.delay as SnipDelay);
    }

    if ('mode' in payload && payload.mode) {
      const pMode = payload.mode as SnipType;
      if (['rectangle', 'window', 'fullscreen', 'freeform'].includes(pMode)) {
        handleSnipTypeChange(pMode);
      }
    }

    // Each capture gets its own standalone editor window when requested. The
    // new surface applies the frame, saves, and copies using its own settings.
    if (settings.multipleInstances && isTauriEnvironment() && imageUrl) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_capture_window', {
          payload: {
            imageUrl,
            width,
            height,
            title: `Snip ${width}×${height}`,
          },
        });
        desktopCapture = null;
        pendingAutoCopy = false;
        return;
      } catch (err) {
        console.warn('Could not open a dedicated capture window, using this window:', err);
      }
    }

    const sized = await prepareCapturedImage(imageUrl, width, height);
    imageUrl = sized.imageUrl;
    width = sized.width;
    height = sized.height;

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
    hasUnsavedEdits = false;
    resetToolStateForNewCapture();
    desktopCapture = null;
    pendingAutoCopy = imageUrl.length > 0;
    if (imageUrl) {
      announce(`Screenshot captured, ${width} by ${height} pixels`);
    }

    await tick();
    canvasArea?.fitToViewport();
  }

  function handleTriggerOcr() {
    activeTool = 'text';
    handleTriggerNew();
  }

  async function triggerFullscreenCapture() {
    if (isTauriEnvironment()) {
      snipType = 'fullscreen';
      await startCaptureFlow();
      return;
    }

    const res = await captureDesktopDisplay(false);
    wasWindowMaximized = res.wasMaximized;
    await handleCapture({
      imageUrl: res.capture.image_data_url,
      width: res.capture.width,
      height: res.capture.height,
      mode: 'fullscreen',
    });
  }

  /**
   * Applies a shortcut edit. Where the desktop owns the keys the change is
   * written there first, and a refusal — most often another application
   * already holding the key — leaves the previous binding in place so the list
   * never claims something the desktop is not listening for.
   */
  async function handleShortcutsChange(
    next: ShortcutItem[],
    _changedId: string
  ): Promise<string | null> {
    const previous = shortcuts;
    shortcuts = next;
    saveShortcuts(next);

    if (!desktopOwnsShortcuts) {
      void syncGlobalShortcuts(next);
      return null;
    }

    const error = await applySystemShortcuts(next);
    if (error) {
      shortcuts = previous;
      saveShortcuts(previous);
      return error;
    }

    return null;
  }

  /**
   * Runs a capture request. The desktop can deliver the same press through more
   * than one path, so repeats of one action are ignored for a moment.
   */
  const handledActions = new Map<string, number>();

  function runCaptureAction(id: string) {
    const now = Date.now();
    if (now - (handledActions.get(id) ?? 0) < 600) return;
    handledActions.set(id, now);

    if (id === 'overlay') {
      mode = 'snip';
      handleTriggerNew();
    } else if (id === 'record') {
      mode = 'record';
      handleTriggerNew();
    } else if (id === 'fullscreen') {
      snipType = 'fullscreen';
      void triggerFullscreenCapture();
    } else {
      handleTriggerNew();
    }
  }

  /** Desktop activation, from the portal or the entry that started this launch. */
  function handleGlobalShortcutEvent(event: Event) {
    const detail = (event as CustomEvent<{ id?: string }>).detail;
    if (!detail?.id) return;
    if (isOverlayActive || isOverlayInstance || countdown !== null) return;

    runCaptureAction(detail.id);
  }

  function handleGlobalKeyDown(e: KeyboardEvent) {
    if (countdown !== null && e.key === 'Escape') {
      e.preventDefault();
      handleCancelCountdown();
      return;
    }

    if (view === 'settings') return;

    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable)) {
      return;
    }

    // Check customizable shortcuts
    const overlayShortcut = shortcuts.find((s) => s.id === 'overlay');
    if (overlayShortcut && matchesShortcut(e, overlayShortcut.keys)) {
      e.preventDefault();
      runCaptureAction('overlay');
      return;
    }

    const recordShortcut = shortcuts.find((s) => s.id === 'record');
    if (recordShortcut && matchesShortcut(e, recordShortcut.keys)) {
      e.preventDefault();
      runCaptureAction('record');
      return;
    }

    const fullscreenShortcut = shortcuts.find((s) => s.id === 'fullscreen');
    if (fullscreenShortcut && matchesShortcut(e, fullscreenShortcut.keys)) {
      e.preventDefault();
      runCaptureAction('fullscreen');
      return;
    }

    const newCaptureShortcut = shortcuts.find((s) => s.id === 'newCapture');
    if (newCaptureShortcut && matchesShortcut(e, newCaptureShortcut.keys)) {
      e.preventDefault();
      runCaptureAction('newCapture');
      return;
    }

    const modifier = e.ctrlKey || e.metaKey;
    const hasImageTab = view === 'editor' && tabs.length > 0;

    // Ctrl + Plus / Ctrl + Minus: step the canvas zoom
    if (hasImageTab && modifier && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      zoom = clampZoom(zoomIn(zoom));
      return;
    }

    if (hasImageTab && modifier && (e.key === '-' || e.key === '_')) {
      e.preventDefault();
      zoom = clampZoom(zoomOut(zoom));
      return;
    }

    // Ctrl + 0: view actual size (100%)
    if (hasImageTab && modifier && e.key === '0') {
      e.preventDefault();
      zoom = 100;
      return;
    }

    // Ctrl + 1: fit the capture to the viewport
    if (hasImageTab && modifier && e.key === '1') {
      e.preventDefault();
      canvasArea?.fitToViewport();
      return;
    }

    // Phase 9: Ctrl+Z / Ctrl+Y walk the reversible edit history.
    if (hasImageTab && modifier && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      handleUndo();
      return;
    }

    if (hasImageTab && modifier && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      handleRedo();
      return;
    }

    // Ctrl + C: copy the flattened composite bitmap
    if (hasImageTab && modifier && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      void copyComposite();
      return;
    }

    // Ctrl+O: Open image file
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      handleOpenFile();
      return;
    }

    // Ctrl+R: toggle the crown (ruler) overlay. Scan Text is Phase 21 and
    // not built yet, so the dual binding always resolves to the ruler.
    if (hasImageTab && modifier && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      draftingTool = draftingTool === 'ruler' ? 'off' : 'ruler';
      announce(draftingTool === 'ruler' ? 'Ruler shown' : 'Ruler hidden');
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

    // Alt keytips (behavioral Surface A): badges show while Alt is held;
    // Alt+1..4 / Alt+letter shortcuts dispatch here.
    if (e.altKey && !modifier && !e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === '1' || key === 'n') { e.preventDefault(); handleTriggerNew(); return; }
      if (key === 't') { e.preventDefault(); touchWritingEnabled = !touchWritingEnabled; return; }
      if (!hasImageTab) { /* editor tools have no target without an image */ }
      else if (key === 'b') { e.preventDefault(); activeTool = 'pen'; emojiGlyph = null; isCropping = false; return; }
      else if (key === 'h') { e.preventDefault(); activeTool = 'highlighter'; emojiGlyph = null; isCropping = false; return; }
      else if (key === 'e') { e.preventDefault(); activeTool = 'eraser'; emojiGlyph = null; isCropping = false; return; }
      if (key === 'i') {
        e.preventDefault();
        if (hasImageTab) {
          isCropping = !isCropping;
          if (isCropping) { activeTool = 'select'; emojiGlyph = null; }
        }
        return;
      }
      if (key === 's') { e.preventDefault(); handleSave(); return; }
      if (key === 'z') { e.preventDefault(); openFlyout('zoom'); return; }
      if (key === '2') { e.preventDefault(); openFlyout('snipType'); return; }
      if (key === '3' || key === 'd') { e.preventDefault(); openFlyout('delay'); return; }
      if (key === '4' || key === 'm') { e.preventDefault(); openFlyout(key === 'm' && !hasImageTab ? 'snip' : 'more'); return; }
      if (key === 'a' || key === 'o') { e.preventDefault(); openFlyout('snipType'); return; }
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeyDown} />

{#if isOverlayInstance}
  <!-- Dedicated Fullscreen Capture Overlay Window -->
  <div class="h-screen w-screen bg-transparent overflow-hidden select-none">
    <FloatingOverlay
      active={isOverlayReady}
      visible={overlaySized}
      mode={overlayMode}
      snipType={overlaySnipType}
      delay={overlayDelay}
      frameBitmap={overlayFrameBitmap}
      desktopCapture={overlayCapture}
      onClose={handleOverlayClose}
      onCapture={handleOverlayCapture}
      onModeChange={handleOverlayModeChange}
      onSnipTypeChange={handleOverlaySnipTypeChange}
      onDelayChange={handleOverlayDelayChange}
      onScreenDraw={() => { activeTool = 'pen'; }}
      onTextActions={() => { activeTool = 'text'; }}
      onColorPicker={() => {}}
    />
  </div>
{:else}
  <!-- Outer application shell with dynamic light/dark class -->
  <div class="{theme} h-screen w-screen flex flex-col font-segoe select-none overflow-hidden transition-colors duration-150">
    <div class="h-full w-full flex flex-col bg-[#f3f4f6] dark:bg-[#0d0f14] text-neutral-800 dark:text-neutral-100">
      <!-- 1. Window TitleBar with Draggable Region & Window Controls -->
      <TitleBar
        {tabs}
        {activeTabId}
        {theme}
        onRequestClose={requestWindowClose}
        onSelectTab={(id) => { activeTabId = id; hasUnsavedEdits = false; view = 'editor'; }}
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
        {shapeOutlineColor}
        {shapeFillColor}
        {shapeStrokeWidth}
        {emojiGlyph}
        onShapeOutlineChange={(c) => shapeOutlineColor = c}
        onShapeFillChange={(c) => shapeFillColor = c}
        onShapeWidthChange={(w) => shapeStrokeWidth = clampShapeWidth(w)}
        onEmojiSelect={(glyph) => emojiGlyph = glyph}
        {zoom}
        hasImage={view === 'editor' && tabs.length > 0}
        {touchWritingEnabled}
        {canUndo}
        {canRedo}
        {undoLabel}
        {redoLabel}
        onUndo={handleUndo}
        onRedo={handleRedo}
        {isCropping}
        onTouchWritingChange={(enabled) => {
          touchWritingEnabled = enabled;
          try { localStorage.setItem('sniplex_touch_writing', enabled ? '1' : '0'); } catch {}
          announce(enabled ? 'Touch writing on — one finger draws' : 'Touch writing off — one finger pans');
        }}
        onTriggerNew={handleTriggerNew}
        onTriggerOcr={handleTriggerOcr}
        onModeChange={handleModeChange}
        onSnipTypeChange={handleSnipTypeChange}
        onDelayChange={handleDelayChange}
        onToolChange={(t) => {
          activeTool = t;
          if (t !== 'shapes') emojiGlyph = null;
          if (t !== 'select') isCropping = false;
        }}
        onPenColorChange={(c) => penColor = c}
        onPenSizeChange={(s) => penSize = s}
        onHighlighterColorChange={(c) => highlighterColor = c}
        onHighlighterSizeChange={(s) => highlighterSize = clampHighlighterSize(s)}
        onShapeKindChange={(s) => { shapeKind = s; emojiGlyph = null; }}
        onZoomCommand={handleZoomCommand}
        onZoomChange={(z) => zoom = clampZoom(z)}
        onSave={handleSave}
        onCopy={() => { void copyComposite(); }}
        onShare={handleShare}
        draftingTool={draftingTool}
        onDraftingChange={(tool) => {
          draftingTool = tool;
          announce(tool === 'off' ? 'Ruler hidden' : 'Ruler shown');
        }}
        onOpenSettings={() => view = 'settings'}
        onOpenFile={handleOpenFile}
        onOpenScreenshotsFolder={handleOpenScreenshotsFolder}
        {openFlyoutSignal}
        onPrint={handlePrint}
        onToggleCrop={() => {
          isCropping = !isCropping;
          if (isCropping) {
            activeTool = 'select';
            emojiGlyph = null;
          }
        }}
        onClearAll={handleEraseAllInk}
      />

      <!-- 2b. Contextual secondary sub-toolbar. A fixed-height slot reserves
           the toolbar's row whether or not a tool needs options, so the
           canvas below never shifts down (and is never overlapped). -->
      {#if view === 'editor' && tabs.length > 0}
        <div class="h-10 shrink-0">
      <SecondaryToolbar
        {activeTool}
        {isCropping}
        hasImage={view === 'editor' && tabs.length > 0}
        {shapeKind}
        {shapeFillColor}
        {shapeFillOpacity}
        {shapeOutlineColor}
        {shapeOutlineOpacity}
        {shapeStrokeWidth}
        {emojiGlyph}
        onShapeKindChange={(s) => { shapeKind = s; emojiGlyph = null; }}
        onFillColorChange={(c) => shapeFillColor = c}
        onFillOpacityChange={(o) => shapeFillOpacity = o}
        onOutlineColorChange={(c) => shapeOutlineColor = c}
        onOutlineOpacityChange={(o) => shapeOutlineOpacity = o}
        onStrokeWidthChange={(w) => shapeStrokeWidth = clampShapeWidth(w)}
        onEmojiSelect={(g) => {
          emojiGlyph = null;
          if (g) canvasArea?.stampEmoji(g);
        }}
        {textFontFamily}
        {textFontSize}
        {textBold}
        {textItalic}
        {textUnderline}
        {textColor}
        {textHighlight}
        {textAlign}
        onTextFontFamilyChange={(f) => textFontFamily = f}
        onTextFontSizeChange={(s) => textFontSize = clampTextSize(s)}
        onTextBoldChange={(b) => textBold = b}
        onTextItalicChange={(i) => textItalic = i}
        onTextUnderlineChange={(u) => textUnderline = u}
        onTextColorChange={(c) => textColor = c}
        onTextHighlightChange={(h) => textHighlight = h}
        onTextAlignChange={(a) => textAlign = a}
        onApplyCrop={() => canvasArea?.commitCrop()}
            onCancelCrop={() => canvasArea?.cancelCrop()}
      />
        </div>
      {/if}

      <!-- 3. Main Body View (Canvas, Empty, or Settings) -->
      {#if view === 'settings'}
        <SettingsModal
          onClose={() => view = tabs.length > 0 ? 'editor' : 'empty'}
          onShortcutsChange={handleShortcutsChange}
        />
      {:else if view === 'empty' || tabs.length === 0}
        <EmptyState />
      {:else}
        <CanvasArea
          bind:this={canvasArea}
          imageUrl={activeTab?.imageUrl || ''}
          width={activeTab?.width || 960}
          height={activeTab?.height || 540}
          {zoom}
          {activeTool}
          {penColor}
          {penSize}
          {highlighterColor}
          {highlighterSize}
          {shapeKind}
          {shapeOutlineColor}
          {shapeFillColor}
          {shapeStrokeWidth}
          {shapeOutlineOpacity}
          {shapeFillOpacity}
          {emojiGlyph}
          {textFontFamily}
          {textFontSize}
          {textBold}
          {textItalic}
          {textUnderline}
          {textColor}
          {textHighlight}
          {textAlign}
          draftingTool={draftingTool}
          {touchWritingEnabled}
          {isCropping}
          onApplyCrop={() => isCropping = false}
          onCancelCrop={() => isCropping = false}
          onZoomChange={handleCanvasZoom}
          onImageReady={handleCanvasImageReady}
          onCanvasMutated={handleCanvasMutated}
          onHistoryPush={handleHistoryPush}
          onHistoryBoundary={handleHistoryBoundary}
          onHistoryAmend={handleHistoryAmend}
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

      <!-- Non-Tauri fallback FloatingOverlay -->
      {#if !isTauriEnvironment() && isOverlayActive}
        <FloatingOverlay
          active={isOverlayActive}
          {mode}
          {snipType}
          {delay}
          {desktopCapture}
          onClose={handleCloseOverlay}
          onCapture={handleCapture}
          onModeChange={(m) => (mode = m)}
          onSnipTypeChange={(t) => (snipType = t)}
          onDelayChange={(d) => (delay = d)}
          onScreenDraw={() => {
            activeTool = 'pen';
          }}
          onTextActions={() => {
            activeTool = 'text';
          }}
          onColorPicker={() => {}}
        />
      {/if}

      <!-- Phase 16: Save As dialog (PNG / JPG / GIF for captures) -->
      {#if saveDialogOpen && activeTab}
        <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Save as" tabindex="-1" onpointerdown={(e) => { if (e.target === e.currentTarget) saveDialogOpen = false; }}>
          <div class="w-80 rounded-xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#181d28]">
            <h2 class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Save as</h2>
            <div class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{activeTab.title} · {activeTab.width}×{activeTab.height}</div>
            <div class="mt-3 grid grid-cols-3 gap-1.5" role="group" aria-label="Save format">
              {#each saveFormatsForImage() as fmt}
                <button
                  type="button"
                  aria-pressed={saveFormat === fmt}
                  class="rounded-md border px-2 py-1.5 text-xs font-medium uppercase transition-colors {saveFormat === fmt ? 'border-[#0067c0] bg-[#0067c0] text-white' : 'border-black/10 text-neutral-700 hover:bg-black/5 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/10'}"
                  onclick={() => saveFormat = fmt}
                >
                  {fmt}
                </button>
              {/each}
            </div>
            <div class="mt-4 flex justify-end gap-2">
              <button type="button" class="rounded-md px-3 py-1.5 text-xs text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10" onclick={() => saveDialogOpen = false}>Cancel</button>
              <button type="button" class="rounded-md bg-[#0067c0] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1070c7]" onclick={confirmSave}>Save</button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Unsaved changes confirmation (Surface G) -->
      {#if unsavedDialogOpen}
        <div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-label="Do you want to save changes?" tabindex="-1" onpointerdown={(e) => { if (e.target === e.currentTarget) resolveUnsaved('cancel'); }}>
          <div class="w-80 rounded-xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#181d28]">
            <h2 class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Do you want to save changes?</h2>
            <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Your edits to this capture have not been saved yet.</p>
            <div class="mt-4 flex justify-end gap-2">
              <button type="button" class="rounded-md px-3 py-1.5 text-xs text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10" onclick={() => resolveUnsaved('cancel')}>Cancel</button>
              <button type="button" class="rounded-md px-3 py-1.5 text-xs text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10" onclick={() => resolveUnsaved('dont')}>Don't save</button>
              <button type="button" class="rounded-md bg-[#0067c0] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1070c7]" onclick={() => resolveUnsaved('save')}>Save</button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Clipboard confirmation toast -->
      {#if copyToast}
        <div
          class="fixed bottom-9 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3.5 py-2 bg-white/95 dark:bg-[#181d28]/95 border border-black/10 dark:border-white/10 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.3)] backdrop-blur-md text-xs font-medium text-neutral-800 dark:text-neutral-100 select-none pointer-events-none animate-in fade-in zoom-in-95 duration-150"
          aria-hidden="true"
        >
          {#if copyToast.ok}
            <span class="w-4 h-4 rounded-full flex items-center justify-center bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Check class="w-3 h-3 stroke-[2.6]" />
            </span>
          {:else}
            <span class="w-4 h-4 rounded-full flex items-center justify-center bg-rose-500/15 text-rose-600 dark:text-rose-400">
              <AlertCircle class="w-3 h-3 stroke-[2.2]" />
            </span>
          {/if}
          <span>{copyToast.message}</span>
        </div>
      {/if}

      <!-- Accessible live region for clipboard announcements -->
      <div class="sr-only" role="status" aria-live="polite">{copyAnnouncement}</div>

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
{/if}
