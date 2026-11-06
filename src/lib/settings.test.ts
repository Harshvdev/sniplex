import { describe, expect, it } from 'bun:test';
import { DEFAULT_SETTINGS } from './settings-defaults';

describe('Behavioral-plan settings defaults', () => {
  it('matches the specified defaults', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    expect(DEFAULT_SETTINGS.usePrintScreenKey).toBe(true);
    expect(DEFAULT_SETTINGS.autoCopy).toBe(true);
    expect(DEFAULT_SETTINGS.autoSaveScreenshots).toBe(true);
    expect(DEFAULT_SETTINGS.askToSaveScreenshots).toBe(false);
    expect(DEFAULT_SETTINGS.multipleInstances).toBe(false);
    expect(DEFAULT_SETTINGS.outlineEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.hdrCorrector).toBe(false);
    expect(DEFAULT_SETTINGS.autoSaveRecordings).toBe(true);
    expect(DEFAULT_SETTINGS.askToSaveRecordings).toBe(true);
    expect(DEFAULT_SETTINGS.recordMicrophone).toBe(false);
    expect(DEFAULT_SETTINGS.recordSystemAudio).toBe(true);
  });

  it('has no cursor-inclusion setting', () => {
    expect('includeCursor' in DEFAULT_SETTINGS).toBe(false);
  });
});
