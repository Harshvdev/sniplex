import { describe, expect, it } from 'bun:test';
import { isFingerMarkupTool, normalizeTouchWriting, touchActionFor } from './touch-writing';

describe('Phase 8: Touch Writing toggle', () => {
  it('draws with the pen when the toggle is on', () => {
    expect(
      touchActionFor({ activeTool: 'pen', touchWritingEnabled: true, isCropping: false, insideCanvas: true })
    ).toBe('draw');
  });

  it('draws with the highlighter when the toggle is on', () => {
    expect(
      touchActionFor({ activeTool: 'highlighter', touchWritingEnabled: true, isCropping: false, insideCanvas: true })
    ).toBe('draw');
  });

  it('pans when the toggle is off, even with a markup tool selected', () => {
    expect(
      touchActionFor({ activeTool: 'pen', touchWritingEnabled: false, isCropping: false, insideCanvas: true })
    ).toBe('pan');
    expect(
      touchActionFor({ activeTool: 'highlighter', touchWritingEnabled: false, isCropping: false, insideCanvas: true })
    ).toBe('pan');
  });

  it('pans for non-markup tools even when the toggle is on', () => {
    for (const tool of ['select', 'eraser', 'text', 'shapes', 'crop'] as const) {
      expect(
        touchActionFor({ activeTool: tool, touchWritingEnabled: true, isCropping: false, insideCanvas: true })
      ).toBe('pan');
    }
  });

  it('never inks while cropping or outside the canvas', () => {
    expect(
      touchActionFor({ activeTool: 'pen', touchWritingEnabled: true, isCropping: true, insideCanvas: true })
    ).toBe('pan');
    expect(
      touchActionFor({ activeTool: 'pen', touchWritingEnabled: true, isCropping: false, insideCanvas: false })
    ).toBe('pan');
  });

  it('restricts finger markup to pen and highlighter', () => {
    expect(isFingerMarkupTool('pen')).toBe(true);
    expect(isFingerMarkupTool('highlighter')).toBe(true);
    expect(isFingerMarkupTool('eraser')).toBe(false);
    expect(isFingerMarkupTool('select')).toBe(false);
  });

  it('migrates the legacy touch selection to toggle-on plus pen', () => {
    expect(normalizeTouchWriting('touch', false)).toEqual({ activeTool: 'pen', touchWritingEnabled: true });
    expect(normalizeTouchWriting('pen', false)).toEqual({ activeTool: 'pen', touchWritingEnabled: false });
    expect(normalizeTouchWriting('highlighter', true)).toEqual({ activeTool: 'highlighter', touchWritingEnabled: true });
  });
});
