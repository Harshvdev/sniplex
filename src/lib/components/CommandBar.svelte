<script lang="ts">
  import {
    Camera,
    Video,
    Plus,
    ChevronDown,
    Pen,
    Highlighter,
    Eraser,
    Ruler,
    Hand,
    Crop,
    Type,
    ScanText,
    Shapes,
    Undo2,
    Redo2,
    Save,
    Copy,
    Share2,
    MoreHorizontal,
    Check,
    Settings,
    FolderOpen,
    Printer,
    Info,
    Timer,
    TimerOff,
  } from '@lucide/svelte';
  import SnipIcons from '../icons/SnipIcons.svelte';
  import PenFlyout from './PenFlyout.svelte';
  import HighlighterFlyout from './HighlighterFlyout.svelte';
  import type { CaptureMode, SnipType, SnipDelay, ToolType, ShapeKind, ZoomCommand } from '../types';

  let {
    mode = 'snip',
    snipType = 'rectangle',
    delay = 0,
    activeTool = 'pen',
    penColor = '#0078d4',
    penSize = 3,
    highlighterColor = '#ffeb3b',
    highlighterSize = 18,
    shapeKind = 'rectangle',
    zoom = 100,
    hasImage = true,
    touchWritingEnabled = false,
    canUndo = false,
    canRedo = false,
    undoLabel = null,
    redoLabel = null,
    isCropping = false,
    onTriggerNew = () => {},
    onModeChange = (m: CaptureMode) => {},
    onSnipTypeChange = (t: SnipType) => {},
    onDelayChange = (d: SnipDelay) => {},
    onToolChange = (t: ToolType) => {},
    onPenColorChange = (c: string) => {},
    onPenSizeChange = (s: number) => {},
    onHighlighterColorChange = (c: string) => {},
    onHighlighterSizeChange = (s: number) => {},
    onShapeKindChange = (s: ShapeKind) => {},
    /** Phase 13: selected shape outline/fill style. */
    shapeOutlineColor = '#d13438',
    shapeFillColor = 'transparent',
    shapeStrokeWidth = 3,
    onShapeOutlineChange = (c: string) => {},
    onShapeFillChange = (c: string) => {},
    onShapeWidthChange = (w: number) => {},
    /** Phase 13: armed emoji stamp glyph. */
    emojiGlyph = null,
    onEmojiSelect = (_glyph: string | null) => {},
    onZoomCommand = (command: ZoomCommand) => {},
    onZoomChange = (value: number) => {},
    onTouchWritingChange = (enabled: boolean) => {},
    onSave = () => {},
    onCopy = () => {},
    onUndo = () => {},
    onRedo = () => {},
    /** Phase 17: external handoffs. */
    onShare = () => {},
    /** Phase 18: drafting overlay selection. */
    draftingTool = 'off',
    onDraftingChange = (_tool: 'off' | 'ruler') => {},
    onOpenSettings = () => {},
    onOpenFile = () => {},
    onOpenScreenshotsFolder = () => {},
    /** Alt-key menu opener signal from the shell. */
    openFlyoutSignal = null,
    onToggleCrop = () => {},
    onClearAll = () => {},
    onTriggerOcr = () => {},
    onPrint = () => {},
  }: {
    mode: CaptureMode;
    snipType: SnipType;
    delay: SnipDelay;
    activeTool: ToolType;
    penColor: string;
    penSize: number;
    highlighterColor: string;
    highlighterSize: number;
    shapeKind: ShapeKind;
    zoom: number;
    hasImage: boolean;
    /** Phase 8 toggle, independent of the selected markup tool. */
    touchWritingEnabled: boolean;
    /** Phase 9: history availability, reflected in button state. */
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
    isCropping: boolean;
    onTriggerNew: () => void;
    onModeChange: (m: CaptureMode) => void;
    onSnipTypeChange: (t: SnipType) => void;
    onDelayChange: (d: SnipDelay) => void;
    onToolChange: (t: ToolType) => void;
    onPenColorChange: (c: string) => void;
    onPenSizeChange: (s: number) => void;
    onHighlighterColorChange: (c: string) => void;
    onHighlighterSizeChange: (s: number) => void;
    onShapeKindChange: (s: ShapeKind) => void;
    /** Phase 13: selected shape outline/fill style. */
    shapeOutlineColor: string;
    shapeFillColor: string;
    shapeStrokeWidth: number;
    onShapeOutlineChange: (c: string) => void;
    onShapeFillChange: (c: string) => void;
    onShapeWidthChange: (w: number) => void;
    /** Phase 13: armed emoji stamp glyph. */
    emojiGlyph: string | null;
    onEmojiSelect: (glyph: string | null) => void;
    onZoomCommand: (command: ZoomCommand) => void;
    onZoomChange: (value: number) => void;
    onTouchWritingChange: (enabled: boolean) => void;
    onSave: () => void;
    onCopy: () => void;
    onUndo: () => void;
    onRedo: () => void;
    /** Phase 17: external handoffs. */
    onShare: () => void;
    /** Phase 18: drafting overlay selection. */
    draftingTool: 'off' | 'ruler';
    onDraftingChange: (tool: 'off' | 'ruler') => void;
    onOpenSettings: () => void;
    onOpenFile: () => void;
    onOpenScreenshotsFolder: () => void;
    openFlyoutSignal: { name: string; nonce: number } | null;
    onToggleCrop: () => void;
    onClearAll: () => void;
    onTriggerOcr?: () => void;
    onPrint?: () => void;
  } = $props();

  // Active popovers
  let activeFlyout = $state<string | null>(null);
  let showCopiedToast = $state(false);
  // Alt-key keytip badges (behavioral Surface A).
  let showAltHints = $state(false);

  function toggleFlyout(name: string) {
    activeFlyout = activeFlyout === name ? null : name;
  }
  // Shell-driven Alt-key menu openers.
  let lastSignalNonce = $state(0);
  $effect(() => {
    const s = openFlyoutSignal;
    if (s && s.nonce !== lastSignalNonce) {
      lastSignalNonce = s.nonce;
      activeFlyout = s.name;
    }
  });

  function handleWindowPointerDown(e: PointerEvent) {
    if (!activeFlyout) return;
    const target = e.target as Element | null;
    if (target?.closest?.('.flyout-container')) {
      return;
    }
    activeFlyout = null;
  }

  function handleCopy() {
    onCopy();
    showCopiedToast = true;
    setTimeout(() => {
      showCopiedToast = false;
    }, 2000);
  }

  const delayOptions: { id: SnipDelay; label: string }[] = [
    { id: 0, label: 'No delay' },
    { id: 3, label: '3-second delay' },
    { id: 5, label: '5-second delay' },
    { id: 10, label: '10-second delay' },
  ];

  const snipTypes: { id: SnipType; label: string }[] = [
    { id: 'rectangle', label: 'Rectangle' },
    { id: 'window', label: 'Window' },
    { id: 'fullscreen', label: 'Full screen' },
    { id: 'freeform', label: 'Freeform' },
  ];

  const zoomPresets = [10, 25, 50, 100, 200, 400, 800, 1600, 3200];

  const zoomCommands: { id: ZoomCommand; label: string; hint: string }[] = [
    { id: 'fit', label: 'Fit to window', hint: 'Ctrl + 1' },
    { id: 'actual', label: 'View actual size (100%)', hint: 'Ctrl + 0' },
  ];
