/**
 * Phase 18 — Digital Ruler Tool.
 *
 * A draggable translucent straightedge with tick marks. It rotates in the
 * 0°–90° range around the mouse cursor (the hinge point). Drawing near any
 * of the four edges with the pen or highlighter snaps the stroke onto that
 * edge; the eraser can be guided the same way.
 */

export type DraftingTool = 'off' | 'ruler';

export const RULER_WHEEL_STEP = 1;
export const RULER_SNAP_DISTANCE = 18;

/** Half-length of the rendered ruler straightedge (image px). */
export const RULER_HALF_LENGTH = 160;
/** Half-thickness of the rendered ruler strip (image px). */
export const RULER_HALF_THICKNESS = 16;

export const RULER_MIN_ANGLE = 0;
export const RULER_MAX_ANGLE = 90;

/** Clamps an angle into the ruler's 0°–90° travel. */
export function clampRulerAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return RULER_MIN_ANGLE;
  return Math.min(RULER_MAX_ANGLE, Math.max(RULER_MIN_ANGLE, degrees));
}

/** Rotates the ruler by one wheel notch, clamped to 0°–90°. */
export function wheelRotateAngle(current: number, deltaY: number): number {
  const step = RULER_WHEEL_STEP;
  return clampRulerAngle(current + (deltaY < 0 ? step : -step));
}

/**
 * Rotates `origin` around the hinge point so the hinge stays under the
 * cursor. Returns the new origin and angle. This is the pointer-tip hinge
 * rotation: the ruler turns about the cursor, not about its own center.
 */
export function rotateAroundHinge(
  origin: DraftPoint,
  angle: number,
  hinge: DraftPoint,
  deltaDegrees: number
): { origin: DraftPoint; angle: number } {
  const nextAngle = clampRulerAngle(angle + deltaDegrees);
  const applied = nextAngle - angle;
  const radians = (applied * Math.PI) / 180;
  const dx = origin.x - hinge.x;
  const dy = origin.y - hinge.y;
  return {
    angle: nextAngle,
    origin: {
      x: hinge.x + dx * Math.cos(radians) + dy * Math.sin(radians),
      y: hinge.y - dx * Math.sin(radians) + dy * Math.cos(radians),
    },
  };
}

/** Unit direction for an angle in degrees (0° = east, counter-clockwise on screen). */
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
 * Projects a point onto the nearest of the ruler strip's four edges.
 * In ruler-local coordinates (along = across the strip length,
 * perpendicular = across its thickness) the four edges are the two long
 * sides at perpendicular ±half-thickness and the two short sides at
 * along ±half-length. Returns the closest edge point if it is within
 * `threshold` image pixels, otherwise null.
 */
export function rulerEdgeProjection(
  origin: DraftPoint,
  angle: number,
  point: DraftPoint,
  threshold: number = RULER_SNAP_DISTANCE
): { distance: number; projected: DraftPoint } | null {
  const direction = angleDirection(angle);
  const perpendicularDir = { x: -direction.y, y: direction.x };
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const along = dx * direction.x + dy * direction.y;
  const perp = dx * perpendicularDir.x + dy * perpendicularDir.y;

  type Edge = { a: number; p: number; ba: number; bp: number; horizontal: boolean };
  // In (along, perp) space each edge runs between its two endpoints.
  const edges: Edge[] = [
    { a: -RULER_HALF_LENGTH, p: -RULER_HALF_THICKNESS, ba: RULER_HALF_LENGTH, bp: -RULER_HALF_THICKNESS, horizontal: true },
    { a: -RULER_HALF_LENGTH, p: RULER_HALF_THICKNESS, ba: RULER_HALF_LENGTH, bp: RULER_HALF_THICKNESS, horizontal: true },
    { a: -RULER_HALF_LENGTH, p: -RULER_HALF_THICKNESS, ba: -RULER_HALF_LENGTH, bp: RULER_HALF_THICKNESS, horizontal: false },
    { a: RULER_HALF_LENGTH, p: -RULER_HALF_THICKNESS, ba: RULER_HALF_LENGTH, bp: RULER_HALF_THICKNESS, horizontal: false },
  ];

  function pointOnSegment(ax: number, ay: number, bx: number, by: number): { distance: number; projected: DraftPoint } {
    const lenSq = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((along - ax) * (bx - ax) + (perp - ay) * (by - ay)) / lenSq));
    const projAlong = ax + (bx - ax) * t;
    const projPerp = ay + (by - ay) * t;
    const distance = Math.hypot(along - projAlong, perp - projPerp);
    return {
      distance,
      projected: {
        x: origin.x + direction.x * projAlong + perpendicularDir.x * projPerp,
        y: origin.y + direction.y * projAlong + perpendicularDir.y * projPerp,
      },
    };
  }

  let best: { distance: number; projected: DraftPoint } | null = null;
  for (const edge of edges) {
    const candidate = pointOnSegment(edge.a, edge.p, edge.ba, edge.bp);
    if (candidate.distance <= threshold && (!best || candidate.distance < best.distance)) {
      best = candidate;
    }
  }
  return best;
}
