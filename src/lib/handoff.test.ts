import { describe, expect, it } from 'bun:test';
import { handoffFileName, toShareFile } from './handoff';

describe('Phase 17: External Handoffs', () => {
  it('builds share files with the right name and type', () => {
    const file = toShareFile({ title: 'Snip.png', mime: 'image/png', blob: new Blob(['x']) });
    expect(file?.name).toBe('Snip.png');
    expect(file?.type).toBe('image/png');
    expect(file?.size).toBe(1);
  });

  it('rejects unnamed payloads', () => {
    expect(toShareFile({ title: '', mime: 'image/png', blob: new Blob(['x']) })).toBeNull();
  });

  it('builds filesystem-safe handoff file names', () => {
    expect(handoffFileName('a/b', '.png')).toBe('a_b.png');
    expect(handoffFileName('', '.mp4')).toBe('Sniplex.mp4');
  });
});
