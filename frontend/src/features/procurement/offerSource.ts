import type { Offer } from '@/types/procurement';

/**
 * Where an offer comes from, in the three kinds a person must never confuse:
 * store: read from a store's page by the server's search, with the time it was read.
 * file: a price list somebody uploaded; its prices are what the file says, not checked.
 * test: made-up data, marked as such by whoever uploaded it or by the demonstration. Never counted as a real offer.
 */
export type OfferSourceKind = 'store' | 'file' | 'test';

export function offerSource(offer: Pick<Offer, 'demo' | 'store' | 'source'>): OfferSourceKind {
  if (offer.demo) return 'test';
  return offer.store || offer.source === 'store_catalog' ? 'store' : 'file';
}
