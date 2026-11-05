import { describe, expect, it } from 'vitest';
import { quoteParts } from '@/features/docx/quoteParts';
import { canOpenFact, factMessage, factSource } from './factSources';

const base = { kind: 'date' as const, value: '1 May', quote: 'Due on 1 May.', location: null, highlights: [] };
const blocks = [{ index: 0, kind: 'heading' as const, section: null, text: 'Terms' }, { index: 1, kind: 'paragraph' as const, section: 'Terms', text: 'Pay. Due on 1 May. Thanks.' }];

describe('facts as evidence', () => {
  it('a PDF fact keeps its page and the highlights the server sent', () => {
    const rect = { x: 0, y: 0, w: 1, h: 1 };
    const source = factSource({ ...base, page: 3, highlights: [rect] }, 'd', 'n', undefined);
    expect(source).toMatchObject({ page: 3, highlights: [rect] });
    expect(source.paragraph).toBeUndefined();
    expect(canOpenFact(source)).toBe(true);
  });
  it('a PDF fact without highlights does not get any', () => {
    expect(factSource({ ...base, page: 3 }, 'd', 'n', undefined).highlights).toBeUndefined();
  });
  it('a DOCX fact opens only the block that really has the sentence', () => {
    expect(factSource({ ...base, page: null }, 'd', 'n', blocks).paragraph).toBe(1);
    const missing = factSource({ ...base, quote: 'Elsewhere.', page: null }, 'd', 'n', blocks);
    expect(missing.paragraph).toBeUndefined();
    expect(canOpenFact(missing)).toBe(false);
  });
  it('a DOCX quote that spans blocks opens the block holding the value', () => {
    const rows = [{ index: 4, kind: 'table_row' as const, section: null, text: 'Stage | Term' }, { index: 5, kind: 'table_row' as const, section: null, text: 'First | 1 May' }];
    expect(factSource({ ...base, quote: 'Stage | Term First | 1 May', page: null }, 'd', 'n', rows).paragraph).toBe(5);
  });
  it('the message is separate from the chat', () => {
    const message = factMessage(factSource({ ...base, page: 1 }, 'd', 'n', undefined));
    expect(message.id.startsWith('facts:')).toBe(true);
    expect(message.sources).toHaveLength(1);
  });
});

describe('quote marking in the reader', () => {
  it('splits around an exact quote', () => {
    expect(quoteParts('Pay. Due on 1 May. Thanks.', 'Due on 1 May.')).toEqual(['Pay. ', 'Due on 1 May.', ' Thanks.']);
  });
  it('marks the whole block when the quote runs past it', () => {
    expect(quoteParts('First', 'Heading First')).toEqual(['', 'First', '']);
  });
  it('marks nothing when the quote is not there', () => {
    expect(quoteParts('Pay.', 'Due')).toBeNull();
    expect(quoteParts('Pay.', '')).toBeNull();
  });
});