</script>

<svelte:window
  onpointerdown={handleWindowPointerDown}
  onkeydown={(e) => {
    if (e.key === 'Escape' && activeFlyout) activeFlyout = null;
    if (e.key === 'Alt') showAltHints = true;
  }}
  onkeyup={(e) => {
    if (e.key === 'Alt') showAltHints = false;
  }}
/>

<div class="h-12 border-b border-black/[0.06] dark:border-white/[0.07] bg-[#f9fafb] dark:bg-[#161b26] flex items-center justify-between px-3 text-neutral-800 dark:text-neutral-200 select-none relative z-30 transition-colors duration-150">
  <!-- LEFT: Trigger & Modes -->
  <div class="flex items-center gap-2">
    <!-- 1. "+ New" Button -->
    <button
      type="button"
      class="h-8 flex items-center justify-center gap-1.5 px-3 bg-[#0067c0] hover:bg-[#1070c7] active:bg-[#005fb8] text-white text-xs font-medium rounded-[6px] shadow-sm transition-colors relative"
      onclick={onTriggerNew}
      title="New snip (Print Screen or Ctrl+N)"
    >
      <Plus class="w-3.5 h-3.5 stroke-[2.2]" />
      <span>New</span>
      {#if showAltHints}<span class="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-[#0067c0] px-1 text-[8px] font-bold text-white shadow">1</span>{/if}
    </button>

    <!-- 2. Camera / Video Segmented Pill (Matching Reference) -->
    <div class="flex items-center h-8 bg-black/[0.04] dark:bg-white/[0.06] rounded-[6px] p-0.5 border border-black/[0.05] dark:border-white/[0.05]">
      <button
        type="button"
        class="relative h-full flex items-center justify-center px-2.5 rounded-[4px] text-xs font-medium transition-colors {mode === 'snip' ? 'bg-white dark:bg-[#222a3b] text-neutral-900 dark:text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}"
        onclick={() => onModeChange('snip')}
        title="Snip mode"
      >
        <Camera class="w-3.5 h-3.5" />
        {#if mode === 'snip'}
          <div class="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3.5 h-[2px] rounded-full bg-[#0067c0] dark:bg-[#60cdff]"></div>
        {/if}
      </button>

      <button
        type="button"
        class="relative h-full flex items-center justify-center px-2.5 rounded-[4px] text-xs font-medium transition-colors {mode === 'record' ? 'bg-white dark:bg-[#222a3b] text-neutral-900 dark:text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}"
        onclick={() => onModeChange('record')}
        title="Record mode"
      >
        <Video class="w-3.5 h-3.5" />
        {#if mode === 'record'}
          <div class="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3.5 h-[2px] rounded-full bg-[#0067c0] dark:bg-[#60cdff]"></div>
        {/if}
      </button>
    </div>

    <!-- 3. Snip Mode Dropdown Button (Rectangle v) -->
    <div class="relative flyout-container">
      <button
        type="button"
        class="h-8 flex items-center gap-1 px-2 rounded-[6px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] border border-transparent hover:border-black/[0.05] dark:hover:border-white/[0.05] transition-colors text-xs text-neutral-700 dark:text-neutral-300"
        onclick={() => toggleFlyout('snipType')}
        title="Snip mode"
      >
        <SnipIcons type={snipType} className="w-4 h-4 text-neutral-700 dark:text-neutral-300" />
        {#if showAltHints}<span class="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-[#0067c0] px-1 text-[8px] font-bold text-white shadow">2</span>{/if}
        <ChevronDown class="w-3 h-3 text-neutral-500 stroke-[1.8]" />
      </button>

      {#if activeFlyout === 'snipType'}
        <div class="absolute top-full mt-1.5 left-0 z-50 min-w-[150px] bg-white dark:bg-[#181d28] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_12px_32px_rgba(0,0,0,0.45)] py-1 flex flex-col">
          {#each snipTypes as st}
            <button
              type="button"
              class="relative flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors text-neutral-800 dark:text-neutral-200"
              onclick={() => { onSnipTypeChange(st.id); activeFlyout = null; }}
            >
              {#if snipType === st.id}
                <div class="absolute left-1 w-[2.5px] h-3.5 rounded-full bg-[#0067c0] dark:bg-[#60cdff]"></div>
              {/if}
              <div class="w-4 h-4 flex items-center justify-center ml-0.5 text-neutral-700 dark:text-neutral-300">
                <SnipIcons type={st.id} className="w-3.5 h-3.5" />
              </div>
              <span>{st.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- 4. Timer Option (On the right of rectangle button) -->
    <div class="relative flyout-container">
      <button
        type="button"
        class="h-8 flex items-center gap-1 px-2 rounded-[6px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] border border-transparent hover:border-black/[0.05] dark:hover:border-white/[0.05] transition-colors text-xs text-neutral-700 dark:text-neutral-300"
        onclick={() => toggleFlyout('delay')}
        title={delay === 0 ? 'Snip delay (No delay)' : `Snip delay (${delay}-second delay)`}
        style="position:relative"
      >
        {#if showAltHints}<span class="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-[#0067c0] px-1 text-[8px] font-bold text-white shadow">3</span>{/if}
        {#if delay === 0}
          <TimerOff class="w-4 h-4 text-neutral-700 dark:text-neutral-300 stroke-[1.8]" />
        {:else}
          <div class="relative flex items-center">
            <Timer class="w-4 h-4 text-[#0067c0] dark:text-[#60cdff] stroke-[1.8]" />
            <span class="absolute -bottom-1 -right-1 text-[9px] font-bold font-mono px-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-100 leading-none">{delay}</span>
          </div>
        {/if}
        <ChevronDown class="w-3 h-3 text-neutral-500 stroke-[1.8]" />
      </button>

      {#if activeFlyout === 'delay'}
        <div class="absolute top-full mt-1.5 left-0 z-50 min-w-[160px] bg-white dark:bg-[#181d28] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_12px_32px_rgba(0,0,0,0.45)] py-1 flex flex-col">
          {#each delayOptions as opt}
            <button
              type="button"
              class="relative flex items-center justify-between px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors text-neutral-800 dark:text-neutral-200"
              onclick={() => { onDelayChange(opt.id); activeFlyout = null; }}
            >
              <span>{opt.label}</span>
              {#if delay === opt.id}
                <Check class="w-3.5 h-3.5 text-[#0067c0] dark:text-[#60cdff]" />
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- 5. OCR Text Actions Icon (Next to Timer on Homescreen) -->
    <button
      type="button"
      class="h-8 flex items-center justify-center px-2 rounded-[6px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] border border-transparent hover:border-black/[0.05] dark:hover:border-white/[0.05] transition-colors text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer"
      onclick={onTriggerOcr}
      title="Text actions / OCR (Super+Shift+T)"
    >
      <ScanText class="w-4 h-4 text-neutral-700 dark:text-neutral-300 stroke-[1.8]" />
    </button>
  </div>

  <!-- CENTER: Annotation & Editing Markup Tools -->
  {#if hasImage}
    <div class="flex items-center gap-1">
      <div class="w-[1px] h-5 bg-black/[0.08] dark:bg-white/[0.08] mx-1"></div>

      <!-- Pen Tool -->
      <div class="relative flyout-container">
        <button
          type="button"
          class="flex items-center gap-1 px-2 py-1.5 rounded-[6px] transition-colors {activeTool === 'pen' ? 'bg-black/[0.08] dark:bg-white/[0.12] text-neutral-900 dark:text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'}"
          onclick={() => {
            if (activeTool === 'pen') toggleFlyout('pen');
            else { onToolChange('pen'); activeFlyout = null; }
          }}
          title="Ballpoint pen"
        >
          <Pen class="w-4 h-4 stroke-[1.8]" />
          {#if showAltHints}<span class="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-[#0067c0] px-1 text-[8px] font-bold text-white shadow">B</span>{/if}
          <div class="w-2.5 h-2.5 rounded-full border border-black/20" style="background-color: {penColor};"></div>
          <ChevronDown class="w-3 h-3 text-neutral-500" />
        </button>

        {#if activeFlyout === 'pen'}
          <div class="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 z-50">
            <PenFlyout
              color={penColor}
              size={penSize}
              onColorChange={(c) => { onPenColorChange(c); }}
              onSizeChange={(s) => { onPenSizeChange(s); }}
            />
          </div>
        {/if}
      </div>

      <!-- Highlighter Tool -->
      <div class="relative flyout-container">
        <button
          type="button"
          class="flex items-center gap-1 px-2 py-1.5 rounded-[6px] transition-colors {activeTool === 'highlighter' ? 'bg-black/[0.08] dark:bg-white/[0.12] text-neutral-900 dark:text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'}"
          onclick={() => {
            if (activeTool === 'highlighter') toggleFlyout('highlighter');
            else { onToolChange('highlighter'); activeFlyout = null; }
          }}
          title="Highlighter"
        >
          <Highlighter class="w-4 h-4 stroke-[1.8]" />
          {#if showAltHints}<span class="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-[#0067c0] px-1 text-[8px] font-bold text-white shadow">H</span>{/if}
          <div class="w-3 h-1.5 rounded-sm" style="background-color: {highlighterColor};"></div>
          <ChevronDown class="w-3 h-3 text-neutral-500" />
        </button>

        {#if activeFlyout === 'highlighter'}
          <div class="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 z-50">
            <HighlighterFlyout
              color={highlighterColor}
              size={highlighterSize}
              onColorChange={(c) => { onHighlighterColorChange(c); }}
              onSizeChange={(s) => { onHighlighterSizeChange(s); }}
            />
          </div>
        {/if}
      </div>

      <!-- Eraser Tool -->
      <div class="relative flyout-container">
        <button
          type="button"
          class="flex items-center gap-1 px-2 py-1.5 rounded-[6px] transition-colors {activeTool === 'eraser' ? 'bg-black/[0.08] dark:bg-white/[0.12] text-neutral-900 dark:text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'}"
          onclick={() => {
            if (activeTool === 'eraser') toggleFlyout('eraser');
            else { onToolChange('eraser'); activeFlyout = null; }
          }}
          title="Eraser"
        >
          <Eraser class="w-4 h-4 stroke-[1.8]" />
          {#if showAltHints}<span class="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-[#0067c0] px-1 text-[8px] font-bold text-white shadow">E</span>{/if}
          <ChevronDown class="w-3 h-3 text-neutral-500" />
        </button>

        {#if activeFlyout === 'eraser'}
          <div class="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 z-50 min-w-[140px] bg-white dark:bg-[#181d28] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_12px_32px_rgba(0,0,0,0.45)] py-1 flex flex-col">
            <button
              type="button"
              class="px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors text-red-600 dark:text-red-400"
              onclick={() => { onClearAll(); activeFlyout = null; }}
            >
              Erase all ink
            </button>
          </div>
        {/if}
      </div>

      <!-- Touch Writing Toggle (Phase 8): independent of the markup tool -->
      <button
        type="button"
        aria-pressed={touchWritingEnabled}
        class="w-8 h-8 rounded-[6px] flex items-center justify-center transition-colors relative {touchWritingEnabled ? 'bg-black/[0.08] dark:bg-white/[0.12] text-neutral-900 dark:text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'}"
        onclick={() => onTouchWritingChange(!touchWritingEnabled)}
        title={touchWritingEnabled ? 'Touch writing on — one finger draws' : 'Touch writing off — one finger pans'}
      >
        <Hand class="w-4 h-4 stroke-[1.8]" />
        {#if showAltHints}<span class="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-[#0067c0] px-1 text-[8px] font-bold text-white shadow">T</span>{/if}
      </button>

      <!-- Image Crop Tool -->
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] flex items-center justify-center transition-colors relative {isCropping ? 'bg-[#0067c0] text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'}"
        onclick={onToggleCrop}
        title="Crop image"
      >
        <Crop class="w-4 h-4 stroke-[1.8]" />
        {#if showAltHints}<span class="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-[#0067c0] px-1 text-[8px] font-bold text-white shadow">I</span>{/if}
      </button>

      <!-- Text Insertion Tool -->
      <button
        type="button"
        class="flex items-center gap-1 px-2 py-1.5 rounded-[6px] transition-colors {activeTool === 'text' ? 'bg-black/[0.08] dark:bg-white/[0.12] text-neutral-900 dark:text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'}"
        onclick={() => onToolChange(activeTool === 'text' ? 'select' : 'text')}
        title="Text"
      >
        <Type class="w-4 h-4 stroke-[1.8]" />
        <span class="text-xs">Text</span>
      </button>

      <!-- Shapes & Emojis Tool -->
      <div class="relative flyout-container">
        <button
          type="button"
          class="relative flex items-center gap-1 px-2 py-1.5 rounded-[6px] transition-colors {activeTool === 'shapes' ? 'bg-black/[0.08] dark:bg-white/[0.12] text-neutral-900 dark:text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'}"
          onclick={() => onToolChange(activeTool === 'shapes' ? 'select' : 'shapes')}
          title={emojiGlyph ? `Stamping ${emojiGlyph}` : 'Shapes & emojis'}
        >
          <Shapes class="w-4 h-4 stroke-[1.8]" />
          {#if showAltHints}<span class="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-[#0067c0] px-1 text-[8px] font-bold text-white shadow">S</span>{/if}
          {#if emojiGlyph}
            <span class="text-sm leading-none">{emojiGlyph}</span>
          {/if}
        </button>

      </div>

      <div class="w-[1px] h-5 bg-black/[0.08] dark:bg-white/[0.08] mx-1"></div>

      <!-- Undo / Redo (Phase 9) -->
      <button
        type="button"
        disabled={!canUndo}
        class="w-7 h-7 rounded-[5px] flex items-center justify-center transition-colors {canUndo ? 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300' : 'text-neutral-400 dark:text-neutral-600 cursor-not-allowed'}"
        title={canUndo && undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
        onclick={onUndo}
      >
        <Undo2 class="w-3.5 h-3.5 stroke-[1.8]" />
      </button>

      <button
        type="button"
        disabled={!canRedo}
        class="w-7 h-7 rounded-[5px] flex items-center justify-center transition-colors {canRedo ? 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300' : 'text-neutral-400 dark:text-neutral-600 cursor-not-allowed'}"
        title={canRedo && redoLabel ? `Redo ${redoLabel} (Ctrl+Y)` : 'Redo (Ctrl+Y)'}
        onclick={onRedo}
      >
        <Redo2 class="w-3.5 h-3.5 stroke-[1.8]" />
      </button>
    </div>
  {/if}

  <!-- RIGHT: Export, Zoom, Overflow -->
  <div class="flex items-center gap-1">
    {#if hasImage}
      <!-- Zoom Dropdown -->
      <div class="relative flyout-container">
        <button
          type="button"
          class="flex items-center gap-1 px-2 py-1 rounded-[5px] text-xs font-mono text-neutral-600 dark:text-neutral-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
          onclick={() => toggleFlyout('zoom')}
          title="Zoom level"
        >
          <span>{Math.round(zoom)}%</span>
          <ChevronDown class="w-3 h-3" />
        </button>

        {#if activeFlyout === 'zoom'}
          <div class="absolute top-full mt-1.5 right-0 z-50 w-[212px] bg-white dark:bg-[#181d28] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_12px_32px_rgba(0,0,0,0.45)] p-1.5 flex flex-col">
            <div class="grid grid-cols-3 gap-1">
              {#each zoomPresets as preset}
                <button
                  type="button"
                  class="h-7 rounded-[4px] text-[11px] font-mono transition-colors {Math.round(zoom) === preset ? 'bg-[#0067c0] text-white' : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.06]'}"
                  onclick={() => { onZoomChange(preset); activeFlyout = null; }}
                >
                  {preset}%
                </button>
              {/each}
            </div>

            <div class="mt-1.5 pt-1 border-t border-black/[0.06] dark:border-white/[0.08] flex flex-col">
              {#each zoomCommands as command}
                <button
                  type="button"
                  class="px-2 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] transition-colors flex items-center justify-between gap-4"
                  onclick={() => { onZoomCommand(command.id); activeFlyout = null; }}
                >
                  <span class="truncate">{command.label}</span>
                  {#if command.hint}
                    <kbd class="shrink-0 text-[10px] font-mono text-neutral-400 dark:text-neutral-500">{command.hint}</kbd>
                  {:else if Math.round(zoom) === 100}
                    <Check class="w-3.5 h-3.5 shrink-0 text-[#0067c0] dark:text-[#60cdff]" />
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- Save As Button -->
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] flex items-center justify-center hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300 transition-colors"
        onclick={onSave}
        title="Save as (Ctrl+S)"
      >
        <Save class="w-4 h-4 stroke-[1.8]" />
      </button>

      <!-- Copy Button -->
      <button
        type="button"
        class="relative w-8 h-8 rounded-[6px] flex items-center justify-center hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300 transition-colors"
        onclick={handleCopy}
        title="Copy to clipboard (Ctrl+C)"
      >
        <Copy class="w-4 h-4 stroke-[1.8]" />
        {#if showCopiedToast}
          <div class="absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black text-white text-[11px] px-2 py-1 rounded shadow-lg">
            Copied!
          </div>
        {/if}
      </button>

      <!-- Share Button (Phase 17) -->
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] flex items-center justify-center hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300 transition-colors"
        onclick={onShare}
        title="Share"
      >
        <Share2 class="w-4 h-4 stroke-[1.8]" />
      </button>

    {/if}

    <!-- "See More" (...) Menu -->
    <div class="relative flyout-container">
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] flex items-center justify-center hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300 transition-colors"
        onclick={() => toggleFlyout('more')}
        title="See more options"
        style="position:relative"
      >
        {#if showAltHints}<span class="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-[#0067c0] px-1 text-[8px] font-bold text-white shadow">4</span>{/if}
        <MoreHorizontal class="w-4 h-4 stroke-[1.8]" />
      </button>

      {#if activeFlyout === 'more'}
        <div class="absolute top-full mt-1.5 right-0 z-50 min-w-[160px] bg-white dark:bg-[#181d28] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_12px_32px_rgba(0,0,0,0.45)] py-1 flex flex-col text-neutral-800 dark:text-neutral-200">
          {#if hasImage}
            <button
              type="button"
              class="flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors"
              onclick={() => { onDraftingChange(draftingTool === 'ruler' ? 'off' : 'ruler'); activeFlyout = null; }}
            >
            <Ruler class="w-3.5 h-3.5 text-neutral-500" />
            <span>{draftingTool === 'ruler' ? 'Hide ruler' : 'Show ruler'}</span>
            <span class="ml-auto text-[10px] font-mono text-neutral-400">Ctrl + R</span>
            </button>
          {/if}

          <button
            type="button"
            class="flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors"
            onclick={() => { onOpenFile(); activeFlyout = null; }}
          >
            <FolderOpen class="w-3.5 h-3.5 text-neutral-500" />
            <span>Open file</span>
          </button>

          {#if hasImage}
            <button
              type="button"
              class="flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors"
              onclick={() => { onOpenScreenshotsFolder(); activeFlyout = null; }}
            >
              <FolderOpen class="w-3.5 h-3.5 text-neutral-500" />
              <span>Open screenshots folder</span>
            </button>
          {/if}

          {#if hasImage}
            <button
              type="button"
              class="flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors"
              onclick={() => { onPrint(); activeFlyout = null; }}
            >
            <Printer class="w-3.5 h-3.5 text-neutral-500" />
            <span>Print</span>
          </button>
          {/if}

          <div class="w-full h-[1px] bg-black/[0.08] dark:bg-white/[0.08] my-1"></div>

          <button
            type="button"
            class="flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors"
            onclick={() => { onOpenSettings(); activeFlyout = null; }}
          >
            <Settings class="w-3.5 h-3.5 text-neutral-500" />
            <span>Settings</span>
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

