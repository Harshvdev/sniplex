export const MIN_ZOOM = 10;
export const MAX_ZOOM = 3200;
export const ZOOM_STEP = 1.25;
export const ZOOM_SLIDER_STEPS = 1000;

/** Keeps every zoom value inside the supported viewport range. */
export function clampZoom(zoom: number, maximum: number = MAX_ZOOM): number {
  if (!Number.isFinite(zoom)) return 100;
  const max = Number.isFinite(maximum)
    ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, maximum))
    : MAX_ZOOM;
  return Math.min(max, Math.max(MIN_ZOOM, zoom));
}

/**
 * Reads a typed zoom percentage, clamped to the supported range. Returns null
 * when the text is not a usable number so the caller can keep the old value.
 */
export function parseZoomInput(value: string): number | null {
  const normalized = value.replace(/%/g, '').trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;

  return clampZoom(parsed);
}

/** Multiplies the current zoom by one step, clamped to the supported range. */
export function zoomIn(current: number, factor: number = ZOOM_STEP): number {
  return clampZoom(current * factor);
}

/** Divides the current zoom by one step, clamped to the supported range. */
export function zoomOut(current: number, factor: number = ZOOM_STEP): number {
  return clampZoom(current / factor);
}

/** Moves the zoom by whole percentage points, e.g. 100% to 101%. */
export function nudgeZoom(current: number, delta: number, maximum: number = MAX_ZOOM): number {
  return clampZoom(Math.round(current) + delta, maximum);
}

/**
 * Applies a wheel delta as a continuous multiplicative zoom change. The
 * exponential curve keeps every wheel tick the same perceived size regardless
 * of the current zoom level.
 */
export function wheelZoom(current: number, deltaY: number, sensitivity = 0.0015): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampZoom(current);
  return clampZoom(current * Math.exp(-deltaY * sensitivity));
}

/**
 * Maps a zoom percentage onto the logarithmic slider track. A linear track
 * would squeeze the useful 10-100% range into the first few pixels.
 */
export function zoomToSliderPosition(
  zoom: number,
  maximum: number = MAX_ZOOM,
  minimum: number = MIN_ZOOM
): number {
  const max = Math.max(minimum, maximum);
  if (max <= minimum) return 0;

  const clamped = clampZoom(zoom, max);
  const ratio = Math.log(clamped / minimum) / Math.log(max / minimum);
  return Math.round(Math.min(1, Math.max(0, ratio)) * ZOOM_SLIDER_STEPS);
}

/** Converts a logarithmic slider position back into a zoom percentage. */
export function sliderPositionToZoom(
  position: number,
  maximum: number = MAX_ZOOM,
  minimum: number = MIN_ZOOM
): number {
  const max = Math.max(minimum, maximum);
  if (max <= minimum) return clampZoom(minimum, max);

  const ratio = Math.min(1, Math.max(0, position / ZOOM_SLIDER_STEPS));
  return clampZoom(minimum * Math.pow(max / minimum, ratio), max);
}

/**
 * Calculates the zoom percentage at which the whole image fits inside the
 * usable viewport. Small images are never enlarged beyond `maximum`.
 */
export function computeFitZoom(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
  maximum = 100
): number {
  if (
    !(viewportWidth > 0) ||
    !(viewportHeight > 0) ||
    !(imageWidth > 0) ||
    !(imageHeight > 0)
  ) {
    return 100;
  }

  const ratio = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight) * 100;
  return clampZoom(Math.min(maximum, ratio));
}

/**
 * Returns how far a scroll container must jump so that `imagePoint` stays under
 * the pointer after the canvas is drawn at `newScale`.
 *
 * `currentCanvasLeft` is the canvas offset inside the viewport after the new
 * size has been laid out but before the scroll position changes.
 */
export function scrollDeltaToAnchor(
  currentCanvasLeft: number,
  pointerX: number,
  imagePointX: number,
  newScale: number
): number {
  return currentCanvasLeft + imagePointX * newScale - pointerX;
}
