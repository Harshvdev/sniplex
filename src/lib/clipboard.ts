import { isTauriEnvironment } from './capture';

export type ClipboardMethod = 'native' | 'browser';

export interface ClipboardCopyResult {
  ok: boolean;
  method?: ClipboardMethod;
  error?: string;
}

/** Converts a binary blob into a base64 string without a FileReader dependency. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

async function copyWithNativeClipboard(blob: Blob): Promise<void> {
  const pngBase64 = await blobToBase64(blob);
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke<string>('copy_image_to_clipboard', { pngBase64 });
}

async function copyWithBrowserClipboard(blob: Blob): Promise<void> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== 'function' ||
    typeof ClipboardItem === 'undefined'
  ) {
    throw new Error('Image clipboard access is not available');
  }

  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/**
 * Phase 21: copies plain text to the system clipboard (Scan Text mode).
 * Uses the Web Clipboard API; failures are reported as a result object
 * so the caller can keep the selection intact and announce the failure.
 */
export async function copyTextToClipboard(text: string): Promise<ClipboardCopyResult> {
  if (!text) return { ok: false, error: 'Nothing to copy' };
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('Text clipboard access is not available');
    }
    await navigator.clipboard.writeText(text);
    return { ok: true, method: 'browser' };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Copies a PNG bitmap to the system clipboard.
 *
 * In the desktop shell the native path runs first because automatic copies have
 * no user gesture for the browser Clipboard API. The browser path remains the
 * fallback for the web preview and for systems where the native helper fails.
 */
export async function copyImageToClipboard(blob: Blob): Promise<ClipboardCopyResult> {
  let nativeError = '';

  if (isTauriEnvironment()) {
    try {
      await copyWithNativeClipboard(blob);
      return { ok: true, method: 'native' };
    } catch (error) {
      nativeError = errorMessage(error);
    }
  }

  try {
    await copyWithBrowserClipboard(blob);
    return { ok: true, method: 'browser' };
  } catch (error) {
    const browserError = errorMessage(error);
    return {
      ok: false,
      error: nativeError ? `${nativeError}; ${browserError}` : browserError,
    };
  }
}
