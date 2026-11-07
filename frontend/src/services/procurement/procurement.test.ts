import { describe, expect, it } from 'vitest';
import { fromMinor, toMinor } from '@/lib/money';
import { toMarking, toOffer, toPart, toSheet } from '@/api/procurement';
import { DEMO_SUPPLIER, createDemoAdapter, csvCell, findParts, fixtureParts, parsePriceCsv } from './demoAdapter';
import { compareMarking, matchMarking, normalizeCode } from './matching';

const part = { rawCode: 'SKF 6205-2RS1', brand: 'SKF' };
const page = (text: string, n = 1) => ({ page: n, paragraph: null, location: null, text });

describe('status rules from the contract', () => {
  it.each([
    ['SKF 6205-2RS1', 'exact'], ['6205 2RS1', 'exact'], ['6205-2РС1', 'exact'],
    ['6205', 'possible'], ['62O5-2RS1', 'possible'], ['6205-2RS1/C3', 'possible'],
    ['6205-ZZ', 'conflict'], ['6206-2RS1', 'conflict'], ['FAG 6205-2RS1', 'conflict'],
    ['62', 'insufficient'], ['', 'insufficient'], ['XYZ-999', 'insufficient'],
  ])('%s is %s', (marking, status) => {
    expect(compareMarking(marking, part)).toBe(status);
  });
  it('never calls a different seal type exact', () => {
    expect(compareMarking('6205-ZZ', part)).not.toBe('exact');
  });
  it('normalizes look-alikes and separators', () => {
    expect(normalizeCode('6205-2рс1')).toBe('62052RS1');
  });
  it('picks the strongest candidate and shows what differs', () => {
    const parts = fixtureParts();
    const result = matchMarking('6205-ZZ', parts);
    expect(result.status).toBe('exact');
    const conflict = matchMarking('6205-2Z', [parts[0]!]);
    expect(conflict.status).toBe('conflict');
    expect(conflict.candidates[0]?.differences).toEqual([{ document: '2RS1', marking: '2Z' }]);
  });
});

describe('demonstration parts', () => {
  it('come with a real quote and place, and no guessed quantity', () => {
    const [first, second] = findParts([page('Заменить подшипник SKF 6205-2RS1 — 2 шт. Также уплотнение TC-35-52.', 14)]);
    expect(first).toMatchObject({ rawCode: 'SKF 6205-2RS1', quantity: 2, page: 14, quantityStatus: 'found' });
    expect(first?.quote).toContain('6205-2RS1');
    expect(second).toMatchObject({ quantity: null, quantityStatus: 'missing' });
  });
  it('do not take dates or clause numbers for part numbers', () => {
    expect(findParts([page('Договор от 12.03.2026, пункт 10.4 и 2026-11-05.')])).toEqual([]);
  });
  it('fixtures have no quote, so nothing links to an invented place', () => {
    expect(fixtureParts().every((item) => item.quote === null && item.page === null)).toBe(true);
  });
});

