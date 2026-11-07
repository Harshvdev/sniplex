/**
 * Phase 21 — Scan Text (OCR) & Table Extraction.
 *
 * Pure, DOM-free logic for turning Tesseract.js output into selectable
 * words, plain text, and spreadsheet-ready TSV. The browser-side runner
 * lives in scan-text-runner.ts; anything in this module is unit-testable
 * under Bun without a canvas or OCR engine.
 */

export interface OcrBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  id: string;
  text: string;
  conf: number;
  bbox: OcrBBox;
  lineId: string;
  blockId: string;
}

export interface OcrLine {
  id: string;
  blockId: string;
  bbox: OcrBBox;
  wordIds: string[];
  text: string;
}

export interface OcrBlock {
  id: string;
  bbox: OcrBBox;
  lineIds: string[];
}

export interface ScanResult {
  words: OcrWord[];
  lines: OcrLine[];
  blocks: OcrBlock[];
  plainText: string;
  tableTsv: string;
  hasTable: boolean;
  imageW: number;
  imageH: number;
  engineVersion: string;
}

export interface ScanRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const MIN_CONFIDENCE_KEPT = 0;

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function readBBox(v: unknown): OcrBBox {
  if (!v || typeof v !== 'object') return { x0: 0, y0: 0, x1: 0, y1: 0 };
  const r = v as Record<string, unknown>;
  return {
    x0: num(r.x0),
    y0: num(r.y0),
    x1: num(r.x1),
    y1: num(r.y1),
  };
}

