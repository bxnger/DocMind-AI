import { describe, expect, it } from 'vitest';
import { toSource } from './conversations';

const base = { index: 2, documentId: 'd', documentName: 'n', quote: 'q' };

describe('toSource', () => {
  it('keeps PDF page and highlights', () => {
    const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.01 };
    expect(toSource({ ...base, page: 4, highlights: [rect] })).toMatchObject({ index: 2, page: 4, location: null, highlights: [rect] });
  });
  it('keeps a null page and the location for DOCX', () => {
    const source = toSource({ ...base, page: null, location: 'Terms' });
    expect(source.page).toBeNull();
    expect(source.location).toBe('Terms');
    expect(source.highlights).toBeUndefined();
  });
  it('rejects the old marker field', () => {
    expect(() => toSource({ marker: 1, documentId: 'd', documentName: 'n', quote: 'q' })).toThrow();
  });
});
