import { fromMinor, toMinor } from '@/lib/money';
import type { Confirmation, Offer, Part, PartList, PriceList, Quote, QuoteItem, QuoteRequestItem } from '@/types/procurement';
import type { EvidenceSource } from '@/types/chat';
import { demoIdentify, normalizeCode, splitBrand } from './matching';
import type { ProcurementAdapter, SourceText } from './types';

/**
 * Stands in until the backend has these routes, and says so on screen. Parts and quotes are searched in the document's
 * real text, so a source link always leads to a real place. Built-in prices are invented and marked. It reads no photos.
 */
export const DEMO_SUPPLIER = 'DEMO';
const CODE = /(?:\b[A-ZА-Я]{2,10}\s+)?\b(?=[0-9A-ZА-Я./-]*\d)(?=[0-9A-ZА-Я./-]*[A-ZА-Я-])[0-9A-ZА-Я]+(?:[-/.][0-9A-ZА-Я]+)+\b/g;
const QUANTITY = /(\d{1,5})\s*(шт|pcs|pc|дана|компл|ед)(?!\p{L})/iu;
const DATE_LIKE = /^\d{1,4}[-./]\d{1,2}([-./]\d{1,4})?$/;
const FIXTURES = ['SKF 6205-2RS', 'SKF 6205-ZZ', 'NSK 6305-2RS'];
const MAX_PARTS = 40;
const DEMO_DATE = '2000-01-01';

const sentences = (text: string) => text.split(/(?<=[.!?;])\s+/).filter(Boolean);

function makePart(id: string, code: string, documentId: string, documentName: string, source: SourceText | null, quote: string | null): Part {
  const quantity = quote ? QUANTITY.exec(quote) : null;
  const sources: EvidenceSource[] = source && quote ? [{ index: 1, documentId, documentName, page: source.page, location: source.location, quote, ...(source.paragraph === null ? {} : { paragraph: source.paragraph }) }] : [];
  return { id, category: 'other', name: '', partNumber: code, manufacturer: splitBrand(code).brand, quantity: quantity?.[1] ? Number(quantity[1]) : null, unit: quantity?.[2] ?? null, specs: [], location: null, verified: quote !== null, sources };
}

export function findParts(pages: readonly SourceText[], documentId = 'd', documentName = 'd'): Part[] {
  const found = new Map<string, Part>();
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      for (const match of sentence.matchAll(CODE)) {
        const code = match[0].trim();
        const key = normalizeCode(splitBrand(code).code);
        if (DATE_LIKE.test(code) || key.length < 4 || found.has(key) || found.size >= MAX_PARTS) continue;
        found.set(key, makePart(`demo-part-${found.size + 1}`, code, documentId, documentName, page, sentence.slice(0, 400)));
      }
    }
  }
  return [...found.values()];
}

/** No code in the document: sample lines with no source, so the screens can still be seen. */
export const fixtureParts = (): Part[] => FIXTURES.map((code, index) => makePart(`demo-fixture-${index + 1}`, code, '', '', null, null));

function parseLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === separator && !quoted) {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  return [...cells, cell].map((value) => value.trim());
}

const HEADERS: Record<string, readonly string[]> = {
  sku: ['артикул', 'sku', 'part number', 'partnumber', 'код'],
  price: ['цена', 'price', 'баға'],
  currency: ['валюта', 'currency'],
  stock: ['наличие', 'stock', 'қойма', 'остаток'],
  url: ['ссылка', 'url', 'link', 'сілтеме'],
  supplier: ['поставщик', 'supplier', 'жеткізуші'],
  date: ['дата', 'date', 'checked_at', 'күн'],
};

export interface PriceRow {
  row: number;
  sku: string;
  price: string;
  currency: string;
  checkedAt: string | null;
  stockQuantity: number | null;
  url: string | null;
}

