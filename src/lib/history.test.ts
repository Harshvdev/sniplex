import { describe, expect, it } from 'bun:test';
import { HistoryStack, copySnapshot, type HistorySnapshot } from './history';

function pixels(fill: number, w = 2, h = 2): HistorySnapshot {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe('Phase 9: History Engine', () => {
  it('starts empty with no undo or redo', () => {
    const history = new HistoryStack();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  it('undoes to the pre-edit bitmap and redoes to the post-edit bitmap', () => {
    const history = new HistoryStack();
    const before = pixels(10);
    const after = pixels(20);

    history.push('pen stroke', before, after);
    expect(history.canUndo).toBe(true);
    expect(history.nextUndoLabel).toBe('pen stroke');

    const undone = history.undo();
    expect(undone?.data[0]).toBe(10);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.nextRedoLabel).toBe('pen stroke');

    const redone = history.redo();
    expect(redone?.data[0]).toBe(20);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it('walks back through multiple edits in order', () => {
    const history = new HistoryStack();
    history.push('pen', pixels(1), pixels(2));
    history.push('highlighter', pixels(2), pixels(3));
    history.push('eraser', pixels(3), pixels(4));

    expect(history.undo()?.data[0]).toBe(3);
    expect(history.undo()?.data[0]).toBe(2);
    expect(history.undo()?.data[0]).toBe(1);
    expect(history.undo()).toBeNull();

    expect(history.redo()?.data[0]).toBe(2);
    expect(history.redo()?.data[0]).toBe(3);
    expect(history.redo()?.data[0]).toBe(4);
    expect(history.redo()).toBeNull();
  });

  it('a new edit clears the redo stack', () => {
    const history = new HistoryStack();
    history.push('pen', pixels(1), pixels(2));
    history.undo();
    expect(history.canRedo).toBe(true);

    history.push('shape', pixels(1), pixels(9));
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBeNull();
  });

  it('retains the full undo depth without truncation', () => {
    const history = new HistoryStack();
    for (let i = 0; i < 200; i += 1) {
      history.push(`edit ${i}`, pixels(i), pixels(i + 1));
    }
    expect(history.undoDepth).toBe(200);
    expect(history.nextUndoLabel).toBe('edit 199');
  });

  it('replaceLastAfter rewrites the latest after-state (wet-ink amend)', () => {
    const history = new HistoryStack();
    history.push('shape', pixels(1), pixels(2));
    history.replaceLastAfter(pixels(9));
    history.undo();
    expect(history.redo()?.data[0]).toBe(9);
  });

  it('clear() empties both stacks', () => {
    const history = new HistoryStack();
    history.push('pen', pixels(1), pixels(2));
    history.undo();
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(0);
  });

  it('copySnapshot isolates history from later canvas writes', () => {
    const original = pixels(7);
    const copy = copySnapshot(original);
    original.data[0] = 99;
    expect(copy.data[0]).toBe(7);
    expect(copy.width).toBe(original.width);
    expect(copy.height).toBe(original.height);
  });
});
