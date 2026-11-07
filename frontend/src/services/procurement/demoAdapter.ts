import { fromMinor, toMinor } from '@/lib/money';
import type { Marking, Offer, Part, PriceList, Sheet } from '@/types/procurement';
import { matchMarking, normalizeCode, splitBrand } from './matching';
import type { ProcurementAdapter, SourceText } from './types';

/**
 * Stands in until the backend has these routes, and says so on screen. Parts and quotes are searched in the document's
 * real text, so a source link always leads to a real place. Built-in prices are invented and marked DEMO. It reads no photos.
 */
export const DEMO_SUPPLIER = 'DEMO';
const CODE = /(?:\b[A-ZА-Я]{2,10}\s+)?\b(?=[0-9A-ZА-Я./-]*\d)(?=[0-9A-ZА-Я./-]*[A-ZА-Я-])[0-9A-ZА-Я]+(?:[-/.][0-9A-ZА-Я]+)+\b/g;
const QUANTITY = /(\d{1,5})\s*(шт|pcs|pc|дана|компл|ед)(?!\p{L})/iu;
const DATE_LIKE = /^\d{1,4}[-./]\d{1,2}([-./]\d{1,4})?$/;
const FIXTURES = ['SKF 6205-2RS1', 'SKF 6205-ZZ', 'NSK 6305-2RS'];
const MAX_PARTS = 40;

const sentences = (text: string) => text.split(/(?<=[.!?;])\s+/).filter(Boolean);

function makePart(id: string, code: string, source: Partial<SourceText>, quote: string | null): Part {
  const quantity = quote ? QUANTITY.exec(quote) : null;
  return {
    id,
    rawCode: code,
    normalizedCode: normalizeCode(splitBrand(code).code),
    brand: splitBrand(code).brand,
    description: null,
    quantity: quantity?.[1] ? Number(quantity[1]) : null,
    unit: quantity?.[2] ?? null,
    quantityStatus: quantity ? 'found' : 'missing',
    quantitySource: 'document',
    included: true,
    note: '',
    page: source.page ?? null,
    location: source.location ?? null,
    paragraph: source.paragraph ?? null,
    quote,
    highlights: [],
    extraction: 'pattern',
  };
}

export function findParts(pages: readonly SourceText[]): Part[] {
  const found = new Map<string, Part>();
  for (const page of pages) {
    for (const sentence of sentences(page.text)) {
      for (const match of sentence.matchAll(CODE)) {
        const code = match[0].trim();
        const key = normalizeCode(splitBrand(code).code);
        if (DATE_LIKE.test(code) || key.length < 4 || found.has(key) || found.size >= MAX_PARTS) continue;
        found.set(key, makePart(`demo-part-${found.size + 1}`, code, page, sentence.slice(0, 400)));
      }
    }
  }
  return [...found.values()];
}

/** No code in the document: sample lines with no quote and no link, so the screens can still be seen. */
export const fixtureParts = (): Part[] => FIXTURES.map((code, index) => makePart(`demo-fixture-${index + 1}`, code, {}, null));

const CSV_COLUMNS = ['sku', 'price', 'currency', 'checked_at'];

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

export interface PriceRow {
  row: number;
  sku: string;
  price: string;
  currency: string;
  checkedAt: string;
  stock: number | null;
  url: string | null;
}

