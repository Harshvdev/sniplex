import { describe, expect, it } from 'bun:test';
import {
  CROP_MIN_SIZE,
  clampCropRect,
  fullCropRect,
  isEffectiveCrop,
  resizeCropRect,
} from './crop';

describe('Phase 14: Image Crop geometry', () => {
  it('produces a full-canvas rect for a new capture', () => {
    expect(fullCropRect(1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('clamps an out-of-bounds rect into the image', () => {
    expect(clampCropRect({ x: -50, y: -50, width: 5000, height: 5000 }, 1000, 800)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 800,
    });
  });

  it('enforces the minimum frame size on every side', () => {
    const rect = clampCropRect({ x: 10, y: 10, width: 2, height: 2 }, 1000, 800);
    expect(rect.width).toBeGreaterThanOrEqual(CROP_MIN_SIZE);
    expect(rect.height).toBeGreaterThanOrEqual(CROP_MIN_SIZE);
  });

  it('moves corner handles on both axes', () => {
    const rect = { x: 100, y: 100, width: 200, height: 200 };
    const next = resizeCropRect(rect, 'se', 40, 30, 1000, 800);
    expect(next).toEqual({ x: 100, y: 100, width: 240, height: 230 });

    const northwest = resizeCropRect(rect, 'nw', 20, 15, 1000, 800);
    expect(northwest).toEqual({ x: 120, y: 115, width: 180, height: 185 });
  });

  it('moves edge handles on their own axis', () => {
    const rect = { x: 100, y: 100, width: 200, height: 200 };
    expect(resizeCropRect(rect, 'e', 25, 99, 1000, 800).width).toBe(225);
    expect(resizeCropRect(rect, 's', 99, 25, 1000, 800).height).toBe(225);
    expect(resizeCropRect(rect, 'n', 0, -20, 1000, 800).y).toBe(80);
  });

  it('refuses to invert the frame on any handle', () => {
    const rect = { x: 100, y: 100, width: 50, height: 50 };
    const next = resizeCropRect(rect, 'se', -500, -500, 1000, 800);
    expect(next.width).toBeGreaterThanOrEqual(CROP_MIN_SIZE);
    expect(next.height).toBeGreaterThanOrEqual(CROP_MIN_SIZE);
  });

  it('detects whether a crop actually trims the image', () => {
    expect(isEffectiveCrop({ x: 0, y: 0, width: 1000, height: 800 }, 1000, 800)).toBe(false);
    expect(isEffectiveCrop({ x: 10, y: 0, width: 990, height: 800 }, 1000, 800)).toBe(true);
  });
});
