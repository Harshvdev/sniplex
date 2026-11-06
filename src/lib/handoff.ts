/**
 * Phase 17 — External Application Handoffs.
 *
 * Share, Edit in External Image Editor, and Edit in External Video Editor.
 * Native share sheets and shell handlers are used when available; otherwise
 * the composite falls back to a download or the clipboard.
 */

export interface HandoffPayload {
  title: string;
  mime: string;
  blob: Blob;
}

export type HandoffTarget = 'share' | 'image-editor' | 'video-editor';

/** True when the platform exposes the Web Share API with file support. */
export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && 'share' in navigator;
}

/** True when the platform can launch an external program for the file. */
export function canOpenExternally(): boolean {
  return typeof window !== 'undefined' && typeof window.open === 'function';
}

/** Builds the File object the share sheet expects. */
export function toShareFile(payload: HandoffPayload): File | null {
  if (!payload.title) return null;
  return new File([payload.blob], payload.title, { type: payload.mime });
}

/** Default file name for a handoff payload. */
export function handoffFileName(title: string, extension: string): string {
  const base = (title || 'Sniplex').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Sniplex';
  return `${base}${extension}`;
}

/**
 * Shares a payload through the native share sheet when it accepts files,
 * otherwise copies the image to the clipboard. Returns which path was
 * actually taken so callers do not misreport a copy as a share.
 */
export type ShareOutcome = 'native' | 'clipboard' | 'failed';

export async function sharePayload(payload: HandoffPayload): Promise<ShareOutcome> {
  const file = toShareFile(payload);
  if (file && canNativeShare()) {
    try {
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (!nav.canShare || nav.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: payload.title });
        return 'native';
      }
      // Files unsupported by this share target: fall back to the clipboard
      // rather than "sharing" a meaningless text-only payload.
    } catch {
      return 'failed';
    }
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [payload.mime]: payload.blob })]);
    return 'clipboard';
  } catch {
    return 'failed';
  }
}
