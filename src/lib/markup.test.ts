import { describe, expect, it } from 'bun:test';
import { hitTestOp, type MarkupOp } from './markup';

describe('Phase 11: filled-shape erasing', () => {
  it('erases the interior of a solid-filled rectangle', () => {
    const op: MarkupOp = {
      type: 'shape',
      id: 'rect',
      shape: {
        kind: 'rectangle',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        outlineColor: '#000',
        fillColor: '#ff0000',
        strokeWidth: 3,
      },
    };
    expect(hitTestOp(op, { x: 50, y: 50 }, 10)).toBe(true);
  });

  it('erases the interior of a solid-filled oval', () => {
    const op: MarkupOp = {
      type: 'shape',
      id: 'oval',
      shape: {
        kind: 'oval',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 60 },
        outlineColor: '#000',
        fillColor: '#00ff00',
        strokeWidth: 3,
      },
    };
    expect(hitTestOp(op, { x: 50, y: 30 }, 2)).toBe(true);
  });

  it('does not erase the interior of a transparent shape', () => {
    const op: MarkupOp = {
      type: 'shape',
      id: 'hollow',
      shape: {
        kind: 'rectangle',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        outlineColor: '#000',
        fillColor: 'transparent',
        strokeWidth: 3,
      },
    };
    expect(hitTestOp(op, { x: 50, y: 50 }, 2)).toBe(false);
  });
});
