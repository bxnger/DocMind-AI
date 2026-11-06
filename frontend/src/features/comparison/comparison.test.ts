import { describe, expect, it } from 'vitest';
import type { Difference } from '@/types/comparison';
import { annotationsFor, countChanges, filterChanges, looksUnrelated, mirrorTop, stepChange, alignmentOf, isMoved, swapComparison, textMarksFor } from './compareModel';
import { buildUnified, countWords, type UnifiedItem } from './unifiedDiff';
import { blockInQuote, markParts } from '@/features/docx/quoteParts';
import type { Comparison } from '@/types/comparison';
import { diffWords, type Segment } from './wordDiff';

const added: Difference = { id: '1', type: 'added', explanation: '', a: null, b: { page: 2, quote: 'New clause.' } };
const removed: Difference = { id: '2', type: 'removed', explanation: '', a: { page: 1, quote: 'Old clause.' }, b: null };
const changed: Difference = { id: '3', type: 'changed', explanation: '', a: { page: 3, quote: '60 days' }, b: { page: 3, quote: '90 days' } };
const docx: Difference = { id: '4', type: 'removed', explanation: '', a: { page: null, quote: 'No page.' }, b: null };
const all = [added, removed, changed];
const join = (list: Segment[]) => list.map((s) => s.text).join('');
const marked = (list: Segment[]) => list.filter((s) => s.changed).map((s) => s.text.trim());

describe('diffWords', () => {
  it('marks only the changed word and rebuilds both quotes exactly', () => {
    const before = 'Notice of at  least 60 days is required.';
    const after = 'Notice of at  least 90 days is required.';
    const diff = diffWords(before, after);
    expect(marked(diff.a)).toEqual(['60']);
    expect(marked(diff.b)).toEqual(['90']);
    expect(join(diff.a)).toBe(before);
    expect(join(diff.b)).toBe(after);
    expect([diff.removedWords, diff.addedWords]).toEqual([1, 1]);
  });
  it('handles insertions, deletions and Cyrillic', () => {
    const diff = diffWords('Қатысушы саны үш адам', 'Қатысушы саны бес немесе үш адам');
    expect(marked(diff.a)).toEqual([]);
    expect(marked(diff.b)).toEqual(['бес немесе']);
    expect(diffWords('a b c', 'a c').removedWords).toBe(1);
  });
  it('treats identical text as no change and handles empty text', () => {
    expect(diffWords('same text', 'same text').addedWords).toBe(0);
    expect(diffWords('', 'x').addedWords).toBe(1);
  });
  it('shows a huge pair as changed whole, still exact', () => {
    const long = 'word '.repeat(3000);
    const diff = diffWords(long, long);
    expect(diff.removedWords).toBe(3000);
    expect(join(diff.a)).toBe(long);
  });
});

describe('counts and filters', () => {
  it('counts real differences', () => {
    expect(countChanges(all)).toEqual({ all: 3, changed: 1, added: 1, removed: 1 });
    expect(countChanges([])).toEqual({ all: 0, changed: 0, added: 0, removed: 0 });
  });
  it('filters by type', () => {
    expect(filterChanges(all, 'all')).toHaveLength(3);
    expect(filterChanges(all, 'added')).toEqual([added]);
    expect(filterChanges(all, 'changed')).toEqual([changed]);
  });
});

describe('stepChange', () => {
  it('moves and wraps in both directions', () => {
    expect(stepChange(all, '1', 1)).toBe(removed);
    expect(stepChange(all, '3', 1)).toBe(added);
    expect(stepChange(all, '1', -1)).toBe(changed);
  });
  it('starts from the matching end when nothing, or a filtered-out change, is selected', () => {
    expect(stepChange(all, null, 1)).toBe(added);
    expect(stepChange(all, null, -1)).toBe(changed);
    expect(stepChange([added], '3', 1)).toBe(added);
  });
  it('has nowhere to go in an empty list', () => {
    expect(stepChange([], null, 1)).toBeNull();
  });
});

describe('honesty rules', () => {
  it('flags documents with no similar sentences', () => {
    expect(looksUnrelated([added, removed])).toBe(true);
    expect(looksUnrelated(all)).toBe(false);
    expect(looksUnrelated([added])).toBe(false);
  });
  it('marks only sides that have a real page and quote', () => {
    expect(annotationsFor(all, 'a').map((n) => n.className)).toEqual(['hl-removed', 'hl-changed']);
    expect(annotationsFor(all, 'b').map((n) => n.className)).toEqual(['hl-added', 'hl-changed']);
    expect(annotationsFor([docx], 'a')).toEqual([]);
  });
});

describe('mirrorTop', () => {
  it('keeps the same share of the document and survives a page that cannot scroll', () => {
    expect(mirrorTop({ top: 50, range: 100 }, 400)).toBe(200);
    expect(mirrorTop({ top: 0, range: 0 }, 400)).toBe(0);
  });
});

describe('swapping the documents', () => {
  const comparison: Comparison = {
    id: 'c', documentAId: 'A', documentBId: 'B', status: 'ready', progress: 1, errorCode: null,
    differences: [
      { id: '1', type: 'added', explanation: '', a: null, b: { page: 2, quote: 'new' } },
      { id: '2', type: 'removed', explanation: '', a: { page: 1, quote: 'old' }, b: null },
      { id: '3', type: 'changed', explanation: '', a: { page: 1, quote: 'x' }, b: { page: 3, quote: 'y' } },
    ],
  };
  it('reads the same result the other way round', () => {
    const swapped = swapComparison(comparison);
    expect([swapped.documentAId, swapped.documentBId]).toEqual(['B', 'A']);
    expect(swapped.differences.map((d) => d.type)).toEqual(['removed', 'added', 'changed']);
    expect(swapped.differences[0]?.a).toEqual({ page: 2, quote: 'new' });
    expect(swapped.differences[2]?.b).toEqual({ page: 1, quote: 'x' });
  });
  it('twice gives back the original', () => {
    expect(swapComparison(swapComparison(comparison))).toEqual(comparison);
  });
});

