export interface OutlineOptions {
  enabled: boolean;
  color: string;
  width: number;
}

export interface OutlinedImage {
  imageUrl: string;
  width: number;
  height: number;
}

export interface OutlineSize {
  width: number;
  height: number;
  padding: number;
}

/** Adds a symmetric frame around an image without covering its pixels. */
export function outlineSize(
  width: number,
  height: number,
  strokeWidth: number
): OutlineSize {
  const sourceWidth = Math.max(1, Math.round(width));
  const sourceHeight = Math.max(1, Math.round(height));
  const padding = Math.max(0, Math.round(strokeWidth));

  return {
    width: sourceWidth + padding * 2,
    height: sourceHeight + padding * 2,
    padding,
  };
}

/**
 * Renders the configured screenshot frame around a captured data URL.
 * The frame is drawn as a colored ring around the capture, so image content is
 * never painted over.
 */
export function applyCaptureOutline(
  imageUrl: string,
  width: number,
  height: number,
  options: OutlineOptions
): Promise<OutlinedImage> {
  if (!imageUrl || !options.enabled || options.width <= 0) {
    return Promise.resolve({ imageUrl, width, height });
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sourceWidth = img.naturalWidth || width;
      const sourceHeight = img.naturalHeight || height;
      const size = outlineSize(sourceWidth, sourceHeight, options.width);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ imageUrl, width, height });
        return;
      }

      ctx.fillStyle = options.color;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(img, size.padding, size.padding, sourceWidth, sourceHeight);

      resolve({
        imageUrl: canvas.toDataURL('image/png'),
        width: size.width,
        height: size.height,
      });
    };
    img.onerror = () => resolve({ imageUrl, width, height });
    img.src = imageUrl;
  });
}
