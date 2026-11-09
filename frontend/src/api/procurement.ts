import type { EvidenceSource } from '@/types/chat';
import type { CheckedAtOrigin, Confirmation, ConfirmationInput, MatchStatus, Offer, Part, PartCategory, PartList, PartOffers, PartType, PhotoCandidate, PhotoIssue, PhotoMatch, PriceList, PriceListInput, Quote, QuoteItem, QuoteRequestItem, SearchSource, SiteCheck, StoreSearchInput, StoreSearchResult, BarcodeLookup, UnconfirmedPage } from '@/types/procurement';
import { AppError, ERROR_BAD_RESPONSE, getJson, isRecord, postJson, send } from './client';
import { toSource } from './conversations';

const bad = () => new AppError({ code: ERROR_BAD_RESPONSE, message: 'Unexpected response from the backend' });
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => options.find((option) => option === value) ?? fallback;
const CATEGORIES: readonly PartCategory[] = ['bearing', 'seal', 'belt', 'filter', 'fastener', 'motor', 'electrical', 'hydraulic', 'other'];
const ORIGINS: readonly CheckedAtOrigin[] = ['file', 'upload_form', 'import_date', 'site'];

function sources(value: unknown): EvidenceSource[] {
  return list(value).flatMap((item) => {
    try {
      return [toSource(item)];
    } catch {
      return [];
    }
  });
}

/** `verified` counts only when the server says so: anything else gets the warning. */
export function toPart(value: unknown): Part {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.partNumber !== 'string') throw bad();
  return {
    id: value.id,
    category: oneOf(value.category, CATEGORIES, 'other'),
    name: text(value.name) ?? '',
    partNumber: value.partNumber,
    manufacturer: text(value.manufacturer),
    quantity: num(value.quantity),
    unit: text(value.unit),
    specs: list(value.specs).flatMap((spec) => (isRecord(spec) && typeof spec.name === 'string' && typeof spec.value === 'string' ? [{ name: spec.name, value: spec.value, unit: text(spec.unit), origin: spec.origin === 'document' ? 'document' as const : 'standard' as const }] : [])),
    location: text(value.location),
    verified: value.verified === true,
    sources: sources(value.sources),
  };
}

export function toPartList(value: unknown): PartList {
  if (!isRecord(value) || typeof value.documentId !== 'string') throw bad();
  const parts = list(value.parts).map(toPart);
  const equipment = isRecord(value.equipment) ? { name: text(value.equipment.name), model: text(value.equipment.model), manufacturer: text(value.equipment.manufacturer), sources: sources(value.equipment.sources) } : null;
  return {
    documentId: value.documentId,
    status: oneOf(value.status, ['processing', 'ready', 'failed'] as const, 'failed'),
    progress: num(value.progress),
    errorCode: isRecord(value.error) ? text(value.error.code) : null,
    equipment,
    parts,
    summary: { total: isRecord(value.summary) ? (num(value.summary.total) ?? parts.length) : parts.length, unverified: parts.filter((part) => !part.verified).length },
  };
}

function toCandidate(value: unknown): PhotoCandidate[] {
  if (!isRecord(value) || typeof value.partId !== 'string') return [];
  return [{ partId: value.partId, partNumber: text(value.partNumber) ?? '', name: text(value.name) ?? '', match: oneOf(value.match, ['exact', 'close', 'partial', 'type'] as const, 'partial'), difference: text(value.difference), sources: sources(value.sources) }];
}

const MATCH_STATUSES: readonly MatchStatus[] = ['matched', 'needs_confirmation', 'no_match', 'type_only', 'unreadable'];
const PART_TYPES: readonly PartType[] = [...CATEGORIES, 'unknown'];
const ISSUES: readonly PhotoIssue[] = ['glare', 'blur', 'angle', 'partial', 'dark', 'far', 'no_marking', 'not_a_part'];
const strings = (value: unknown): string[] => list(value).flatMap((item) => (typeof item === 'string' ? [item] : []));

