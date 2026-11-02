import { describe, expect, it } from 'bun:test';
import { pixelLinePoints } from './drawing';

describe('Pixel-accurate pen strokes', () => {
  it('returns a single pixel when the stroke does not move', () => {
    expect(pixelLinePoints(4, 7, 4, 7)).toEqual([{ x: 4, y: 7 }]);
  });

  it('rasterizes horizontal and vertical lines one pixel at a time', () => {
    expect(pixelLinePoints(0, 0, 3, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);

    expect(pixelLinePoints(2, 5, 2, 2)).toEqual([
      { x: 2, y: 5 },
      { x: 2, y: 4 },
      { x: 2, y: 3 },
      { x: 2, y: 2 },
    ]);
  });

  it('covers diagonals without skipping pixels', () => {
    const points = pixelLinePoints(0, 0, 3, 3);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 3, y: 3 });
  });

  it('rasterizes every direction symmetrically', () => {
    const forward = pixelLinePoints(1, 2, 8, 6);
    const backward = pixelLinePoints(8, 6, 1, 2);

    expect(backward).toEqual([...forward].reverse());
    expect(forward[0]).toEqual({ x: 1, y: 2 });
    expect(forward[forward.length - 1]).toEqual({ x: 8, y: 6 });
  });

  it('maps fractional image coordinates onto whole pixels', () => {
    expect(pixelLinePoints(2.9, 3.1, 4.2, 3.8)).toEqual(pixelLinePoints(2, 3, 4, 3));
  });

  it('never repeats a pixel inside one segment', () => {
    const points = pixelLinePoints(0, 0, 7, 3);
    const keys = points.map((point) => `${point.x},${point.y}`);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
