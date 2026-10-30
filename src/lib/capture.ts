import type { DesktopCapture, WindowRect, SnipType, CapturePayload } from './types';

/**
 * Checks whether the current runtime environment is inside Tauri desktop shell.
 */
export function isTauriEnvironment(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

/**
 * Calculates the axis-aligned bounding box enclosing an arbitrary set of 2D points.
 */
export function getPointsBoundingBox(
  points: Array<{ x: number; y: number }>
): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }

  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.max(1, Math.round(maxX - minX)),
    height: Math.max(1, Math.round(maxY - minY)),
  };
}

/**
 * Identifies which application window frame (if any) contains the given cursor coordinates.
 * When multiple overlapping windows contain the point, prefers the smallest (innermost) window.
 */
export function findHoveredWindow(
  windows: WindowRect[],
  x: number,
  y: number
): WindowRect | null {
  const matches = windows.filter((w) => {
    return (
      x >= w.x &&
      x <= w.x + w.width &&
      y >= w.y &&
      y <= w.y + w.height
    );
  });

  if (matches.length === 0) return null;

  // Sort by area ascending so smaller/child windows take priority over screen-sized root windows
  matches.sort((a, b) => a.width * a.height - b.width * b.height);
  return matches[0];
}

/**
 * Crops a rectangular region from an image or canvas source.
 */
export function cropRectangle(
  source: CanvasImageSource,
  rect: { x: number; y: number; w: number; h: number }
): string {
  const width = Math.max(1, Math.round(rect.w));
  const height = Math.max(1, Math.round(rect.h));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    0,
    0,
    width,
    height
  );

  return canvas.toDataURL('image/png');
}

/**
 * Crops an irregular freeform lasso region from an image or canvas source.
 * Enclosed pixels remain fully opaque, while outside pixels are transparent.
 */
export function cropFreeform(
  source: CanvasImageSource,
  points: Array<{ x: number; y: number }>
): { dataUrl: string; width: number; height: number } {
  if (points.length < 3) {
    return { dataUrl: '', width: 0, height: 0 };
  }

  const bb = getPointsBoundingBox(points);
  const canvas = document.createElement('canvas');
  canvas.width = bb.width;
  canvas.height = bb.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl: '', width: 0, height: 0 };

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x - bb.x, points[0].y - bb.y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x - bb.x, points[i].y - bb.y);
  }
  ctx.closePath();
  ctx.clip();

  // Draw source aligned with the bounding box
  ctx.drawImage(source, -bb.x, -bb.y);
  ctx.restore();

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: bb.width,
    height: bb.height,
  };
}

/**
 * Asynchronously crops a rectangular region from an image data URL.
 */
export function cropFromDataUrl(
  dataUrl: string,
  rect: { x: number; y: number; w: number; h: number }
): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve('');
      return;
    }
    const img = new Image();
    img.onload = () => {
      resolve(cropRectangle(img, rect));
    };
    img.onerror = () => {
      resolve('');
    };
    img.src = dataUrl;
  });
}

/**
 * Asynchronously crops an irregular freeform region from an image data URL.
 */
export function cropFreeformFromDataUrl(
  dataUrl: string,
  points: Array<{ x: number; y: number }>
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve({ dataUrl: '', width: 0, height: 0 });
      return;
    }
    const img = new Image();
    img.onload = () => {
      resolve(cropFreeform(img, points));
    };
    img.onerror = () => {
      resolve({ dataUrl: '', width: 0, height: 0 });
    };
    img.src = dataUrl;
  });
}

/**
 * Requests desktop display acquisition and display freeze from the Tauri backend,
 * or gracefully generates a fallback mock surface in pure browser environments.
 */
export async function captureDesktopDisplay(): Promise<DesktopCapture> {
  if (isTauriEnvironment()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      // Ensure the window is genuinely maximized before entering capture overlay
      if (!(await win.isMaximized())) {
        await win.maximize();
        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      const { invoke } = await import('@tauri-apps/api/core');
      const capture = await invoke<DesktopCapture>('capture_desktop');
      return capture;
    } catch (err) {
      console.warn('Native desktop capture error:', err);
    }
  }

  // Fallback for non-native browser environment / testing
  const fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = window.innerWidth || 1920;
  fallbackCanvas.height = window.innerHeight || 1080;
  const ctx = fallbackCanvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 0, fallbackCanvas.width, fallbackCanvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px sans-serif';
    ctx.fillText('Sniplex Desktop Capture Preview', 40, 60);
  }

  return {
    image_data_url: fallbackCanvas.toDataURL('image/png'),
    width: fallbackCanvas.width,
    height: fallbackCanvas.height,
    windows: [
      {
        id: 'mock-window-1',
        title: 'Active Document',
        x: 100,
        y: 100,
        width: 800,
        height: 500,
      },
    ],
  };
}

/**
 * Restores the desktop window from fullscreen capture overlay back to standard editor window.
 */
export async function restoreDesktopWindow(): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('restore_window');

      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();

      // Ensure the window manager properly applies the maximized state after exiting fullscreen
      for (let attempt = 0; attempt < 4; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        const isMax = await win.isMaximized();
        if (!isMax) {
          await win.maximize();
        } else {
          break;
        }
      }
    } catch (err) {
      console.warn('Failed to restore desktop window:', err);
    }
  }
}

