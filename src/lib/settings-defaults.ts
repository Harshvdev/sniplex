import type { AppTheme } from './types';

export interface SniplexSettings {
  theme: AppTheme;
  usePrintScreenKey: boolean;
  autoCopy: boolean;
  autoSaveScreenshots: boolean;
  screenshotFolder: string;
  askToSaveScreenshots: boolean;
  multipleInstances: boolean;
  outlineEnabled: boolean;
  outlineColor: string;
  outlineWidth: number;
  hdrCorrector: boolean;
  autoSaveRecordings: boolean;
  recordingFolder: string;
  askToSaveRecordings: boolean;
  recordMicrophone: boolean;
  recordSystemAudio: boolean;
  askToSave: boolean;
  announcements: boolean;
}

export const DEFAULT_SETTINGS: SniplexSettings = {
  theme: 'system',
  usePrintScreenKey: true,
  autoCopy: true,
  autoSaveScreenshots: true,
  screenshotFolder: '~/Pictures/Screenshots',
  askToSaveScreenshots: false,
  multipleInstances: false,
  outlineEnabled: false,
  outlineColor: '#d13438',
  outlineWidth: 2,
  hdrCorrector: false,
  autoSaveRecordings: true,
  recordingFolder: '~/Videos/Screen Recordings',
  askToSaveRecordings: true,
  recordMicrophone: false,
  recordSystemAudio: true,
  askToSave: false,
  announcements: true,
};

