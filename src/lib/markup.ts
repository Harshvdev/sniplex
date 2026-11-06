/**
 * Shared editor model (Phase 9 / 11 / 12 / 13 / 14 infrastructure).
 *
 * The composite canvas is fully determined by a *pristine* base image plus an
 * ordered list of markup operations. History, Undo/Redo, the eraser, crop and
 * label/emoji editing all re-render from this model instead of mutating
 * pixels incrementally, which guarantees:
 *
 * - Undo/Redo always restores an exact, consistent state (no bitmap drift,
 *   no dimension mismatch after a committed crop).
 * - The eraser removes whole *elements* (vector hit-testing), never
 *   brush-sized chunks of them.
 * - Moving or editing a text label never destroys other ink underneath.
 */

import type { ShapeGeometry } from './shapes';
import { shapeBounds } from './shapes';
import type { HeldShape } from './hold-snap';
import type { TextLabel } from './text-label';
import { labelHeight, labelWidth } from './text-label';
import type { ErasePoint } from './eraser';
import { pathIntersectsBrush } from './eraser';

export type MarkupOp =
  | {
      type: 'stroke';
      id: string;
      tool: 'pen' | 'highlighter';
      points: ErasePoint[];
      color: string;
      /** Pen: 1–36 (image px). Highlighter: 6–48 (image px). */
      size: number;
      /** Pen opacity 0.1–1 (highlighter uses a fixed translucent alpha). */
      opacity: number;
      /** Set when Draw & Hold snapped the stroke to a clean shape. */
      snapped: HeldShape | null;
    }
  | { type: 'shape'; id: string; shape: ShapeGeometry }
  | {
      type: 'emoji';
      id: string;
      glyph: string;
      x: number;
      y: number;
      size: number;
      /** Radians, counter-clockwise (screen convention: rotated around the glyph center). */
      rotation: number;
    }
  | { type: 'label'; id: string; label: TextLabel };

/** The complete, re-renderable state of the editor canvas. */
export interface EditorModel {
  /** Pristine base (screenshot or opened image). `null` for a blank canvas. */
  sourceImage: CanvasImageSource | null;
  width: number;
  height: number;
  ops: MarkupOp[];
}

let markupOpCounter = 0;

export function createMarkupOpId(prefix: string): string {
  markupOpCounter += 1;
  return `${prefix}-${markupOpCounter}`;
}

/**
 * Deep-clones markup ops. Ops round-trip through JSON rather than
 * structuredClone because ops stored in Svelte `$state` are reactive proxies,
 * which structuredClone rejects — and these are plain JSON-safe objects anyway.
 */
export function cloneMarkupOps(ops: MarkupOp[]): MarkupOp[] {
  return JSON.parse(JSON.stringify(ops)) as MarkupOp[];
}

/** Deep-clones the model for history. The source image is referenced, not copied. */
export function cloneEditorModel(model: EditorModel): EditorModel {
  return {
    sourceImage: model.sourceImage,
    width: model.width,
    height: model.height,
    ops: cloneMarkupOps(model.ops),
  };
}

/** Axis-aligned bounds of any op, in image pixels. */
export function opBounds(op: MarkupOp): { left: number; top: number; right: number; bottom: number } {
  switch (op.type) {
    case 'stroke': {
      if (op.points.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 };
      let left = op.points[0].x;
      let right = op.points[0].x;
      let top = op.points[0].y;
      let bottom = op.points[0].y;
      for (const point of op.points) {
        if (point.x < left) left = point.x;
        if (point.x > right) right = point.x;
        if (point.y < top) top = point.y;
        if (point.y > bottom) bottom = point.y;
      }
      const pad = op.size / 2;
      if (op.snapped) {
        const s = op.snapped;
        return {
          left: Math.min(s.x1, s.x2) - pad,
          top: Math.min(s.y1, s.y2) - pad,
          right: Math.max(s.x1, s.x2) + pad,
          bottom: Math.max(s.y1, s.y2) + pad,
        };
      }
      return { left: left - pad, top: top - pad, right: right + pad, bottom: bottom + pad };
    }
    case 'shape': {
      const bounds = shapeBounds(op.shape);
      const pad = op.shape.strokeWidth / 2;
      return {
        left: bounds.left - pad,
        top: bounds.top - pad,
        right: bounds.right + pad,
        bottom: bounds.bottom + pad,
      };
    }
    case 'emoji': {
      const half = op.size / 2;
      return { left: op.x - half, top: op.y - half, right: op.x + half, bottom: op.y + half };
    }
    case 'label': {
      const width = labelWidth(op.label);
      const height = labelHeight(op.label);
      return { left: op.label.x, top: op.label.y, right: op.label.x + width, bottom: op.label.y + height };
    }
  }
}

