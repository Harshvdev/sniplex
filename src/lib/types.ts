import type { EditorModel } from './markup';

export type CaptureMode = 'snip' | 'record';

export type SnipType = 'rectangle' | 'window' | 'fullscreen' | 'freeform';

export type SnipDelay = 0 | 3 | 5 | 10;

export type ToolType =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'crop'
  | 'text'
  | 'shapes';

export type ShapeKind = 'rectangle' | 'oval' | 'line' | 'arrow';

export type AppTheme = 'light' | 'dark' | 'system';

export type AppView = 'editor' | 'empty' | 'settings';

export type ZoomCommand = 'in' | 'out' | 'actual' | 'fit';

export interface CanvasAreaApi {
  exportPngBlob(): Promise<Blob | null>;
  /** Returns the flattened composite canvas (capture + markup), or null when unavailable. */
  compositeCanvas(): HTMLCanvasElement | null;
  fitToViewport(): boolean;
  /** Phase 9: restores a history snapshot onto the composite canvas. */
  restoreSnapshot(data: Uint8ClampedArray, width: number, height: number, model?: EditorModel): void;
  /** Phase 9: captures the current editor model for history. */
  captureSnapshot(): { data: Uint8ClampedArray; width: number; height: number; model?: EditorModel } | null;
  /** Phase 11: removes all ink, keeping the pristine capture. */
  eraseAllInk(): void;
  /** Docked crop Apply/Cancel (secondary toolbar). */
  commitCrop(): void;
  cancelCrop(): void;
  /** Emoji palette click: stamps the glyph at the canvas center. */
  stampEmoji(glyph: string): void;
}

export interface TabItem {
  id: string;
  title: string;
  imageUrl?: string;
  width: number;
  height: number;
  timestamp: string;
}

export interface WindowRect {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopCapture {
  image_data_url: string;
  width: number;
  height: number;
  windows: WindowRect[];
}

export interface CapturePayload {
  imageUrl: string;
  width: number;
  height: number;
  mode: SnipType;
  delay?: SnipDelay;
}

export type { ShortcutItem } from './shortcuts';

