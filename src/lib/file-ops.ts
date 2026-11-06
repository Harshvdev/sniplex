/**
 * Phase 16 — File Operations & Print.
 *
 * Save As supports PNG/JPG/GIF for captures (MP4 for recordings), Open File
 * loads images into the editor, and Print opens the system print dialog.
 */

import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export type SaveFormat = 'png' | 'jpg' | 'gif' | 'mp4';

export const SAVE_FORMATS: { id: SaveFormat; label: string; mime: string; extension: string }[] = [
  { id: 'png', label: 'PNG', mime: 'image/png', extension: '.png' },
  { id: 'jpg', label: 'JPG', mime: 'image/jpeg', extension: '.jpg' },
  { id: 'gif', label: 'GIF', mime: 'image/gif', extension: '.gif' },
  { id: 'mp4', label: 'MP4', mime: 'video/mp4', extension: '.mp4' },
];

/** Formats available for an image capture. */
export function saveFormatsForImage(): SaveFormat[] {
  return ['png', 'jpg', 'gif'];
}

/** Formats available for a video recording. */
export function saveFormatsForVideo(): SaveFormat[] {
  return ['mp4'];
}

export function isValidSaveFormat(value: string): value is SaveFormat {
  return (['png', 'jpg', 'gif', 'mp4'] as string[]).includes(value);
}

/** MIME type for a format id, falling back to PNG. */
export function saveFormatMime(format: SaveFormat): string {
  return SAVE_FORMATS.find((f) => f.id === format)?.mime ?? 'image/png';
}

/** Extension (with dot) for a format id. */
export function saveFormatExtension(format: SaveFormat): string {
  return SAVE_FORMATS.find((f) => f.id === format)?.extension ?? '.png';
}

/** Builds a filesystem-safe save name from a title and format. */
export function buildSaveFileName(title: string, format: SaveFormat): string {
  const base = (title || 'Sniplex').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Sniplex';
  return `${base}${saveFormatExtension(format)}`;
}

/**
 * Encodes a canvas composite to the target format. PNG/JPG use the canvas
 * implementation; GIF is encoded explicitly (browsers don't support it).
 * Returns the encoded blob (or null when unsupported).
 */
export async function encodeCanvasToFormat(
  canvas: HTMLCanvasElement,
  format: SaveFormat
): Promise<Blob | null> {
  if (format === 'gif') {
    return encodeCanvasToGif(canvas);
  }
  const mime = saveFormatMime(format);
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), mime, 0.92);
    } catch {
      resolve(null);
    }
  });
}

/** Flattens the (possibly transparent) composite onto white and encodes a GIF89a. */
function encodeCanvasToGif(canvas: HTMLCanvasElement): Blob | null {
  try {
    const width = canvas.width;
    const height = canvas.height;
    if (width <= 0 || height <= 0) return null;

    const flat = document.createElement('canvas');
    flat.width = width;
    flat.height = height;
    const flatCtx = flat.getContext('2d');
    if (!flatCtx) return null;
    flatCtx.fillStyle = '#ffffff';
    flatCtx.fillRect(0, 0, width, height);
    flatCtx.drawImage(canvas, 0, 0);
    const imageData = flatCtx.getImageData(0, 0, width, height);

    const palette = quantize(imageData.data, 256);
    const index = applyPalette(imageData.data, palette);

    const gif = GIFEncoder();
    gif.writeFrame(index, width, height, { palette });
    gif.finish();
    // gif.bytes() is a Uint8Array backed by ArrayBuffer — copy out for Blob.
    return new Blob([new Uint8Array(gif.bytes())], { type: 'image/gif' });
  } catch {
    return null;
  }
}

/** Triggers a browser download for the given blob and file name. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
