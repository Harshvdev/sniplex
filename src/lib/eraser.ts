/**
 * Phase 11 — Eraser geometry.
 *
 * The eraser removes foreground ink only — never the underlying capture.
 * A swipe hit-tests the brush against recorded stroke paths; a hit removes
 * that whole element. Erase-all-ink restores the pristine composite.
 */

export interface ErasePoint {
  x: number;
  y: number;
}

export const ERASER_BRUSH_SIZE = 20;

/** Distance from a point to the segment a–b (px). */
export function pointSegmentDistance(point: ErasePoint, a: ErasePoint, b: ErasePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const projectionX = a.x + t * dx;
  const projectionY = a.y + t * dy;
  return Math.hypot(point.x - projectionX, point.y - projectionY);
}

/** True when a brush centered at `brush` touches any segment of `path`. */
export function pathIntersectsBrush(path: ErasePoint[], brush: ErasePoint, brushRadius: number): boolean {
  if (path.length === 0) return false;
  if (path.length === 1) {
    return Math.hypot(path[0].x - brush.x, path[0].y - brush.y) <= brushRadius;
  }
  for (let i = 1; i < path.length; i += 1) {
    if (pointSegmentDistance(brush, path[i - 1], path[i]) <= brushRadius) return true;
  }
  return false;
}

/** Returns the indices of every recorded stroke touched by one brush dab. */
export function strokesHitByBrush(
  strokes: ErasePoint[][],
  brush: ErasePoint,
  brushRadius: number
): number[] {
  const hits: number[] = [];
  for (let i = 0; i < strokes.length; i += 1) {
    if (pathIntersectsBrush(strokes[i], brush, brushRadius)) hits.push(i);
  }
  return hits;
}
