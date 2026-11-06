import { describe, expect, it } from 'bun:test';
import {
  RULER_SNAP_DISTANCE,
  clampRulerAngle,
  rotateAroundHinge,
  rulerEdgeProjection,
  rulerProjection,
  shouldSnapToRuler,
  wheelRotateAngle,
} from './drafting';

describe('Phase 18: Ruler geometry', () => {
  it('clamps angles to 0-90', () => {
    expect(clampRulerAngle(-20)).toBe(0);
    expect(clampRulerAngle(45)).toBe(45);
    expect(clampRulerAngle(200)).toBe(90);
  });

  it('rotates 1 degree per wheel notch, clamped', () => {
    expect(wheelRotateAngle(45, -100)).toBe(46);
    expect(wheelRotateAngle(45, 100)).toBe(44);
    expect(wheelRotateAngle(90, -100)).toBe(90);
    expect(wheelRotateAngle(0, 100)).toBe(0);
  });

  it('keeps the hinge point fixed during rotation', () => {
    const rotated = rotateAroundHinge({ x: 100, y: 50 }, 0, { x: 160, y: 50 }, 90);
    expect(rotated.angle).toBe(90);
    // Rotation about hinge (160,50): origin should move to hinge + rotated offset.
    expect(rotated.origin.x).toBeCloseTo(160, 5);
    expect(rotated.origin.y).toBeCloseTo(110, 5);
  });

  it('projects onto a horizontal ruler', () => {
    const { distance, projected } = rulerProjection({ x: 0, y: 50 }, 0, { x: 30, y: 80 });
    expect(distance).toBe(30);
    expect(projected).toEqual({ x: 30, y: 50 });
  });

  it('projects onto a vertical ruler', () => {
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

  it('respects a custom zoom-scaled snap threshold', () => {
    expect(shouldSnapToRuler({ x: 0, y: 50 }, 0, { x: 10, y: 80 })).toBe(false);
    expect(shouldSnapToRuler({ x: 0, y: 50 }, 0, { x: 10, y: 80 }, 36)).toBe(true);
  });

  it('does not snap past the physical ends', () => {
    expect(shouldSnapToRuler({ x: 0, y: 50 }, 0, { x: 500, y: 52 })).toBe(false);
    expect(shouldSnapToRuler({ x: 0, y: 50 }, 0, { x: 100, y: 52 })).toBe(true);
  });

  it('snaps onto any of the four edges (short sides too)', () => {
    // Near the right short edge center (along=+160).
    const edge = rulerEdgeProjection({ x: 0, y: 0 }, 0, { x: 172, y: 0 });
    expect(edge).not.toBeNull();
    expect(edge?.projected.x).toBeCloseTo(160, 5);
    expect(edge?.projected.y).toBeCloseTo(0, 5);
    // Far from every edge.
    expect(rulerEdgeProjection({ x: 0, y: 0 }, 0, { x: 0, y: 100 })).toBeNull();
  });
});
