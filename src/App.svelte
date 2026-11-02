<script lang="ts">
  import { tick, onMount } from 'svelte';
  import TitleBar from './lib/components/TitleBar.svelte';
  import CommandBar from './lib/components/CommandBar.svelte';
  import CanvasArea from './lib/components/CanvasArea.svelte';
  import EmptyState from './lib/components/EmptyState.svelte';
  import FloatingOverlay from './lib/components/FloatingOverlay.svelte';
  import SettingsModal from './lib/components/SettingsModal.svelte';
  import { AlertCircle, Check, Timer } from '@lucide/svelte';
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
    WindowRect,
    ZoomCommand,
    CanvasAreaApi,
  } from './lib/types';
  import { captureDesktopDisplay, restoreDesktopWindow, isTauriEnvironment } from './lib/capture';
  import { initTiming, mark } from './lib/timing';
  import { playTimerChime } from './lib/audio';
  import { clampZoom, zoomIn, zoomOut } from './lib/viewport';
  import { copyImageToClipboard } from './lib/clipboard';

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

  let activeTool = $state<ToolType>('pen');
  let penColor = $state('#0078d4');
  let penSize = $state(3);
  let highlighterColor = $state('#ffeb3b');
  let highlighterSize = $state(18);
  let shapeKind = $state<ShapeKind>('rectangle');
  let zoom = $state(100);
  let isCropping = $state(false);

  // Canvas viewport handoff for zoom, fit, and composited exports.
  let canvasArea = $state<CanvasAreaApi | null>(null);

  // Clipboard synchronization state.
  let autoCopy = $state<boolean>(loadAutoCopySetting());
  let pendingAutoCopy = false;
  let isCopying = false;

  let copyToast = $state<{ message: string; ok: boolean } | null>(null);
  let copyToastTimer: number | null = null;
  let copyAnnouncement = $state('');
  let announceTimer: number | null = null;
  let autoCopyTimer: number | null = null;
  let autoCopyTabId = '';

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
        view = 'editor';
        input.value = '';
        await tick();
        canvasArea?.fitToViewport();
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

  function loadAutoCopySetting(): boolean {
    if (typeof localStorage === 'undefined') return true;
    const stored = localStorage.getItem('sniplex_auto_copy');
    return stored === null ? true : stored === 'true';
  }

  function handleAutoCopyChange(value: boolean) {
    autoCopy = value;
    try {
      localStorage.setItem('sniplex_auto_copy', String(value));
    } catch {}
  }

  function announceCopy(message: string) {
    copyAnnouncement = '';
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      copyAnnouncement = message;
      announceTimer = null;
    }, 60);
  }

  function showCopyToast(ok: boolean) {
    copyToast = { message: ok ? 'Copied to clipboard' : 'Copy failed', ok };
    if (copyToastTimer) clearTimeout(copyToastTimer);
    copyToastTimer = window.setTimeout(() => {
      copyToast = null;
      copyToastTimer = null;
    }, 2200);
  }

  /** Copies the flattened composite bitmap from the editor canvas. */
  async function copyComposite(): Promise<boolean> {
    if (!activeTab || !canvasArea || isCopying) return false;

    isCopying = true;
    try {
      const blob = await canvasArea.exportPngBlob();
      if (!blob) {
        announceCopy('Could not copy image to clipboard');
        showCopyToast(false);
        return false;
      }

      const result = await copyImageToClipboard(blob);
      if (result.ok) {
        announceCopy('Composite image copied to clipboard');
        showCopyToast(true);
        return true;
      }

      console.warn('Clipboard copy error:', result.error);
      announceCopy('Could not copy image to clipboard');
      showCopyToast(false);
      return false;
    } finally {
      isCopying = false;
    }
  }

  function handleCanvasImageReady() {
    if (!pendingAutoCopy) return;
    pendingAutoCopy = false;
    if (autoCopy) void copyComposite();
  }

  function handleCanvasMutated() {
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
  let wasWindowMaximized = $state(true);
  let countdown = $state<number | null>(null);
  let countdownTimer: number | null = null;

  // Dedicated overlay instance states
  const isOverlayInstance = typeof window !== 'undefined' && window.location.hash === '#overlay';
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
      if (key === '+' || key === '=' || key === '-' || key === '_' || key === '0') {
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
      await invoke('complete_capture', { payload });
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
        await getCurrentWindow().hide();
        mark('main.hidden');

        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('start_capture_session', {
          mode,
          snipType,
          delay,
        });
        mark('main.command_done');
      } else {
        const res = await captureDesktopDisplay();
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
    pendingAutoCopy = imageUrl.length > 0;

    await tick();
    canvasArea?.fitToViewport();
  }

  function handleTriggerOcr() {
    activeTool = 'text';
    handleTriggerNew();
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
      captureDesktopDisplay().then((res) => {
        wasWindowMaximized = res.wasMaximized;
        handleCapture({
          imageUrl: res.capture.image_data_url,
          width: res.capture.width,
          height: res.capture.height,
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

    // Ctrl + 0: fit the capture to the viewport
    if (hasImageTab && modifier && e.key === '0') {
      e.preventDefault();
      canvasArea?.fitToViewport();
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
      onScreenDraw={() => {}}
      onTextActions={() => {}}
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
        onModeChange={handleModeChange}
        onSnipTypeChange={handleSnipTypeChange}
        onDelayChange={handleDelayChange}
        onToolChange={(t) => activeTool = t}
        onPenColorChange={(c) => penColor = c}
        onPenSizeChange={(s) => penSize = s}
        onHighlighterColorChange={(c) => highlighterColor = c}
        onHighlighterSizeChange={(s) => highlighterSize = s}
        onShapeKindChange={(s) => shapeKind = s}
        onZoomCommand={handleZoomCommand}
        onZoomChange={(z) => zoom = clampZoom(z)}
        onSave={handleSave}
        onCopy={() => { void copyComposite(); }}
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
          {autoCopy}
          onAutoCopyChange={handleAutoCopyChange}
          onClose={() => view = tabs.length > 0 ? 'editor' : 'empty'}
          onThemeChange={(t) => theme = t}
          onShortcutsChange={(s) => shortcuts = s}
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
          {isCropping}
          onApplyCrop={() => isCropping = false}
          onCancelCrop={() => isCropping = false}
          onZoomChange={handleCanvasZoom}
          onImageReady={handleCanvasImageReady}
          onCanvasMutated={handleCanvasMutated}
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
          onColorPicker={(color) => {
            if (color) penColor = color;
          }}
        />
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
