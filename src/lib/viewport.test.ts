import { describe, expect, it } from 'bun:test';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_SLIDER_STEPS,
  clampZoom,
  computeFitZoom,
  nudgeZoom,
  parseZoomInput,
  scrollDeltaToAnchor,
  sliderPositionToZoom,
  wheelZoom,
  zoomIn,
  zoomOut,
  zoomToSliderPosition,
} from './viewport';

describe('Phase 4: Canvas Viewport Navigation & Zoom', () => {
  it('clamps zoom values to the supported range', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(-25)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM + 500)).toBe(MAX_ZOOM);
    expect(clampZoom(145.5)).toBe(145.5);
    expect(clampZoom(Number.NaN)).toBe(100);
  });

  it('honours an optional zoom ceiling', () => {
    expect(clampZoom(900, 800)).toBe(800);
    expect(clampZoom(700, 800)).toBe(700);
    expect(clampZoom(50, 800)).toBe(50);
    expect(clampZoom(900, Number.NaN)).toBe(900);
  });

  it('reads a typed zoom percentage and clamps it', () => {
    expect(parseZoomInput('3200')).toBe(3200);
    expect(parseZoomInput('125.5')).toBe(125.5);
    expect(parseZoomInput('100%')).toBe(100);
    expect(parseZoomInput(' 75 % ')).toBe(75);
    expect(parseZoomInput('9999')).toBe(MAX_ZOOM);
    expect(parseZoomInput('0')).toBe(MIN_ZOOM);
    expect(parseZoomInput('-20')).toBe(MIN_ZOOM);
    expect(parseZoomInput('')).toBeNull();
    expect(parseZoomInput('   ')).toBeNull();
    expect(parseZoomInput('abc')).toBeNull();
    expect(parseZoomInput('12px')).toBeNull();
    expect(parseZoomInput('Infinity')).toBeNull();
  });

  it('steps zoom in and out around the current level', () => {
    expect(zoomIn(100)).toBe(125);
    expect(zoomOut(100)).toBe(80);
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
  });

  it('nudges the zoom by whole percentage points', () => {
    expect(nudgeZoom(100, 1)).toBe(101);
    expect(nudgeZoom(100, -1)).toBe(99);
    expect(nudgeZoom(52.08, 1)).toBe(53);
    expect(nudgeZoom(52.08, -1)).toBe(51);
    expect(nudgeZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nudgeZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it('applies continuous wheel zoom in both directions', () => {
    expect(wheelZoom(100, -100)).toBeGreaterThan(100);
    expect(wheelZoom(100, 100)).toBeLessThan(100);
    expect(wheelZoom(100, 0)).toBe(100);
    expect(wheelZoom(100, -100000)).toBe(MAX_ZOOM);
    expect(wheelZoom(100, 100000)).toBe(MIN_ZOOM);
  });

  it('maps the logarithmic zoom slider in both directions', () => {
    expect(zoomToSliderPosition(MIN_ZOOM, 3200)).toBe(0);
    expect(zoomToSliderPosition(3200, 3200)).toBe(ZOOM_SLIDER_STEPS);
    expect(sliderPositionToZoom(0, 3200)).toBe(MIN_ZOOM);
    expect(sliderPositionToZoom(ZOOM_SLIDER_STEPS, 3200)).toBe(3200);
    expect(sliderPositionToZoom(zoomToSliderPosition(100, 3200), 3200)).toBeGreaterThan(99);
    expect(sliderPositionToZoom(zoomToSliderPosition(100, 3200), 3200)).toBeLessThan(101);
    expect(sliderPositionToZoom(zoomToSliderPosition(800, 3200), 3200)).toBeGreaterThan(797);
    expect(sliderPositionToZoom(zoomToSliderPosition(800, 3200), 3200)).toBeLessThan(803);
  });

  it('fits large images inside the usable viewport without upscaling small ones', () => {
    expect(computeFitZoom(1000, 600, 1920, 1080)).toBeCloseTo(52.08, 2);
    expect(computeFitZoom(1000, 600, 800, 600)).toBe(100);
    expect(computeFitZoom(500, 500, 100, 100)).toBe(100);
    expect(computeFitZoom(500, 250, 1000, 1000)).toBe(25);
    expect(computeFitZoom(0, 600, 1920, 1080)).toBe(100);
    expect(computeFitZoom(1000, 600, 0, 1080)).toBe(100);
  });

  it('anchors the selected image point under the pointer while zooming', () => {
    // Pointer at x=500 over image pixel 500 at 100%; at 200% the canvas must
    // scroll right by 500px so the same pixel stays under the pointer.
    expect(scrollDeltaToAnchor(0, 500, 500, 2)).toBe(500);
    // Zooming out from 200% back to 100% scrolls back to the origin.
    expect(scrollDeltaToAnchor(0, 500, 500, 1)).toBe(0);
    // A canvas already offset to the left needs a smaller correction.
    expect(scrollDeltaToAnchor(-200, 500, 500, 1.5)).toBe(50);
  });
});
