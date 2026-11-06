import { describe, expect, it } from 'bun:test';
import {
  RULER_SNAP_DISTANCE,
  normalizeAngle,
  protractorArcDistance,
  rulerProjection,
  shouldSnapToProtractor,
  shouldSnapToRuler,
  wheelRotateAngle,
} from './drafting';

describe('Phase 18: Drafting geometry', () => {
  it('normalizes angles into [0, 360)', () => {
    expect(normalizeAngle(370)).toBe(10);
    expect(normalizeAngle(-10)).toBe(350);
    expect(normalizeAngle(360)).toBe(0);
  });

  it('rotates 1° per wheel notch and 15° with Shift', () => {
    expect(wheelRotateAngle(90, -100, false)).toBe(91);
    expect(wheelRotateAngle(90, 100, false)).toBe(89);
    expect(wheelRotateAngle(90, -100, true)).toBe(105);
    expect(wheelRotateAngle(358, -100, false)).toBe(359);
  });

  it('projects points onto a horizontal ruler', () => {
    const { distance, projected } = rulerProjection({ x: 0, y: 50 }, 0, { x: 30, y: 80 });
    expect(distance).toBe(30);
    expect(projected).toEqual({ x: 30, y: 50 });
  });

  it('projects points onto a vertical ruler', () => {
    const { distance, projected } = rulerProjection({ x: 100, y: 0 }, 90, { x: 130, y: 40 });
    expect(distance).toBeCloseTo(30, 5);
    expect(projected.x).toBeCloseTo(100, 5);
    expect(projected.y).toBeCloseTo(40, 5);
  });

  it('snaps only near the ruler edge', () => {
    expect(shouldSnapToRuler({ x: 0, y: 50 }, 0, { x: 10, y: 62 })).toBe(true);
    expect(shouldSnapToRuler({ x: 0, y: 50 }, 0, { x: 10, y: 100 })).toBe(false);
    expect(RULER_SNAP_DISTANCE).toBeGreaterThan(0);
  });

  it('respects a custom (zoom-scaled) snap threshold', () => {
    // 30px from the edge: outside the default 18px magnet, inside 36px.
    expect(shouldSnapToRuler({ x: 0, y: 50 }, 0, { x: 10, y: 80 })).toBe(false);
    expect(shouldSnapToRuler({ x: 0, y: 50 }, 0, { x: 10, y: 80 }, 36)).toBe(true);
  });

  it('does not snap past the physical ends of the straightedge', () => {
    // Near the infinite line but 500px along it — beyond the 160px half-length.
    expect(shouldSnapToRuler({ x: 0, y: 50 }, 0, { x: 500, y: 52 })).toBe(false);
    expect(shouldSnapToRuler({ x: 0, y: 50 }, 0, { x: 100, y: 52 })).toBe(true);
  });

  it('measures distance to the protractor arc', () => {
    expect(protractorArcDistance({ x: 0, y: 0 }, 90, { x: 90, y: 0 })).toBe(0);
    expect(protractorArcDistance({ x: 0, y: 0 }, 90, { x: 50, y: 0 })).toBe(40);
    expect(protractorArcDistance({ x: 0, y: 0 }, 90, { x: 130, y: 0 })).toBe(40);
  });

  it('snaps only near the protractor rim', () => {
    expect(shouldSnapToProtractor({ x: 0, y: 0 }, 90, { x: 88, y: 0 })).toBe(true);
    expect(shouldSnapToProtractor({ x: 0, y: 0 }, 90, { x: 20, y: 0 })).toBe(false);
  });
});
