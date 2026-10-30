import { describe, expect, it } from 'bun:test';
import {
  getPointsBoundingBox,
  findHoveredWindow,
  cropRectangle,
  cropFreeform,
  cropFromDataUrl,
  cropFreeformFromDataUrl,
} from './capture';
import type { WindowRect } from './types';

describe('Phase 2: Capture Engine & Geometry Calculations', () => {
  it('computes exact bounding box for polygon points', () => {
    const points = [
      { x: 50, y: 100 },
      { x: 200, y: 80 },
      { x: 180, y: 350 },
      { x: 30, y: 220 },
    ];

    const bb = getPointsBoundingBox(points);
    expect(bb.x).toBe(30);
    expect(bb.y).toBe(80);
    expect(bb.width).toBe(170); // 200 - 30
    expect(bb.height).toBe(270); // 350 - 80
  });

  it('handles empty points gracefully', () => {
    const bb = getPointsBoundingBox([]);
    expect(bb.width).toBe(0);
    expect(bb.height).toBe(0);
  });

  it('finds hovered window containing coordinates', () => {
    const windows: WindowRect[] = [
      {
        id: 'root-desktop',
        title: 'Desktop',
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      },
      {
        id: 'editor-window',
        title: 'Code Editor',
        x: 100,
        y: 100,
        width: 800,
        height: 600,
      },
      {
        id: 'panel',
        title: 'Side Panel',
        x: 150,
        y: 150,
        width: 200,
        height: 300,
      },
    ];

    // Inside side panel (smallest window should be prioritized)
    const match1 = findHoveredWindow(windows, 180, 200);
    expect(match1).not.toBeNull();
    expect(match1?.id).toBe('panel');

    // Inside code editor, outside side panel
    const match2 = findHoveredWindow(windows, 500, 300);
    expect(match2).not.toBeNull();
    expect(match2?.id).toBe('editor-window');

    // Outside code editor, on root desktop
    const match3 = findHoveredWindow(windows, 1200, 800);
    expect(match3).not.toBeNull();
    expect(match3?.id).toBe('root-desktop');

    // Completely out of bounds
    const match4 = findHoveredWindow(windows, 3000, 3000);
    expect(match4).toBeNull();
  });

  it('handles empty data url gracefully in cropFromDataUrl', async () => {
    const res = await cropFromDataUrl('', { x: 0, y: 0, w: 100, h: 100 });
    expect(res).toBe('');
  });

  it('handles empty points gracefully in cropFreeformFromDataUrl', async () => {
    const res = await cropFreeformFromDataUrl('', []);
    expect(res.dataUrl).toBe('');
  });
});
