import { describe, expect, it } from 'vitest';
import { PAGE_GAP, displayedPage, pageScrollTop, revealHeight, spotScrollTop } from './usePdfScroller';

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

  it('reveals higher on a phone, where the evidence sheet covers the lower part', () => {
    expect(revealHeight({ clientWidth: 1000, clientHeight: 600 })).toBe(600);
    expect(revealHeight({ clientWidth: 360, clientHeight: 600 })).toBeCloseTo(180);
  });
});

describe('page number shown after navigation', () => {
  it('names the requested page even when the end of the document stops the scroll short', () => {
    // Citation on the last page; the reading line can only reach page 3.
    expect(displayedPage(3, 4)).toBe(4);
  });
  it('follows the scroll position once the user has taken over', () => {
    expect(displayedPage(3, null)).toBe(3);
  });
});