export function parsePriceCsv(content: string): { rows: PriceRow[]; skipped: Array<{ row: number; reason: string }> } | null {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const separator = (lines[0] ?? '').includes(';') ? ';' : ',';
  const header = parseLine(lines[0] ?? '', separator).map((name) => name.toLowerCase());
  if (!CSV_COLUMNS.every((column) => header.includes(column))) return null;
  const at = (cells: string[], name: string) => cells[header.indexOf(name)] ?? '';
  const rows: PriceRow[] = [];
  const skipped: Array<{ row: number; reason: string }> = [];
  lines.slice(1).forEach((line, index) => {
    if (!line.trim()) return;
    const row = index + 2;
    const cells = parseLine(line, separator);
    const price = toMinor(at(cells, 'price'));
    const checkedAt = at(cells, 'checked_at');
    if (!at(cells, 'sku')) skipped.push({ row, reason: 'SKU_MISSING' });
    else if (price === null) skipped.push({ row, reason: 'PRICE_INVALID' });
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) skipped.push({ row, reason: 'DATE_INVALID' });
    else {
      const stock = Number(at(cells, 'stock'));
      rows.push({ row, sku: at(cells, 'sku'), price: fromMinor(price), currency: at(cells, 'currency').toUpperCase(), checkedAt, stock: at(cells, 'stock') && Number.isFinite(stock) ? stock : null, url: at(cells, 'url') || null });
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

const demoRows = (part: Part): PriceRow[] => {
  const code = splitBrand(part.rawCode).code;
  return [
    { row: 1, sku: code, price: '4500.00', currency: 'KZT', checkedAt: '2000-01-01', stock: null, url: null },
    { row: 2, sku: `${code}/C3`, price: '5200.00', currency: 'KZT', checkedAt: '2000-01-01', stock: null, url: null },
  ];
};

export function createDemoAdapter(pages: readonly SourceText[]): ProcurementAdapter {
  const found = findParts(pages);
  let parts = found.length ? found : fixtureParts();
  const markings = new Map<string, Marking>();
  const lists = new Map<string, { list: PriceList; rows: PriceRow[] }>();
  const selected = new Map<string, string>();
  let sequence = 0;
  const nextId = (prefix: string) => `demo-${prefix}-${(sequence += 1)}`;

  const offersOf = (part: Part, priceListId: string | null): Offer[] => {
    const uploaded = priceListId ? lists.get(priceListId) : undefined;
    const rows = uploaded ? uploaded.rows : demoRows(part);
    const supplier = uploaded ? uploaded.list.supplier : DEMO_SUPPLIER;
    const code = normalizeCode(splitBrand(part.rawCode).code);
    return rows.flatMap((row): Offer[] => {
      const sku = normalizeCode(row.sku);
      if (!sku.startsWith(code)) return [];
      return [{ id: `${part.id}:${priceListId ?? 'demo'}:${row.row}`, priceListId: priceListId ?? 'demo', supplier, sku: row.sku, sourceRow: row.row, unitPrice: row.price, currency: row.currency, checkedAt: row.checkedAt, stock: row.stock, url: row.url, match: sku === code ? 'exact' : 'needs_review' }];
    });
  };

  const buildSheet = (priceListId: string | null): Sheet => {
    const totals = new Map<string, { minor: bigint; lines: number }>();
    let unpriced = 0;
    const items = parts.map((part) => {
      const offers = offersOf(part, priceListId);
      const choice = offers.find((offer) => offer.id === selected.get(part.id)) ?? null;
      const price = choice ? toMinor(choice.unitPrice) : null;
      const line = price !== null && part.quantity !== null ? price * BigInt(part.quantity) : null;
      if (part.included) {
        if (line === null || !choice) unpriced += 1;
        else {
          const total = totals.get(choice.currency) ?? { minor: 0n, lines: 0 };
          totals.set(choice.currency, { minor: total.minor + line, lines: total.lines + 1 });
        }
      }
      const marking = [...markings.values()].filter((item) => item.matchedPartId === part.id).at(-1) ?? null;
      return { partId: part.id, markingStatus: marking?.status ?? null, markingId: marking?.id ?? null, selectedOfferId: choice?.id ?? null, lineTotal: line === null ? null : fromMinor(line), offers };
    });
    return { items, totals: [...totals].map(([currency, total]) => ({ currency, amount: fromMinor(total.minor), lines: total.lines })), unpricedParts: unpriced, complete: unpriced === 0 };
  };

  return {
    isDemo: true,
    parts: async () => parts,
    updatePart: async (id, patch) => {
      parts = parts.map((part) => (part.id === id ? { ...part, ...patch, ...(patch.quantity === undefined ? {} : { quantitySource: 'user' as const, quantityStatus: 'found' as const }) } : part));
      const part = parts.find((candidate) => candidate.id === id);
      if (!part) throw new Error('Unknown part');
      return part;
    },
    uploadMarking: async () => {
      const marking: Marking = { id: nextId('marking'), readText: null, readBy: null, confirmed: false, confirmedText: null, status: null, matchedPartId: null, candidates: [] };
      markings.set(marking.id, marking);
      return marking;
    },
    confirmMarking: async (id, text) => {
      const marking: Marking = { id, readText: null, readBy: null, confirmed: true, confirmedText: text, ...matchMarking(text, parts) };
      markings.set(id, marking);
      return marking;
    },
    priceLists: async () => [...lists.values()].map((item) => item.list),
    uploadPriceList: async (file, supplier) => {
      const parsed = /\.csv$/i.test(file.name) ? parsePriceCsv(await file.text()) : null;
      if (!parsed) throw Object.assign(new Error('Unreadable price list'), { demoPriceListError: true });
      const list: PriceList = { id: nextId('list'), fileName: file.name, supplier, sourceNote: '', uploadedAt: new Date().toISOString(), rowCount: parsed.rows.length, skippedRows: parsed.skipped };
      lists.set(list.id, { list, rows: parsed.rows });
      return list;
    },
    sheet: async (priceListId) => buildSheet(priceListId),
    selectOffer: async (partId, offerId) => {
      if (offerId) selected.set(partId, offerId);
      else selected.delete(partId);
    },
    exportSheet: async (priceListId) => {
      const sheet = buildSheet(priceListId);
      const header = ['DEMO', 'code', 'quantity', 'unit', 'marking', 'source', 'quote', 'supplier', 'price', 'currency', 'checked_at', 'line_total', 'note'];
      const rows = parts.filter((part) => part.included).map((part) => {
        const item = sheet.items.find((candidate) => candidate.partId === part.id);
        const offer = item?.offers.find((candidate) => candidate.id === item.selectedOfferId);
        return ['DEMO', part.rawCode, part.quantity, part.unit, item?.markingStatus ?? '', part.page ?? part.location ?? '', part.quote ?? '', offer?.supplier ?? '', offer?.unitPrice ?? '', offer?.currency ?? '', offer?.checkedAt ?? '', item?.lineTotal ?? '', part.note];
      });
      return new Blob(['\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    },
  };
}