export function toPhotoMatch(value: unknown): PhotoMatch {
  if (!isRecord(value)) throw bad();
  const recognized = isRecord(value.recognized) ? value.recognized : {};
  return {
    matchStatus: oneOf(value.matchStatus, MATCH_STATUSES, 'unreadable'),
    recognized: {
      text: text(recognized.text),
      partNumber: text(recognized.partNumber),
      manufacturer: text(recognized.manufacturer),
      markings: strings(recognized.markings),
      readability: text(recognized.readability),
      visibleMarkings: strings(recognized.visibleMarkings),
      partType: PART_TYPES.find((type) => type === recognized.partType) ?? null,
      confidence: recognized.confidence === 'high' || recognized.confidence === 'medium' || recognized.confidence === 'low' ? recognized.confidence : null,
      issues: strings(recognized.issues).flatMap((issue) => ISSUES.filter((known) => known === issue)),
    },
    matches: list(value.matches).flatMap(toCandidate),
    message: text(value.message),
    tips: strings(value.tips),
  };
}

export function toConfirmation(value: unknown): Confirmation {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.partId !== 'string') throw bad();
  return { id: value.id, partId: value.partId, decision: value.decision === 'confirmed' ? 'confirmed' : 'rejected', recognizedPartNumber: text(value.recognizedPartNumber), documentPartNumber: text(value.documentPartNumber) ?? '', confirmedBy: text(value.confirmedBy) ?? '', createdAt: text(value.createdAt) ?? '' };
}

export function toPriceList(value: unknown): PriceList {
  if (!isRecord(value) || typeof value.id !== 'string') throw bad();
  return {
    id: value.id,
    supplier: text(value.supplier) ?? '',
    fileName: text(value.fileName) ?? '',
    rows: num(value.rows) ?? 0,
    skipped: list(value.skipped).flatMap((row) => (isRecord(row) && typeof row.row === 'number' ? [{ row: row.row, reason: text(row.reason) ?? '' }] : [])),
    checkedAt: text(value.checkedAt),
    checkedAtOrigin: oneOf(value.checkedAtOrigin, ORIGINS, 'import_date'),
    demo: value.demo === true,
    importedAt: text(value.importedAt) ?? '',
  };
}

function toSiteCheck(value: unknown): SiteCheck | null {
  if (!isRecord(value)) return null;
  return { status: value.status === 'checked' ? 'checked' : 'failed', reason: text(value.reason), price: text(value.price), currency: text(value.currency), checkedAt: text(value.checkedAt) };
}

/** A link comes from a price file somebody uploaded, so only a web address may become one. */
export const toHttpUrl = (value: unknown): string | null => (typeof value === 'string' && /^https?:\/\//i.test(value.trim()) ? value.trim() : null);

/** An offer must say which row of which file it came from. Otherwise it is no offer at all. */
export function toOffer(value: unknown): Offer[] {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.priceListId !== 'string' || typeof value.sourceRow !== 'number') return [];
  return [{
    id: value.id,
    supplier: text(value.supplier) ?? '',
    title: text(value.title) ?? '',
    partNumber: text(value.partNumber) ?? '',
    match: value.match === 'exact' ? 'exact' : 'close',
    price: text(value.price),
    currency: text(value.currency),
    stockStatus: oneOf(value.stockStatus, ['available', 'unavailable', 'unknown'] as const, 'unknown'),
    stockQuantity: num(value.stockQuantity),
    url: toHttpUrl(value.url),
    source: text(value.source) ?? 'price_list',
    priceListId: value.priceListId,
    sourceRow: value.sourceRow,
    checkedAt: text(value.checkedAt),
    // A store's time is always the moment its page was read, also when the answer came from the server's cache.
    checkedAtOrigin: value.source === 'store_catalog' ? 'site' : oneOf(value.checkedAtOrigin, ORIGINS, 'import_date'),
    demo: value.demo === true,
    manufacturer: text(value.manufacturer),
    priceListFile: text(value.priceListFile),
    priceOrigin: value.priceOrigin === 'site_checked' ? 'site_checked' : value.priceOrigin === 'file' ? 'file' : value.source === 'store_catalog' ? 'none' : 'file',
    filePrice: text(value.filePrice),
    siteCheck: toSiteCheck(value.siteCheck),
    store: text(value.store),
    sameSellerAs: strings(value.sameSellerAs),
    barcode: text(value.barcode),
  }];
}

