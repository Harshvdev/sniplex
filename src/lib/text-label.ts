/**
 * Phase 12 — Text Insertion.
 *
 * A text label is a movable vector element: content, typography, and
 * position (in image pixels). The editor commits it with Esc / click-away,
 * and committed labels are drawn onto the composite canvas so they copy,
 * export, and undo like any other markup.
 */

export type TextAlign = 'left' | 'center' | 'right';

export const TEXT_MIN_SIZE = 8;
export const TEXT_MAX_SIZE = 72;
export const TEXT_DEFAULT_SIZE = 24;

export interface TextLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  align: TextAlign;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  highlight: boolean;
  /** Max line width in px (0 = natural width, no wrap). Set via side handles. */
  maxWidth: number;
}

export const TEXT_FONT_FAMILIES = [
  { id: 'Segoe UI Variable', label: 'Segoe UI Variable' },
  { id: 'Segoe UI', label: 'Segoe UI' },
  { id: 'Georgia', label: 'Georgia' },
  { id: 'Consolas', label: 'Consolas' },
] as const;

export const TEXT_DEFAULT_FONT_FAMILY = 'Segoe UI Variable';

export function clampTextSize(size: number): number {
  if (!Number.isFinite(size)) return TEXT_DEFAULT_SIZE;
  return Math.min(TEXT_MAX_SIZE, Math.max(TEXT_MIN_SIZE, size));
}

export function isValidTextAlign(value: string): value is TextAlign {
  return value === 'left' || value === 'center' || value === 'right';
}

/** A label exists only when it has non-whitespace content. */
export function isCommittableText(text: string): boolean {
  return text.trim().length > 0;
}

let textLabelCounter = 0;

export function createTextLabel(partial: Partial<TextLabel> = {}): TextLabel {
  textLabelCounter += 1;
  return {
    id: `text-${textLabelCounter}-${partial.x ?? 0}-${partial.y ?? 0}`,
    text: partial.text ?? '',
    x: partial.x ?? 20,
    y: partial.y ?? 20,
    fontSize: clampTextSize(partial.fontSize ?? TEXT_DEFAULT_SIZE),
    color: partial.color ?? '#000000',
    align: isValidTextAlign(partial.align ?? 'left') ? (partial.align ?? 'left') : 'left',
    fontFamily: partial.fontFamily ?? TEXT_DEFAULT_FONT_FAMILY,
    bold: partial.bold ?? false,
    italic: partial.italic ?? false,
    underline: partial.underline ?? false,
    highlight: partial.highlight ?? false,
    maxWidth: Math.max(0, Number.isFinite(partial.maxWidth) ? partial.maxWidth! : 0),
  };
}

/** Line height factor used for multi-line labels. */
export const TEXT_LINE_HEIGHT_FACTOR = 1.35;

/** Splits a label into display lines on any newline style. */
export function textLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Height of one display line for a given font size. */
export function labelLineHeight(fontSize: number): number {
  return fontSize * TEXT_LINE_HEIGHT_FACTOR;
}

/** Total height of a (possibly multi-line) label. */
export function labelHeight(label: TextLabel): number {
  return wrappedTextLines(label).length * labelLineHeight(label.fontSize);
}

/**
 * Display lines after word-wrapping at maxWidth (0 = no wrap). Explicit
 * newlines always split; long words are never split mid-word.
 */
