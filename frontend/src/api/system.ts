import type { Capabilities } from '@/types/document';
import { AppError, ERROR_BAD_RESPONSE, getPublicJson, isRecord } from './client';

export async function getHealth(signal?: AbortSignal): Promise<void> {
  await getPublicJson('/health', signal);
}

export async function getCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  const body = await getPublicJson('/capabilities', signal);
  const limits = isRecord(body) && isRecord(body.limits) ? body.limits : null;
  if (
    !isRecord(body) ||
    !limits ||
    typeof body.version !== 'string' ||
    typeof limits.maxFileSizeBytes !== 'number' ||
    typeof limits.maxPages !== 'number' ||
    typeof limits.maxDocumentsPerConversation !== 'number'
  ) {
    throw new AppError({ code: ERROR_BAD_RESPONSE, message: 'Unexpected capabilities response' });
  }
  return {
    version: body.version,
    languages: Array.isArray(body.languages) ? body.languages.filter((l) => typeof l === 'string') : [],
    ocr: body.ocr === true,
    docxPreview: body.docxPreview === 'pdf' ? 'pdf' : 'none',
    comparison: body.comparison === true,
    highlights: body.highlights === true,
    procurement: body.procurement === true,
    limits: {
      maxFileSizeBytes: limits.maxFileSizeBytes,
      maxPages: limits.maxPages,
      maxDocumentsPerConversation: limits.maxDocumentsPerConversation,
    },
  };
}
