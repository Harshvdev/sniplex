import { describe, expect, it } from 'bun:test';
import { shortcutToTrigger } from './global-shortcuts';

describe('Portal shortcut triggers', () => {
  it('uses the portal modifier and keysym names', () => {
    expect(shortcutToTrigger(['Ctrl', 'Shift', 'S'])).toBe('CTRL+SHIFT+S');
    expect(shortcutToTrigger(['Ctrl', 'PrintScreen'])).toBe('CTRL+Print');
    expect(shortcutToTrigger(['Alt', 'Space'])).toBe('ALT+Space');
  });

  it('normalises single keys and drops duplicate modifiers', () => {
    expect(shortcutToTrigger(['Ctrl', 'Control', 'S'])).toBe('CTRL+S');
    expect(shortcutToTrigger(['Escape'])).toBe('Escape');
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

