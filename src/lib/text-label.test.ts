import { describe, expect, it } from 'bun:test';
import {
  TEXT_DEFAULT_SIZE,
  TEXT_MAX_SIZE,
  TEXT_MIN_SIZE,
  clampTextSize,
  cornerScale,
  createTextLabel,
  estimateTextWidth,
  hitTextLabel,
  isCommittableText,
  isValidTextAlign,
  labelHeight,
  labelHitDistance,
  labelWidth,
  textBoxZone,
  textLines,
  textZoneCursor,
} from './text-label';

describe('Phase 12: Text Insertion', () => {
  it('clamps font sizes to 8–72 px', () => {
    expect(clampTextSize(2)).toBe(TEXT_MIN_SIZE);
    expect(clampTextSize(200)).toBe(TEXT_MAX_SIZE);
    expect(clampTextSize(24)).toBe(24);
    expect(clampTextSize(Number.NaN)).toBe(TEXT_DEFAULT_SIZE);
  });

  it('accepts only left/center/right alignment', () => {
    expect(isValidTextAlign('left')).toBe(true);
    expect(isValidTextAlign('center')).toBe(true);
    expect(isValidTextAlign('right')).toBe(true);
    expect(isValidTextAlign('justify')).toBe(false);
  });

  it('commits only non-whitespace content', () => {
    expect(isCommittableText('Hello')).toBe(true);
    expect(isCommittableText('   ')).toBe(false);
    expect(isCommittableText('')).toBe(false);
  });

  it('creates labels with sane defaults', () => {
    const label = createTextLabel({ text: 'Note', x: 30, y: 40 });
    expect(label.text).toBe('Note');
    expect(label.fontSize).toBe(TEXT_DEFAULT_SIZE);
    expect(label.align).toBe('left');
    expect(label.id.length).toBeGreaterThan(0);
  });

  it('estimates text width proportional to size and length', () => {
    expect(estimateTextWidth(20, 'AB')).toBe(24);
    expect(estimateTextWidth(20, '')).toBe(0);
    expect(estimateTextWidth(20, 'ABCD')).toBeGreaterThan(estimateTextWidth(20, 'AB'));
  });

  it('splits multi-line labels into separate rows', () => {
    expect(textLines('a\r\nb\nc')).toEqual(['a', 'b', 'c']);
    const label = createTextLabel({ text: 'one\ntwo\nthree', x: 0, y: 0, fontSize: 20 });
    expect(labelHeight(label)).toBe(3 * 20 * 1.35);
    // Width is the widest line, not the whole blob.
    expect(labelWidth(label)).toBe(estimateTextWidth(20, 'three'));
  });

  it('hit-tests a click inside the label box', () => {
    const label = createTextLabel({ text: 'Hello', x: 10, y: 10, fontSize: 20 });
    expect(hitTextLabel(label, 15, 15)).toBe(true);
    expect(hitTextLabel(label, 500, 500)).toBe(false);
  });

  it('reports zero distance inside and positive distance outside', () => {
    const label = createTextLabel({ text: 'Hi', x: 0, y: 0, fontSize: 20 });
    expect(labelHitDistance(label, 1, 1)).toBe(0);
    expect(labelHitDistance(label, 1000, 1000)).toBeGreaterThan(0);
  });

  it('grows downward (y) at a fixed width (x) while typing', () => {
    // Fixed 120px box width: short text is one line, long text wraps and
    // the height grows downward without the box widening.
    const short = createTextLabel({ text: 'Hi', x: 10, y: 20, fontSize: 20, maxWidth: 120 });
    const long = createTextLabel({
      text: 'a longer sentence that keeps going and going',
      x: 10,
      y: 20,
      fontSize: 20,
      maxWidth: 120,
    });
    expect(long.maxWidth).toBe(short.maxWidth);
    expect(labelHeight(long)).toBeGreaterThan(labelHeight(short));
    expect(labelHeight(long)).toBeGreaterThan(short.fontSize * 1.35);
    // Wrapped lines never exceed the fixed box width.
    expect(labelWidth(long)).toBeLessThanOrEqual(120);
  });

  describe('Canva-style text-box zones', () => {
    // 'Hello' @ 20px: width 60, height 27 → box 100..160 × 100..127.
    const label = () => createTextLabel({ text: 'Hello', x: 100, y: 100, fontSize: 20 });

    it('treats the strict interior as interior (edit, never move)', () => {
      expect(textBoxZone(label(), 130, 113)).toBe('interior');
      // 10px past the top border is still inside, and must NOT become a move zone.
      expect(textBoxZone(label(), 130, 110)).toBe('interior');
      expect(textBoxZone(label(), 115, 109)).toBe('interior');
      expect(textZoneCursor('interior')).toBe('cursor-text');
    });

    it('maps corners to resize cursors', () => {
      expect(textBoxZone(label(), 100, 100)).toBe('nw');
      expect(textBoxZone(label(), 160, 100)).toBe('ne');
      expect(textBoxZone(label(), 100, 127)).toBe('sw');
      expect(textBoxZone(label(), 160, 127)).toBe('se');
      expect(textZoneCursor('nw')).toBe('cursor-nwse-resize');
      expect(textZoneCursor('se')).toBe('cursor-nwse-resize');
      expect(textZoneCursor('ne')).toBe('cursor-nesw-resize');
      expect(textZoneCursor('sw')).toBe('cursor-nesw-resize');
    });

    it('maps left/right edges to width-change cursors', () => {
      expect(textBoxZone(label(), 100, 113)).toBe('w');
      expect(textBoxZone(label(), 160, 113)).toBe('e');
      expect(textZoneCursor('w')).toBe('cursor-ew-resize');
      expect(textZoneCursor('e')).toBe('cursor-ew-resize');
    });

    it('maps top/bottom edges to move cursors', () => {
      expect(textBoxZone(label(), 130, 100)).toBe('n');
      expect(textBoxZone(label(), 130, 127)).toBe('s');
      expect(textZoneCursor('n')).toBe('cursor-move');
      expect(textZoneCursor('s')).toBe('cursor-move');
    });

    it('keeps the edge cursor just outside the border', () => {
      expect(textBoxZone(label(), 96, 113)).toBe('w');
      expect(textBoxZone(label(), 130, 96)).toBe('n');
      expect(textBoxZone(label(), 164, 113)).toBe('e');
      expect(textBoxZone(label(), 130, 131)).toBe('s');
      expect(textBoxZone(label(), 96, 96)).toBe('nw');
    });

    it('returns null far outside the box', () => {
      expect(textBoxZone(label(), 500, 500)).toBeNull();
      expect(textZoneCursor(null)).toBeNull();
    });

    it('keeps a tiny label interior-clickable', () => {
      const tiny = createTextLabel({ text: 'I', x: 50, y: 50, fontSize: 20 });
      const cx = 50 + labelWidth(tiny) / 2;
      const cy = 50 + labelHeight(tiny) / 2;
      expect(textBoxZone(tiny, cx, cy)).toBe('interior');
    });

    it('uses the stretched width as the visible box width', () => {
      // Short text with a wide explicit width: side handles move the box.
      const label = createTextLabel({ text: 'Hi', x: 10, y: 10, fontSize: 20, maxWidth: 300 });
      expect(labelWidth(label)).toBe(300);
      expect(hitTextLabel(label, 200, 15)).toBe(true);
    });

    it('scales corners uniformly with the opposite corner fixed', () => {
      const box = { x: 100, y: 100, width: 120, height: 60 };
      // Southeast drag to double size: anchor NW (100,100) fixed.
      const grown = cornerScale('se', { x: 340, y: 220 }, box, 20);
      expect(grown.ratio).toBeCloseTo(2);
      expect(grown.width).toBeCloseTo(240);
      expect(grown.height).toBeCloseTo(120);
      expect(grown.fontSize).toBeCloseTo(40);
      expect(grown.x).toBeCloseTo(100);
      expect(grown.y).toBeCloseTo(100);
      expect(grown.width / grown.height).toBeCloseTo(box.width / box.height);
      // Northeast drag to double size: anchor SW (100,160) fixed.
      const north = cornerScale('ne', { x: 340, y: 40 }, box, 20);
      expect(north.x).toBeCloseTo(100);
      expect(north.y + north.height).toBeCloseTo(160);
      expect(north.fontSize).toBeCloseTo(40);
      // Clamp keeps font size in range.
      const huge = cornerScale('se', { x: 10000, y: 10000 }, box, 20);
      expect(huge.fontSize).toBe(TEXT_MAX_SIZE);
    });
  });
});
