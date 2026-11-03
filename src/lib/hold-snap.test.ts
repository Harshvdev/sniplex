import { describe, expect, it } from 'bun:test';
import { detectHeldShape, type StrokePoint } from './hold-snap';

function rectanglePoints(width = 200, height = 120): StrokePoint[] {
  const points: StrokePoint[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) points.push({ x: (width * i) / steps, y: 0 });
  for (let i = 1; i <= steps; i++) points.push({ x: width, y: (height * i) / steps });
  for (let i = 1; i <= steps; i++) points.push({ x: width - (width * i) / steps, y: height });
  for (let i = 1; i <= steps; i++) points.push({ x: 0, y: height - (height * i) / steps });
  return points;
}

function circlePoints(radius = 60, segments = 48): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (Math.PI * 2 * i) / segments;
    points.push({
      x: radius + Math.cos(angle) * radius,
      y: radius + Math.sin(angle) * radius,
    });
  }
  return points;
}

function linePoints(): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i <= 20; i++) {
    points.push({ x: 10 + i * 10, y: 60 + Math.sin(i / 3) * 1.2 });
  }
  return points;
}

function arrowPoints(): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i <= 20; i++) points.push({ x: 10 + i * 10, y: 100 });
  points.push({ x: 205, y: 92 });
  points.push({ x: 195, y: 82 });
  points.push({ x: 185, y: 74 });
  points.push({ x: 180, y: 78 });
  return points;
}

describe('Phase 7: Draw & Hold shape recognition', () => {
  it('snaps a closed rectangular stroke', () => {
    const shape = detectHeldShape(rectanglePoints());
    expect(shape?.kind).toBe('rectangle');
    expect(shape?.x1).toBeCloseTo(0, 0);
    expect(shape?.y1).toBeCloseTo(0, 0);
    expect(shape?.x2).toBeCloseTo(200, 0);
    expect(shape?.y2).toBeCloseTo(120, 0);
  });

  it('snaps a closed round stroke to an oval', () => {
    const shape = detectHeldShape(circlePoints());
    expect(shape?.kind).toBe('oval');
    expect(shape?.x2! - shape?.x1!).toBeCloseTo(120, 0);
  });

  it('snaps a rough straight stroke to a line', () => {
    const shape = detectHeldShape(linePoints());
    expect(shape?.kind).toBe('line');
    expect(shape?.x1).toBeCloseTo(10, 0);
    expect(shape?.x2).toBeCloseTo(210, 0);
  });

  it('recognises a shaft with a folded-back head as an arrow', () => {
    const shape = detectHeldShape(arrowPoints());
    expect(shape?.kind).toBe('arrow');
    expect(shape?.x2).toBeGreaterThan(190);
  });

  it('leaves short or shapeless scribbles freehand', () => {
    expect(detectHeldShape([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBeNull();
    expect(
      detectHeldShape([
        { x: 10, y: 10 },
        { x: 40, y: 40 },
        { x: 20, y: 80 },
        { x: 90, y: 30 },
        { x: 30, y: 120 },
        { x: 110, y: 70 },
      ])
    ).toBeNull();
  });
});
