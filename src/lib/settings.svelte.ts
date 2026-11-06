import { DEFAULT_SETTINGS, type SniplexSettings } from './settings-defaults';
import type { AppTheme } from './types';

const STORAGE_KEY = 'sniplex_settings';
const LEGACY_THEME_KEY = 'sniplex_theme';
const LEGACY_AUTO_COPY_KEY = 'sniplex_auto_copy';
const LEGACY_FOLDER_KEY = 'sniplex_save_folder';

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
    // Migrate the old single "ask to save" toggle onto the screenshot toggle.
    askToSaveScreenshots: DEFAULT_SETTINGS.askToSaveScreenshots,
  };

  if (typeof localStorage === 'undefined') return base;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<SniplexSettings>;
    // Migrate old persisted blobs: the single askToSave toggle becomes the
    // screenshot prompt, and missing new keys fall back to spec defaults.
    const askToSaveScreenshots =
      typeof parsed.askToSaveScreenshots === 'boolean'
        ? parsed.askToSaveScreenshots
        : typeof parsed.askToSave === 'boolean'
          ? parsed.askToSave
          : base.askToSaveScreenshots;

    return {
      theme: typeof parsed.theme === 'string' && THEMES.includes(parsed.theme as AppTheme)
        ? (parsed.theme as AppTheme)
        : base.theme,
      usePrintScreenKey: asBoolean(parsed.usePrintScreenKey, base.usePrintScreenKey),
      autoCopy: asBoolean(parsed.autoCopy, base.autoCopy),
      autoSaveScreenshots: asBoolean(parsed.autoSaveScreenshots, base.autoSaveScreenshots),
      screenshotFolder: asFolder(parsed.screenshotFolder, base.screenshotFolder),
      askToSaveScreenshots,
      multipleInstances: asBoolean(parsed.multipleInstances, base.multipleInstances),
      outlineEnabled: asBoolean(parsed.outlineEnabled, base.outlineEnabled),
      outlineColor: asColor(parsed.outlineColor, base.outlineColor),
      outlineWidth: asWidth(parsed.outlineWidth, base.outlineWidth),
      hdrCorrector: asBoolean(parsed.hdrCorrector, base.hdrCorrector),
      autoSaveRecordings: asBoolean(parsed.autoSaveRecordings, base.autoSaveRecordings),
      recordingFolder: asFolder(parsed.recordingFolder, base.recordingFolder),
      askToSaveRecordings: asBoolean(parsed.askToSaveRecordings, base.askToSaveRecordings),
      recordMicrophone: asBoolean(parsed.recordMicrophone, base.recordMicrophone),
      recordSystemAudio: asBoolean(parsed.recordSystemAudio, base.recordSystemAudio),
      askToSave: askToSaveScreenshots,
      announcements: asBoolean(parsed.announcements, base.announcements),
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
