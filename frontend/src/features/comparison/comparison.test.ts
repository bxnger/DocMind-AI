import { describe, expect, it } from 'vitest';
import type { Difference } from '@/types/comparison';
import { annotationsFor, countChanges, filterChanges, looksUnrelated, mirrorTop, stepChange } from './compareModel';
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
