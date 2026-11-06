/**
 * Phase 9 — History Engine (Undo / Redo).
 *
 * History entries store both a flattened composite bitmap *and* an optional
 * copy of the vector editor model (base image reference + op list). Undo
 * prefers re-rendering from the model — it is exact and dimension-safe (a
 * crop Undo restores the pre-crop canvas size for free) — and falls back to
 * the bitmap when no model is attached (legacy entries, tests).
 */

import type { EditorModel } from './markup';
import { cloneEditorModel } from './markup';

export interface HistorySnapshot {
  /** `getImageData`-style pixel buffer, copied on push. May be empty when a model is attached. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Phase 12/14 infrastructure: re-renderable editor state at this point in time. */
  model?: EditorModel;
}

export interface HistoryEntry {
  label: string;
  /** Bitmap before this edit — what Undo puts back on the canvas. */
  before: HistorySnapshot;
  /** Bitmap after this edit — what Redo puts back on the canvas. */
  after: HistorySnapshot | null;
}

export class HistoryStack {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /** Label of the edit Undo would revert, if any. */
  get nextUndoLabel(): string | null {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].label : null;
  }

  /** Label of the edit Redo would replay, if any. */
  get nextRedoLabel(): string | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1].label : null;
  }

  /**
   * Records a completed edit. `before` is the canvas bitmap captured when
   * the stroke/edit started; `after` is captured when it finished.
   * Performing a new edit clears the redo stack, as in every editor.
   */
  push(label: string, before: HistorySnapshot, after: HistorySnapshot): void {
    this.undoStack.push({ label, before, after });
    this.redoStack.length = 0;
  }

  /** Replaces the latest entry's `after` (wet-ink edits before merging). */
  replaceLastAfter(after: HistorySnapshot): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.after = after;
  }

  /**
   * Steps backwards. Returns the bitmap the canvas should now display,
   * or `null` when there is nothing to undo.
   */
  undo(): HistorySnapshot | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return entry.before;
  }

  /**
   * Steps forwards. Returns the bitmap the canvas should now display,
   * or `null` when there is nothing to redo.
   */
  redo(): HistorySnapshot | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return entry.after;
  }

  /** Drops all history (new capture / image load). */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

/** Deep-copies a pixel buffer (and the editor model, when present) so later edits cannot alias history. */
export function copySnapshot(snapshot: HistorySnapshot): HistorySnapshot {
  return {
    data: new Uint8ClampedArray(snapshot.data),
    width: snapshot.width,
    height: snapshot.height,
    model: snapshot.model ? cloneEditorModel(snapshot.model) : undefined,
  };
}