export function wrappedTextLines(label: TextLabel): string[] {
  const maxWidth = label.maxWidth ?? 0;
  if (!maxWidth || maxWidth <= 0) return textLines(label.text);
  const out: string[] = [];
  for (const segment of textLines(label.text)) {
    if (!segment) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of segment.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && estimateTextWidth(label.fontSize, candidate, label) > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Width of one line of text at a given size. Uses a measured canvas width
 * when a DOM is available; falls back to a character-width approximation
 * in headless/test environments. Bold/italic labels measure with the
 * matching weight and style so wrapping matches the rendered editor.
 */
export function estimateTextWidth(
  fontSize: number,
  text: string,
  options?: { bold?: boolean; italic?: boolean }
): number {
  if (!text) return 0;
  try {
    if (typeof document !== 'undefined') {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) {
        const weight = options?.bold ? '700' : '400';
        const style = options?.italic ? 'italic' : 'normal';
        ctx.font = `${style} ${weight} ${fontSize}px 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif`;
        return ctx.measureText(text).width;
      }
    }
  } catch {
    // Fall through to the approximation below.
  }
  return text.length * fontSize * 0.6;
}

/**
 * Visible box width of a label. An explicit line width (set by a side or
 * corner drag) is the box width, so stretching the side handles widens the
 * box itself. Without one, the box hugs the widest wrapped text line.
 */
export function labelWidth(label: TextLabel): number {
  const maxWidth = label.maxWidth ?? 0;
  if (maxWidth > 0) return maxWidth;
  return Math.max(0, ...wrappedTextLines(label).map((line) => estimateTextWidth(label.fontSize, line, label)));
}

/** Distance from a point to the label's bounding box (0 = inside). */
export function labelHitDistance(label: TextLabel, x: number, y: number): number {
  const width = labelWidth(label);
  const height = labelHeight(label);
  const dx = Math.max(label.x - x, 0, x - (label.x + width));
  const dy = Math.max(label.y - y, 0, y - (label.y + height));
  return Math.hypot(dx, dy);
}

/** True when a click at (x, y) selects the label. */
export function hitTextLabel(label: TextLabel, x: number, y: number, tolerance = 8): boolean {
  return labelHitDistance(label, x, y) <= tolerance;
}

export type TextZone = 'interior' | 'nw' | 'ne' | 'sw' | 'se' | 'w' | 'e' | 'n' | 's';

export interface CornerResizeResult {
  ratio: number;
  fontSize: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * Uniform corner scale: the box (and its text) grow/shrink by one ratio so
 * the aspect (width/height) stays constant, anchored on the opposite
 * corner which stays fixed. Ratio is clamped to the font size limits.
 */
export function cornerScale(
  zone: 'nw' | 'ne' | 'sw' | 'se',
  pointer: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
  fontSize: number
): CornerResizeResult {
  const anchorIsRight = zone === 'nw' || zone === 'sw';
  const anchorIsBottom = zone === 'nw' || zone === 'ne';
  const anchorX = anchorIsRight ? box.x + box.width : box.x;
  const anchorY = anchorIsBottom ? box.y + box.height : box.y;
  const cornerX = anchorIsRight ? box.x : box.x + box.width;
  const cornerY = anchorIsBottom ? box.y : box.y + box.height;
  const startDist = Math.hypot(cornerX - anchorX, cornerY - anchorY) || 1;
  const nowDist = Math.hypot(pointer.x - anchorX, pointer.y - anchorY);
  const raw = nowDist / startDist;
  const minRatio = TEXT_MIN_SIZE / fontSize;
  const maxRatio = TEXT_MAX_SIZE / fontSize;
  const ratio = Math.min(maxRatio, Math.max(minRatio, raw));
  const width = box.width * ratio;
  const height = box.height * ratio;
  return {
    ratio,
    fontSize: clampTextSize(fontSize * ratio),
    width,
    height,
    x: anchorIsRight ? anchorX - width : anchorX,
    y: anchorIsBottom ? anchorY - height : anchorY,
  };
}

/** Half-thickness of the edge band around the box border, in image px. */
export const TEXT_EDGE_TOL = 8;

/**
 * Canva-style zone under a point, in image coordinates.
 * Thin edge bands (not wide dot circles) hug the border, so a click
 * well inside the border stays `interior` (edit) and never moves the box:
 * - corners (within the band of both a horizontal and vertical edge) → resize
 * - left / right edges → width change
 * - top / bottom edges → move the box
 * - strictly inside → interior (edit)
 *
 * The band overlaps both sides of the border, so hovering just outside
 * an edge also shows the matching cursor. The tolerance adapts to very
 * small boxes so a tiny label still has an interior core.
 *
 * Returns null outside the box (beyond the edge band).
 */
export function textBoxZone(label: TextLabel, x: number, y: number): TextZone | null {
  const w = Math.max(labelWidth(label), 8);
  const h = Math.max(labelHeight(label), 8);
  const left = label.x;
  const right = label.x + w;
  const top = label.y;
  const bottom = label.y + h;
  // Adaptive: keep an interior core even on narrow/single-char labels.
  const tol = Math.min(TEXT_EDGE_TOL, w / 3, h / 3);
  if (x < left - tol || x > right + tol || y < top - tol || y > bottom + tol) return null;
  const nearLeft = Math.abs(x - left) <= tol;
  const nearRight = Math.abs(x - right) <= tol;
  const nearTop = Math.abs(y - top) <= tol;
  const nearBottom = Math.abs(y - bottom) <= tol;
  if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
    // Corner: pick the nearest corner when a very small box is near two.
    const corners: [TextZone, number, number][] = [
      ['nw', left, top],
      ['ne', right, top],
      ['sw', left, bottom],
      ['se', right, bottom],
    ];
    corners.sort((a, b) => Math.hypot(x - a[1], y - a[2]) - Math.hypot(x - b[1], y - b[2]));
    return corners[0][0];
  }
  if (nearLeft || nearRight) {
    // Edge (not corner): closer side wins on narrow boxes.
    if (nearLeft && nearRight) return x - left <= right - x ? 'w' : 'e';
    return nearLeft ? 'w' : 'e';
  }
  if (nearTop || nearBottom) {
    if (nearTop && nearBottom) return y - top <= bottom - y ? 'n' : 's';
    return nearTop ? 'n' : 's';
  }
  return 'interior';
}

/**
 * Canvas cursor naming a text-box zone (Canva-style):
 * corners → resize, left/right → width, top/bottom → move, interior → edit.
 * Returns null for a null zone (caller falls back to the default cursor).
 */
export function textZoneCursor(zone: TextZone | null): string | null {
  if (!zone) return null;
  if (zone === 'interior') return 'cursor-text';
  if (zone === 'nw' || zone === 'se') return 'cursor-nwse-resize';
  if (zone === 'ne' || zone === 'sw') return 'cursor-nesw-resize';
  if (zone === 'w' || zone === 'e') return 'cursor-ew-resize';
  return 'cursor-move';
}