describe('page alignment is never claimed without grounds', () => {
  const pdf = (pageCount: number) => ({ kind: 'pdf', pageCount });
  it('tells the cases apart', () => {
    expect(alignmentOf(pdf(3), pdf(3))).toBe('same-length');
    expect(alignmentOf(pdf(3), pdf(4))).toBe('proportional');
    expect(alignmentOf(pdf(3), { kind: 'docx', pageCount: null })).toBe('none');
    expect(alignmentOf(undefined, pdf(3))).toBe('none');
  });
});

describe('moved sentences', () => {
  it('are a change with identical text', () => {
    const quote = { page: 1, quote: 'same' };
    expect(isMoved({ id: '1', type: 'changed', explanation: '', a: quote, b: { page: 2, quote: 'same' } })).toBe(true);
    expect(isMoved({ id: '1', type: 'changed', explanation: '', a: quote, b: { page: 1, quote: 'other' } })).toBe(false);
  });
});

describe('unified diff', () => {
  const change = (id: string, type: Difference['type'], a: string | null, b: string | null): Difference => ({ id, type, explanation: '', a: a === null ? null : { page: 1, quote: a }, b: b === null ? null : { page: 1, quote: b } });
  const A = 'Intro stays. Rent is 100. Old clause goes. Outro stays.';
  const B = 'Intro stays. Rent is 200. New clause comes. Outro stays.';
  const differences = [change('1', 'changed', 'Rent is 100.', 'Rent is 200.'), change('2', 'removed', 'Old clause goes.', null), change('3', 'added', null, 'New clause comes.')];
  const shape = (items: UnifiedItem[]) => items.map((item) => (item.kind === 'same' ? item.text : `#${item.difference.id}`));

  it('puts each change in its place among the unchanged text', () => {
    const { items, unplaced } = buildUnified(A, B, differences);
    expect(shape(items)).toEqual(['Intro stays.', '#1', '#2', '#3', 'Outro stays.']);
    expect(unplaced).toEqual([]);
  });
  it('every unchanged word is real text of the document', () => {
    const { items } = buildUnified(A, B, differences);
    for (const item of items) if (item.kind === 'same') expect(B).toContain(item.text);
  });
  it('lists a change it cannot find apart, and invents no position', () => {
    const lost = change('9', 'added', null, 'Not in the text at all.');
    const { items, unplaced } = buildUnified(A, B, [...differences, lost]);
    expect(unplaced).toEqual([lost]);
    expect(shape(items)).not.toContain('#9');
  });
  it('handles a repeated sentence and one that moved', () => {
    const { items, unplaced } = buildUnified('Same. Same. End.', 'End. Same. Same.', [change('1', 'changed', 'End.', 'End.')]);
    expect(unplaced).toEqual([]);
    expect(shape(items)).toEqual(['#1', 'Same. Same.']);
  });
  it('identical documents are one unchanged run', () => {
    expect(shape(buildUnified(A, A, []).items)).toEqual([A]);
  });
  it('never cuts inside a word', () => {
    const { items } = buildUnified('Alpha beta gamma removed one. Delta epsilon.', 'Alpha beta gamma Delta epsilon.', [change('1', 'removed', 'removed one.', null)]);
    expect(shape(items)).toEqual(['Alpha beta gamma', '#1', 'Delta epsilon.']);
  });
  it('counts words', () => {
    expect(countWords(' two  words ')).toBe(2);
  });
});

describe('marks in the text of a DOCX', () => {
  it('marks only what is really in the block, and rebuilds it exactly', () => {
    const text = 'Pay 5 now. Then rest.';
    const parts = markParts(text, [{ quote: 'Pay 5 now.', className: 'x' }, { quote: 'absent', className: 'y' }]);
    expect(parts).toEqual([{ text: 'Pay 5 now.', className: 'x' }, { text: ' Then rest.' }]);
    expect(parts.map((part) => part.text).join('')).toBe(text);
  });
  it('does not let marks overlap', () => {
    const parts = markParts('abcdef', [{ quote: 'abcd', className: 'first' }, { quote: 'cdef', className: 'second' }]);
    expect(parts.filter((part) => part.className).map((part) => part.className)).toEqual(['first']);
  });
  it('marks a whole block that is a part of a longer sentence', () => {
    expect(markParts('Договор поставки', [{ quote: 'Договор поставки Настоящий договор вступает в силу.', className: 'x' }])).toEqual([{ text: 'Договор поставки', className: 'x' }]);
  });
  it('does not take a short common word for a part of the quote', () => {
    expect(blockInQuote('цена', 'Договорная цена указана.')).toBe(false);
    expect(blockInQuote('цена', 'цена указана.')).toBe(true);
  });
  it('gives the whole block unmarked when nothing matches', () => {
    expect(markParts('abc', [])).toEqual([{ text: 'abc' }]);
  });
});

describe('text marks for a comparison', () => {
  it('uses the real quotes of that side', () => {
    const list: Difference[] = [{ id: '1', type: 'added', explanation: '', a: null, b: { page: null, quote: 'new' } }];
    expect(textMarksFor(list, 'a')).toEqual([]);
    expect(textMarksFor(list, 'b')).toEqual([{ quote: 'new', className: 'docx-added' }]);
  });
});
