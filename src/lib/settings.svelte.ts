import type { AppTheme } from './types';

export interface SniplexSettings {
  theme: AppTheme;
  autoCopy: boolean;
  includeCursor: boolean;
  autoSaveScreenshots: boolean;
  screenshotFolder: string;
  autoSaveRecordings: boolean;
  recordingFolder: string;
  outlineEnabled: boolean;
  outlineColor: string;
  outlineWidth: number;
  multipleInstances: boolean;
  askToSave: boolean;
  announcements: boolean;
  printScreenShortcut: boolean;
  recordMicrophone: boolean;
  recordSystemAudio: boolean;
}

const STORAGE_KEY = 'sniplex_settings';
const LEGACY_THEME_KEY = 'sniplex_theme';
const LEGACY_AUTO_COPY_KEY = 'sniplex_auto_copy';
const LEGACY_FOLDER_KEY = 'sniplex_save_folder';

export const DEFAULT_SETTINGS: SniplexSettings = {
  theme: 'dark',
  autoCopy: true,
  includeCursor: false,
  autoSaveScreenshots: true,
  screenshotFolder: '~/Pictures/Screenshots',
  autoSaveRecordings: false,
  recordingFolder: '~/Videos/Screen Recordings',
  outlineEnabled: false,
  outlineColor: '#d13438',
  outlineWidth: 2,
  multipleInstances: false,
  askToSave: true,
  announcements: true,
  printScreenShortcut: true,
  recordMicrophone: false,
  recordSystemAudio: true,
};

const THEMES: AppTheme[] = ['light', 'dark', 'system'];

function readLegacyString(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function asWidth(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(20, Math.max(1, Math.round(value)));
}

function asFolder(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/** Reads persisted preferences, merging defaults and migrating older keys. */
export function loadSettings(): SniplexSettings {
  const legacyTheme = readLegacyString(LEGACY_THEME_KEY) as AppTheme | null;
  const legacyAutoCopy = readLegacyString(LEGACY_AUTO_COPY_KEY);
  const legacyFolder = readLegacyString(LEGACY_FOLDER_KEY);

  const base: SniplexSettings = {
    ...DEFAULT_SETTINGS,
    theme: legacyTheme && THEMES.includes(legacyTheme) ? legacyTheme : DEFAULT_SETTINGS.theme,
    autoCopy: legacyAutoCopy === null ? DEFAULT_SETTINGS.autoCopy : legacyAutoCopy === 'true',
    screenshotFolder: legacyFolder || DEFAULT_SETTINGS.screenshotFolder,
  };

  if (typeof localStorage === 'undefined') return base;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<SniplexSettings>;
    return {
      theme: typeof parsed.theme === 'string' && THEMES.includes(parsed.theme as AppTheme)
        ? (parsed.theme as AppTheme)
        : base.theme,
      autoCopy: asBoolean(parsed.autoCopy, base.autoCopy),
      includeCursor: asBoolean(parsed.includeCursor, base.includeCursor),
      autoSaveScreenshots: asBoolean(parsed.autoSaveScreenshots, base.autoSaveScreenshots),
      screenshotFolder: asFolder(parsed.screenshotFolder, base.screenshotFolder),
      autoSaveRecordings: asBoolean(parsed.autoSaveRecordings, base.autoSaveRecordings),
      recordingFolder: asFolder(parsed.recordingFolder, base.recordingFolder),
      outlineEnabled: asBoolean(parsed.outlineEnabled, base.outlineEnabled),
      outlineColor: asColor(parsed.outlineColor, base.outlineColor),
      outlineWidth: asWidth(parsed.outlineWidth, base.outlineWidth),
      multipleInstances: asBoolean(parsed.multipleInstances, base.multipleInstances),
      askToSave: asBoolean(parsed.askToSave, base.askToSave),
      announcements: asBoolean(parsed.announcements, base.announcements),
      printScreenShortcut: asBoolean(parsed.printScreenShortcut, base.printScreenShortcut),
      recordMicrophone: asBoolean(parsed.recordMicrophone, base.recordMicrophone),
      recordSystemAudio: asBoolean(parsed.recordSystemAudio, base.recordSystemAudio),
    };
  } catch {
    return base;
  }
}

/** Reactive singleton shared by every surface that reads preferences. */
export const settings = $state<SniplexSettings>(loadSettings());

export function persistSettings(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Failed to persist Sniplex settings:', err);
  }
}

export function updateSettings(patch: Partial<SniplexSettings>): void {
  Object.assign(settings, patch);
  persistSettings();
}
