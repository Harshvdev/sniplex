/**
 * Phase 15 — Color Picker.
 *
 * A circular magnifying loupe reads exact pixel values around the pointer,
 * with zoom, and a format toggle (HEX / RGB / HSL). Left-click copies the
 * formatted code to the clipboard and closes the overlay.
 */

export type ColorFormat = 'HEX' | 'RGB' | 'HSL';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export const COLOR_PICKER_FORMATS: ColorFormat[] = ['HEX', 'RGB', 'HSL'];

/** Loupe zoom bounds (Ctrl+wheel). */
export const LOUPE_MIN_ZOOM = 2;
export const LOUPE_MAX_ZOOM = 16;
export const LOUPE_DEFAULT_ZOOM = 6;

export function clampLoupeZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return LOUPE_DEFAULT_ZOOM;
  return Math.min(LOUPE_MAX_ZOOM, Math.max(LOUPE_MIN_ZOOM, zoom));
}

/** One wheel notch changes the zoom by this factor. */
export function wheelLoupeZoom(current: number, deltaY: number, ctrl: boolean): number {
  if (!ctrl) return clampLoupeZoom(current);
  return clampLoupeZoom(current * (deltaY < 0 ? 1.1 : 0.9));
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function clampRgb(color: RgbColor): RgbColor {
  return { r: clampChannel(color.r), g: clampChannel(color.g), b: clampChannel(color.b) };
}

/** Formats a pixel as `#RRGGBB` (uppercase, e.g. `#0067C0`). */
export function rgbToHex(color: RgbColor): string {
  const { r, g, b } = clampRgb(color);
  const hex = (v: number) => v.toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Formats a pixel as `rgb(r, g, b)`. */
export function rgbToCss(color: RgbColor): string {
  const { r, g, b } = clampRgb(color);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Formats a pixel as `hsl(h, s%, l%)` (integer degrees/percent). */
export function rgbToHsl(color: RgbColor): string {
  const { r, g, b } = clampRgb(color);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2 / 255;

  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1)) / 255;
  return `hsl(${Math.round(hue)}, ${Math.round(saturation * 100)}%, ${Math.round(lightness * 100)}%)`;
}

/** Formats a pixel in the selected clipboard format. */
export function formatColor(color: RgbColor, format: ColorFormat): string {
  switch (format) {
    case 'HEX':
      return rgbToHex(color);
    case 'RGB':
      return rgbToCss(color);
    case 'HSL':
      return rgbToHsl(color);
  }
}

/** Cycles the format toggle forward. */
export function nextColorFormat(current: ColorFormat): ColorFormat {
  const index = COLOR_PICKER_FORMATS.indexOf(current);
  return COLOR_PICKER_FORMATS[(index + 1) % COLOR_PICKER_FORMATS.length];
}

/**
 * Reads pixel (x, y) from a raw RGBA buffer, or null outside the image.
 */
export function readPixel(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): RgbColor | null {
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const index = (y * width + x) * 4;
  if (index + 2 >= data.length) return null;
  return { r: data[index], g: data[index + 1], b: data[index + 2] };
}