/** Headers as the contract describes them, in Russian, Kazakh or English. Null without a part number and a price. */
export function parsePriceCsv(content: string, defaultCurrency = 'KZT'): { rows: PriceRow[]; skipped: Array<{ row: number; reason: string }> } | null {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const separator = (lines[0] ?? '').includes(';') ? ';' : ',';
  const header = parseLine(lines[0] ?? '', separator).map((name) => name.toLowerCase());
  const column = (name: string) => header.findIndex((cell) => HEADERS[name]?.includes(cell));
  if (column('sku') < 0 || column('price') < 0) return null;
  const at = (cells: string[], name: string) => cells[column(name)] ?? '';
  const rows: PriceRow[] = [];
  const skipped: Array<{ row: number; reason: string }> = [];
  lines.slice(1).forEach((line, index) => {
    if (!line.trim()) return;
    const row = index + 2;
    const cells = parseLine(line, separator);
    const price = toMinor(at(cells, 'price'));
    const date = at(cells, 'date');
    if (!at(cells, 'sku')) skipped.push({ row, reason: 'SKU_MISSING' });
    else if (price === null) skipped.push({ row, reason: 'PRICE_INVALID' });
    else {
      const stock = Number(at(cells, 'stock'));
      rows.push({ row, sku: at(cells, 'sku'), price: fromMinor(price), currency: (at(cells, 'currency') || defaultCurrency).toUpperCase(), checkedAt: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, stockQuantity: at(cells, 'stock') && Number.isFinite(stock) ? stock : null, url: at(cells, 'url') || null });
    }
  });
  return { rows, skipped };
}

/** Text in a spreadsheet cell that starts like a formula must stay text. */
export function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",;\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

interface StoredList {
  list: PriceList;
  rows: PriceRow[];
}

const BUILT_IN: PriceList = { id: 'demo-list', supplier: DEMO_SUPPLIER, fileName: '', rows: 0, skipped: [], checkedAt: DEMO_DATE, checkedAtOrigin: 'import_date', demo: true, importedAt: '' };

const builtInRows = (part: Part): PriceRow[] => {
  const code = splitBrand(part.partNumber).code;
  return [
    { row: 1, sku: code, price: '4500.00', currency: 'KZT', checkedAt: DEMO_DATE, stockQuantity: null, url: null },
    { row: 2, sku: `${code}/C3`, price: '5200.00', currency: 'KZT', checkedAt: DEMO_DATE, stockQuantity: null, url: null },
  ];
};

