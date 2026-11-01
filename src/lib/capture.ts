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
  const srcW =
    ('width' in source
      ? (source as { width: number }).width
      : (source as unknown as { naturalWidth: number }).naturalWidth) || Math.round(rect.w);
  const srcH =
    ('height' in source
      ? (source as { height: number }).height
      : (source as unknown as { naturalHeight: number }).naturalHeight) || Math.round(rect.h);

  const sx = Math.max(0, Math.min(srcW - 1, Math.round(rect.x)));
  const sy = Math.max(0, Math.min(srcH - 1, Math.round(rect.y)));
  const sw = Math.max(1, Math.min(srcW - sx, Math.round(rect.w)));
  const sh = Math.max(1, Math.min(srcH - sy, Math.round(rect.h)));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.drawImage(
    source,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    sw,
    sh
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
 * immediately hiding the Sniplex application window so that desktop contents are clean.
 */
export async function captureDesktopDisplay(): Promise<{ capture: DesktopCapture; wasMaximized: boolean }> {
  let wasMaximized = true;

  if (isTauriEnvironment()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      wasMaximized = await win.isMaximized();

      // Immediately hide the window from the desktop before triggering screen grab
      await win.hide();

      const { invoke } = await import('@tauri-apps/api/core');
      const capture = await invoke<DesktopCapture>('capture_desktop');
      return { capture, wasMaximized };
    } catch (err) {
      console.warn('Native desktop capture error:', err);
    }
  }

  // Fallback for non-native test environments
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
    capture: {
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
    },
    wasMaximized: true,
  };
}

/**
 * Restores the desktop window from fullscreen capture overlay back to standard editor window,
 * preserving whether the window was originally maximized or floating.
 */
export async function restoreDesktopWindow(wasMaximized: boolean = true): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('restore_window', { wasMaximized });

      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();

      if (wasMaximized) {
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 60));
          if (!(await win.isMaximized())) {
            await win.maximize();
          } else {
            break;
          }
        }
      } else {
        await win.unmaximize();
      }
    } catch (err) {
      console.warn('Failed to restore desktop window:', err);
    }
  }
}

