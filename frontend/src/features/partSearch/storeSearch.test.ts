import { describe, expect, it } from 'vitest';
import { toBarcodeLookup, toStoreSearch } from '@/api/procurement';
import { collapseSameSeller } from './sameSeller';
import { isBuilding } from './useStoreSearch';

// Shapes copied from backend/docs/STORE-SEARCH-API.md on backend/store-search (5a70cd3).
const storeOffer = (id: string, store: string, partNumber: string, price: string | null, extra: Record<string, unknown> = {}) => ({
  id, source: 'store_catalog', store, supplier: store, title: 'Подшипник', partNumber, match: 'exact', price, currency: price ? 'KZT' : null,
  stockStatus: 'available', priceOrigin: price ? 'site_checked' : null, checkedAt: price ? '2026-11-09T12:50:46+00:00' : null, checkedAtOrigin: price ? 'site' : null,
  demo: false, sameSellerAs: [], url: `https://${store}/p`, priceListId: 'pls8c1f', sourceRow: Number(id.split(':')[1] ?? 1), ...extra,
});

describe('store search answer', () => {
  const answer = toStoreSearch({
    query: '6205-2RS', searchedAs: '6205-2RS', kind: 'partNumber', reason: null,
    offers: [storeOffer('pls:1', 'industrialmotion.kz', '6205-2RS', '4790.00'), storeOffer('pls:2', 'bcindustry.kz', '6205-2RS', null, { sameSellerAs: ['bearing.kz'] })],
    similar: [storeOffer('pls:3', 'bcindustry.kz', '6205-2RSH', '4805.00')],
    unconfirmed: [{ id: null, store: 'bcindustry.kz', match: 'unconfirmed', price: null, reason: 'part_number_not_on_page', url: 'https://bcindustry.kz/x', title: '6203' }],
    sources: [{ store: 'bearing.kz', status: 'skipped', reason: 'same_seller', sameSellerAs: 'bcindustry.kz', candidates: 0 }],
    searchedAt: '2026-11-09T12:50:57+00:00',
  });
  it('keeps offers, similar and unconfirmed apart', () => {
    expect(answer.offers.map((offer) => offer.id)).toEqual(['pls:1', 'pls:2']);
    expect(answer.similar.map((offer) => [offer.id, offer.match])).toEqual([['pls:3', 'close']]);
    expect(answer.unconfirmed).toEqual([{ store: 'bcindustry.kz', url: 'https://bcindustry.kz/x', title: '6203', partNumber: null, reason: 'part_number_not_on_page', sameSellerAs: [] }]);
  });
  it('reads store fields and never invents a price origin or a date', () => {
    const [read, unread] = answer.offers;
    expect(read).toMatchObject({ store: 'industrialmotion.kz', priceOrigin: 'site_checked', checkedAt: '2026-11-09T12:50:46+00:00', checkedAtOrigin: 'site' });
    expect(unread).toMatchObject({ price: null, priceOrigin: 'none', checkedAt: null, sameSellerAs: ['bearing.kz'] });
  });
  it('says why a store was skipped', () => {
    expect(answer.sources[0]).toMatchObject({ status: 'skipped', reason: 'same_seller', sameSellerAs: 'bcindustry.kz' });
  });
  it('reads a barcode answer', () => {
    const found = toBarcodeLookup({ codes: [{ format: 'EAN13', value: '4006381333931', valid: true, kind: 'gtin' }], lookup: { offers: [], similar: [], unconfirmed: [], reason: 'gtin_not_in_sources', sources: [] } });
    expect(found.codes).toEqual([{ format: 'EAN13', value: '4006381333931', valid: true, kind: 'gtin' }]);
    expect(found.lookup?.reason).toBe('gtin_not_in_sources');
  });
  it('knows a catalogue that is still building', () => {
    expect(isBuilding({ ...answer, offers: [], similar: [], sources: [{ store: 'industrialmotion.kz', status: 'unavailable', reason: 'index_building', candidates: 0, sameSellerAs: null, indexedAt: null }] })).toBe(true);
    expect(isBuilding(answer)).toBe(false);
  });
});

describe('one seller, one card', () => {
  it('folds the same part from two sites of one seller', () => {
    const offers = toStoreSearch({ offers: [
      storeOffer('a:1', 'bcindustry.kz', '6205-2RS', '4805.00', { sameSellerAs: ['bearing.kz'] }),
      storeOffer('a:2', 'bearing.kz', '6205-2RS', '4805.00', { sameSellerAs: ['bcindustry.kz'] }),
      storeOffer('a:3', 'industrialmotion.kz', '6205-2RS', '4790.00'),
      storeOffer('a:4', 'bearing.kz', '6205-2Z', '3000.00', { sameSellerAs: ['bcindustry.kz'] }),
    ] }).offers;
    expect(collapseSameSeller(offers).map(({ offer, alsoAt }) => [offer.id, alsoAt])).toEqual([['a:1', ['bearing.kz']], ['a:3', []], ['a:4', []]]);
  });
});
