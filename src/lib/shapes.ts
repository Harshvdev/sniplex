/**
 * Phase 13 — Geometric Shapes & Emojis.
 *
 * Four vector shapes (Rectangle, Oval/Circle, Line, Arrow) drawn by
 * drag-to-size, with Shift constraining the proportions. Emoji stamps are
 * placed by click and can later be moved with the text tool's drag behavior.
 */

import type { ShapeKind } from './types';

export interface ShapePoint {
  x: number;
  y: number;
}

export interface ShapeGeometry {
  kind: ShapeKind;
  start: ShapePoint;
  end: ShapePoint;
  outlineColor: string;
  fillColor: 'transparent' | string;
  strokeWidth: number;
  outlineOpacity: number;
  fillOpacity: number;
}

export const SHAPE_MIN_WIDTH = 1;
export const SHAPE_MAX_WIDTH = 20;
export const SHAPE_DEFAULT_WIDTH = 3;

export function clampShapeWidth(width: number): number {
  if (!Number.isFinite(width)) return SHAPE_DEFAULT_WIDTH;
  return Math.min(SHAPE_MAX_WIDTH, Math.max(SHAPE_MIN_WIDTH, width));
}

/**
 * Constrains a drag rectangle. With Shift held, Rectangle/Oval lock to a
 * square/circle (end forced onto the longer edge) and Line/Arrow snap to
 * 15° increments.
 */
export function constrainShapeEnd(start: ShapePoint, end: ShapePoint, kind: ShapeKind, shift: boolean): ShapePoint {
  if (!shift) return end;

  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (kind === 'line' || kind === 'arrow') {
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 12; // 15°
    const snapped = Math.round(angle / step) * step;
    const length = Math.hypot(dx, dy);
    return { x: start.x + Math.cos(snapped) * length, y: start.y + Math.sin(snapped) * length };
  }

  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + (dx >= 0 ? 1 : -1) * side,
    y: start.y + (dy >= 0 ? 1 : -1) * side,
  };
}

/** Bounding box of a shape, tolerant of reversed drag directions. */
export function shapeBounds(shape: ShapeGeometry): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.min(shape.start.x, shape.end.x),
    top: Math.min(shape.start.y, shape.end.y),
    right: Math.max(shape.start.x, shape.end.x),
    bottom: Math.max(shape.start.y, shape.end.y),
  };
}

/** Shape stroke/fill defaults shown in the flyout. */
export const SHAPE_DEFAULT_OUTLINE = '#d13438';
export const SHAPE_DEFAULT_FILL = 'transparent';

/** Standard emoji stamp palette (common Fluent-style glyphs). */
export const EMOJI_PALETTE = [
  '😀','😁','😂','🤣','😊','😍','😘','😜','😎','🤔',
  '😴','😷','🤯','😳','😒','😏','🙄','😬','😕','😟',
  '😮','😲','😢','😭','😡','😤','👍','👎','👏','🙏',
  '💪','✌️','👋','👉','👈','👆','👇','🫡','🤝','❤️',
  '💛','💚','💙','💜','🖤','🤍','💔','💯','🔥','⭐',
  '🌟','✨','⚡','🎉','🎊','🎁','🏆','🚀','💡','📎',
  '📌','✅','❌','⚠️','❓','❗','🎯','🏀','⚽','🎮',
] as const;

export type EmojiGlyph = (typeof EMOJI_PALETTE)[number];

/** Default pixel size for a newly stamped emoji (independent of shape stroke). */
export const EMOJI_DEFAULT_SIZE = 48;
