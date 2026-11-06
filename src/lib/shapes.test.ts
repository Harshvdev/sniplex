import { describe, expect, it } from 'bun:test';
import {
  EMOJI_PALETTE,
  SHAPE_MAX_WIDTH,
  SHAPE_MIN_WIDTH,
  clampShapeWidth,
  constrainShapeEnd,
  shapeBounds,
} from './shapes';

describe('Phase 13: Geometric Shapes', () => {
  it('leaves the end point alone when Shift is not held', () => {
    expect(constrainShapeEnd({ x: 0, y: 0 }, { x: 30, y: 40 }, 'rectangle', false)).toEqual({ x: 30, y: 40 });
  });

  it('locks Rectangle/Oval to a square with Shift', () => {
    expect(constrainShapeEnd({ x: 10, y: 10 }, { x: 50, y: 25 }, 'rectangle', true)).toEqual({ x: 50, y: 50 });
    expect(constrainShapeEnd({ x: 10, y: 10 }, { x: 20, y: 60 }, 'oval', true)).toEqual({ x: 60, y: 60 });
    expect(constrainShapeEnd({ x: 50, y: 50 }, { x: 20, y: 30 }, 'rectangle', true)).toEqual({ x: 20, y: 20 });
  });

  it('snaps Line/Arrow to 15° increments with Shift', () => {
    const end = constrainShapeEnd({ x: 0, y: 0 }, { x: 100, y: 10 }, 'line', true);
    // 100,10 is ~5.7°, snaps to 0° (horizontal).
    expect(end.y).toBeCloseTo(0, 5);
    expect(end.x).toBeCloseTo(Math.hypot(100, 10), 5);

    const vertical = constrainShapeEnd({ x: 0, y: 0 }, { x: 10, y: 100 }, 'arrow', true);
    expect(vertical.x).toBeCloseTo(0, 5);
  });

  it('bounds a shape regardless of drag direction', () => {
    const bounds = shapeBounds({
      kind: 'rectangle',
      start: { x: 60, y: 70 },
      end: { x: 10, y: 20 },
      outlineColor: '#000',
      fillColor: 'transparent',
      strokeWidth: 3,
      outlineOpacity: 1,
      fillOpacity: 1,
    });
    expect(bounds).toEqual({ left: 10, top: 20, right: 60, bottom: 70 });
  });

  it('clamps stroke width to 1–20 px', () => {
    expect(clampShapeWidth(0)).toBe(SHAPE_MIN_WIDTH);
    expect(clampShapeWidth(50)).toBe(SHAPE_MAX_WIDTH);
    expect(clampShapeWidth(3)).toBe(3);
    expect(clampShapeWidth(Number.NaN)).toBe(3);
  });

  it('offers a usable emoji palette', () => {
    expect(EMOJI_PALETTE.length).toBeGreaterThanOrEqual(40);
    expect(new Set(EMOJI_PALETTE).size).toBe(EMOJI_PALETTE.length);
  });
});
