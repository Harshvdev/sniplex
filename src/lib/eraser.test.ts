import { describe, expect, it } from 'bun:test';
import { ERASER_BRUSH_SIZE, pathIntersectsBrush, pointSegmentDistance, strokesHitByBrush } from './eraser';

describe('Phase 11: Eraser geometry', () => {
  it('measures distance to a segment interior and its endpoints', () => {
    expect(pointSegmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(pointSegmentDistance({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(4);
    expect(pointSegmentDistance({ x: 14, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(4);
  });

  it('handles a degenerate segment as a point', () => {
    expect(pointSegmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  it('detects a brush overlapping a stroke path', () => {
    const path = [
      { x: 0, y: 10 },
      { x: 100, y: 10 },
    ];
    expect(pathIntersectsBrush(path, { x: 50, y: 14 }, 5)).toBe(true);
    expect(pathIntersectsBrush(path, { x: 50, y: 16 }, 5)).toBe(false);
  });

  it('detects a brush dabbing a single-point stroke', () => {
    expect(pathIntersectsBrush([{ x: 10, y: 10 }], { x: 12, y: 10 }, 3)).toBe(true);
    expect(pathIntersectsBrush([{ x: 10, y: 10 }], { x: 20, y: 10 }, 3)).toBe(false);
  });

  it('returns false for an empty path', () => {
    expect(pathIntersectsBrush([], { x: 0, y: 0 }, 10)).toBe(false);
  });

  it('reports every stroke index hit by one dab, in order', () => {
    const strokes = [
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ],
      [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
    ];
    expect(strokesHitByBrush(strokes, { x: 50, y: 10 }, 12)).toEqual([0]);
    expect(strokesHitByBrush(strokes, { x: 50, y: 45 }, 12)).toEqual([1]);
    expect(strokesHitByBrush(strokes, { x: 50, y: 500 }, 12)).toEqual([]);
  });

  it('keeps the default brush size sensible for canvas swipes', () => {
    expect(ERASER_BRUSH_SIZE).toBeGreaterThanOrEqual(10);
    expect(ERASER_BRUSH_SIZE).toBeLessThanOrEqual(40);
  });
});
