export interface ShortcutItem {
  id: string;
  label: string;
  description: string;
  keys: string[];
  defaultKeys: string[];
}

export const DEFAULT_SHORTCUTS: ShortcutItem[] = [
  {
    id: 'overlay',
    label: 'Screen capture overlay',
    description: 'Open the capture selector and toolbar',
    keys: ['Ctrl', 'Shift', 'S'],
    defaultKeys: ['Ctrl', 'Shift', 'S'],
  },
  {
    id: 'record',
    label: 'Screen recording',
    description: 'Start or switch to screen recording mode',
    keys: ['Ctrl', 'Shift', 'R'],
    defaultKeys: ['Ctrl', 'Shift', 'R'],
  },
  {
    id: 'fullscreen',
    label: 'Full screen capture',
    description: 'Instantly capture the entire screen',
    keys: ['Ctrl', 'PrintScreen'],
    defaultKeys: ['Ctrl', 'PrintScreen'],
  },
  {
    id: 'newCapture',
    label: 'New capture',
    description: 'Open a new capture in the editor',
    keys: ['Ctrl', 'N'],
    defaultKeys: ['Ctrl', 'N'],
  },
];

const STORAGE_KEY = 'sniplex_shortcuts';

export function loadShortcuts(): ShortcutItem[] {
  if (typeof window === 'undefined') {
    return DEFAULT_SHORTCUTS.map((s) => ({ ...s, keys: [...s.keys], defaultKeys: [...s.defaultKeys] }));
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SHORTCUTS.map((s) => ({ ...s, keys: [...s.keys], defaultKeys: [...s.defaultKeys] }));
    }
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    return DEFAULT_SHORTCUTS.map((def) => {
      const savedKeys = parsed[def.id];
      return {
        ...def,
        keys: Array.isArray(savedKeys) && savedKeys.length > 0 ? savedKeys : [...def.defaultKeys],
        defaultKeys: [...def.defaultKeys],
      };
    });
  } catch {
    return DEFAULT_SHORTCUTS.map((s) => ({ ...s, keys: [...s.keys], defaultKeys: [...s.defaultKeys] }));
  }
}

export function saveShortcuts(shortcuts: ShortcutItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    const map: Record<string, string[]> = {};
    for (const s of shortcuts) {
      map[s.id] = s.keys;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.error('Failed to save shortcuts:', err);
  }
}

export function areKeysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, index) => val.toLowerCase() === b[index].toLowerCase());
}

export function parseKeyEvent(e: KeyboardEvent): {
  modifiers: string[];
  primaryKey: string | null;
  isValidCombination: boolean;
} {
  const modifiers: string[] = [];
  if (e.ctrlKey) modifiers.push('Ctrl');
  if (e.shiftKey) modifiers.push('Shift');
  if (e.altKey) modifiers.push('Alt');
  if (e.metaKey) modifiers.push('Super');

  const rawKey = e.key;
  const isModifierKey = ['Control', 'Shift', 'Alt', 'Meta'].includes(rawKey);

  if (isModifierKey) {
    return {
      modifiers,
      primaryKey: null,
      isValidCombination: false,
    };
  }

  let normalizedKey = rawKey;
  if (rawKey === ' ' || rawKey === 'Spacebar') {
    normalizedKey = 'Space';
  } else if (rawKey === 'PrintScreen' || rawKey === 'Snapshot') {
    normalizedKey = 'PrintScreen';
  } else if (rawKey.length === 1) {
    normalizedKey = rawKey.toUpperCase();
  }

  // Standalone keys allowed without modifiers
  const isSpecialStandalone = [
    'PrintScreen',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
    'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  ].includes(normalizedKey);

  const isValidCombination = modifiers.length > 0 || isSpecialStandalone;

  return {
    modifiers,
    primaryKey: normalizedKey,
    isValidCombination,
  };
}

export function matchesShortcut(e: KeyboardEvent, keys: string[]): boolean {
  if (!keys || keys.length === 0) return false;

  const wantCtrl = keys.some((k) => k.toLowerCase() === 'ctrl');
  const wantShift = keys.some((k) => k.toLowerCase() === 'shift');
  const wantAlt = keys.some((k) => k.toLowerCase() === 'alt');
  const wantSuper = keys.some((k) => k.toLowerCase() === 'super' || k.toLowerCase() === 'meta');

  if (e.ctrlKey !== wantCtrl) return false;
  if (e.shiftKey !== wantShift) return false;
  if (e.altKey !== wantAlt) return false;
  if (e.metaKey !== wantSuper) return false;

  const primaryKey = keys.find(
    (k) => !['ctrl', 'shift', 'alt', 'super', 'meta'].includes(k.toLowerCase())
  );
  if (!primaryKey) return false;

  const eventKey = e.key;
  if (primaryKey.toLowerCase() === 'printscreen') {
    return eventKey === 'PrintScreen' || eventKey === 'Snapshot';
  }

  if (primaryKey.toLowerCase() === 'space') {
    return eventKey === ' ' || eventKey === 'Spacebar';
  }

  return eventKey.toLowerCase() === primaryKey.toLowerCase();
}

