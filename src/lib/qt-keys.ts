/**
 * Translation between the key names the shortcut editor uses and the Qt key
 * codes the desktop stores.
 *
 * A code packs the modifiers into the high bits and the key into the low ones,
 * so `Ctrl+Shift+S` reads as a large, arbitrary-looking number. Keeping the
 * mapping here means the settings list and the desktop service agree on what a
 * binding actually is, in both directions.
 */

const SHIFT = 0x02000000;
const CTRL = 0x04000000;
const ALT = 0x08000000;
const META = 0x10000000;

/** Named keys, using the same spelling the keyboard events report. */
const NAMED_KEYS: Array<[string, number]> = [
  ['PrintScreen', 0x01000009],
  ['Escape', 0x01000000],
  ['Tab', 0x01000001],
  ['Backspace', 0x01000003],
  ['Enter', 0x01000005],
  ['Insert', 0x01000006],
  ['Delete', 0x01000007],
  ['Home', 0x01000010],
  ['End', 0x01000011],
  ['ArrowLeft', 0x01000012],
  ['ArrowUp', 0x01000013],
  ['ArrowRight', 0x01000014],
  ['ArrowDown', 0x01000015],
  ['PageUp', 0x01000016],
  ['PageDown', 0x01000017],
  ['Space', 0x20],
  ['F1', 0x01000030],
  ['F2', 0x01000031],
  ['F3', 0x01000032],
  ['F4', 0x01000033],
  ['F5', 0x01000034],
  ['F6', 0x01000035],
  ['F7', 0x01000036],
  ['F8', 0x01000037],
  ['F9', 0x01000038],
  ['F10', 0x01000039],
  ['F11', 0x0100003a],
  ['F12', 0x0100003b],
];

/** Codes the desktop reports, with the spelling the editor shows. */
const BY_CODE = new Map<number, string>();
for (const [name, code] of NAMED_KEYS) {
  BY_CODE.set(code, name);
}
// Return shares the Enter name, since browsers do not distinguish them.
BY_CODE.set(0x01000004, 'Enter');

const BY_NAME = new Map<string, number>();
for (const [name, code] of NAMED_KEYS) {
  BY_NAME.set(name.toLowerCase(), code);
}
BY_NAME.set('return', 0x01000004);
BY_NAME.set('left', 0x01000012);
BY_NAME.set('up', 0x01000013);
BY_NAME.set('right', 0x01000014);
BY_NAME.set('down', 0x01000015);

function keyCode(name: string): number | null {
  const named = BY_NAME.get(name.toLowerCase());
  if (named !== undefined) return named;

  // Single characters, including punctuation such as `+` or `=`.
  if (name.length === 1) {
    const code = name.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f) return code;
  }

  return null;
}

/**
 * Turns a binding into the codes the desktop expects. An empty binding encodes
 * to an empty list, which the desktop reads as "no shortcut"; `null` means the
 * combination cannot be represented.
 */
export function encodeShortcut(keys: string[]): number[] | null {
  let modifiers = 0;
  let primary: number | null = null;

  for (const key of keys) {
    switch (key.toLowerCase()) {
      case 'ctrl':
      case 'control':
        modifiers |= CTRL;
        break;
      case 'shift':
        modifiers |= SHIFT;
        break;
      case 'alt':
        modifiers |= ALT;
        break;
      case 'super':
      case 'meta':
        modifiers |= META;
        break;
      default: {
        const code = keyCode(key);
        if (code === null || primary !== null) return null;
        primary = code;
      }
    }
  }

  if (primary === null) return null;
  return [modifiers | primary];
}

/** Turns a stored code back into a binding, or `null` if it is unknown here. */
export function decodeCode(code: number): string[] | null {
  if (!Number.isInteger(code) || code === 0) return null;

  const base = code & 0x01ffffff;
  const key = BY_CODE.get(base) ?? printable(base);
  if (key === null) return null;

  const keys: string[] = [];
  if (code & CTRL) keys.push('Ctrl');
  if (code & SHIFT) keys.push('Shift');
  if (code & ALT) keys.push('Alt');
  if (code & META) keys.push('Super');
  keys.push(key);
  return keys;
}

function printable(code: number): string | null {
  if (code < 0x20 || code >= 0x7f) return null;
  const character = String.fromCharCode(code);
  return character.toUpperCase();
}
