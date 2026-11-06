import type { Comparison, Difference, DifferenceType } from '@/types/comparison';

import type { QuoteMark } from '@/features/docx/quoteParts';

export type ChangeFilter = 'all' | DifferenceType;
export type Side = 'a' | 'b';

export function countChanges(differences: readonly Difference[]): Record<ChangeFilter, number> {
  const counts = { all: differences.length, changed: 0, added: 0, removed: 0 };
  for (const difference of differences) counts[difference.type] += 1;
  return counts;
}

export function filterChanges(differences: readonly Difference[], filter: ChangeFilter): Difference[] {
  return filter === 'all' ? [...differences] : differences.filter((difference) => difference.type === filter);
}

/** The next change in the visible list, wrapping around. With nothing selected, starts from the matching end. */
export function stepChange(visible: readonly Difference[], selectedId: string | null, delta: 1 | -1): Difference | null {
  if (visible.length === 0) return null;
  const position = visible.findIndex((difference) => difference.id === selectedId);
  if (position === -1) return visible[delta === 1 ? 0 : visible.length - 1] ?? null;
  return visible[(position + delta + visible.length) % visible.length] ?? null;
}

/**
 * Two sides of the same change. Only sentences that differ reach this list, so no similar pair at all
 * while both sides have sentences of their own is a sign of two unrelated documents.
 */
export function looksUnrelated(differences: readonly Difference[]): boolean {
  const counts = countChanges(differences);
  return counts.changed === 0 && counts.added > 0 && counts.removed > 0;
}

/** Text to mark on one document's pages. A side without a page has nothing to mark. */
export function annotationsFor(differences: readonly Difference[], side: Side) {
  return differences.flatMap((difference) => {
    const evidence = difference[side];
    return evidence && evidence.page !== null ? [{ page: evidence.page, quote: evidence.quote, className: `hl-${difference.type}` }] : [];
  });
}

/** The same for a document without pages, whose reader marks text wherever it is really found. */
export function textMarksFor(differences: readonly Difference[], side: Side): QuoteMark[] {
  return differences.flatMap((difference) => {
    const evidence = difference[side];
    return evidence ? [{ quote: evidence.quote, className: `docx-${difference.type}` }] : [];
  });
}

/** Scroll lock moves by the same share of the document. Pages do not align one to one, so it is approximate. */
export function mirrorTop(from: { top: number; range: number }, targetRange: number): number {
  return from.range <= 0 ? 0 : (from.top / from.range) * targetRange;
}

/** The same result read the other way round: what was added to B is what would be removed from it. */
export function swapComparison(comparison: Comparison): Comparison {
  const opposite = { added: 'removed', removed: 'added', changed: 'changed' } as const;
  return {
    ...comparison,
    documentAId: comparison.documentBId,
    documentBId: comparison.documentAId,
    differences: comparison.differences.map((difference) => ({ ...difference, type: opposite[difference.type], a: difference.b, b: difference.a })),
  };
}

/** The server reports a sentence that only changed place as a change with identical text on both sides. */
export const isMoved = (difference: Difference): boolean =>
  difference.type === 'changed' && difference.a !== null && difference.a.quote === difference.b?.quote;

/** Pages can line up one to one only between PDFs of equal length. Anything else must not claim to. */
export function alignmentOf(a: { kind: string; pageCount: number | null } | undefined, b: { kind: string; pageCount: number | null } | undefined): 'same-length' | 'proportional' | 'none' {
  if (a?.kind !== 'pdf' || b?.kind !== 'pdf') return 'none';
  return a.pageCount === b.pageCount ? 'same-length' : 'proportional';
}
