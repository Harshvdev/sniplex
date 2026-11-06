import { describe, expect, it } from 'bun:test';
import {
  COLOR_PICKER_FORMATS,
  clampLoupeZoom,
  formatColor,
  nextColorFormat,
  readPixel,
  rgbToCss,
  rgbToHex,
  rgbToHsl,
  wheelLoupeZoom,
} from './color-picker';

describe('Phase 15: Color Picker', () => {
  it('formats hex as uppercase #RRGGBB', () => {
    expect(rgbToHex({ r: 0, g: 103, b: 192 })).toBe('#0067C0');
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe('#FFFFFF');
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
  });

  it('formats rgb() and hsl() strings', () => {
    expect(rgbToCss({ r: 255, g: 0, b: 0 })).toBe('rgb(255, 0, 0)');
    expect(rgbToHsl({ r: 0, g: 0, b: 0 })).toBe('hsl(0, 0%, 0%)');
    expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toBe('hsl(0, 0%, 100%)');
  });

  it('clamps channel values into 0–255', () => {
    expect(rgbToHex({ r: 999, g: -5, b: 0 })).toBe('#FF0000');
    expect(rgbToCss({ r: Number.NaN, g: 0, b: 0 })).toBe('rgb(0, 0, 0)');
  });

  it('formats in the selected format', () => {
    const color = { r: 0, g: 103, b: 192 };
    expect(formatColor(color, 'HEX')).toBe('#0067C0');
    expect(formatColor(color, 'RGB')).toBe('rgb(0, 103, 192)');
    expect(formatColor(color, 'HSL')).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });

  it('cycles the format toggle HEX → RGB → HSL → HEX', () => {
    expect(nextColorFormat('HEX')).toBe('RGB');
    expect(nextColorFormat('RGB')).toBe('HSL');
    expect(nextColorFormat('HSL')).toBe('HEX');
    expect(COLOR_PICKER_FORMATS).toEqual(['HEX', 'RGB', 'HSL']);
  });

  it('clamps loupe zoom to 2–16x', () => {
    expect(clampLoupeZoom(1)).toBe(2);
    expect(clampLoupeZoom(99)).toBe(16);
    expect(clampLoupeZoom(6)).toBe(6);
  });

  it('zooms the loupe with Ctrl+wheel, not plain wheel', () => {
    expect(wheelLoupeZoom(6, -100, false)).toBe(6);
    expect(wheelLoupeZoom(6, -100, true)).toBeGreaterThan(6);
    expect(wheelLoupeZoom(6, 100, true)).toBeLessThan(6);
  });

  it('reads pixels from a raw RGBA buffer', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    expect(readPixel(data, 2, 1, 0, 0)).toEqual({ r: 255, g: 0, b: 0 });
    expect(readPixel(data, 2, 1, 1, 0)).toEqual({ r: 0, g: 255, b: 0 });
    expect(readPixel(data, 2, 1, 5, 0)).toBeNull();
  });
});
