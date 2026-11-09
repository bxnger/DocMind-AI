import { codeKey } from './codes';
import type { Offer } from '@/types/procurement';

/**
 * bcindustry.kz and bearing.kz are one seller with two sites. The same part from both is one quote, not two
 * independent ones: the first (the server's order, cheapest first) stays, the other becomes "also at".
 */
export function collapseSameSeller(offers: readonly Offer[]): Array<{ offer: Offer; alsoAt: string[] }> {
  const kept: Array<{ offer: Offer; alsoAt: string[] }> = [];
  for (const offer of offers) {
    const site = offer.store;
    const twin = site
      ? kept.find(({ offer: other }) => {
        const otherSite = other.store;
        return otherSite !== null && codeKey(other.partNumber) === codeKey(offer.partNumber)
          && (other.sameSellerAs.includes(site) || offer.sameSellerAs.includes(otherSite));
      })
      : undefined;
    if (twin && offer.store) twin.alsoAt.push(offer.store);
    else kept.push({ offer, alsoAt: [] });
  }
  return kept;
}
