import { describe, expect, it } from 'bun:test';
import { shortcutToAccelerator, shortcutToTrigger } from './global-shortcuts';

describe('Phase 6: Global shortcut accelerators', () => {
  it('maps modifier lists to desktop accelerator strings', () => {
    expect(shortcutToAccelerator(['Ctrl', 'Shift', 'S'])).toBe('CommandOrControl+Shift+S');
    expect(shortcutToAccelerator(['Ctrl', 'PrintScreen'])).toBe('CommandOrControl+PrintScreen');
    expect(shortcutToAccelerator(['Alt', 'Space'])).toBe('Alt+Space');
  });

  it('normalises single keys and drops duplicate modifiers', () => {
    expect(shortcutToAccelerator(['Ctrl', 'Control', 'n'])).toBe('CommandOrControl+N');
    expect(shortcutToAccelerator(['Escape'])).toBe('Escape');
  });

  it('returns null when no non-modifier key is present', () => {
    expect(shortcutToAccelerator([])).toBeNull();
    expect(shortcutToAccelerator(['Ctrl', 'Shift'])).toBeNull();
  });
});

describe('Portal shortcut triggers', () => {
  it('uses the portal modifier and keysym names', () => {
    expect(shortcutToTrigger(['Ctrl', 'Shift', 'S'])).toBe('CTRL+SHIFT+S');
    expect(shortcutToTrigger(['Ctrl', 'PrintScreen'])).toBe('CTRL+Print');
    expect(shortcutToTrigger(['Alt', 'Space'])).toBe('ALT+Space');
  });

  it('translates named keys to XDG keysyms', () => {
    expect(shortcutToTrigger(['F5'])).toBe('F5');
    expect(shortcutToTrigger(['Super', 'ArrowUp'])).toBe('LOGO+Up');
    expect(shortcutToTrigger(['Ctrl', 'PageDown'])).toBe('CTRL+Page_Down');
  });

  it('returns null when no non-modifier key is present', () => {
    expect(shortcutToTrigger([])).toBeNull();
    expect(shortcutToTrigger(['Ctrl', 'Shift'])).toBeNull();
  });
});
