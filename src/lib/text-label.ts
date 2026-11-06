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
}

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
  return textLines(label.text).length * labelLineHeight(label.fontSize);
}

/**
 * Width of one line of text at a given size. Uses a measured canvas width
 * when a DOM is available; falls back to a character-width approximation
 * in headless/test environments.
 */
export function estimateTextWidth(fontSize: number, text: string): number {
  if (!text) return 0;
  try {
    if (typeof document !== 'undefined') {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) {
        ctx.font = `${fontSize}px 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif`;
        return ctx.measureText(text).width;
      }
    }
  } catch {
    // Fall through to the approximation below.
  }
  return text.length * fontSize * 0.6;
}

/** Widest line of a label — the box width used for alignment and hit-testing. */
export function labelWidth(label: TextLabel): number {
  return Math.max(0, ...textLines(label.text).map((line) => estimateTextWidth(label.fontSize, line)));
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
