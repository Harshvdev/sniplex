export interface PixelPoint {
  x: number;
  y: number;
}

/**
 * Rasterizes the line between two image pixels with Bresenham's algorithm.
 *
 * A one-pixel ballpoint stroke has to color whole pixels. Canvas strokes are
 * antialiased and a fractional mouse position would spread them over two or
 * three pixels, so small pen sizes paint these exact pixel coordinates instead.
 */
export function pixelLinePoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): PixelPoint[] {
  let x = Math.floor(startX);
  let y = Math.floor(startY);
  const targetX = Math.floor(endX);
  const targetY = Math.floor(endY);

  const points: PixelPoint[] = [{ x, y }];
  const deltaX = Math.abs(targetX - x);
  const stepX = x < targetX ? 1 : -1;
  const deltaY = -Math.abs(targetY - y);
  const stepY = y < targetY ? 1 : -1;
  let error = deltaX + deltaY;

  while (x !== targetX || y !== targetY) {
    const doubled = 2 * error;
    if (doubled >= deltaY) {
      error += deltaY;
      x += stepX;
    }
    if (doubled <= deltaX) {
      error += deltaX;
      y += stepY;
    }
    points.push({ x, y });
  }

  return points;
}
