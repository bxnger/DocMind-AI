import { describe, expect, it } from 'vitest';
import type { DocumentText } from '@/services/chat';
import { locateEvidence } from './locate';

const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.02 };
const pages: DocumentText = [
  { page: 1, items: ['Registration closes ', 'on 5 November.'], text: 'Registration closes on 5 November.' },
  { page: 2, items: ['Teams may have at most three members.'], text: 'Teams may have at most three members.' },
];

describe('locateEvidence', () => {
  it('trusts the backend coordinates and does not look in the text', () => {
    expect(locateEvidence({ page: 1, quote: 'anything', highlights: [rect] }, pages)).toEqual({ kind: 'coordinates', match: null });
    expect(locateEvidence({ page: 1, quote: 'anything', highlights: [rect] }, undefined).kind).toBe('coordinates');
  });

  it('without coordinates, highlights only a quote that is really in the page text', () => {
    const found = locateEvidence({ page: 1, quote: 'Registration closes on 5 November.' }, pages);
    expect(found.kind).toBe('text');
    expect(found.match).toHaveLength(2);
  });

  it('without coordinates and without the quote on the page, opens the page and highlights nothing', () => {
    expect(locateEvidence({ page: 2, quote: 'Registration closes on 5 November.' }, pages)).toEqual({ kind: 'page', match: null });
  });

  it('treats an empty list of rectangles as no coordinates', () => {
    expect(locateEvidence({ page: 2, quote: 'Teams may have at most three members.', highlights: [] }, pages).kind).toBe('text');
  });

  it('says it does not know yet while the page text is still being read', () => {
    expect(locateEvidence({ page: 1, quote: 'Registration closes' }, undefined)).toEqual({ kind: 'unknown', match: null });
  });

  it('opens the page for a page that has no text, such as a scan', () => {
    expect(locateEvidence({ page: 1, quote: 'x' }, [{ page: 1, items: [], text: '' }]).kind).toBe('page');
    expect(locateEvidence({ page: 9, quote: 'x' }, pages).kind).toBe('page');
  });

  it('has no quote to search for, so only the page is known', () => {
    expect(locateEvidence({ page: 1, quote: null }, pages).kind).toBe('page');
  });

  it('is a section for DOCX, whatever else the source carries', () => {
    expect(locateEvidence({ page: null, quote: 'Ends in sixty days.' }, pages)).toEqual({ kind: 'section', match: null });
    expect(locateEvidence({ page: null, quote: 'x', highlights: [rect] }, undefined).kind).toBe('section');
  });
});
