import { describe, expect, it } from 'vitest';
import type { Offer, Part } from '@/types/procurement';
import { classifyScan, codeKey, compareCodes, isStoreUrl, normalizeCode, validGtin } from './codes';
import { findParts, NO_FILTER, orderOffers } from './offerOrder';

const part = (id: string, partNumber: string, name = 'подшипник'): Part => ({ id, partNumber, name, category: 'bearing', manufacturer: null, quantity: 1, unit: 'шт', specs: [], location: null, verified: true, sources: [] });
const offer = (id: string, price: string | null, match: 'exact' | 'close' = 'exact'): Offer => ({
  id, supplier: 'S', title: '', partNumber: '6205-2RS', match, price, currency: 'KZT', stockStatus: 'unknown', stockQuantity: null, url: null, source: 'price_list',
  priceListId: 'pl', sourceRow: 1, checkedAt: null, checkedAtOrigin: 'import_date', demo: false, manufacturer: null, priceListFile: null, priceOrigin: 'file', filePrice: null, siteCheck: null, store: null, sameSellerAs: [], barcode: null,
});

describe('part numbers', () => {
  it('reads the same designation however it is typed', () => {
    expect(codeKey('6205‑2rs')).toBe('62052RS');
    expect(normalizeCode('6205­2RS')).toBe('62052RS');
    expect(compareCodes('6205 2RS', '6205-2RS')).toBe('exact');
    expect(compareCodes('А-12', 'A-12')).toBe('exact');
  });
  it('keeps 6205 and 6205-2RS apart', () => {
    expect(compareCodes('6205', '6205-2RS')).toBe('close');
    expect(compareCodes('6205-2RS', '6205')).toBe('close');
    expect(compareCodes('6205-2Z', '6205-2RS')).toBe('close');
    expect(compareCodes('6203', '6205-2RS')).toBeNull();
  });
  it('finds parts by number first, then by name', () => {
    const parts = [part('a', '6205-2RS'), part('b', '6205'), part('c', '6203', 'подшипник шариковый'), part('d', 'A-12', 'ремень клиновой')];
    expect(findParts(parts, '6205-2RS').map((hit) => [hit.part.id, hit.match])).toEqual([['a', 'exact'], ['b', 'close']]);
    expect(findParts(parts, 'ремень').map((hit) => hit.part.id)).toEqual(['d']);
    expect(findParts(parts, '  ')).toEqual([]);
    expect(findParts(parts, '9999')).toEqual([]);
  });
});

describe('offers order', () => {
  const item = { offers: [offer('e1', '5000'), offer('e2', null), offer('e3', '4850.50')], similar: [offer('s1', '1200', 'close')] };
  it('keeps exact apart from similar, in the server order', () => {
    const { exact, similar } = orderOffers(item, 'exactFirst', NO_FILTER);
    expect(exact.map((x) => x.id)).toEqual(['e1', 'e2', 'e3']);
    expect(similar.map((x) => x.id)).toEqual(['s1']);
  });
  it('never compares amounts in different currencies', () => {
    const rub = { ...offer('r1', '100'), currency: 'RUB' };
    expect(orderOffers({ offers: [rub, offer('k1', '5000')], similar: [] }, 'priceAsc', NO_FILTER).merged.map((x) => x.id)).toEqual(['k1', 'r1']);
  });
  it('sorts by price both ways and never calls an empty price cheapest', () => {
    expect(orderOffers(item, 'priceAsc', NO_FILTER).merged.map((x) => x.id)).toEqual(['s1', 'e3', 'e1', 'e2']);
    expect(orderOffers(item, 'priceDesc', NO_FILTER).merged.map((x) => x.id)).toEqual(['e1', 'e3', 's1', 'e2']);
  });
  it('filters exact only and priced only', () => {
    expect(orderOffers(item, 'priceAsc', { exactOnly: true, pricedOnly: true, hideTest: false }).merged.map((x) => x.id)).toEqual(['e3', 'e1']);
  });
});

describe('test data filter', () => {
  const test = { ...offer('t1', '5100'), demo: true };
  const item = { offers: [offer('e1', '4850'), test], similar: [] };
  it('hides test data only when asked, and never the chosen offer', () => {
    expect(orderOffers(item, 'exactFirst', NO_FILTER).exact.map((x) => x.id)).toEqual(['e1', 't1']);
    expect(orderOffers(item, 'exactFirst', { ...NO_FILTER, hideTest: true }).exact.map((x) => x.id)).toEqual(['e1']);
    expect(orderOffers(item, 'exactFirst', { ...NO_FILTER, hideTest: true }, 't1').exact.map((x) => x.id)).toEqual(['e1', 't1']);
  });
});

describe('scanned codes', () => {
  it('checks the GS1 digit', () => {
    expect(validGtin('4006381333931')).toBe(true);
    expect(validGtin('4006381333932')).toBe(false);
    expect(validGtin('96385074')).toBe(true);
    expect(validGtin('036000291452')).toBe(true);
  });
  it('treats a QR code by what it holds', () => {
    expect(classifyScan('ean_13', '4006381333931')).toEqual({ kind: 'product', format: 'ean_13', code: '4006381333931' });
    expect(classifyScan('ean_13', '4006381333932').kind).toBe('badChecksum');
    expect(classifyScan('qr_code', 'https://example.kz/p?id=1')).toEqual({ kind: 'url', url: 'https://example.kz/p?id=1', host: 'example.kz' });
    expect(classifyScan('qr_code', '6205-2RS')).toEqual({ kind: 'text', text: '6205-2RS', codeLike: true });
    expect(classifyScan('qr_code', 'Привет, это просто текст')).toMatchObject({ kind: 'text', codeLike: false });
    expect(classifyScan('qr_code', '4006381333931').kind).toBe('product');
  });
});

describe('store links', () => {
  it('sends only links to the supported stores', () => {
    expect(isStoreUrl('https://industrialmotion.kz/product/6203')).toBe(true);
    expect(isStoreUrl('https://www.bcindustry.kz/catalog/x')).toBe(true);
    expect(isStoreUrl('https://bearing.kz/p')).toBe(true);
    expect(isStoreUrl('https://example.kz/catalog?item=42')).toBe(false);
    expect(isStoreUrl('https://industrialmotion.kz.evil.com/p')).toBe(false);
    expect(isStoreUrl('https://evilbearing.kz/p')).toBe(false);
    expect(isStoreUrl('javascript:alert(1)')).toBe(false);
  });
});
