<script lang="ts">
  import { Square, Circle, Minus, ArrowUpRight, Ban, Smile, Check, X } from '@lucide/svelte';
  import type { ShapeKind, ToolType } from '../types';
  import { EMOJI_PALETTE, SHAPE_MAX_WIDTH, SHAPE_MIN_WIDTH } from '../shapes';
  import { TEXT_FONT_FAMILIES, TEXT_MAX_SIZE, TEXT_MIN_SIZE, type TextAlign } from '../text-label';

  let {
    activeTool = 'select',
    isCropping = false,
    hasImage = false,
    // Shapes
    shapeKind = 'rectangle',
    shapeFillColor = 'transparent',
    shapeFillOpacity = 1,
    shapeOutlineColor = '#d13438',
    shapeOutlineOpacity = 1,
    shapeStrokeWidth = 3,
    emojiGlyph = null,
    onShapeKindChange = (_s: ShapeKind) => {},
    onFillColorChange = (_c: string) => {},
    onFillOpacityChange = (_o: number) => {},
    onOutlineColorChange = (_c: string) => {},
    onOutlineOpacityChange = (_o: number) => {},
    onStrokeWidthChange = (_w: number) => {},
    onEmojiSelect = (_g: string | null) => {},
    // Text
    textFontFamily = 'Segoe UI Variable',
    textFontSize = 24,
    textBold = false,
    textItalic = false,
    textUnderline = false,
    textColor = '#000000',
    textHighlight = false,
    textAlign = 'left',
    onTextFontFamilyChange = (_f: string) => {},
    onTextFontSizeChange = (_s: number) => {},
    onTextBoldChange = (_b: boolean) => {},
    onTextItalicChange = (_i: boolean) => {},
    onTextUnderlineChange = (_u: boolean) => {},
    onTextColorChange = (_c: string) => {},
    onTextHighlightChange = (_h: boolean) => {},
    onTextAlignChange = (_a: TextAlign) => {},
    // Crop
    onApplyCrop = () => {},
    onCancelCrop = () => {},
  }: {
    activeTool: ToolType;
    isCropping: boolean;
    /** Secondary options only exist once a capture is loaded. */
    hasImage: boolean;
    shapeKind: ShapeKind;
    shapeFillColor: string;
    shapeFillOpacity: number;
    shapeOutlineColor: string;
    shapeOutlineOpacity: number;
    shapeStrokeWidth: number;
    emojiGlyph: string | null;
    onShapeKindChange: (s: ShapeKind) => void;
    onFillColorChange: (c: string) => void;
    onFillOpacityChange: (o: number) => void;
    onOutlineColorChange: (c: string) => void;
    onOutlineOpacityChange: (o: number) => void;
    onStrokeWidthChange: (w: number) => void;
    onEmojiSelect: (g: string | null) => void;
    textFontFamily: string;
    textFontSize: number;
    textBold: boolean;
    textItalic: boolean;
    textUnderline: boolean;
    textColor: string;
    textHighlight: boolean;
    textAlign: TextAlign;
    onTextFontFamilyChange: (f: string) => void;
    onTextFontSizeChange: (s: number) => void;
    onTextBoldChange: (b: boolean) => void;
    onTextItalicChange: (i: boolean) => void;
    onTextUnderlineChange: (u: boolean) => void;
    onTextColorChange: (c: string) => void;
    onTextHighlightChange: (h: boolean) => void;
    onTextAlignChange: (a: TextAlign) => void;
    onApplyCrop: () => void;
    onCancelCrop: () => void;
  } = $props();

  const shapes: { kind: ShapeKind; label: string; icon: any }[] = [
    { kind: 'rectangle', label: 'Rectangle', icon: Square },
    { kind: 'oval', label: 'Oval', icon: Circle },
    { kind: 'line', label: 'Line', icon: Minus },
    { kind: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  ];

  const colors = ['#000000', '#ffffff', '#d13438', '#0078d4', '#107c41', '#ffb900', '#ea4c89'];
  const textPalette = ['#000000', '#ffffff', '#d13438', '#0078d4', '#107c10', '#8a6d00'];

  let openMenu = $state<'emoji' | 'fill' | 'outline' | null>(null);
  function toggle(menu: 'emoji' | 'fill' | 'outline') {
    openMenu = openMenu === menu ? null : menu;
  }

  // Clicking outside any open dropdown closes it.
  function closeOnOutside(e: PointerEvent) {
    if (!openMenu) return;
    const target = e.target as Element | null;
    if (target?.closest?.('.secondary-menu')) return;
    openMenu = null;
  }
</script>

<svelte:window onpointerdown={closeOnOutside} />

{#if hasImage && isCropping}
  <div class="flex h-10 items-center gap-2 border-b border-black/[0.06] bg-[#fdfdfd] px-3 dark:border-white/[0.07] dark:bg-[#161b26] text-xs" data-testid="secondary-toolbar-crop">
    <button type="button" class="flex items-center gap-1.5 rounded-md bg-[#0067c0] px-3 py-1 text-white font-medium hover:bg-[#1070c7] cursor-pointer" onclick={onApplyCrop}>
      <Check class="w-3.5 h-3.5" /> Apply <span class="opacity-60">(Enter)</span>
    </button>
    <button type="button" class="flex items-center gap-1.5 rounded-md px-3 py-1 text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10 cursor-pointer" onclick={onCancelCrop}>
      <X class="w-3.5 h-3.5" /> Cancel <span class="opacity-60">(Esc)</span>
    </button>
    <span class="text-neutral-400">Drag handles to resize · arrows pan the frame</span>
  </div>
{:else if hasImage && activeTool === 'shapes'}
  <div class="flex min-h-10 flex-wrap items-center gap-2 border-b border-black/[0.06] bg-[#fdfdfd] px-3 py-1 dark:border-white/[0.07] dark:bg-[#161b26] text-xs" data-testid="secondary-toolbar-shapes">
    <div class="relative secondary-menu">
      <button type="button" class="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer" onclick={() => toggle('emoji')}>
        <Smile class="w-4 h-4" /> Emoji
      </button>
      {#if openMenu === 'emoji'}
        <div class="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#181d28]">
          <div class="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
            {#each EMOJI_PALETTE as glyph}
              <button type="button" class="flex h-8 items-center justify-center rounded text-lg hover:bg-black/5 dark:hover:bg-white/10" title="Stamp at center" onclick={() => onEmojiSelect(glyph)}>{glyph}</button>
            {/each}
          </div>
          <p class="mt-1 text-[10px] text-neutral-400">Click an emoji to stamp it at center.</p>
        </div>
      {/if}
    </div>

    <div class="h-4 w-px bg-black/10 dark:bg-white/10"></div>

    <div class="flex items-center gap-1" role="group" aria-label="Shapes">
      {#each shapes as s}
        {@const Icon = s.icon}
        <button type="button" title={s.label} aria-pressed={shapeKind === s.kind} class="flex h-7 w-7 items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 {shapeKind === s.kind ? 'bg-[#0067c0] text-white' : ''}" onclick={() => onShapeKindChange(s.kind)}>
          <Icon class="w-4 h-4 stroke-[2]" />
        </button>
      {/each}
    </div>

    <div class="h-4 w-px bg-black/10 dark:bg-white/10"></div>

    <div class="relative secondary-menu">
      <button type="button" class="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer" onclick={() => toggle('fill')}>
        <span class="h-3.5 w-3.5 rounded-full border" style={shapeFillColor === 'transparent' ? 'background: repeating-conic-gradient(#999 0% 25%, #fff 0% 50%) 0 0/8px 8px' : `background:${shapeFillColor}`}></span> Fill
      </button>
      {#if openMenu === 'fill'}
        <div class="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#181d28]">
          <div class="flex flex-wrap gap-1.5">
            <button type="button" class="h-6 w-6 rounded-full border flex items-center justify-center {shapeFillColor === 'transparent' ? 'ring-2 ring-[#0067c0]' : ''}" onclick={() => onFillColorChange('transparent')} title="No fill"><Ban class="w-3.5 h-3.5 text-neutral-400" /></button>
            {#each colors as c}
              <button type="button" class="h-6 w-6 rounded-full border {shapeFillColor === c ? 'ring-2 ring-[#0067c0]' : ''}" style="background:{c}" onclick={() => onFillColorChange(c)} aria-label={c}></button>
            {/each}
          </div>
          <label class="mt-2 flex items-center gap-2 text-[11px]">Opacity <input type="range" min="10" max="100" value={Math.round(shapeFillOpacity * 100)} class="flex-1 accent-[#0067c0]" oninput={(e) => onFillOpacityChange(Number((e.target as HTMLInputElement).value) / 100)} /><span class="w-8 font-mono">{Math.round(shapeFillOpacity * 100)}%</span></label>
        </div>
      {/if}
    </div>

    <div class="relative secondary-menu">
      <button type="button" class="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer" onclick={() => toggle('outline')}>
        <span class="h-3.5 w-3.5 rounded-full border" style="background:{shapeOutlineColor}"></span> Outline
      </button>
      {#if openMenu === 'outline'}
        <div class="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#181d28]">
          <div class="flex flex-wrap gap-1.5">
            {#each colors as c}
              <button type="button" class="h-6 w-6 rounded-full border {shapeOutlineColor === c ? 'ring-2 ring-[#0067c0]' : ''}" style="background:{c}" onclick={() => onOutlineColorChange(c)} aria-label={c}></button>
            {/each}
          </div>
          <label class="mt-2 flex items-center gap-2 text-[11px]">Size <input type="range" min={SHAPE_MIN_WIDTH} max={SHAPE_MAX_WIDTH} value={shapeStrokeWidth} class="flex-1 accent-[#0067c0]" oninput={(e) => onStrokeWidthChange(Number((e.target as HTMLInputElement).value))} /><span class="w-8 font-mono">{shapeStrokeWidth}px</span></label>
          <label class="mt-1 flex items-center gap-2 text-[11px]">Opacity <input type="range" min="10" max="100" value={Math.round(shapeOutlineOpacity * 100)} class="flex-1 accent-[#0067c0]" oninput={(e) => onOutlineOpacityChange(Number((e.target as HTMLInputElement).value) / 100)} /><span class="w-8 font-mono">{Math.round(shapeOutlineOpacity * 100)}%</span></label>
        </div>
      {/if}
    </div>
  </div>
{:else if hasImage && activeTool === 'text'}
  <div class="flex min-h-10 flex-wrap items-center gap-2 border-b border-black/[0.06] bg-[#fdfdfd] px-3 py-1 dark:border-white/[0.07] dark:bg-[#161b26] text-xs" data-testid="secondary-toolbar-text">
    <select class="rounded border border-black/10 bg-white px-1.5 py-1 text-[11px] dark:border-white/10 dark:bg-[#10141f]" value={textFontFamily} onchange={(e) => onTextFontFamilyChange((e.target as HTMLSelectElement).value)} aria-label="Font family">
      {#each TEXT_FONT_FAMILIES as f}
        <option value={f.id}>{f.label}</option>
      {/each}
    </select>
    <label class="flex items-center gap-1">Size <input type="range" min={TEXT_MIN_SIZE} max={TEXT_MAX_SIZE} value={textFontSize} class="w-20 accent-[#0067c0]" oninput={(e) => onTextFontSizeChange(Number((e.target as HTMLInputElement).value))} /><span class="w-8 font-mono">{textFontSize}px</span></label>

    <div class="h-4 w-px bg-black/10 dark:bg-white/10"></div>

    <div class="flex gap-1" role="group" aria-label="Text style">
      <button type="button" aria-pressed={textBold} class="rounded px-2 py-0.5 font-bold hover:bg-black/5 dark:hover:bg-white/10 {textBold ? 'bg-[#0067c0] text-white' : ''}" onclick={() => onTextBoldChange(!textBold)}>B</button>
      <button type="button" aria-pressed={textItalic} class="rounded px-2 py-0.5 italic hover:bg-black/5 dark:hover:bg-white/10 {textItalic ? 'bg-[#0067c0] text-white' : ''}" onclick={() => onTextItalicChange(!textItalic)}>I</button>
      <button type="button" aria-pressed={textUnderline} class="rounded px-2 py-0.5 underline hover:bg-black/5 dark:hover:bg-white/10 {textUnderline ? 'bg-[#0067c0] text-white' : ''}" onclick={() => onTextUnderlineChange(!textUnderline)}>U</button>
    </div>

    <div class="flex items-center gap-1" role="group" aria-label="Text color">
      {#each textPalette as c}
        <button type="button" class="h-4 w-4 rounded-full border {textColor === c ? 'ring-2 ring-[#0067c0]' : 'border-black/15 dark:border-white/15'}" style="background:{c}" onclick={() => onTextColorChange(c)} aria-label={c}></button>
      {/each}
      <input type="color" value={textColor} class="h-5 w-5 cursor-pointer" aria-label="Custom text color" oninput={(e) => onTextColorChange((e.target as HTMLInputElement).value)} />
    </div>

    <button type="button" aria-pressed={textHighlight} class="rounded px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10 {textHighlight ? 'bg-[#0067c0] text-white' : ''}" onclick={() => onTextHighlightChange(!textHighlight)}>Background</button>

    <div class="h-4 w-px bg-black/10 dark:bg-white/10"></div>

    <div class="flex gap-1" role="group" aria-label="Alignment">
      {#each [{ id: 'left', label: 'Left' }, { id: 'center', label: 'Center' }, { id: 'right', label: 'Right' }] as a}
        <button type="button" aria-pressed={textAlign === a.id} class="rounded px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10 {textAlign === a.id ? 'bg-[#0067c0] text-white' : ''}" onclick={() => onTextAlignChange(a.id as TextAlign)}>{a.label}</button>
      {/each}
    </div>
  </div>
{/if}
