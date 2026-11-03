export interface StrokePoint {
  x: number;
  y: number;
}

export type HeldShapeKind = 'rectangle' | 'oval' | 'line' | 'arrow';

/**
 * A held stroke snapped to clean geometry. Rectangle and oval use the
 * top-left/bottom-right pair; line and arrow use the two endpoints.
 */
export interface HeldShape {
  kind: HeldShapeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const MIN_POINTS = 6;
const MIN_EXTENT = 16;
const CLOSE_RATIO = 0.3;
const CLOSE_MIN_GAP = 10;
const LINE_STRAIGHTNESS = 1.08;
const ARROW_SHAFT_STRAIGHTNESS = 1.14;

function distance(a: StrokePoint, b: StrokePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pathLength(points: StrokePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

function boundingBox(points: StrokePoint[]) {
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/** Counts how many bounding-box corners the stroke actually visits. */
function cornerHits(
  points: StrokePoint[],
  box: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number }
): number {
  const tolerance = Math.min(40, Math.max(8, Math.min(box.width, box.height) * 0.18));
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];

  let hits = 0;
  for (const corner of corners) {
    if (points.some((point) => distance(point, corner) <= tolerance)) {
      hits += 1;
    }
  }
  return hits;
}

interface ArrowGeometry {
  tip: StrokePoint;
  shaftLength: number;
}

/** Detects a shaft followed by a short returning arrowhead. */
function arrowGeometry(
  points: StrokePoint[],
  cumulative: number[],
  total: number,
  box: { width: number; height: number }
): ArrowGeometry | null {
  if (points.length < 8) return null;

  let tipIndex = 0;
  let tipDistance = 0;
  for (let i = 1; i < points.length; i++) {
    const d = distance(points[0], points[i]);
    if (d > tipDistance) {
      tipDistance = d;
      tipIndex = i;
    }
  }

  // A straight line's farthest sample is its end, so there is no tail to fold
  // back into a head.
  if (tipIndex < 3 || tipIndex > points.length - 3) return null;

  const shaftLength = cumulative[tipIndex];
  if (shaftLength < MIN_EXTENT) return null;

  // The shaft itself must read as a line.
  if (shaftLength / Math.max(1, tipDistance) > ARROW_SHAFT_STRAIGHTNESS) return null;

  const tailLength = total - shaftLength;
  if (tailLength < Math.max(12, total * 0.1)) return null;

  const tip = points[tipIndex];
  let spread = 0;
  for (let i = tipIndex + 1; i < points.length; i++) {
    spread = Math.max(spread, distance(tip, points[i]));
  }
  if (spread > Math.max(24, tipDistance * 0.45)) return null;

  // The returning stroke has to move away from the shaft, otherwise a slightly
  // bent line would be mistaken for an arrow.
  let lateral = 0;
  const dx = tip.x - points[0].x;
  const dy = tip.y - points[0].y;
  const length = Math.hypot(dx, dy) || 1;
  for (let i = tipIndex + 1; i < points.length; i++) {
    const px = points[i].x - points[0].x;
    const py = points[i].y - points[0].y;
    lateral = Math.max(lateral, Math.abs(px * (dy / length) - py * (dx / length)));
  }
  if (lateral < Math.min(10, Math.max(6, tipDistance * 0.08))) return null;
  if (Math.max(box.width, box.height) < MIN_EXTENT) return null;

  return { tip, shaftLength };
}

/**
 * Classifies a finished freehand stroke into one of the shapes that Draw & Hold
 * recognises. Returns null when the stroke should stay freehand.
 */
export function detectHeldShape(points: StrokePoint[]): HeldShape | null {
  if (points.length < MIN_POINTS) return null;

  const box = boundingBox(points);
  if (Math.max(box.width, box.height) < MIN_EXTENT) return null;

  const total = pathLength(points);
  if (total < MIN_EXTENT) return null;

  const start = points[0];
  const end = points[points.length - 1];
  const gap = distance(start, end);
  const closed = gap <= Math.max(CLOSE_MIN_GAP, CLOSE_RATIO * Math.max(box.width, box.height));

  if (closed && total > Math.max(box.width, box.height) * 1.2) {
    const hits = cornerHits(points, box);
    return {
      kind: hits >= 3 ? 'rectangle' : 'oval',
      x1: box.minX,
      y1: box.minY,
      x2: box.maxX,
      y2: box.maxY,
    };
  }

  const chord = distance(start, end);
  if (chord < MIN_EXTENT) return null;

  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]));
  }

  const arrow = arrowGeometry(points, cumulative, total, box);
  if (arrow) {
    return {
      kind: 'arrow',
      x1: start.x,
      y1: start.y,
      x2: arrow.tip.x,
      y2: arrow.tip.y,
    };
  }

  if (total / chord <= LINE_STRAIGHTNESS) {
    return { kind: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }

  return null;
}
