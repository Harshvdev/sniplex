import { describe, expect, it } from 'bun:test';
import {
  HIGHLIGHTER_ALPHA,
  HIGHLIGHTER_MAX_SIZE,
  HIGHLIGHTER_MIN_SIZE,
  HIGHLIGHTER_PRESETS,
  clampHighlighterSize,
  constrainStraightLine,
} from './highlighter';

describe('Phase 10: Highlighter geometry', () => {
  it('constrains toward horizontal when the pointer moves sideways', () => {
    expect(constrainStraightLine({ x: 10, y: 20 }, { x: 50, y: 26 })).toEqual({ x: 50, y: 20 });
  });

  it('constrains toward vertical when the pointer moves up/down', () => {
    expect(constrainStraightLine({ x: 10, y: 20 }, { x: 14, y: 60 })).toEqual({ x: 10, y: 60 });
  });

  it('keeps an exactly diagonal drag deterministic (horizontal wins)', () => {
    expect(constrainStraightLine({ x: 0, y: 0 }, { x: 8, y: 8 })).toEqual({ x: 8, y: 0 });
  });

  it('returns the anchor itself for a zero-length vector', () => {
    expect(constrainStraightLine({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  it('clamps the thickness slider to 6–48 px', () => {
    expect(clampHighlighterSize(2)).toBe(HIGHLIGHTER_MIN_SIZE);
    expect(clampHighlighterSize(99)).toBe(HIGHLIGHTER_MAX_SIZE);
    expect(clampHighlighterSize(18)).toBe(18);
    expect(clampHighlighterSize(Number.NaN)).toBe(HIGHLIGHTER_MIN_SIZE);
  });

  it('keeps the ink translucent so the image stays legible', () => {
    expect(HIGHLIGHTER_ALPHA).toBeLessThanOrEqual(0.5);
    expect(HIGHLIGHTER_ALPHA).toBeGreaterThan(0);
  });

  it('exposes the six fluorescent presets in flyout order', () => {
    expect(HIGHLIGHTER_PRESETS.map((preset) => preset.name)).toEqual([
      'Yellow',
      'Green',
      'Pink',
      'Blue',
      'Orange',
      'Purple',
    ]);
  });
});
