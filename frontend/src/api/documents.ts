import { getSessionToken, invalidateSession } from './session';
import type { EvidenceRect } from '@/types/chat';
import type { DocumentModel, DocumentError } from '@/types/document';
import {
  AppError,
  ERROR_BAD_RESPONSE,
  apiUrl,
  deleteResource,
  errorFromBody,
  getJson,
  isRecord,
  networkError,
  timeoutError,
} from './client';

/** 20 MB on a slow connection still fits. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

function badResponse(): AppError {
  return new AppError({ code: ERROR_BAD_RESPONSE, message: 'Unexpected response from the backend' });
}

function toDocumentError(value: unknown): DocumentError | null {
  if (!isRecord(value)) return null;
  return {
    code: typeof value.code === 'string' ? value.code : 'UNKNOWN',
    message: typeof value.message === 'string' ? value.message : '',
    retryable: value.retryable === true,
  };
}

const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | null =>
  options.find((option) => option === value) ?? null;

function toRect(value: unknown): EvidenceRect | null {
  if (!isRecord(value)) return null;
  const { x, y, w, h } = value;
  return typeof x === 'number' && typeof y === 'number' && typeof w === 'number' && typeof h === 'number' ? { x, y, w, h } : null;
}

/** Validates the backend's Document at the boundary so the UI works with clean types. */
export function toDocument(dto: unknown): DocumentModel {
  if (!isRecord(dto)) throw badResponse();
  const kind = oneOf(dto.kind, ['pdf', 'docx'] as const);
  const status = oneOf(dto.status, ['processing', 'ready', 'failed'] as const);
  if (
    typeof dto.id !== 'string' ||
    typeof dto.name !== 'string' ||
    typeof dto.sizeBytes !== 'number' ||
    typeof dto.createdAt !== 'string' ||
    !kind ||
    !status
  ) {
    throw badResponse();
  }
  return {
    id: dto.id,
    name: dto.name,
    kind,
    status,
    sizeBytes: dto.sizeBytes,
    createdAt: dto.createdAt,
    stage: oneOf(dto.stage, ['queued', 'extracting', 'ocr', 'indexing'] as const),
    pageCount: typeof dto.pageCount === 'number' ? dto.pageCount : null,
    language: oneOf(dto.language, ['kk', 'ru', 'en', 'mixed'] as const),
    ocrUsed: typeof dto.ocrUsed === 'boolean' ? dto.ocrUsed : null,
    hasPreview: dto.hasPreview === true,
    isDemo: dto.isDemo === true,
    error: toDocumentError(dto.error),
  };
}

export async function listDocuments(signal?: AbortSignal): Promise<DocumentModel[]> {
  const body = await getJson('/documents', signal);
  if (!isRecord(body) || !Array.isArray(body.items)) throw badResponse();
  return body.items.map(toDocument);
}

export async function getDocument(id: string, signal?: AbortSignal): Promise<DocumentModel> {
  return toDocument(await getJson(`/documents/${encodeURIComponent(id)}`, signal));
}

export function deleteDocument(id: string): Promise<void> {
  return deleteResource(`/documents/${encodeURIComponent(id)}`);
}

export function documentFileUrl(id: string): string {
  return apiUrl(`/documents/${encodeURIComponent(id)}/file`);
}

export interface UploadCallbacks {
  /** Real byte progress from the browser, between 0 and 1. */
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

/** XMLHttpRequest because fetch still has no upload progress events. */
export async function uploadDocument(file: File, { onProgress, signal }: UploadCallbacks): Promise<DocumentModel> {
  const token = await getSessionToken();
  if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file);

    xhr.open('POST', apiUrl('/documents'));
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'text';
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.ontimeout = () => reject(timeoutError());
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(networkError());
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // A non-JSON body is handled below: errorFromBody and toDocument both reject null.
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(toDocument(body));
        } catch (error) {
          reject(error);
        }
      } else {
        // Not sent again by itself: the upload counts against limits, and the user decides.
        if (xhr.status === 401) invalidateSession(token);
        reject(errorFromBody(xhr.status, body, xhr.getResponseHeader('Retry-After')));
      }
    };
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

export type TextBlockKind = 'heading' | 'paragraph' | 'table_row' | 'page';

export interface TextBlock {
  index: number;
  kind: TextBlockKind;
  section: string | null;
  /** PDF only. */
  page?: number | null;
  text: string;
}

export async function getDocumentText(id: string, signal?: AbortSignal): Promise<TextBlock[]> {
  const body = await getJson(`/documents/${encodeURIComponent(id)}/text`, signal);
  if (!isRecord(body) || !Array.isArray(body.blocks)) throw badResponse();
  return body.blocks.map((block: unknown): TextBlock => {
    if (!isRecord(block) || typeof block.index !== 'number' || typeof block.text !== 'string') throw badResponse();
    return {
      index: block.index,
      kind: oneOf(block.kind, ['heading', 'paragraph', 'table_row', 'page'] as const) ?? 'paragraph',
      section: typeof block.section === 'string' ? block.section : null,
      page: typeof block.page === 'number' ? block.page : null,
      text: block.text,
    };
  });
}

export const FACT_KINDS = ['deadline', 'date', 'duration', 'amount', 'percent'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export interface DocumentFact {
  kind: FactKind;
  value: string;
  quote: string;
  page: number | null;
  location: string | null;
  highlights: EvidenceRect[];
  /** Block index in /text. DOCX only. */
  paragraph?: number;
}

export interface DocumentFacts {
  facts: DocumentFact[];
  suggestedQuestions: string[];
}

export async function getDocumentFacts(id: string, signal?: AbortSignal): Promise<DocumentFacts> {
  const body = await getJson(`/documents/${encodeURIComponent(id)}/facts`, signal);
  if (!isRecord(body) || !Array.isArray(body.facts)) throw badResponse();
  const facts = body.facts.flatMap((fact: unknown): DocumentFact[] => {
    const kind = isRecord(fact) ? oneOf(fact.kind, FACT_KINDS) : null;
    // A kind added later is skipped, not shown under a wrong heading.
    if (!isRecord(fact) || !kind || typeof fact.value !== 'string' || typeof fact.quote !== 'string') return [];
    return [{
      kind,
      value: fact.value,
      quote: fact.quote,
      page: typeof fact.page === 'number' ? fact.page : null,
      location: typeof fact.location === 'string' ? fact.location : null,
      ...(typeof fact.paragraph === 'number' ? { paragraph: fact.paragraph } : {}),
      highlights: Array.isArray(fact.highlights) ? fact.highlights.flatMap((rect: unknown) => {
        const parsed = toRect(rect);
        return parsed ? [parsed] : [];
      }) : [],
    }];
  });
  const questions: unknown[] = Array.isArray(body.suggestedQuestions) ? body.suggestedQuestions : [];
  return { facts, suggestedQuestions: questions.filter((question): question is string => typeof question === 'string') };
}
