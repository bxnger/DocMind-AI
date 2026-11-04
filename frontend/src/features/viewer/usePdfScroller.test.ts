import { describe, expect, it } from 'vitest';
import { PAGE_GAP, pageScrollTop, spotScrollTop } from './usePdfScroller';

describe('scroll targets', () => {
  it('puts the highlighted spot in the upper third of the viewport', () => {
    // Page starts at 1000, is 1000 tall, the quote is 40% down, the viewport is 600 tall.
    expect(spotScrollTop(1000, 1000, 0.4, 600)).toBe(1000 + 400 - 200);
  });

  it('never scrolls above the top of the document', () => {
    expect(spotScrollTop(24, 800, 0.01, 900)).toBe(0);
    expect(pageScrollTop(0)).toBe(0);
  });

  it('shows the whole top of a page, with its gap', () => {
    expect(pageScrollTop(2000)).toBe(2000 - PAGE_GAP);
  });
});
