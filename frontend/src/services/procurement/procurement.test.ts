import { describe, expect, it } from 'vitest';
import { fromMinor, toMinor } from '@/lib/money';
import { toOffer, toPart, toPartList, toPhotoMatch, toPriceList, toQuote } from '@/api/procurement';
import { readableQuote } from '@/features/procurement/PartRow';
import { quoteItems } from '@/features/procurement/useProcurement';
import { DEMO_SUPPLIER, createDemoAdapter, csvCell, findParts, fixtureParts, parsePriceCsv } from './demoAdapter';
import { compareCode, demoIdentify, normalizeCode } from './matching';

const part = { partNumber: 'SKF 6205-2RS1', manufacturer: 'SKF' };
const page = (text: string, n = 1) => ({ page: n, paragraph: null, location: null, text });

describe('demonstration matching', () => {
  it.each([
    ['SKF 6205-2RS1', 'exact'], ['6205 2RS1', 'exact'], ['6205-2РС1', 'exact'],
    ['6205', 'partial'], ['6205-2RS1/C3', 'partial'],
    ['62O5-2RS1', 'close'], ['6205-ZZ', 'close'], ['6206-2RS1', 'close'], ['FAG 6205-2RS1', 'close'],
    ['62', null], ['', null], ['XYZ-999', null],
  ])('%s is %s', (marking, expected) => {
    expect(compareCode(marking, part)).toBe(expected);
  });
  it('never calls a different seal type exact, and says what differs', () => {
    const result = demoIdentify('6205-ZZ', [{ ...fixtureParts()[0]!, partNumber: 'SKF 6205-2RS1' }]);
    expect(result.matchStatus).toBe('needs_confirmation');
    expect(result.matches[0]).toMatchObject({ match: 'close', difference: '6205-ZZ ≠ 6205-2RS1' });
  });
  it('uses the contract statuses', () => {
    const parts = [{ ...fixtureParts()[0]!, partNumber: 'SKF 6205-2RS1' }];
    expect(demoIdentify('SKF 6205-2RS1', parts).matchStatus).toBe('matched');
    expect(demoIdentify('QWERTY-999', parts).matchStatus).toBe('no_match');
    expect(demoIdentify('62', parts).matchStatus).toBe('unreadable');
  });
  it('normalizes look-alikes and separators', () => {
    expect(normalizeCode('6205-2рс1')).toBe('62052RS1');
  });
});

describe('demonstration parts', () => {
  it('come with a real quote and place, and no guessed quantity', () => {
    const [first, second] = findParts([page('Заменить подшипник SKF 6205-2RS1 — 2 шт. Также уплотнение TC-35-52.', 14)]);
    expect(first).toMatchObject({ partNumber: 'SKF 6205-2RS1', quantity: 2, verified: true });
    expect(first?.sources[0]).toMatchObject({ page: 14 });
    expect(first?.sources[0]?.quote).toContain('6205-2RS1');
    expect(second).toMatchObject({ quantity: null });
  });
  it('do not take dates or clause numbers for part numbers', () => {
    expect(findParts([page('Договор от 12.03.2026, пункт 10.4 и 2026-11-05.')])).toEqual([]);
  });
  it('fixtures have no source, so nothing links to an invented place', () => {
    expect(fixtureParts().every((item) => item.sources.length === 0)).toBe(true);
  });
});