export function toPartOffers(value: unknown): PartOffers[] {
  if (!isRecord(value) || typeof value.partId !== 'string') return [];
  return [{ partId: value.partId, partNumber: text(value.partNumber) ?? '', offers: list(value.offers).flatMap(toOffer), similar: list(value.similar).flatMap(toOffer) }];
}

function toQuoteItem(value: unknown): QuoteItem[] {
  if (!isRecord(value) || typeof value.partId !== 'string') return [];
  const identification = isRecord(value.identification) ? value.identification : {};
  return [{
    partId: value.partId,
    quantity: num(value.quantity) ?? 0,
    offer: toOffer(value.offer)[0] ?? null,
    unitPrice: text(value.unitPrice),
    currency: text(value.currency),
    lineTotal: text(value.lineTotal),
    status: oneOf(value.status, ['priced', 'no_price', 'offer_missing'] as const, 'no_price'),
    matchWarning: value.matchWarning === true,
    identification: { status: oneOf(identification.status, ['user_confirmed', 'user_rejected', 'document_only'] as const, 'document_only'), confirmationId: text(identification.confirmationId) },
  }];
}

export function toQuote(value: unknown): Quote {
  if (!isRecord(value) || !Array.isArray(value.items)) throw bad();
  return {
    items: value.items.flatMap(toQuoteItem),
    totals: list(value.totals).flatMap((total) => (isRecord(total) && typeof total.currency === 'string' && typeof total.amount === 'string' ? [{ currency: total.currency, amount: total.amount, items: num(total.items) ?? 0 }] : [])),
    unpriced: num(value.unpriced) ?? 0,
    warnings: list(value.warnings).flatMap((item) => (typeof item === 'string' ? [item] : [])),
    calculatedAt: text(value.calculatedAt) ?? '',
  };
}

const doc = (id: string) => `/documents/${encodeURIComponent(id)}`;

export async function startParts(documentId: string, language: string): Promise<void> {
  await postJson(`${doc(documentId)}/parts`, { language });
}

export async function getParts(documentId: string, signal?: AbortSignal): Promise<PartList> {
  return toPartList(await getJson(`${doc(documentId)}/parts`, signal));
}

export async function identifyPart(documentId: string, image: File, language: string): Promise<PhotoMatch> {
  const body = new FormData();
  body.append('image', image);
  body.append('language', language);
  const response = await send(`${doc(documentId)}/parts/identify`, { method: 'POST', body });
  return toPhotoMatch(await response.json());
}

export async function confirmPart(documentId: string, partId: string, input: ConfirmationInput): Promise<Confirmation> {
  const response = await postJson(`${doc(documentId)}/parts/${encodeURIComponent(partId)}/confirmations`, input);
  return toConfirmation(await response.json());
}

export async function uploadPriceList(file: File, input: PriceListInput): Promise<PriceList> {
  const body = new FormData();
  body.append('file', file);
  if (input.supplier) body.append('supplier', input.supplier);
  if (input.checkedAt) body.append('checkedAt', input.checkedAt);
  if (input.demo) body.append('demo', 'true');
  const response = await send('/price-lists', { method: 'POST', body });
  return toPriceList(await response.json());
}

export async function listPriceLists(signal?: AbortSignal): Promise<PriceList[]> {
  const body = await getJson('/price-lists', signal);
  if (!isRecord(body) || !Array.isArray(body.items)) throw bad();
  return body.items.map(toPriceList);
}

