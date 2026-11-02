export type PinchPhase = 'start' | 'update' | 'end';

export type PinchHandler = (phase: PinchPhase, scale: number, x: number, y: number) => void;

interface PinchWindow extends Window {
  __sniplexPinch?: (phase: string, scale: number, x: number, y: number) => void;
}

/**
 * Receives trackpad pinch gestures forwarded by the native shell.
 *
 * The shell removes the platform page-zoom gesture and reports its scale here,
 * so a pinch can be applied to the capture canvas instead of the interface.
 */
export function registerPinchBridge(handler: PinchHandler): () => void {
  const target = window as PinchWindow;

  target.__sniplexPinch = (phase, scale, x, y) => {
    if (phase !== 'start' && phase !== 'update' && phase !== 'end') return;
    if (!Number.isFinite(scale) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    handler(phase, scale, x, y);
  };

  return () => {
    if (target.__sniplexPinch) delete target.__sniplexPinch;
  };
}