describe('demonstration quote', () => {
  const adapter = () => createDemoAdapter([page('Подшипник SKF 6205-2RS1 — 2 шт.')], 'd', 'n');
  it('marks built-in offers, keeps similar ones apart and chooses nothing', async () => {
    const a = adapter();
    const { parts } = await a.parts();
    const [item] = await a.offers(parts.map((p) => p.id));
    expect(a.isDemo).toBe(true);
    expect(item?.offers.every((offer) => offer.demo && offer.supplier === DEMO_SUPPLIER)).toBe(true);
    expect(item?.offers.map((offer) => offer.match)).toEqual(['exact']);
    expect(item?.similar.map((offer) => offer.match)).toEqual(['close']);
    const quote = await a.quote([{ partId: parts[0]!.id, quantity: 2, offerId: null }]);
    expect(quote.totals).toEqual([]);
    expect(quote.unpriced).toBe(1);
    expect(quote.items[0]?.status).toBe('no_price');
  });
  it('quantity times price is exact, and a similar choice warns', async () => {
    const a = adapter();
    const { parts } = await a.parts();
    const id = parts[0]!.id;
    const [item] = await a.offers([id]);
    const exact = await a.quote([{ partId: id, quantity: 3, offerId: item!.offers[0]!.id }]);
    expect(exact.totals).toEqual([{ currency: 'KZT', amount: '13500.00', items: 1 }]);
    expect(exact.items[0]).toMatchObject({ status: 'priced', lineTotal: '13500.00', matchWarning: false });
    expect((await a.quote([{ partId: id, quantity: 1, offerId: item!.similar[0]!.id }])).items[0]?.matchWarning).toBe(true);
  });
  it('a vanished offer is a line status, not an error', async () => {
    const a = adapter();
    const { parts } = await a.parts();
    expect((await a.quote([{ partId: parts[0]!.id, quantity: 1, offerId: 'gone' }])).items[0]?.status).toBe('offer_missing');
  });
  it('reads no photo, and a person decides', async () => {
    const a = adapter();
    expect((await a.identify(new File(['x'], 'a.jpg'))).matchStatus).toBe('unreadable');
    const { parts } = await a.parts();
    const confirmation = await a.confirm(parts[0]!.id, { recognizedText: 'x', recognizedPartNumber: 'x', decision: 'confirmed' });
    const quote = await a.quote([{ partId: parts[0]!.id, quantity: 1, offerId: null, confirmationId: confirmation.id }]);
    expect(quote.items[0]?.identification).toEqual({ status: 'user_confirmed', confirmationId: confirmation.id });
    expect((await a.quote([{ partId: parts[0]!.id, quantity: 1, offerId: null }])).items[0]?.identification.status).toBe('document_only');
  });
  it('labels its export', async () => {
    const a = adapter();
    const { parts } = await a.parts();
    const text = await (await a.exportQuote([{ partId: parts[0]!.id, quantity: 2, offerId: null }], 'csv')).text();
    expect(text).toContain('DEMO');
    expect(text.split('\r\n')[1]).toContain('SKF 6205-2RS1');
  });
});

describe('the sheet sent for calculation', () => {
  const parts = [{ ...fixtureParts()[0]!, id: 'a', quantity: 2 }, { ...fixtureParts()[1]!, id: 'b', quantity: null }, { ...fixtureParts()[2]!, id: 'c', quantity: 1 }];
  it('takes the document quantity, and never guesses a missing one', () => {
    const { items, withoutQuantity } = quoteItems(parts, {});
    expect(items.map((item) => [item.partId, item.quantity])).toEqual([['a', 2], ['c', 1]]);
    expect(withoutQuantity).toBe(1);
  });
  it('applies what the person changed', () => {
    const { items, withoutQuantity } = quoteItems(parts, {
      a: { included: true, quantity: 5, offerId: 'o', note: '', confirmationId: 'c1' },
      b: { included: true, quantity: 3, offerId: null, note: '', confirmationId: null },
      c: { included: false, quantity: null, offerId: null, note: '', confirmationId: null },
    });
    expect(items).toEqual([{ partId: 'a', quantity: 5, offerId: 'o', confirmationId: 'c1' }, { partId: 'b', quantity: 3, offerId: null }]);
    expect(withoutQuantity).toBe(0);
  });
});

describe('price files', () => {
  it('reads Russian and English headers, and reports bad rows', () => {
    const parsed = parsePriceCsv('Артикул;Цена;Валюта;Дата\n6205-2RS1;4500,50;kzt;2026-11-01\n6205;abc;KZT;2026-11-01\n;1;KZT;');
    expect(parsed?.rows).toMatchObject([{ sku: '6205-2RS1', price: '4500.50', currency: 'KZT', row: 2, checkedAt: '2026-11-01' }]);
    expect(parsed?.skipped.map((row) => row.reason)).toEqual(['PRICE_INVALID', 'SKU_MISSING']);
    expect(parsePriceCsv('sku,price\na,1')?.rows[0]).toMatchObject({ currency: 'KZT', checkedAt: null, stockQuantity: null });
  });
  it('refuses a file without a part number and a price', () => {
    expect(parsePriceCsv('name,color\na,red')).toBeNull();
  });
  it('keeps a formula from running in a spreadsheet', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1')).toBe("'-1");
  });
});

describe('quotes of parts', () => {
  it('show the dash of a part number stored as a soft hyphen, and change nothing else', () => {
    expect(readableQuote('подшипник 6205\u00AD2RS — 4 шт.', '6205-2RS')).toBe('подшипник 6205-2RS — 4 шт.');
    expect(readableQuote('пере\u00ADнос 6205-2RS', 'XYZ')).toBe('пере\u00ADнос 6205-2RS');
  });
});

