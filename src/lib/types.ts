export type CaptureMode = 'snip' | 'record';

export type SnipType = 'rectangle' | 'window' | 'fullscreen' | 'freeform';

export type SnipDelay = 0 | 3 | 5 | 10;

export type ToolType =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'ruler'
  | 'touch'
  | 'crop'
  | 'text'
  | 'shapes'
  | 'emoji';

export type ShapeKind = 'rectangle' | 'oval' | 'line' | 'arrow' | 'star';

export type AppTheme = 'light' | 'dark' | 'system';

export type AppView = 'editor' | 'empty' | 'settings';

export type ZoomCommand = 'in' | 'out' | 'actual' | 'fit';

export interface CanvasAreaApi {
  exportPngBlob(): Promise<Blob | null>;
  fitToViewport(): boolean;
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

