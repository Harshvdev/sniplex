import { describe, expect, it } from 'bun:test';
import { blobToBase64 } from './clipboard';

describe('Phase 5: Clipboard Synchronization', () => {
  it('encodes PNG blobs as base64 for the native clipboard bridge', async () => {
    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const blob = new Blob([signature]);

    expect(await blobToBase64(blob)).toBe('iVBORw0KGgo=');
  });

  it('handles empty blobs and payloads larger than one encoding chunk', async () => {
    expect(await blobToBase64(new Blob([]))).toBe('');

    const large = new Uint8Array(0x8000 + 16).fill(0x41);
    const encoded = await blobToBase64(new Blob([large]));

    expect(encoded.length).toBeGreaterThan(0);
    expect(atob(encoded)).toHaveLength(large.length);
    expect(atob(encoded).slice(0, 4)).toBe('AAAA');
  });
});
