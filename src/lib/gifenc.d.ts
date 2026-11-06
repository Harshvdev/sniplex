/**
 * Minimal type declarations for the `gifenc` package (no upstream types).
 * Only the surface this project uses is declared.
 */
declare module 'gifenc' {
  /** Quantizes RGBA pixel data to at most `maxColors` palette colors. */
  export function quantize(
    rgba: Uint8ClampedArray | Uint8Array | number[],
    maxColors: number,
    options?: { format?: string; oneBitAlpha?: boolean | null; roundRGB?: number; roundAlpha?: number }
  ): number[][];

  /** Maps RGBA pixel data onto the given palette; returns palette indices. */
  export function applyPalette(
    rgba: Uint8ClampedArray | Uint8Array | number[],
    palette: number[][],
    format?: string
  ): Uint8Array;

  export interface WriteFrameOptions {
    transparent?: boolean;
    transparentIndex?: number;
    /** Frame delay in milliseconds. */
    delay?: number;
    palette?: number[][] | null;
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
  }

  export interface GifEncoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: WriteFrameOptions): void;
    finish(): void;
    /** Returns the encoded GIF bytes. */
    bytes(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(): GifEncoder;
}
