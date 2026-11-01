/**
 * Procedural Audio Synthesis for Sniplex.
 * Generates pure PCM WAV audio data in memory for countdown timer cues.
 * Zero external audio assets, zero stream leaks, instant playback in WebKitGTK.
 */

function buildWavDataUrl(samples: Float32Array, sampleRate = 44100): string {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // RIFF identifier
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + numSamples * 2, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // "fmt " chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // chunk length (16 for PCM)
  view.setUint16(20, 1, true); // audio format (1 = PCM)
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * 1 * 16/8)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // "data" chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, numSamples * 2, true);

  // PCM 16-bit samples
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  // Convert buffer to base64 data URL
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

function createChimeWav(freq: number, duration = 0.16, sampleRate = 44100): string {
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 22.0);
    // Fundamental + gentle octave overtone for bell clarity
    const val = 0.8 * Math.sin(2 * Math.PI * freq * t) + 0.2 * Math.sin(2 * Math.PI * freq * 2 * t);
    samples[i] = val * env * 0.95;
  }
  return buildWavDataUrl(samples, sampleRate);
}

let normalChimeUrl: string | null = null;
let highChimeUrl: string | null = null;

export function getNormalChimeUrl(): string {
  if (!normalChimeUrl) normalChimeUrl = createChimeWav(880.0);
  return normalChimeUrl;
}

export function getHighChimeUrl(): string {
  if (!highChimeUrl) highChimeUrl = createChimeWav(1174.66);
  return highChimeUrl;
}

function playDataUrl(url: string, volume = 0.85): void {
  try {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
    const audio = new Audio(url);
    audio.volume = volume;
    audio.play().catch((err) => {
      console.debug('Audio playback prevented or failed:', err);
    });
  } catch (err) {
    console.debug('Failed to initialize Audio element:', err);
  }
}

/**
 * Plays an auditory chime on countdown timer ticks.
 * @param pitch 'normal' for countdown ticks (e.g. 3, 2), 'high' for final cue (1)
 */
export function playTimerChime(pitch: 'normal' | 'high' = 'normal'): void {
  const url = pitch === 'high' ? getHighChimeUrl() : getNormalChimeUrl();
  playDataUrl(url, 0.9);
}
