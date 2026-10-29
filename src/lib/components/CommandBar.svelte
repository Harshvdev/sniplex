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
  } from '@lucide/svelte';
  import SnipIcons from '../icons/SnipIcons.svelte';
  import PenFlyout from './PenFlyout.svelte';
  import HighlighterFlyout from './HighlighterFlyout.svelte';
  import ShapesFlyout from './ShapesFlyout.svelte';
  import type { CaptureMode, SnipType, SnipDelay, ToolType, ShapeKind } from '../types';

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
    onZoomChange = (z: number) => {},
    onSave = () => {},
    onCopy = () => {},
    onOpenSettings = () => {},
    onOpenFile = () => {},
    onToggleCrop = () => {},
    onClearAll = () => {},
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
    onZoomChange: (z: number) => void;
    onSave: () => void;
    onCopy: () => void;
    onOpenSettings: () => void;
    onOpenFile: () => void;
    onToggleCrop: () => void;
    onClearAll: () => void;
  } = $props();

  // Active popovers
  let activeFlyout = $state<string | null>(null);
  let showCopiedToast = $state(false);

  function toggleFlyout(name: string) {
    activeFlyout = activeFlyout === name ? null : name;
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
    { id: 3, label: 'Snip in 3 seconds' },
    { id: 5, label: 'Snip in 5 seconds' },
    { id: 10, label: 'Snip in 10 seconds' },
  ];

  const snipTypes: { id: SnipType; label: string }[] = [
    { id: 'rectangle', label: 'Rectangle' },
    { id: 'window', label: 'Window' },
    { id: 'fullscreen', label: 'Full screen' },
    { id: 'freeform', label: 'Freeform' },
  ];
</script>

