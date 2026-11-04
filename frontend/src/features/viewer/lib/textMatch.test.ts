import { describe, expect, it } from 'vitest';
import { findMatches, renderItemHtml } from './textMatch';

describe('findMatches', () => {
  it('finds a quote that wraps across items', () => {
    const items = ['Either party may ', '', 'terminate this', ' Agreement.'];
    expect(findMatches(items, 'party may terminate this Agreement.')).toEqual([
      [
        { item: 0, start: 7, end: 16 },
        { item: 2, start: 0, end: 14 },
        { item: 3, start: 1, end: 11 },
      ],
    ]);
  });

  it('ignores case only when asked', () => {
    expect(findMatches(['Payment'], 'payment')).toEqual([]);
    expect(findMatches(['Payment'], 'payment', { foldCase: true })).toHaveLength(1);
  });

  it('finds every occurrence and honours the limit', () => {
    expect(findMatches(['aa aa aa'], 'aa')).toHaveLength(3);
    expect(findMatches(['aa aa aa'], 'aa', { limit: 2 })).toHaveLength(2);
  });

  it('returns nothing for an empty needle or a missing quote', () => {
    expect(findMatches(['text'], '   ')).toEqual([]);
    expect(findMatches(['text'], 'absent')).toEqual([]);
  });
});

describe('renderItemHtml', () => {
  it('escapes text from the PDF', () => {
    expect(renderItemHtml('<script>', undefined)).toBe('&lt;script&gt;');
  });

  it('wraps only the marked range', () => {
    expect(renderItemHtml('a<b>c', [{ start: 1, end: 4, className: 'hl' }])).toBe(
      'a<mark class="hl">&lt;b&gt;</mark>c',
    );
  });
});
