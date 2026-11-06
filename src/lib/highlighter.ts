/**
 * Phase 10 — Highlighter geometry.
 *
 * A highlighter stroke is a translucent, multiply-blended mark: the
 * underlying capture must stay legible. Holding Shift while drawing
 * constrains the stroke to a horizontal or vertical straight line.
 */

export interface LinePoint {
  x: number;
  y: number;
}

/**
 * Preset fluorescent palette (flyout order matches the brief).
 */
export const HIGHLIGHTER_PRESETS = [
  { color: '#ffeb3b', name: 'Yellow' },
  { color: '#69f0ae', name: 'Green' },
  { color: '#ff80ab', name: 'Pink' },
  { color: '#80d8ff', name: 'Blue' },
  { color: '#ffd180', name: 'Orange' },
  { color: '#ea80fc', name: 'Purple' },
] as const;

/** Highlighter thickness range in pixels (flyout slider bounds). */
export const HIGHLIGHTER_MIN_SIZE = 6;
export const HIGHLIGHTER_MAX_SIZE = 48;

/** Fixed alpha so the ink never hides the image underneath. */
export const HIGHLIGHTER_ALPHA = 0.45;

export function clampHighlighterSize(size: number): number {
  if (!Number.isFinite(size)) return HIGHLIGHTER_MIN_SIZE;
  return Math.min(HIGHLIGHTER_MAX_SIZE, Math.max(HIGHLIGHTER_MIN_SIZE, size));
}

/**
 * Constrains `point` onto the dominant axis through `anchor`: horizontal
 * when the pointer travelled further sideways, vertical when it travelled
 * further up/down. Returns the anchor unchanged for a zero-length vector.
 */
export function constrainStraightLine(anchor: LinePoint, point: LinePoint): LinePoint {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: point.x, y: anchor.y };
  return { x: anchor.x, y: point.y };
}
