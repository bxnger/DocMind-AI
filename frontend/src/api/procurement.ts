import type { EvidenceSource } from '@/types/chat';
import type { CheckedAtOrigin, Confirmation, ConfirmationInput, MatchStatus, Offer, Part, PartCategory, PartList, PartOffers, PartType, PhotoCandidate, PhotoIssue, PhotoMatch, PriceList, PriceListInput, Quote, QuoteItem, QuoteRequestItem } from '@/types/procurement';
import { AppError, ERROR_BAD_RESPONSE, getJson, isRecord, postJson, send } from './client';
import { toSource } from './conversations';

const bad = () => new AppError({ code: ERROR_BAD_RESPONSE, message: 'Unexpected response from the backend' });
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => options.find((option) => option === value) ?? fallback;
const CATEGORIES: readonly PartCategory[] = ['bearing', 'seal', 'belt', 'filter', 'fastener', 'motor', 'electrical', 'hydraulic', 'other'];
const ORIGINS: readonly CheckedAtOrigin[] = ['file', 'upload_form', 'import_date'];

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
    checkedAtOrigin: oneOf(value.checkedAtOrigin, ORIGINS, 'import_date'),
    demo: value.demo === true,
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

export async function getQuote(documentId: string, items: QuoteRequestItem[]): Promise<Quote> {
  const response = await postJson('/procurement/quote', { documentId, items });
  return toQuote(await response.json());
}

export async function exportQuote(documentId: string, items: QuoteRequestItem[], format: 'csv' | 'xlsx'): Promise<Blob> {
  const response = await postJson(`/procurement/quote/export?format=${format}`, { documentId, items });
  return response.blob();
}