export async function deletePriceList(id: string): Promise<void> {
  await send(`/price-lists/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getOffers(documentId: string, partIds: string[]): Promise<PartOffers[]> {
  const response = await postJson('/procurement/offers', { documentId, partIds });
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.items)) throw bad();
  return body.items.flatMap(toPartOffers);
}

/** Reads the supplier's page. The server keeps the result, so offers and quotes must be asked again afterwards. */
export async function checkOfferPrices(offerIds: string[]): Promise<void> {
  await postJson('/procurement/offers/check', { offerIds });
}

export async function getQuote(documentId: string, items: QuoteRequestItem[]): Promise<Quote> {
  const response = await postJson('/procurement/quote', { documentId, items });
  return toQuote(await response.json());
}

export async function exportQuote(documentId: string, items: QuoteRequestItem[], format: 'csv' | 'xlsx'): Promise<Blob> {
  const response = await postJson(`/procurement/quote/export?format=${format}`, { documentId, items });
  return response.blob();
}

function toUnconfirmed(value: unknown): UnconfirmedPage[] {
  if (!isRecord(value) || typeof value.store !== 'string') return [];
  return [{ store: value.store, url: toHttpUrl(value.url), title: text(value.title) ?? '', partNumber: text(value.partNumber), reason: text(value.reason), sameSellerAs: strings(value.sameSellerAs) }];
}

function toSearchSource(value: unknown): SearchSource[] {
  if (!isRecord(value) || typeof value.store !== 'string') return [];
  return [{ store: value.store, status: oneOf(value.status, ['ok', 'unavailable', 'skipped'] as const, 'unavailable'), reason: text(value.reason), candidates: num(value.candidates) ?? 0, sameSellerAs: text(value.sameSellerAs), indexedAt: text(value.indexedAt) }];
}

/** Offers keep the server's three groups. An item that is not a whole offer (no id) is dropped, never guessed. */
export function toStoreSearch(value: unknown): StoreSearchResult {
  if (!isRecord(value)) throw bad();
  return {
    query: text(value.query) ?? '',
    searchedAs: text(value.searchedAs),
    kind: text(value.kind),
    reason: text(value.reason),
    offers: list(value.offers).flatMap(toOffer),
    similar: list(value.similar).flatMap(toOffer).map((offer) => ({ ...offer, match: 'close' as const })),
    unconfirmed: list(value.unconfirmed).flatMap(toUnconfirmed),
    sources: list(value.sources).flatMap(toSearchSource),
    searchedAt: text(value.searchedAt),
  };
}

const CODE_KINDS = ['gtin', 'url', 'partNumber', 'text'] as const;

export function toBarcodeLookup(value: unknown): BarcodeLookup {
  if (!isRecord(value)) throw bad();
  return {
    codes: list(value.codes).flatMap((code) => (isRecord(code) && typeof code.value === 'string' ? [{ format: text(code.format) ?? 'text', value: code.value, valid: typeof code.valid === 'boolean' ? code.valid : null, kind: oneOf(code.kind, CODE_KINDS, 'text') }] : [])),
    lookup: isRecord(value.lookup) ? toStoreSearch(value.lookup) : null,
  };
}

/** Store search. For a document part, the results also join that part's offers on the server. */
export async function searchStores(input: StoreSearchInput, signal?: AbortSignal): Promise<StoreSearchResult> {
  const response = await postJson('/procurement/search', input, signal);
  return toStoreSearch(await response.json());
}

/** A code the phone already read (`text`), or a photo the phone could not read (`image`). */
export async function lookupBarcode(input: { text: string } | { image: File }): Promise<BarcodeLookup> {
  const body = new FormData();
  if ('text' in input) body.append('text', input.text);
  else body.append('image', input.image);
  const response = await send('/procurement/barcodes', { method: 'POST', body });
  return toBarcodeLookup(await response.json());
}
