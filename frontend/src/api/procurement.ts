import type { Marking, MarkingCandidate, MarkingStatus, Offer, Part, PartPatch, PriceList, Sheet, SheetItem } from '@/types/procurement';
import { AppError, ERROR_BAD_RESPONSE, getJson, isRecord, postJson, send } from './client';

const bad = () => new AppError({ code: ERROR_BAD_RESPONSE, message: 'Unexpected response from the backend' });
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const STATUSES: readonly MarkingStatus[] = ['exact', 'possible', 'conflict', 'insufficient'];
const toStatus = (value: unknown): MarkingStatus | null => STATUSES.find((status) => status === value) ?? null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A part without a verbatim quote is refused here too: the contract promises one for every real part. */
export function toPart(value: unknown): Part {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.rawCode !== 'string' || typeof value.quote !== 'string' || !value.quote) throw bad();
  return {
    id: value.id,
    rawCode: value.rawCode,
    normalizedCode: text(value.normalizedCode) ?? '',
    brand: text(value.brand),
    description: text(value.description),
    quantity: count(value.quantity),
    unit: text(value.unit),
    quantityStatus: value.quantityStatus === 'found' ? 'found' : 'missing',
    quantitySource: value.quantitySource === 'user' ? 'user' : 'document',
    included: value.included !== false,
    note: text(value.note) ?? '',
    page: count(value.page),
    location: text(value.location),
    paragraph: count(value.paragraph),
    quote: value.quote,
    highlights: list(value.highlights).flatMap((rect) => (isRecord(rect) && typeof rect.x === 'number' && typeof rect.y === 'number' && typeof rect.w === 'number' && typeof rect.h === 'number' ? [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h }] : [])),
    extraction: text(value.extraction) ?? '',
  };
}

function toCandidate(value: unknown): MarkingCandidate[] {
  if (!isRecord(value) || typeof value.partId !== 'string') return [];
  const status = toStatus(value.status);
  if (!status) return [];
  return [{
    partId: value.partId,
    status,
    differences: list(value.differences).flatMap((item) => (isRecord(item) ? [{ document: text(item.document) ?? '', marking: text(item.marking) ?? '' }] : [])),
  }];
}

export function toMarking(value: unknown): Marking {
  if (!isRecord(value) || typeof value.id !== 'string') throw bad();
  return {
    id: value.id,
    readText: text(value.readText),
    readBy: value.readBy === 'model' ? 'model' : null,
    confirmed: value.confirmed === true,
    confirmedText: text(value.confirmedText),
    status: value.confirmed === true ? toStatus(value.status) : null,
    matchedPartId: text(value.matchedPartId),
    candidates: list(value.candidates).flatMap(toCandidate),
  };
}

export function toPriceList(value: unknown): PriceList {
  if (!isRecord(value) || typeof value.id !== 'string') throw bad();
  return {
    id: value.id,
    fileName: text(value.fileName) ?? '',
    supplier: text(value.supplier) ?? '',
    sourceNote: text(value.sourceNote) ?? '',
    uploadedAt: text(value.uploadedAt) ?? '',
    rowCount: count(value.rowCount) ?? 0,
    skippedRows: list(value.skippedRows).flatMap((row) => (isRecord(row) && typeof row.row === 'number' ? [{ row: row.row, reason: text(row.reason) ?? '' }] : [])),
  };
}

/** A price with no price list, source row, currency or date is no offer at all. */
export function toOffer(value: unknown): Offer[] {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.priceListId !== 'string' || typeof value.unitPrice !== 'string' || typeof value.currency !== 'string' || typeof value.checkedAt !== 'string' || typeof value.sourceRow !== 'number') return [];
  return [{
    id: value.id,
    priceListId: value.priceListId,
    supplier: text(value.supplier) ?? '',
    sku: text(value.sku) ?? '',
    sourceRow: value.sourceRow,
    unitPrice: value.unitPrice,
    currency: value.currency,
    checkedAt: value.checkedAt,
    stock: count(value.stock),
    url: text(value.url),
    match: value.match === 'exact' ? 'exact' : 'needs_review',
  }];
}

function toSheetItem(value: unknown): SheetItem[] {
  if (!isRecord(value) || typeof value.partId !== 'string') return [];
  return [{
    partId: value.partId,
    markingStatus: toStatus(value.markingStatus),
    markingId: text(value.markingId),
    selectedOfferId: text(value.selectedOfferId),
    lineTotal: text(value.lineTotal),
    offers: list(value.offers).flatMap(toOffer),
  }];
}

export function toSheet(value: unknown): Sheet {
  if (!isRecord(value) || !Array.isArray(value.items)) throw bad();
  return {
    items: value.items.flatMap(toSheetItem),
    totals: list(value.totals).flatMap((total) => (isRecord(total) && typeof total.currency === 'string' && typeof total.amount === 'string' ? [{ currency: total.currency, amount: total.amount, lines: count(total.lines) ?? 0 }] : [])),
    unpricedParts: count(value.unpricedParts) ?? 0,
    complete: value.complete === true,
  };
}

const doc = (id: string) => `/documents/${encodeURIComponent(id)}`;

async function form(path: string, fields: Record<string, string | Blob>): Promise<unknown> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  const response = await send(path, { method: 'POST', body });
  return response.json();
}

export async function extractParts(documentId: string): Promise<Part[]> {
  const response = await postJson(`${doc(documentId)}/parts`, {});
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.items)) throw bad();
  return body.items.map(toPart);
}

export async function patchPart(id: string, patch: PartPatch): Promise<Part> {
  const response = await send(`/parts/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  return toPart(await response.json());
}

export async function uploadMarking(documentId: string, file: File): Promise<Marking> {
  return toMarking(await form(`${doc(documentId)}/markings`, { file }));
}

export async function confirmMarking(id: string, confirmedText: string): Promise<Marking> {
  const response = await postJson(`/markings/${encodeURIComponent(id)}/confirm`, { text: confirmedText });
  return toMarking(await response.json());
}

export async function uploadPriceList(file: File, supplier: string): Promise<PriceList> {
  return toPriceList(await form('/price-lists', { file, supplier, sourceNote: '' }));
}

export async function listPriceLists(signal?: AbortSignal): Promise<PriceList[]> {
  const body = await getJson('/price-lists', signal);
  if (!isRecord(body) || !Array.isArray(body.items)) throw bad();
  return body.items.map(toPriceList);
}

const withList = (priceListId: string | null) => (priceListId ? `priceListId=${encodeURIComponent(priceListId)}` : '');

export async function getSheet(documentId: string, priceListId: string | null, signal?: AbortSignal): Promise<Sheet> {
  const query = withList(priceListId);
  return toSheet(await getJson(`${doc(documentId)}/procurement${query ? `?${query}` : ''}`, signal));
}

export async function selectOffer(partId: string, offerId: string | null): Promise<void> {
  await send(`/parts/${encodeURIComponent(partId)}/offer`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerId }) });
}

export async function exportSheet(documentId: string, priceListId: string | null, format: 'csv' | 'xlsx'): Promise<Blob> {
  const query = [withList(priceListId), `format=${format}`].filter(Boolean).join('&');
  const response = await send(`${doc(documentId)}/procurement/export?${query}`);
  return response.blob();
}