function toText(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Normalizes a Tesseract.js `Page` (blocks/paragraphs/lines/words) into
 * flat word/line/block lists in the engine's reading order.
 * Bboxes are assumed to already be in original-image coordinates; callers
 * that downscale for OCR must scale bboxes back before calling this.
 */
export function normalizeTesseractPage(
  page: unknown,
  imageW: number,
  imageH: number,
  engineVersion = 'tesseract.js'
): ScanResult {
  const words: OcrWord[] = [];
  const lines: OcrLine[] = [];
  const blocks: OcrBlock[] = [];

  if (!page || typeof page !== 'object') {
    return {
      words, lines, blocks,
      plainText: '', tableTsv: '', hasTable: false,
      imageW, imageH, engineVersion,
    };
  }

  const p = page as Record<string, unknown>;
  const rawBlocks = Array.isArray(p.blocks) ? p.blocks : [];

  rawBlocks.forEach((rawBlock, bi) => {
    if (!rawBlock || typeof rawBlock !== 'object') return;
    const b = rawBlock as Record<string, unknown>;
    const blockId = `b${bi}`;
    const blockBBox = readBBox(b.bbox ?? b);
    const rawParas = Array.isArray(b.paragraphs) ? b.paragraphs : [];
    const lineIds: string[] = [];

    rawParas.forEach((rawPara, pi) => {
      if (!rawPara || typeof rawPara !== 'object') return;
      const para = rawPara as Record<string, unknown>;
      const rawParaLines = Array.isArray(para.lines) ? para.lines : [];

      rawParaLines.forEach((rawLine, li) => {
        if (!rawLine || typeof rawLine !== 'object') return;
        const line = rawLine as Record<string, unknown>;
        const lineId = `${blockId}l${pi}-${li}`;
        const lineBBox = readBBox(line.bbox ?? line);
        const rawWords = Array.isArray(line.words) ? line.words : [];
        const wordIds: string[] = [];

        rawWords.forEach((rawWord, wi) => {
          if (!rawWord || typeof rawWord !== 'object') return;
          const w = rawWord as Record<string, unknown>;
          const text = toText(w.text).trim();
          if (!text) return;
          const id = `${lineId}w${wi}`;
          words.push({
            id,
            text,
            conf: num(w.confidence ?? w.conf),
            bbox: readBBox(w.bbox ?? w),
            lineId,
            blockId,
          });
          wordIds.push(id);
        });

        if (wordIds.length === 0) return;
        const lineText = wordIds
          .map((id) => words.find((w) => w.id === id)?.text ?? '')
          .filter(Boolean)
          .join(' ');
        lines.push({ id: lineId, blockId, bbox: lineBBox, wordIds, text: lineText });
        lineIds.push(lineId);
      });
    });

    if (lineIds.length > 0) {
      blocks.push({ id: blockId, bbox: blockBBox, lineIds });
    }
  });

  const plainText = buildPlainText(words, lines, blocks);
  const table = clusterTable(words);
  const tableTsv = table.hasTable ? buildTsv(table.rows) : '';

  return {
    words, lines, blocks, plainText,
    tableTsv, hasTable: table.hasTable,
    imageW, imageH, engineVersion,
  };
}

/**
 * Plain-text reconstruction in Tesseract reading order (blocks → lines →
 * words). Handles simple hyphenation: a line ending in "-" joined to a
 * next line starting lowercase merges without a space.
 */
export function buildPlainText(words: OcrWord[], lines: OcrLine[], blocks: OcrBlock[]): string {
  if (words.length === 0) return '';
  const wordById = new Map(words.map((w) => [w.id, w]));
  const outLines: string[] = [];

  for (const block of blocks) {
    for (const lineId of block.lineIds) {
      const line = lines.find((l) => l.id === lineId);
      if (!line) continue;
      const text = line.wordIds
        .map((id) => wordById.get(id)?.text ?? '')
        .filter(Boolean)
        .join(' ')
        .trim();
      if (text) outLines.push(text);
    }
  }

  // Fallback when blocks/lines are empty but words exist.
  if (outLines.length === 0) {
    return words.map((w) => w.text).join(' ');
  }

  // Hyphenation join.
  const joined: string[] = [];
  for (const line of outLines) {
    const prev = joined[joined.length - 1];
    if (prev && prev.endsWith('-') && /^[a-z]/.test(line)) {
      joined[joined.length - 1] = `${prev.slice(0, -1)}${line}`;
    } else {
      joined.push(line);
    }
  }
  return joined.join('\n');
}

/**
 * Groups words into table rows by y-center clustering and checks whether
 * the result looks like a real table (≥2 rows, ≥2 rows with ≥2 words,
 * columns start tightly aligned). Prose yields hasTable=false.
 */
export interface TableCluster {
  rows: OcrWord[][];
  colBounds: number[];
  hasTable: boolean;
}

export function clusterTable(words: OcrWord[]): TableCluster {
  if (words.length < 4) return { rows: [], colBounds: [], hasTable: false };

  // Median word height drives row tolerance.
  const heights = words
    .map((w) => Math.max(1, w.bbox.y1 - w.bbox.y0))
    .sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const tol = Math.max(4, medianH * 0.6);

  const sorted = [...words].sort((a, b) => {
    const ca = (a.bbox.y0 + a.bbox.y1) / 2;
    const cb = (b.bbox.y0 + b.bbox.y1) / 2;
    return ca - cb || a.bbox.x0 - b.bbox.x0;
  });

  const rows: OcrWord[][] = [];
  for (const w of sorted) {
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    let placed = false;
    for (const row of rows) {
      const rowCy = (row[0].bbox.y0 + row[0].bbox.y1) / 2;
      if (Math.abs(cy - rowCy) <= tol) {
        row.push(w);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([w]);
  }
  rows.forEach((r) => r.sort((a, b) => a.bbox.x0 - b.bbox.x0));

  const multiRows = rows.filter((r) => r.length >= 2);
  if (rows.length < 2 || multiRows.length < 2) {
    return { rows, colBounds: [], hasTable: false };
  }

  // Column alignment check: the second (and later) column starts must cluster.
  const maxCols = Math.max(...rows.map((r) => r.length));
  if (maxCols < 2) return { rows, colBounds: [], hasTable: false };

  // Gather x-start of each column index across multi-word rows.
  const colStarts: number[][] = Array.from({ length: maxCols }, () => []);
  for (const row of rows) {
    if (row.length < 2) continue;
    row.forEach((w, ci) => colStarts[ci].push(w.bbox.x0));
  }
  // Variance of column 2 (index 1) must be tight.
  const col1 = colStarts[1];
  if (col1.length >= 2) {
    const mean = col1.reduce((a, b) => a + b, 0) / col1.length;
    const variance = col1.reduce((a, b) => a + (b - mean) * (b - mean), 0) / col1.length;
    const std = Math.sqrt(variance);
    if (std > 60) {
      // Ragged prose, not a table. (Rows may still be eligible TSV if caller insists.)
      return { rows, colBounds: [], hasTable: false };
    }
  }

  // Compute average column left edges for colBounds.
  const colBounds = colStarts.map((starts) =>
    starts.length ? starts.reduce((a, b) => a + b, 0) / starts.length : 0
  );

  return { rows, colBounds, hasTable: true };
}

/** Renders table rows as TSV (tab-separated, newline-delimited). */
export function buildTsv(rows: OcrWord[][]): string {
  return rows
    .map((row) =>
      row.map((w) => w.text.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')
    )
    .join('\n');
}

/** Scales bboxes by a factor (OCR downscale → original coords). */
export function scaleBboxes(bboxes: OcrBBox[], factor: number): OcrBBox[] {
  if (factor === 1) return bboxes.map((b) => ({ ...b }));
  return bboxes.map((b) => ({
    x0: b.x0 * factor,
    y0: b.y0 * factor,
    x1: b.x1 * factor,
    y1: b.y1 * factor,
  }));
}

/** Filters words by minimum confidence. Default 0 keeps everything. */
export function filterWordsByConfidence(words: OcrWord[], minConf = MIN_CONFIDENCE_KEPT): OcrWord[] {
  if (minConf <= MIN_CONFIDENCE_KEPT) return words;
  return words.filter((w) => w.conf >= minConf);
}

/**
 * Marquee selection: rect-vs-word intersection.
 * Mode "intersect" (default): word counts when its center is inside the
 * rect OR ≥30% of its area overlaps. Mode "contain": word must be fully
 * inside the rect.
 */
export function marqueeSelect(words: OcrWord[], rect: ScanRect, mode: 'intersect' | 'contain' = 'intersect'): Set<string> {
  const x0 = Math.min(rect.x0, rect.x1);
  const x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1);
  const y1 = Math.max(rect.y0, rect.y1);
  const out = new Set<string>();

  for (const w of words) {
    if (mode === 'contain') {
      if (w.bbox.x0 >= x0 && w.bbox.x1 <= x1 && w.bbox.y0 >= y0 && w.bbox.y1 <= y1) {
        out.add(w.id);
      }
      continue;
    }
    // Intersect: center-in-rect or ≥30% area overlap.
    const cx = (w.bbox.x0 + w.bbox.x1) / 2;
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) {
      out.add(w.id);
      continue;
    }
    const iw = Math.max(0, Math.min(w.bbox.x1, x1) - Math.max(w.bbox.x0, x0));
    const ih = Math.max(0, Math.min(w.bbox.y1, y1) - Math.max(w.bbox.y0, y0));
    const area = Math.max(1e-9, (w.bbox.x1 - w.bbox.x0) * (w.bbox.y1 - w.bbox.y0));
    if ((iw * ih) / area >= 0.3) out.add(w.id);
  }
  return out;
}

/** Orders selected words in reading order (block → line → word index). */
function readingOrder(words: OcrWord[], lines: OcrLine[], blocks: OcrBlock[]): OcrWord[] {
  const order = new Map<string, number>();
  let n = 0;
  const wordById = new Map(words.map((w) => [w.id, w] as const));
  for (const block of blocks) {
    for (const lineId of block.lineIds) {
      const line = lines.find((l) => l.id === lineId);
      if (!line) continue;
      for (const wid of line.wordIds) {
        const w = wordById.get(wid);
        if (w) order.set(w.id, n++);
      }
    }
  }
  // Words with no line assignment go last in x/y order.
  const unlisted = words.filter((w) => !order.has(w.id));
  unlisted.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  for (const w of unlisted) order.set(w.id, n++);
  return words.filter((w) => order.has(w.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Plain text for a selection, in reading order. */
export function selectionToPlainText(words: OcrWord[], selectedIds: Set<string>, lines: OcrLine[] = [], blocks: OcrBlock[] = []): string {
  const picked = readingOrder(words, lines, blocks).filter((w) => selectedIds.has(w.id));
  return picked.map((w) => w.text).join(' ');
}

/** Returns the word whose bbox contains the point (smallest area wins). */
export function wordAtPoint(words: OcrWord[], x: number, y: number): OcrWord | null {
  let best: OcrWord | null = null;
  let bestArea = Infinity;
  for (const w of words) {
    if (x >= w.bbox.x0 && x <= w.bbox.x1 && y >= w.bbox.y0 && y <= w.bbox.y1) {
      const area = (w.bbox.x1 - w.bbox.x0) * (w.bbox.y1 - w.bbox.y0);
      if (area < bestArea) {
        bestArea = area;
        best = w;
      }
    }
  }
  return best;
}

/** TSV for a selection subset (when it forms rows, else space-joined text). */
export function selectionToTsv(words: OcrWord[], selectedIds: Set<string>): string {
  const picked = words.filter((w) => selectedIds.has(w.id));
  if (picked.length === 0) return '';
  const cluster = clusterTable(picked);
  if (!cluster.hasTable) return picked.map((w) => w.text).join(' ');
  // Keep only rows that contain at least one selected word (they all do, by construction).
  return buildTsv(cluster.rows);
}
