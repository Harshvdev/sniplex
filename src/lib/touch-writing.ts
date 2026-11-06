import type { ToolType } from './types';

/**
 * What a single touch contact should do on the capture canvas.
 * - `draw`: lay down a stroke with the active markup tool (pen/highlighter)
 * - `pan`: move the viewport (two-finger gestures take over above this)
 * Both still zoom/pan together once a second contact arrives.
 */
export type TouchAction = 'draw' | 'pan';

export interface TouchDecisionInput {
  /** Current toolbar selection. */
  activeTool: ToolType;
  /** Phase 8 toggle: finger drawing enabled. */
  touchWritingEnabled: boolean;
  /** Crop overlay is up — touches must adjust the frame, never ink. */
  isCropping: boolean;
  /** Contact landed on the capture itself (not the viewport chrome). */
  insideCanvas: boolean;
}

/** Markup tools a finger may drive directly when Touch Writing is on. */
export function isFingerMarkupTool(tool: ToolType): boolean {
  return tool === 'pen' || tool === 'highlighter';
}

/**
 * One-finger contract (plan Phase 8):
 * - Touch Writing ON + markup tool => finger draws
 * - Touch Writing OFF (or non-markup tool) => finger pans/scrolls
 * - Cropping or off-canvas contacts never ink.
 */
export function touchActionFor(input: TouchDecisionInput): TouchAction {
  if (!input.touchWritingEnabled) return 'pan';
  if (input.isCropping || !input.insideCanvas) return 'pan';
  return isFingerMarkupTool(input.activeTool) ? 'draw' : 'pan';
}

/**
 * Migrates the pre-Phase-8 representation where Touch Writing was itself a
 * toolbar selection (`activeTool === 'touch'`). The stored toggle has since
 * become independent of the selection, so an active `touch` selection from an
 * older session simply means: toggle on, pen selected underneath.
 */
export function normalizeTouchWriting(
  activeTool: ToolType | 'touch',
  touchWritingEnabled: boolean
): { activeTool: ToolType; touchWritingEnabled: boolean } {
  if (activeTool === 'touch') return { activeTool: 'pen', touchWritingEnabled: true };
  return { activeTool, touchWritingEnabled };
}