describe('demonstration sheet', () => {
  const adapter = () => createDemoAdapter([page('Подшипник SKF 6205-2RS1 — 2 шт.')]);
  it('marks built-in offers and selects nothing by itself', async () => {
    const a = adapter();
    const sheet = await a.sheet(null);
    expect(a.isDemo).toBe(true);
    expect(sheet.items[0]?.offers[0]?.supplier).toBe(DEMO_SUPPLIER);
    expect(sheet.items[0]?.selectedOfferId).toBeNull();
    expect(sheet.complete).toBe(false);
    expect(sheet.totals).toEqual([]);
  });
  it('a variant needs review, and quantity times price is exact', async () => {
    const a = adapter();
    const [item] = (await a.sheet(null)).items;
    expect(item?.offers.map((offer) => offer.match)).toEqual(['exact', 'needs_review']);
    await a.selectOffer(item!.partId, item!.offers[0]!.id);
    const after = await a.sheet(null);
    expect(after.totals).toEqual([{ currency: 'KZT', amount: '9000.00', lines: 1 }]);
    expect(after.complete).toBe(true);
    await a.updatePart(item!.partId, { quantity: 3 });
    expect((await a.sheet(null)).items[0]?.lineTotal).toBe('13500.00');
    await a.updatePart(item!.partId, { included: false });
    expect((await a.sheet(null)).totals).toEqual([]);
  });
  it('a missing quantity keeps the sheet incomplete', async () => {
    const a = createDemoAdapter([page('Уплотнение TC-35-52.')]);
    const [item] = (await a.sheet(null)).items;
    await a.selectOffer(item!.partId, item!.offers[0]!.id);
    const sheet = await a.sheet(null);
    expect(sheet.complete).toBe(false);
    expect(sheet.unpricedParts).toBe(1);
  });
  it('reads no photo: a person has to type, and only then is there a status', async () => {
    const a = adapter();
    const marking = await a.uploadMarking(new File(['x'], 'a.jpg'));
    expect(marking).toMatchObject({ readText: null, status: null, confirmed: false });
    expect(await a.confirmMarking(marking.id, '6205-ZZ')).toMatchObject({ status: 'conflict', confirmed: true });
  });
  it('labels its export', async () => {
    const text = await (await adapter().exportSheet(null, 'csv')).text();
    expect(text).toContain('DEMO');
    expect(text.split('\r\n')[1]).toContain('SKF 6205-2RS1');
  });
});

describe('price files', () => {
  it('reads rows and reports the bad ones', () => {
    const parsed = parsePriceCsv('sku;price;currency;checked_at\n6205-2RS1;4500,50;kzt;2026-11-01\n6205;abc;KZT;2026-11-01\n;1;KZT;2026-11-01\n6206;1;KZT;вчера');
    expect(parsed?.rows).toMatchObject([{ sku: '6205-2RS1', price: '4500.50', currency: 'KZT', row: 2 }]);
    expect(parsed?.skipped.map((row) => row.reason)).toEqual(['PRICE_INVALID', 'SKU_MISSING', 'DATE_INVALID']);
  });
  it('refuses a file without the required columns', () => {
    expect(parsePriceCsv('sku,price\na,1')).toBeNull();
  });
  it('keeps a formula from running in a spreadsheet', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1')).toBe("'-1");
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

describe('answers of the real API', () => {
  const dto = { id: 'p', rawCode: 'X-1', quote: 'real', page: 3 };
  it('refuse a part without a quote', () => {
    expect(() => toPart({ ...dto, quote: '' })).toThrow();
    expect(() => toPart({ ...dto, quote: undefined })).toThrow();
    expect(toPart(dto)).toMatchObject({ page: 3, quantity: null, quantityStatus: 'missing', included: true });
  });
  it('drop a price with no source', () => {
    const offer = { id: 'o', priceListId: 'l', unitPrice: '1.00', currency: 'KZT', checkedAt: '2026-11-01', sourceRow: 2 };
    expect(toOffer(offer)).toHaveLength(1);
    expect(toOffer({ ...offer, checkedAt: undefined })).toEqual([]);
    expect(toOffer({ ...offer, sourceRow: undefined })).toEqual([]);
    expect(toOffer({ ...offer, match: 'whatever' })[0]?.match).toBe('needs_review');
  });
  it('show no status before a person confirms', () => {
    expect(toMarking({ id: 'm', status: 'exact', confirmed: false }).status).toBeNull();
    expect(toMarking({ id: 'm', status: 'exact', confirmed: true }).status).toBe('exact');
  });
  it('read a sheet', () => {
    expect(toSheet({ items: [{ partId: 'p', offers: [] }], totals: [{ currency: 'KZT', amount: '1.00', lines: 1 }], complete: true })).toMatchObject({ complete: true, unpricedParts: 0 });
  });
});
