/**
 * Phase 21 — browser OCR runner (Tesseract.js, WASM, fully local & offline).
 *
 * The engine loads lazily on first Scan Text click and a single worker
 * is reused across images. No image ever leaves the device. All assets
 * are vendored in public/tess/ so a build runs without internet:
 * worker.min.js + tesseract-core-lstm.wasm.js + eng.traineddata.gz.
 * Do not add CDN URLs here — offline is the contract.
 */
import { buildPlainText, buildTsv, clusterTable, normalizeTesseractPage, scaleBboxes, type ScanResult } from './scan-text';

type TesseractWorker = {
  recognize: (image: unknown, options?: unknown, output?: unknown) => Promise<{ data: unknown }>;
  terminate: () => Promise<unknown>;
  setParameters?: (params: Record<string, unknown>) => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;
let workerGen = 0;

export interface RunOcrOptions {
  onProgress?: (p: number, status?: string) => void;
  engineVersion?: string;
}

/** Downscales huge captures so OCR stays responsive (max edge 2000px). */
export function downscaleForOcr(source: HTMLCanvasElement, maxEdge = 2000): { canvas: HTMLCanvasElement; scale: number } {
  const w = source.width;
  const h = source.height;
  if (!w || !h) return { canvas: source, scale: 1 };
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  if (scale >= 1) return { canvas: source, scale: 1 };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas: source, scale: 1 };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, scale };
}

async function getWorker(onProgress?: (p: number) => void): Promise<TesseractWorker> {
  if (workerPromise) return workerPromise;
  const gen = workerGen;
  workerPromise = (async () => {
    // Lazy import keeps the WASM core out of the initial bundle.
    const mod = await import('tesseract.js');
    const createWorker = (mod as unknown as { createWorker: (langs: string, oem?: number, opts?: unknown) => Promise<TesseractWorker> }).createWorker;
    if (!createWorker) throw new Error('Tesseract.js failed to load');
    // Vendored assets in public/tess/ — served verbatim from dist root.
    // corePath ends in .js so getCore loads the non-SIMD LSTM build directly.
    const worker = await createWorker('eng', 1, {
      workerPath: '/tess/worker.min.js',
      corePath: '/tess/tesseract-core-lstm.wasm.js',
      langPath: '/tess',
      cachePath: '/tess',
      gzip: true,
      logger: (m: { progress?: number; status?: string }) => {
        if (gen !== workerGen) return;
        if (typeof m?.progress === 'number') onProgress?.(m.progress);
      },
    });
    return worker;
  })();
  // On failure, allow retry on next scan.
  workerPromise.catch(() => { workerPromise = null; });
  return workerPromise;
}

/** Runs OCR on the given canvas and returns normalized ScanResult. */
export async function runOcr(sourceCanvas: HTMLCanvasElement, options: RunOcrOptions = {}): Promise<ScanResult> {
  const { canvas, scale } = downscaleForOcr(sourceCanvas);
  const worker = await getWorker((p) => options.onProgress?.(p));

  const result = await worker.recognize(
    canvas as unknown,
    {},
    { text: true, blocks: true, layoutBlocks: true, hocr: false, tsv: false, box: false, unlv: false, osd: false, pdf: false }
  );
  const data = (result as { data: unknown }).data;
  const factor = scale < 1 ? 1 / scale : 1;
  const raw = normalizeTesseractPage(data, sourceCanvas.width, sourceCanvas.height, options.engineVersion ?? 'tesseract.js');

  if (factor !== 1) {
    const words = raw.words.map((w) => ({ ...w, bbox: scaleBboxes([w.bbox], factor)[0] }));
    const lines = raw.lines.map((l) => ({ ...l, bbox: scaleBboxes([l.bbox], factor)[0] }));
    const blocks = raw.blocks.map((b) => ({ ...b, bbox: scaleBboxes([b.bbox], factor)[0] }));
    // Rebuild plain text / table from scaled boxes (text itself unchanged).
    const plainText = buildPlainText(words, lines, blocks);
    const table = clusterTable(words);
    return { ...raw, words, lines, blocks, plainText, tableTsv: table.hasTable ? buildTsv(table.rows) : '', hasTable: table.hasTable };
  }
  return raw;
}

/** Terminates the worker (cancel path). Next scan recreates it. */
export async function cancelOcr(): Promise<void> {
  workerGen += 1;
  const pending = workerPromise;
  workerPromise = null;
  if (pending) {
    try {
      const worker = await pending;
      await worker.terminate();
    } catch {}
  }
}

/** Releases the worker (app unload). */
export async function shutdownOcr(): Promise<void> {
  await cancelOcr();
}
