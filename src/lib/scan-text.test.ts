import { describe, expect, it } from 'bun:test';
import {
  buildPlainText,
  buildTsv,
  clusterTable,
  filterWordsByConfidence,
  marqueeSelect,
  normalizeTesseractPage,
  scaleBboxes,
  selectionToPlainText,
  selectionToTsv,
  wordAtPoint,
  type OcrWord,
} from './scan-text';

function word(id: string, text: string, x0: number, y0: number, x1: number, y1: number, conf = 95): OcrWord {
  return { id, text, conf, bbox: { x0, y0, x1, y1 }, lineId: id.split('-')[0], blockId: 'b0' };
}

describe('Phase 21: normalizeTesseractPage', () => {
  it('maps nested blocks/lines/words to flat lists with stable ids', () => {
    const page = {
      blocks: [
        {
          bbox: { x0: 0, y0: 0, x1: 100, y1: 50 },
          paragraphs: [
            {
              lines: [
                {
                  bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
                  words: [
                    { text: 'Hello', confidence: 98, bbox: { x0: 0, y0: 0, x1: 40, y1: 20 } },
                    { text: 'world', confidence: 91, bbox: { x0: 45, y0: 0, x1: 90, y1: 20 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = normalizeTesseractPage(page, 100, 50);
    expect(result.words).toHaveLength(2);
    expect(result.words[0].text).toBe('Hello');
    expect(result.words[0].id).toBeTruthy();
    expect(result.lines).toHaveLength(1);
    expect(result.blocks).toHaveLength(1);
    expect(result.plainText).toBe('Hello world');
  });

  it('handles empty / malformed pages', () => {
    expect(normalizeTesseractPage(null, 800, 600).words).toHaveLength(0);
    expect(normalizeTesseractPage({}, 800, 600).plainText).toBe('');
  });
});

describe('Phase 21: buildPlainText reading order & hyphenation', () => {
  it('preserves block order (two columns → column1 then column2)', () => {
    const words = [
      word('b0l0-0w0', 'Left', 0, 0, 30, 12),
      word('b0l0-0w1', 'one', 35, 0, 60, 12),
      word('b1l0-0w0', 'Right', 200, 0, 230, 12),
      word('b1l0-0w1', 'two', 235, 0, 260, 12),
    ];
    const lines = [
      { id: 'b0l0-0', blockId: 'b0', bbox: { x0: 0, y0: 0, x1: 60, y1: 12 }, wordIds: ['b0l0-0w0', 'b0l0-0w1'], text: 'Left one' },
      { id: 'b1l0-0', blockId: 'b1', bbox: { x0: 200, y0: 0, x1: 260, y1: 12 }, wordIds: ['b1l0-0w0', 'b1l0-0w1'], text: 'Right two' },
    ];
    const blocks = [
      { id: 'b0', bbox: { x0: 0, y0: 0, x1: 60, y1: 12 }, lineIds: ['b0l0-0'] },
      { id: 'b1', bbox: { x0: 200, y0: 0, x1: 260, y1: 12 }, lineIds: ['b1l0-0'] },
    ];
    expect(buildPlainText(words, lines, blocks)).toBe('Left one\nRight two');
  });

  it('joins hyphenated line breaks', () => {
    const words = [word('b0l0-0w0', 'exam-', 0, 0, 40, 12), word('b0l1-0w0', 'ple', 0, 14, 30, 26)];
    const lines = [
      { id: 'b0l0-0', blockId: 'b0', bbox: { x0: 0, y0: 0, x1: 40, y1: 12 }, wordIds: ['b0l0-0w0'], text: 'exam-' },
      { id: 'b0l1-0', blockId: 'b0', bbox: { x0: 0, y0: 14, x1: 30, y1: 26 }, wordIds: ['b0l1-0w0'], text: 'ple' },
    ];
    const blocks = [{ id: 'b0', bbox: { x0: 0, y0: 0, x1: 40, y1: 26 }, lineIds: ['b0l0-0', 'b0l1-0'] }];
    expect(buildPlainText(words, lines, blocks)).toBe('example');
  });
});

describe('Phase 21: marqueeSelect & selection order', () => {
  const words = [
    word('b0l0-0w0', 'A', 0, 0, 20, 10),
    word('b0l0-0w1', 'B', 25, 0, 45, 10),
    word('b0l1-0w0', 'C', 0, 20, 20, 30),
  ];
  it('selects intersecting words (center-in-rect)', () => {
    const s = marqueeSelect(words, { x0: 0, y0: 0, x1: 50, y1: 15 });
    expect(s.has('b0l0-0w0')).toBe(true);
    expect(s.has('b0l0-0w1')).toBe(true);
    expect(s.has('b0l1-0w0')).toBe(false);
  });

  it('contain mode requires full enclosure', () => {
    const s = marqueeSelect(words, { x0: 0, y0: 0, x1: 22, y1: 12 }, 'contain');
    expect(s.has('b0l0-0w0')).toBe(true);
    expect(s.has('b0l0-0w1')).toBe(false);
  });

  it('selectionToPlainText is reading-order regardless of Set iteration', () => {
    const lines = [
      { id: 'b0l0-0', blockId: 'b0', bbox: { x0: 0, y0: 0, x1: 45, y1: 10 }, wordIds: ['b0l0-0w0', 'b0l0-0w1'], text: 'A B' },
      { id: 'b0l1-0', blockId: 'b0', bbox: { x0: 0, y0: 20, x1: 20, y1: 30 }, wordIds: ['b0l1-0w0'], text: 'C' },
    ];
    const blocks = [{ id: 'b0', bbox: { x0: 0, y0: 0, x1: 45, y1: 30 }, lineIds: ['b0l0-0', 'b0l1-0'] }];
    // Reverse insertion order — copy must still be A B C.
    const sel = new Set(['b0l1-0w0', 'b0l0-0w1', 'b0l0-0w0']);
    expect(selectionToPlainText(words, sel, lines, blocks)).toBe('A B C');
  });
});

describe('Phase 21: table clustering & TSV', () => {
  const tableWords = [
    word('l1w0', 'Name', 0, 0, 60, 14), word('l1w1', 'Age', 100, 0, 150, 14),
    word('l2w0', 'Ann', 0, 20, 60, 34), word('l2w1', '30', 102, 20, 150, 34),
    word('l3w0', 'Bob', 0, 40, 60, 54), word('l3w1', '41', 101, 40, 150, 54),
  ];

  it('detects a 3x3(2-col) grid as table', () => {
    const c = clusterTable(tableWords);
    expect(c.hasTable).toBe(true);
    expect(c.rows).toHaveLength(3);
    expect(buildTsv(c.rows)).toBe('Name\tAge\nAnn\t30\nBob\t41');
  });

  it('rejects single-word rows (prose) as table', () => {
    const prose = [word('p1', 'Hello', 0, 0, 50, 12), word('p2', 'World', 0, 20, 50, 32), word('p3', 'Again', 0, 40, 50, 52)];
    expect(clusterTable(prose).hasTable).toBe(false);
  });

  it('escapes tabs/newlines inside word text', () => {
    expect(buildTsv([[word('e1', 'a\tb\nc', 0, 0, 10, 10)]])).toBe('a b c');
  });

  it('selectionToTsv falls back to space-join for non-table selections', () => {
    const prose = [word('p1', 'Hello', 0, 0, 50, 12), word('p2', 'World', 0, 20, 50, 32), word('p3', 'Again', 0, 40, 50, 52)];
    const sel = new Set(['p1', 'p2', 'p3']);
    expect(selectionToTsv(prose, sel)).toBe('Hello World Again');
  });

  it('selectionToTsv returns TSV for table subsets', () => {
    const sel = new Set(tableWords.map((w) => w.id));
    expect(selectionToTsv(tableWords, sel)).toBe('Name\tAge\nAnn\t30\nBob\t41');
  });
});

describe('Phase 21: helpers', () => {
  it('scales bboxes round-trip', () => {
    const boxes = [{ x0: 10, y0: 20, x1: 30, y1: 40 }];
    const down = scaleBboxes(boxes, 0.5);
    expect(down[0]).toEqual({ x0: 5, y0: 10, x1: 15, y1: 20 });
    const up = scaleBboxes(down, 2);
    expect(up[0]).toEqual(boxes[0]);
  });

  it('wordAtPoint returns containing word or null', () => {
    const words = [word('w1', 'Hi', 10, 10, 40, 24)];
    expect(wordAtPoint(words, 20, 15)?.id).toBe('w1');
    expect(wordAtPoint(words, 100, 100)).toBeNull();
  });

  it('filterWordsByConfidence keeps everything at min=0', () => {
    const words = [word('w1', 'a', 0, 0, 10, 10, 12), word('w2', 'b', 0, 20, 10, 30, 98)];
    expect(filterWordsByConfidence(words, 0)).toHaveLength(2);
    expect(filterWordsByConfidence(words, 50)).toHaveLength(1);
  });
});
