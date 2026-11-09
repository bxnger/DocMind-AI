import { toMinor } from '@/lib/money';
import type { Offer, Part, PartOffers } from '@/types/procurement';
import { compareCodes, looksLikeCode, nameMatches, type CodeMatch } from './codes';

export type OfferSort = 'exactFirst' | 'priceAsc' | 'priceDesc';
export const OFFER_SORTS: readonly OfferSort[] = ['exactFirst', 'priceAsc', 'priceDesc'];

export interface OfferFilter {
  exactOnly: boolean;
  pricedOnly: boolean;
}

export const NO_FILTER: OfferFilter = { exactOnly: false, pricedOnly: false };

const minor = (offer: Offer): bigint | null => (offer.price === null ? null : toMinor(offer.price));

/** Tenge first, then other currencies: amounts in different currencies are never compared with each other. */
const currencyRank = (offer: Offer): string => (offer.currency === 'KZT' ? '' : (offer.currency ?? '~'));

/** Unknown prices always go last: an empty price is never the cheapest. Ties keep the server's order. */
function byPrice(direction: 1 | -1) {
  return (a: Offer, b: Offer): number => {
    const x = minor(a);
    const y = minor(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const currency = currencyRank(a).localeCompare(currencyRank(b));
    if (currency !== 0) return currency;
    return x === y ? 0 : (x < y ? -1 : 1) * direction;
  };
}

/**
 * One list, in the chosen order. The server's own match decides exact or similar. In "exact first" similar offers
 * stay in their own group after the exact ones, each group in the server's order: cheapest first, tenge first.
 */
export function orderOffers(item: Pick<PartOffers, 'offers' | 'similar'> | undefined, sort: OfferSort, filter: OfferFilter): { exact: Offer[]; similar: Offer[]; merged: Offer[] } {
  const keep = (offer: Offer) => !filter.pricedOnly || offer.price !== null;
  const exact = (item?.offers ?? []).filter(keep);
  const similar = filter.exactOnly ? [] : (item?.similar ?? []).filter(keep);
  if (sort === 'exactFirst') return { exact, similar, merged: [] };
  return { exact: [], similar: [], merged: [...exact, ...similar].sort(byPrice(sort === 'priceAsc' ? 1 : -1)) };
}

export type PartHit = { part: Part; match: CodeMatch | 'name' };

/**
 * The document's parts that answer a query: the same designation first, then near ones (another suffix), then by
 * name. An empty query answers with nothing, so the full list stays as it was.
 */
export function findParts(parts: readonly Part[], query: string): PartHit[] {
  const q = query.trim();
  if (!q) return [];
  const rank = { exact: 0, close: 1, name: 2 } as const;
  const hits: PartHit[] = [];
  for (const part of parts) {
    const code = compareCodes(q, part.partNumber);
    if (code) hits.push({ part, match: code });
    else if (!looksLikeCode(q) && nameMatches(q, part.name)) hits.push({ part, match: 'name' });
  }
  return hits.sort((a, b) => rank[a.match] - rank[b.match]);
}
