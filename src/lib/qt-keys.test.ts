import { describe, expect, it } from 'bun:test';
import { decodeCode, encodeShortcut } from './qt-keys';

describe('Desktop shortcut codes', () => {
  it('matches the codes the shortcut service reported for the shipped defaults', () => {
    expect(encodeShortcut(['Ctrl', 'Shift', 'S'])).toEqual([100663379]);
    expect(encodeShortcut(['Ctrl', 'Shift', 'R'])).toEqual([100663378]);
    expect(encodeShortcut(['Ctrl', 'PrintScreen'])).toEqual([83886089]);
    expect(encodeShortcut(['Ctrl', 'N'])).toEqual([67108942]);
  });

  it('round-trips through the desktop representation', () => {
    const bindings = [
      ['Ctrl', 'Shift', 'S'],
      ['Ctrl', 'PrintScreen'],
      ['Alt', 'Space'],
      ['Super', 'ArrowUp'],
      ['Ctrl', 'F5'],
      ['Ctrl', 'Shift', '='],
      ['Ctrl', 'Alt', 'Delete'],
    ];

    for (const binding of bindings) {
      const codes = encodeShortcut(binding);
      expect(codes).not.toBeNull();
      expect(decodeCode(codes![0])).toEqual(binding);
    }
  });

  it('reads the codepoints the desktop returns', () => {
    expect(decodeCode(100663379)).toEqual(['Ctrl', 'Shift', 'S']);
    expect(decodeCode(83886089)).toEqual(['Ctrl', 'PrintScreen']);
    expect(decodeCode(0x01000034)).toEqual(['F5']);
    expect(decodeCode(0x10000000 | 0x01000013)).toEqual(['Super', 'ArrowUp']);
  });

  it('rejects combinations the desktop cannot hold', () => {
    expect(encodeShortcut([])).toBeNull();
    expect(encodeShortcut(['Ctrl', 'Shift'])).toBeNull();
    expect(encodeShortcut(['Ctrl', 'S', 'N'])).toBeNull();
    expect(encodeShortcut(['Ctrl', 'NotAKey'])).toBeNull();
    expect(decodeCode(0)).toBeNull();
    expect(decodeCode(0x04000000 | 0x7f)).toBeNull();
  });
});
