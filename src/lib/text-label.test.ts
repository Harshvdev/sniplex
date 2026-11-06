import { describe, expect, it } from 'bun:test';
import {
  TEXT_DEFAULT_SIZE,
  TEXT_MAX_SIZE,
  TEXT_MIN_SIZE,
  clampTextSize,
  createTextLabel,
  estimateTextWidth,
  hitTextLabel,
  isCommittableText,
  isValidTextAlign,
  labelHeight,
  labelHitDistance,
  labelWidth,
  textLines,
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
});