export function createDemoAdapter(pages: readonly SourceText[], documentId = 'd', documentName = 'd'): ProcurementAdapter {
  const found = findParts(pages, documentId, documentName);
  const parts = found.length ? found : fixtureParts();
  const lists = new Map<string, StoredList>();
  const confirmations = new Map<string, Confirmation>();
  let sequence = 0;
  const nextId = (prefix: string) => `demo-${prefix}-${(sequence += 1)}`;

  const toOffer = (list: PriceList, row: PriceRow, match: Offer['match'], partKey: string): Offer => ({
    id: `${list.id}:${partKey}:${row.row}`,
    supplier: list.supplier,
    title: row.sku,
    partNumber: row.sku,
    match,
    price: row.price,
    currency: row.currency,
    stockStatus: row.stockQuantity === null ? 'unknown' : row.stockQuantity > 0 ? 'available' : 'unavailable',
    stockQuantity: row.stockQuantity,
    url: row.url,
    source: 'price_list',
    priceListId: list.id,
    sourceRow: row.row,
    checkedAt: row.checkedAt ?? list.checkedAt,
    checkedAtOrigin: row.checkedAt ? 'file' : list.checkedAtOrigin,
    demo: list.demo,
  });

  const allOffers = (part: Part): { offers: Offer[]; similar: Offer[] } => {
    const code = normalizeCode(splitBrand(part.partNumber).code);
    const sourcesOf: StoredList[] = lists.size ? [...lists.values()] : [{ list: BUILT_IN, rows: builtInRows(part) }];
    const offers: Offer[] = [];
    const similar: Offer[] = [];
    for (const { list, rows } of sourcesOf) {
      for (const row of rows) {
        const sku = normalizeCode(splitBrand(row.sku).code);
        if (sku === code) offers.push(toOffer(list, row, 'exact', part.id));
        else if (sku.startsWith(code) || code.startsWith(sku)) similar.push(toOffer(list, row, 'close', part.id));
      }
    }
    return { offers: offers.sort((a, b) => Number(a.price) - Number(b.price)), similar };
  };

  const buildQuote = (items: readonly QuoteRequestItem[]): Quote => {
    const totals = new Map<string, { minor: bigint; items: number }>();
    let unpriced = 0;
    const lines = items.flatMap((item): QuoteItem[] => {
      const part = parts.find((candidate) => candidate.id === item.partId);
      if (!part) return [];
      const { offers, similar } = allOffers(part);
      const offer = [...offers, ...similar].find((candidate) => candidate.id === item.offerId) ?? null;
      const price = offer?.price ? toMinor(offer.price) : null;
      const line = price === null ? null : price * BigInt(item.quantity);
      if (line === null || !offer?.currency) unpriced += 1;
      else {
        const total = totals.get(offer.currency) ?? { minor: 0n, items: 0 };
        totals.set(offer.currency, { minor: total.minor + line, items: total.items + 1 });
      }
      const confirmation = item.confirmationId ? confirmations.get(item.confirmationId) : undefined;
      return [{
        partId: part.id,
        quantity: item.quantity,
        offer,
        unitPrice: offer?.price ?? null,
        currency: offer?.currency ?? null,
        lineTotal: line === null ? null : fromMinor(line),
        status: offer ? 'priced' : item.offerId ? 'offer_missing' : 'no_price',
        matchWarning: offer?.match === 'close',
        identification: { status: confirmation ? (confirmation.decision === 'confirmed' ? 'user_confirmed' : 'user_rejected') : 'document_only', confirmationId: confirmation?.id ?? null },
      }];
    });
    return { items: lines, totals: [...totals].map(([currency, total]) => ({ currency, amount: fromMinor(total.minor), items: total.items })), unpriced, warnings: [], calculatedAt: new Date().toISOString() };
  };

  const partList: PartList = { documentId, status: 'ready', progress: 1, errorCode: null, equipment: null, parts, summary: { total: parts.length, unverified: parts.filter((part) => !part.verified).length } };

  return {
    isDemo: true,
    canReadPhotos: true,
    parts: async () => partList,
    identify: async () => ({ matchStatus: 'unreadable', recognized: { text: null, partNumber: null, manufacturer: null, markings: [], readability: null }, matches: [], message: null }),
    identifyText: async (text) => demoIdentify(text, parts),
    confirm: async (partId, input) => {
      const confirmation: Confirmation = { id: nextId('confirmation'), partId, decision: input.decision, recognizedPartNumber: input.recognizedPartNumber, documentPartNumber: parts.find((part) => part.id === partId)?.partNumber ?? '', confirmedBy: 'user', createdAt: new Date().toISOString() };
      confirmations.set(confirmation.id, confirmation);
      return confirmation;
    },
    priceLists: async () => [...lists.values()].map((item) => item.list),
    uploadPriceList: async (file, input) => {
      const parsed = /\.csv$/i.test(file.name) ? parsePriceCsv(await file.text()) : null;
      if (!parsed) throw Object.assign(new Error('Unreadable price list'), { demoPriceListError: true });
      const hasDates = parsed.rows.some((row) => row.checkedAt);
      const list: PriceList = { id: nextId('list'), supplier: input.supplier, fileName: file.name, rows: parsed.rows.length, skipped: parsed.skipped, checkedAt: input.checkedAt || new Date().toISOString().slice(0, 10), checkedAtOrigin: hasDates ? 'file' : input.checkedAt ? 'upload_form' : 'import_date', demo: input.demo, importedAt: new Date().toISOString() };
      lists.set(list.id, { list, rows: parsed.rows });
      return list;
    },
    deletePriceList: async (id) => {
      lists.delete(id);
    },
    offers: async (partIds) => partIds.flatMap((partId) => {
      const part = parts.find((candidate) => candidate.id === partId);
      return part ? [{ partId, partNumber: part.partNumber, ...allOffers(part) }] : [];
    }),
    quote: async (items) => buildQuote(items),
    exportQuote: async (items) => {
      const quote = buildQuote(items);
      const header = ['DEMO', 'part_number', 'quantity', 'unit', 'identification', 'source', 'quote', 'supplier', 'price', 'currency', 'checked_at', 'line_total'];
      const rows = quote.items.map((item) => {
        const part = parts.find((candidate) => candidate.id === item.partId);
        const source = part?.sources[0];
        return ['DEMO', part?.partNumber ?? '', item.quantity, part?.unit ?? '', item.identification.status, source?.page ?? source?.location ?? '', source?.quote ?? '', item.offer?.supplier ?? '', item.unitPrice ?? '', item.currency ?? '', item.offer?.checkedAt ?? '', item.lineTotal ?? ''];
      });
      return new Blob(['\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    },
  };
}
