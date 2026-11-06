/**
 * Phase 18 — Digital Drafting Tools (Ruler & Protractor).
 *
 * A draggable translucent straightedge with tick marks, and a 360° circular
 * protractor. Wheel rotation works in 1° steps (Shift: 15°), and drawing
 * near the ruler edge (or the protractor arc) snaps the stroke onto it.
 */

export type DraftingTool = 'off' | 'ruler' | 'protractor';

export const RULER_WHEEL_STEP = 1;
export const RULER_WHEEL_STEP_FAST = 15;
export const RULER_SNAP_DISTANCE = 18;
export const PROTRACTOR_RADIUS = 90;
export const PROTRACTOR_SNAP_DISTANCE = 14;

/** Normalizes any angle to [0, 360). */
export function normalizeAngle(degrees: number): number {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

/** Rotates an angle by a wheel delta (1° per notch, Shift: 15°). */
export function wheelRotateAngle(current: number, deltaY: number, shift: boolean): number {
  const step = shift ? RULER_WHEEL_STEP_FAST : RULER_WHEEL_STEP;
  return normalizeAngle(current + (deltaY < 0 ? step : -step));
}

/** Unit direction for an angle in degrees (0° = east, counter-clockwise). */
export function angleDirection(degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.cos(radians), y: -Math.sin(radians) };
}

export interface DraftPoint {
  x: number;
  y: number;
}

/**
 * Distance from a point to the infinite ruler line through (origin) with the
 * given rotation. Returns the signed distance and the projection point.
 */
export function rulerProjection(
  origin: DraftPoint,
  angle: number,
  point: DraftPoint
): { distance: number; projected: DraftPoint } {
  const direction = angleDirection(angle);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const along = dx * direction.x + dy * direction.y;
  const perpendicular = -dx * direction.y + dy * direction.x;
  const projected = {
    x: origin.x + direction.x * along,
    y: origin.y + direction.y * along,
  };
  return { distance: Math.abs(perpendicular), projected };
}

/** Half-length of the rendered ruler straightedge (image px). */
export const RULER_HALF_LENGTH = 160;

/** True when the projected point lands on the physical straightedge segment. */
export function rulerProjectionOnSegment(
  origin: DraftPoint,
  angle: number,
  point: DraftPoint
): { distance: number; projected: DraftPoint; onSegment: boolean } {
  const { distance, projected } = rulerProjection(origin, angle, point);
  const along = Math.hypot(projected.x - origin.x, projected.y - origin.y);
  return { distance, projected, onSegment: along <= RULER_HALF_LENGTH };
}

/** True when a stroke point should snap onto the ruler edge. */
export function shouldSnapToRuler(
  origin: DraftPoint,
  angle: number,
  point: DraftPoint,
  threshold: number = RULER_SNAP_DISTANCE
): boolean {
  const { distance, onSegment } = rulerProjectionOnSegment(origin, angle, point);
  return onSegment && distance <= threshold;
}

/**
 * Distance from a point to the protractor's outer arc. Snapping follows the
 * circle when the pointer is near the rim.
 */
export function protractorArcDistance(center: DraftPoint, radius: number, point: DraftPoint): number {
  const distance = Math.hypot(point.x - center.x, point.y - center.y);
  return Math.abs(distance - radius);
}

/** True when a stroke point should snap onto the protractor arc. */
export function shouldSnapToProtractor(
  center: DraftPoint,
  radius: number,
  point: DraftPoint,
  threshold: number = PROTRACTOR_SNAP_DISTANCE
): boolean {
  return protractorArcDistance(center, radius, point) <= threshold;
}