describe('money', () => {
  it('stays exact', () => {
    expect(fromMinor(toMinor('0.10')! + toMinor('0.20')!)).toBe('0.30');
    expect(toMinor('12 500,5')).toBe(1250050n);
    expect(toMinor('abc')).toBeNull();
    expect(toMinor('-1')).toBeNull();
  });
});

describe('answers of the real API, revision 2', () => {
  const source = { index: 1, documentId: 'd', documentName: 'n', page: 12, location: null, quote: 'Подшипник 6205-2RS — 2 шт.' };
  it('reads a part list', () => {
    const list = toPartList({ documentId: 'd', status: 'ready', progress: 1, error: null, equipment: { name: 'Станок', model: 'ТС-16', manufacturer: null, sources: [source] }, parts: [{ id: 'p1', category: 'bearing', name: 'Подшипник', partNumber: '6205-2RS', manufacturer: 'SKF', quantity: null, unit: 'шт', specs: [{ name: 'd', value: '25', unit: 'мм', origin: 'standard' }], location: 'Шпиндель', verified: true, sources: [source] }], summary: { total: 1 } });
    expect(list.parts[0]).toMatchObject({ partNumber: '6205-2RS', quantity: null, verified: true, specs: [{ origin: 'standard' }] });
    expect(list.parts[0]?.sources[0]?.page).toBe(12);
    expect(list.equipment?.model).toBe('ТС-16');
  });
  it('treats anything but verified: true as unverified', () => {
    expect(toPart({ id: 'p', partNumber: 'x' }).verified).toBe(false);
  });
  it('reads a failed extraction', () => {
    expect(toPartList({ documentId: 'd', status: 'failed', error: { code: 'X', message: 'm' } })).toMatchObject({ status: 'failed', errorCode: 'X', parts: [] });
  });
  it('reads a photo match, and an unknown status can never look like a match', () => {
    const match = toPhotoMatch({ matchStatus: 'needs_confirmation', recognized: { text: 'SKF', partNumber: '6205-2RSH', manufacturer: 'SKF', markings: ['C3'], readability: 'medium' }, matches: [{ partId: 'p1', partNumber: '6205-2RS', name: 'n', match: 'close', difference: 'd', sources: [source] }], message: 'm' });
    expect(match.matches[0]).toMatchObject({ partId: 'p1', match: 'close' });
    expect(match.recognized.markings).toEqual(['C3']);
    expect(toPhotoMatch({ matchStatus: 'confirmed' }).matchStatus).toBe('unreadable');
  });
  it('reads an offer with its origin and drops one without a source row', () => {
    const offer = { id: 'pl1:17', supplier: 'S', partNumber: '6205-2RS', match: 'exact', price: '4850.00', currency: 'KZT', stockStatus: 'available', stockQuantity: 40, url: null, source: 'price_list', priceListId: 'pl1', sourceRow: 17, checkedAt: '2026-11-08', checkedAtOrigin: 'file', demo: false };
    expect(toOffer(offer)[0]).toMatchObject({ price: '4850.00', stockQuantity: 40, checkedAtOrigin: 'file', demo: false });
    expect(toOffer({ ...offer, sourceRow: undefined })).toEqual([]);
    expect(toOffer({ ...offer, stockStatus: undefined })[0]?.stockStatus).toBe('unknown');
    expect(toOffer({ ...offer, price: null })[0]?.price).toBeNull();
    expect(toOffer({ ...offer, match: 'whatever' })[0]?.match).toBe('close');
  });
  it('reads a price list', () => {
    expect(toPriceList({ id: 'pl1', supplier: 'S', fileName: 'f', rows: 3, skipped: [{ row: 17, reason: 'Нет цены' }], checkedAt: '2026-11-08', checkedAtOrigin: 'upload_form', demo: true, importedAt: 't' })).toMatchObject({ rows: 3, demo: true, checkedAtOrigin: 'upload_form' });
  });
  it('reads a quote', () => {
    const quote = toQuote({ items: [{ partId: 'p', quantity: 2, offer: null, unitPrice: null, currency: null, lineTotal: null, status: 'offer_missing', identification: { status: 'user_confirmed', confirmationId: 'c1' } }], totals: [{ currency: 'KZT', amount: '1.00', items: 1 }], unpriced: 1, warnings: ['w'], calculatedAt: 't' });
    expect(quote.items[0]).toMatchObject({ status: 'offer_missing', identification: { status: 'user_confirmed' } });
    expect(quote).toMatchObject({ unpriced: 1, warnings: ['w'] });
  });
});
