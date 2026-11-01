import { describe, it, expect } from 'bun:test';
import { playTimerChime, getNormalChimeUrl, getHighChimeUrl } from './audio';

describe('Phase 3: Procedural Audio Synthesis', () => {
  it('generates valid base64 WAV data URLs for timer chime presets', () => {
    const normalChime = getNormalChimeUrl();
    const highChime = getHighChimeUrl();

    expect(normalChime.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(highChime.startsWith('data:audio/wav;base64,')).toBe(true);

    // Verify RIFF and WAVE magic headers in decoded binary
    const decodeHeader = (dataUrl: string) => {
      const b64 = dataUrl.replace('data:audio/wav;base64,', '');
      const binary = atob(b64);
      return binary.slice(0, 4) + binary.slice(8, 12);
    };

    expect(decodeHeader(normalChime)).toBe('RIFFWAVE');
    expect(decodeHeader(highChime)).toBe('RIFFWAVE');
  });

  it('plays timer chime sounds safely without errors when Audio is mocked or missing', () => {
    expect(() => playTimerChime('normal')).not.toThrow();
    expect(() => playTimerChime('high')).not.toThrow();

    // Mock global window and Audio
    (globalThis as unknown as { window: unknown }).window = globalThis;
    let playedUrl = '';
    (globalThis as unknown as { Audio: unknown }).Audio = class {
      src = '';
      volume = 1;
      constructor(src: string) {
        this.src = src;
        playedUrl = src;
      }
      play() {
        return Promise.resolve();
      }
    };

    playTimerChime('normal');
    expect(playedUrl).toBe(getNormalChimeUrl());

    playTimerChime('high');
    expect(playedUrl).toBe(getHighChimeUrl());
  });
});
