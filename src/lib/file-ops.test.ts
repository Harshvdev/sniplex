import { describe, expect, it } from 'bun:test';
import {
  buildSaveFileName,
  isValidSaveFormat,
  saveFormatExtension,
  saveFormatMime,
  saveFormatsForImage,
  saveFormatsForVideo,
} from './file-ops';

describe('Phase 16: File Operations & Print', () => {
  it('offers PNG/JPG/GIF for images', () => {
    expect(saveFormatsForImage()).toEqual(['png', 'jpg', 'gif']);
  });

  it('offers MP4 for recordings', () => {
    expect(saveFormatsForVideo()).toEqual(['mp4']);
  });

  it('validates format ids', () => {
    expect(isValidSaveFormat('png')).toBe(true);
    expect(isValidSaveFormat('mp4')).toBe(true);
    expect(isValidSaveFormat('tiff')).toBe(false);
  });

  it('maps formats to MIME types and extensions', () => {
    expect(saveFormatMime('jpg')).toBe('image/jpeg');
    expect(saveFormatExtension('gif')).toBe('.gif');
    expect(saveFormatMime('png')).toBe('image/png');
    expect(saveFormatExtension('mp4')).toBe('.mp4');
  });

  it('builds filesystem-safe save names', () => {
    expect(buildSaveFileName('Snip 1', 'png')).toBe('Snip 1.png');
    expect(buildSaveFileName('a/b:c', 'jpg')).toBe('a_b_c.jpg');
    expect(buildSaveFileName('', 'png')).toBe('Sniplex.png');
  });
});
