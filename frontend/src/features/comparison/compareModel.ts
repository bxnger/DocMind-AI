import type { Difference, DifferenceType } from '@/types/comparison';

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

/** Scroll lock moves by the same share of the document. Pages do not align one to one, so it is approximate. */
export function mirrorTop(from: { top: number; range: number }, targetRange: number): number {
  return from.range <= 0 ? 0 : (from.top / from.range) * targetRange;
}