/** Returns a copy of the op translated by (dx, dy). */
export function translateOp(op: MarkupOp, dx: number, dy: number): MarkupOp {
  switch (op.type) {
    case 'stroke':
      return {
        ...op,
        points: op.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        snapped: op.snapped
          ? { ...op.snapped, x1: op.snapped.x1 + dx, y1: op.snapped.y1 + dy, x2: op.snapped.x2 + dx, y2: op.snapped.y2 + dy }
          : null,
      };
    case 'shape':
      return {
        ...op,
        shape: {
          ...op.shape,
          start: { x: op.shape.start.x + dx, y: op.shape.start.y + dy },
          end: { x: op.shape.end.x + dx, y: op.shape.end.y + dy },
        },
      };
    case 'emoji':
      return { ...op, x: op.x + dx, y: op.y + dy };
    case 'label':
      return { ...op, label: { ...op.label, x: op.label.x + dx, y: op.label.y + dy } };
  }
}

/** True when the op's bounds touch the rect at all. */
export function opIntersectsRect(
  op: MarkupOp,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  const b = opBounds(op);
  return b.left < rect.x + rect.width && b.right > rect.x && b.top < rect.y + rect.height && b.bottom > rect.y;
}

/** Points sampled along a shape's outline, for distance-based brush hit-testing. */
export function sampleShapeOutline(shape: ShapeGeometry, segments = 48): ErasePoint[] {
  const b = shapeBounds(shape);
  if (shape.kind === 'rectangle') {
    return [
      { x: b.left, y: b.top },
      { x: b.right, y: b.top },
      { x: b.right, y: b.bottom },
      { x: b.left, y: b.bottom },
      { x: b.left, y: b.top },
    ];
  }
  if (shape.kind === 'oval') {
    const cx = (b.left + b.right) / 2;
    const cy = (b.top + b.bottom) / 2;
    const rx = Math.max(0.5, (b.right - b.left) / 2);
    const ry = Math.max(0.5, (b.bottom - b.top) / 2);
    const points: ErasePoint[] = [];
    for (let i = 0; i <= segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry });
    }
    return points;
  }
  // Line and arrow: the two endpoints suffice for segment-distance hit-testing.
  return [{ x: shape.start.x, y: shape.start.y }, { x: shape.end.x, y: shape.end.y }];
}

/** True when the brush at `point` should erase this element (whole-element semantics). */
export function hitTestOp(op: MarkupOp, point: ErasePoint, brushRadius: number): boolean {
  switch (op.type) {
    case 'stroke': {
      const pad = brushRadius + op.size / 2;
      if (op.snapped) {
        const s = op.snapped;
        const bounds = { left: Math.min(s.x1, s.x2), top: Math.min(s.y1, s.y2), right: Math.max(s.x1, s.x2), bottom: Math.max(s.y1, s.y2) };
        // For snapped shapes, test the four edges (coarse but whole-element).
        const edges: [ErasePoint, ErasePoint][] =
          s.kind === 'oval'
            ? []
            : s.kind === 'line' || s.kind === 'arrow'
              ? [[{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]]
              : [
                  [{ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top }],
                  [{ x: bounds.right, y: bounds.top }, { x: bounds.right, y: bounds.bottom }],
                  [{ x: bounds.right, y: bounds.bottom }, { x: bounds.left, y: bounds.bottom }],
                  [{ x: bounds.left, y: bounds.bottom }, { x: bounds.left, y: bounds.top }],
                ];
        if (edges.length === 0) {
          const cx = (bounds.left + bounds.right) / 2;
          const cy = (bounds.top + bounds.bottom) / 2;
          const rx = Math.max(0.5, (bounds.right - bounds.left) / 2);
          const ry = Math.max(0.5, (bounds.bottom - bounds.top) / 2);
          for (let i = 0; i <= 48; i += 1) {
            const a = (i / 48) * Math.PI * 2;
            edges.push([
              { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry },
              { x: cx + Math.cos((i + 1) / 48 * Math.PI * 2) * rx, y: cy + Math.sin((i + 1) / 48 * Math.PI * 2) * ry },
            ]);
          }
        }
        return edges.some(([a, b]) => pathIntersectsBrush([a, b], point, pad));
      }
      return pathIntersectsBrush(op.points, point, pad);
    }
    case 'shape': {
      // A filled rectangle/oval is hit anywhere inside its fill, not only on
      // its outline — otherwise swiping the interior of a solid shape would
      // never erase it.
      if (op.shape.fillColor !== 'transparent') {
        const b = shapeBounds(op.shape);
        if (op.shape.kind === 'rectangle') {
          if (point.x >= b.left && point.x <= b.right && point.y >= b.top && point.y <= b.bottom) return true;
        } else if (op.shape.kind === 'oval') {
          const cx = (b.left + b.right) / 2;
          const cy = (b.top + b.bottom) / 2;
          const rx = Math.max(0.5, (b.right - b.left) / 2);
          const ry = Math.max(0.5, (b.bottom - b.top) / 2);
          const nx = (point.x - cx) / rx;
          const ny = (point.y - cy) / ry;
          if (nx * nx + ny * ny <= 1) return true;
        }
      }
      return pathIntersectsBrush(sampleShapeOutline(op.shape), point, brushRadius + op.shape.strokeWidth / 2);
    }
    case 'emoji':
      return Math.hypot(op.x - point.x, op.y - point.y) <= brushRadius + op.size / 2;
    case 'label': {
      const b = opBounds(op);
      return point.x >= b.left - brushRadius && point.x <= b.right + brushRadius && point.y >= b.top - brushRadius && point.y <= b.bottom + brushRadius;
    }
  }
}
