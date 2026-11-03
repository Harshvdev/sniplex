import { describe, expect, it } from 'bun:test';
import { outlineSize } from './outline';

describe('Phase 6: Screenshot framing outline geometry', () => {
  it('adds a symmetric ring around the capture', () => {
    expect(outlineSize(1920, 1080, 2)).toEqual({ width: 1924, height: 1084, padding: 2 });
    expect(outlineSize(800, 600, 10)).toEqual({ width: 820, height: 620, padding: 10 });
  });

  it('never covers the capture for zero or negative widths', () => {
    expect(outlineSize(800, 600, 0)).toEqual({ width: 800, height: 600, padding: 0 });
    expect(outlineSize(800, 600, -4)).toEqual({ width: 800, height: 600, padding: 0 });
  });

  it('rounds fractional widths and keeps a minimum pixel size', () => {
    expect(outlineSize(1.4, 0.2, 1.6)).toEqual({ width: 5, height: 5, padding: 2 });
  });
});
