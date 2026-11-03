import { isTauriEnvironment } from './capture';
import { decodeCode, encodeShortcut } from './qt-keys';
import type { ShortcutItem } from './shortcuts';

/** Key names accepted by the XDG shortcuts specification. */
const TRIGGER_KEY_NAMES: Record<string, string> = {
  printscreen: 'Print',
  snapshot: 'Print',
  space: 'Space',
  escape: 'Escape',
  esc: 'Escape',
  enter: 'Return',
  return: 'Return',
  tab: 'Tab',
  backspace: 'BackSpace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'Page_Up',
  pagedown: 'Page_Down',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
};

const TRIGGER_MODIFIERS: Record<string, string> = {
  ctrl: 'CTRL',
  control: 'CTRL',
  shift: 'SHIFT',
  alt: 'ALT',
  super: 'LOGO',
  meta: 'LOGO',
};

/**
 * Converts the app's key list into the trigger syntax understood by the
 * desktop portal, for example `CTRL+SHIFT+S` or `CTRL+Print`.
 */
export function shortcutToTrigger(keys: string[]): string | null {
  if (!keys || keys.length === 0) return null;

  const modifiers: string[] = [];
  let primary: string | null = null;

  for (const key of keys) {
    const modifier = TRIGGER_MODIFIERS[key.toLowerCase()];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }

    const normalized = key.toLowerCase();
    const named = TRIGGER_KEY_NAMES[normalized];
    if (named) {
      primary = named;
    } else if (key.length === 1) {
      primary = key.toUpperCase();
    } else {
      primary = key;
    }
  }

  if (!primary) return null;
  return [...modifiers, primary].join('+');
}

/**
 * Registers the capture shortcuts on desktops that take them from a running
 * application instead of the desktop entry.
 *
 * Plasma reads its shortcuts from the entry, so the native side reports success
 * without registering anything there. Other desktops use the portal, and older
 * sessions without it fall back to direct key grabs.
 */
export async function syncGlobalShortcuts(shortcuts: ShortcutItem[]): Promise<void> {
  if (!isTauriEnvironment()) return;

  const portalShortcuts = shortcuts
    .map((item) => ({
      id: item.id,
      description: item.description,
      trigger: shortcutToTrigger(item.keys),
    }))
    .filter((item): item is { id: string; description: string; trigger: string } =>
      item.trigger !== null
    );

  if (portalShortcuts.length === 0) return;

  try {
    await listenForPortalActivations();
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('sync_global_shortcuts', { shortcuts: portalShortcuts });
  } catch (err) {
    // There is no portable fallback to grabbing keys directly. The shortcut
    // remains available while Sniplex is focused, but the desktop owns
    // global shortcuts if it supports the common shortcut portal.
    console.warn('Desktop global shortcuts are unavailable:', err);
  }
}

let portalListenerPending: Promise<void> | null = null;

/** Routes portal activations into the same event the in-app handler uses. */
function listenForPortalActivations(): Promise<void> {
  if (!portalListenerPending) {
    portalListenerPending = (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      await listen<{ id?: string }>('sniplex-global-shortcut', (event) => {
        const id = event.payload?.id;
        if (id) dispatchShortcut(id);
      });
    })().catch((err) => {
      portalListenerPending = null;
      throw err;
    });
  }
  return portalListenerPending;
}

function dispatchShortcut(id: string): void {
  window.dispatchEvent(new CustomEvent('sniplex-global-shortcut', { detail: { id } }));
}

/** One binding as the desktop holds it, before it is turned into key names. */
interface SystemBinding {
  id: string;
  codes: number[];
}

/**
 * Reads the bindings the desktop actually holds for the capture actions.
 *
 * Returns `null` when the desktop keeps its shortcuts elsewhere — there the
 * in-app list is the only source and nothing needs mirroring.
 */
export async function readSystemShortcuts(): Promise<Record<string, string[]> | null> {
  if (!isTauriEnvironment()) return null;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const bindings = await invoke<SystemBinding[] | null>('list_global_shortcuts');
    if (!bindings) return null;

    const readable: Record<string, string[]> = {};
    for (const binding of bindings) {
      const codes = binding.codes;
      if (codes.length === 0) {
        readable[binding.id] = [];
        continue;
      }

      const keys = decodeCode(codes[0]);
      // A combination this build cannot name is left out, so the caller keeps
      // whatever it already had instead of showing a blank shortcut.
      if (keys) readable[binding.id] = keys;
    }

    return readable;
  } catch (err) {
    console.warn('Desktop shortcuts could not be read:', err);
    return null;
  }
}

/**
 * Replaces the complete Sniplex shortcut set through the desktop service.
 *
 * The desktop validates every key before writing and rolls back successful
 * writes if any part of the edit fails, so a conflict elsewhere cannot leave
 * the desktop and the app in different states.
 */
export async function applySystemShortcuts(
  items: ShortcutItem[]
): Promise<string | null> {
  if (!isTauriEnvironment()) return null;

  const bindings: SystemBinding[] = [];

  for (const item of items) {
    const codes =
      item.keys.length === 0 ? [] : encodeShortcut(item.keys);

    if (codes === null) {
      return `${item.label} cannot be used as a desktop shortcut`;
    }

    bindings.push({ id: item.id, codes });
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const applied = await invoke<SystemBinding[]>('set_global_shortcuts', { bindings });

    const appliedCodes = new Map(applied.map((binding) => [binding.id, binding.codes]));
    const mismatch = bindings.find(
      (binding) =>
        !appliedCodes.has(binding.id) ||
        appliedCodes.get(binding.id)!.length !== binding.codes.length ||
        appliedCodes.get(binding.id)!.some((code, index) => code !== binding.codes[index])
    );

    if (mismatch) {
      return 'The desktop did not accept that shortcut';
    }

    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
