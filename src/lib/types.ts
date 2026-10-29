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

export interface TabItem {
  id: string;
  title: string;
  imageUrl?: string;
  width: number;
  height: number;
  timestamp: string;
}

export type { ShortcutItem } from './shortcuts';

