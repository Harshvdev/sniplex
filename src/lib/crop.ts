/**
 * Phase 14 — Image Cropping.
 *
 * An interactive 8-handle frame trims the capture. The crop commits
 * non-destructively: the composite is re-rendered from the selected
 * rectangle and the edit enters history like any other mutation.
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The eight resize handles around the crop frame. */
export type CropHandle =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';

export const CROP_MIN_SIZE = 8;

/** Full-canvas crop rect. */
export function fullCropRect(imageWidth: number, imageHeight: number): CropRect {
  return { x: 0, y: 0, width: Math.max(0, imageWidth), height: Math.max(0, imageHeight) };
}

/** Clamps a crop rect to the image bounds, enforcing a minimum size. */
export function clampCropRect(
  rect: CropRect,
  imageWidth: number,
  imageHeight: number,
  minSize = CROP_MIN_SIZE
): CropRect {
  let x = Math.max(0, Math.min(rect.x, imageWidth - minSize));
  let y = Math.max(0, Math.min(rect.y, imageHeight - minSize));
  let width = Math.max(minSize, Math.min(rect.width, imageWidth - x));
  let height = Math.max(minSize, Math.min(rect.height, imageHeight - y));
  if (x + width > imageWidth) width = imageWidth - x;
  if (y + height > imageHeight) height = imageHeight - y;
  return { x, y, width, height };
}

/**
 * Moves the edges addressed by `handle` by (dx, dy) in image pixels.
 * Returns a rect clamped to the image, or the input unchanged for an
 * unknown handle.
 */
export function resizeCropRect(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number
): CropRect {
  let { x, y, width, height } = rect;
  const left = x;
  const top = y;
  const right = x + width;
  const bottom = y + height;

  let nextLeft = left;
  let nextTop = top;
  let nextRight = right;
  let nextBottom = bottom;

  switch (handle) {
    case 'nw':
      nextLeft += dx;
      nextTop += dy;
      break;
    case 'n':
      nextTop += dy;
      break;
    case 'ne':
      nextTop += dy;
      nextRight += dx;
      break;
    case 'e':
      nextRight += dx;
      break;
    case 'se':
      nextRight += dx;
      nextBottom += dy;
      break;
    case 's':
      nextBottom += dy;
      break;
    case 'sw':
      nextLeft += dx;
      nextBottom += dy;
      break;
    case 'w':
      nextLeft += dx;
      break;
  }

  // Keep the frame at least CROP_MIN_SIZE on every side.
  if (nextRight - nextLeft < CROP_MIN_SIZE) {
    if (handle.includes('w')) nextLeft = nextRight - CROP_MIN_SIZE;
    else nextRight = nextLeft + CROP_MIN_SIZE;
  }
  if (nextBottom - nextTop < CROP_MIN_SIZE) {
    if (handle.includes('n')) nextTop = nextBottom - CROP_MIN_SIZE;
    else nextBottom = nextTop + CROP_MIN_SIZE;
  }

  nextLeft = Math.max(0, Math.min(nextLeft, imageWidth - CROP_MIN_SIZE));
  nextTop = Math.max(0, Math.min(nextTop, imageHeight - CROP_MIN_SIZE));
  nextRight = Math.max(nextLeft + CROP_MIN_SIZE, Math.min(nextRight, imageWidth));
  nextBottom = Math.max(nextTop + CROP_MIN_SIZE, Math.min(nextBottom, imageHeight));

  return { x: nextLeft, y: nextTop, width: nextRight - nextLeft, height: nextBottom - nextTop };
}

/** True when the rect actually changes the image. */
export function isEffectiveCrop(rect: CropRect, imageWidth: number, imageHeight: number): boolean {
  return rect.x > 0 || rect.y > 0 || rect.x + rect.width < imageWidth || rect.y + rect.height < imageHeight;
}