<div class="h-12 border-b border-black/[0.08] dark:border-white/[0.08] bg-[#f9f9f9] dark:bg-[#282828] flex items-center justify-between px-3 text-neutral-800 dark:text-neutral-200 select-none relative z-30">
  <!-- LEFT: Trigger & Modes -->
  <div class="flex items-center gap-2">
    <!-- Camera / Video Segmented Pill -->
    <div class="flex items-center h-8 bg-black/[0.04] dark:bg-white/[0.06] rounded-[6px] p-0.5 border border-black/[0.05] dark:border-white/[0.05]">
      <button
        type="button"
        class="h-full flex items-center justify-center px-2.5 rounded-[4px] text-xs font-medium transition-all {mode === 'snip' ? 'bg-white dark:bg-[#383838] text-neutral-900 dark:text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}"
        onclick={() => onModeChange('snip')}
        title="Snip mode"
      >
        <Camera class="w-3.5 h-3.5 mr-1" />
        <span>Snip</span>
      </button>

      <button
        type="button"
        class="h-full flex items-center justify-center px-2.5 rounded-[4px] text-xs font-medium transition-all {mode === 'record' ? 'bg-white dark:bg-[#383838] text-neutral-900 dark:text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}"
        onclick={() => onModeChange('record')}
        title="Record mode"
      >
        <Video class="w-3.5 h-3.5 mr-1" />
        <span>Record</span>
      </button>
    </div>

    <!-- "+ New" Split Button with Delay dropdown (Perfect match and size alignment) -->
    <div class="flex items-stretch h-8 rounded-[6px] overflow-visible relative shadow-sm">
      <button
        type="button"
        class="h-full flex items-center justify-center gap-1.5 px-2.5 bg-[#0067c0] hover:bg-[#1070c7] text-white text-xs font-medium rounded-l-[6px] transition-colors"
        onclick={onTriggerNew}
        title="New snip (Print Screen or Ctrl+N)"
      >
        <Plus class="w-3.5 h-3.5 stroke-[2.2]" />
        <span>New</span>
      </button>

      <button
        type="button"
        class="h-full w-6 flex items-center justify-center bg-[#0067c0] hover:bg-[#1070c7] text-white border-l border-white/20 rounded-r-[6px] transition-colors"
        onclick={() => toggleFlyout('delay')}
        title="Snip delay"
      >
        <ChevronDown class="w-3.5 h-3.5 stroke-[2]" />
      </button>

      <!-- Delay Dropdown Menu -->
      {#if activeFlyout === 'delay'}
        <div class="absolute top-full mt-1.5 left-0 z-50 min-w-[160px] bg-white dark:bg-[#2c2c2c] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_10px_25px_rgba(0,0,0,0.2)] py-1 flex flex-col">
          {#each delayOptions as opt}
            <button
              type="button"
              class="relative flex items-center justify-between px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors"
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

    <!-- Snip Mode Dropdown Button -->
    <div class="relative">
      <button
        type="button"
        class="h-8 flex items-center gap-1.5 px-2.5 rounded-[6px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] border border-transparent hover:border-black/[0.05] dark:hover:border-white/[0.05] transition-colors text-xs text-neutral-700 dark:text-neutral-300"
        onclick={() => toggleFlyout('snipType')}
        title="Snip mode"
      >
        <SnipIcons type={snipType} className="w-3.5 h-3.5 text-neutral-700 dark:text-neutral-300" />
        <span class="capitalize">
          {snipType === 'fullscreen' ? 'Full screen' : snipType}
        </span>
        <ChevronDown class="w-3.5 h-3.5 text-neutral-500" />
      </button>

      {#if activeFlyout === 'snipType'}
        <div class="absolute top-full mt-1.5 left-0 z-50 min-w-[150px] bg-white dark:bg-[#2c2c2c] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_10px_25px_rgba(0,0,0,0.2)] py-1 flex flex-col">
          {#each snipTypes as st}
            <button
              type="button"
              class="flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors"
              onclick={() => { onSnipTypeChange(st.id); activeFlyout = null; }}
            >
              <SnipIcons type={st.id} className="w-3.5 h-3.5" />
              <span>{st.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- CENTER: Annotation & Editing Markup Tools -->
  {#if hasImage}
    <div class="flex items-center gap-1">
      <div class="w-[1px] h-5 bg-black/[0.08] dark:bg-white/[0.08] mx-1"></div>

      <!-- Pen Tool -->
      <div class="relative">
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
      <div class="relative">
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
      <div class="relative">
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
          <ChevronDown class="w-3 h-3 text-neutral-500" />
        </button>

        {#if activeFlyout === 'eraser'}
          <div class="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 z-50 min-w-[140px] bg-white dark:bg-[#2c2c2c] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_10px_25px_rgba(0,0,0,0.2)] py-1 flex flex-col">
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

      <!-- Ruler / Protractor Tool -->
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] flex items-center justify-center transition-colors {activeTool === 'ruler' ? 'bg-black/[0.08] dark:bg-white/[0.12] text-neutral-900 dark:text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'}"
        onclick={() => onToolChange(activeTool === 'ruler' ? 'select' : 'ruler')}
        title="Ruler / Protractor"
      >
        <Ruler class="w-4 h-4 stroke-[1.8]" />
      </button>

      <!-- Touch Writing Toggle -->
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] flex items-center justify-center transition-colors {activeTool === 'touch' ? 'bg-black/[0.08] dark:bg-white/[0.12] text-neutral-900 dark:text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'}"
        onclick={() => onToolChange(activeTool === 'touch' ? 'select' : 'touch')}
        title="Touch writing"
      >
        <Hand class="w-4 h-4 stroke-[1.8]" />
      </button>

      <!-- Image Crop Tool -->
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] flex items-center justify-center transition-colors {isCropping ? 'bg-[#0067c0] text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'}"
        onclick={onToggleCrop}
        title="Crop image"
      >
        <Crop class="w-4 h-4 stroke-[1.8]" />
      </button>

      <!-- Text Actions (OCR) -->
      <button
        type="button"
        class="flex items-center gap-1 px-2 py-1.5 rounded-[6px] transition-colors {activeTool === 'text' ? 'bg-black/[0.08] dark:bg-white/[0.12] text-neutral-900 dark:text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'}"
        onclick={() => onToolChange(activeTool === 'text' ? 'select' : 'text')}
        title="Text actions (OCR)"
      >
        <ScanText class="w-4 h-4 stroke-[1.8]" />
        <span class="text-xs">Text</span>
      </button>

      <!-- Shapes Tool -->
      <div class="relative">
        <button
          type="button"
          class="flex items-center gap-1 px-2 py-1.5 rounded-[6px] transition-colors {activeTool === 'shapes' ? 'bg-black/[0.08] dark:bg-white/[0.12] text-neutral-900 dark:text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'}"
          onclick={() => {
            if (activeTool === 'shapes') toggleFlyout('shapes');
            else { onToolChange('shapes'); toggleFlyout('shapes'); }
          }}
          title="Shapes"
        >
          <Shapes class="w-4 h-4 stroke-[1.8]" />
          <ChevronDown class="w-3 h-3 text-neutral-500" />
        </button>

        {#if activeFlyout === 'shapes'}
          <div class="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 z-50">
            <ShapesFlyout
              shape={shapeKind}
              strokeColor="#d13438"
              fillColor="transparent"
              strokeWidth={3}
              onSelectShape={(s) => onShapeKindChange(s)}
            />
          </div>
        {/if}
      </div>

      <div class="w-[1px] h-5 bg-black/[0.08] dark:bg-white/[0.08] mx-1"></div>

      <!-- Undo / Redo -->
      <button
        type="button"
        class="w-7 h-7 rounded-[5px] flex items-center justify-center hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300 transition-colors"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 class="w-3.5 h-3.5 stroke-[1.8]" />
      </button>

      <button
        type="button"
        class="w-7 h-7 rounded-[5px] flex items-center justify-center hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300 transition-colors"
        title="Redo (Ctrl+Y)"
      >
        <Redo2 class="w-3.5 h-3.5 stroke-[1.8]" />
      </button>
    </div>
  {/if}

  <!-- RIGHT: Export, Zoom, Overflow -->
  <div class="flex items-center gap-1">
    {#if hasImage}
      <!-- Zoom Dropdown -->
      <div class="relative">
        <button
          type="button"
          class="flex items-center gap-1 px-2 py-1 rounded-[5px] text-xs font-mono text-neutral-600 dark:text-neutral-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
          onclick={() => toggleFlyout('zoom')}
          title="Zoom level"
        >
          <span>{zoom}%</span>
          <ChevronDown class="w-3 h-3" />
        </button>

        {#if activeFlyout === 'zoom'}
          <div class="absolute top-full mt-1.5 right-0 z-50 min-w-[130px] bg-white dark:bg-[#2c2c2c] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_10px_25px_rgba(0,0,0,0.2)] py-1 flex flex-col">
            {#each [50, 75, 100, 150, 200] as z}
              <button
                type="button"
                class="px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors flex items-center justify-between"
                onclick={() => { onZoomChange(z); activeFlyout = null; }}
              >
                <span>{z}%</span>
                {#if zoom === z}
                  <Check class="w-3.5 h-3.5 text-[#0067c0] dark:text-[#60cdff]" />
                {/if}
              </button>
            {/each}
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

      <!-- Share Button -->
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] flex items-center justify-center hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300 transition-colors"
        title="Share"
      >
        <Share2 class="w-4 h-4 stroke-[1.8]" />
      </button>
    {/if}

    <!-- "See More" (...) Menu -->
    <div class="relative">
      <button
        type="button"
        class="w-8 h-8 rounded-[6px] flex items-center justify-center hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-neutral-700 dark:text-neutral-300 transition-colors"
        onclick={() => toggleFlyout('more')}
        title="See more options"
      >
        <MoreHorizontal class="w-4 h-4 stroke-[1.8]" />
      </button>

      {#if activeFlyout === 'more'}
        <div class="absolute top-full mt-1.5 right-0 z-50 min-w-[160px] bg-white dark:bg-[#2c2c2c] rounded-[8px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_10px_25px_rgba(0,0,0,0.2)] py-1 flex flex-col text-neutral-800 dark:text-neutral-200">
          <button
            type="button"
            class="flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors"
            onclick={() => { onOpenFile(); activeFlyout = null; }}
          >
            <FolderOpen class="w-3.5 h-3.5 text-neutral-500" />
            <span>Open file</span>
          </button>

          <button
            type="button"
            class="flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-[4px] mx-1 transition-colors"
            onclick={() => activeFlyout = null}
          >
            <Printer class="w-3.5 h-3.5 text-neutral-500" />
            <span>Print</span>
          </button>

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

