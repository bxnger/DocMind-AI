import type { Comparison, Difference, Evidence } from '@/types/comparison';
import { AppError, ERROR_BAD_RESPONSE, getJson, isRecord, postJson } from './client';

const bad = () => new AppError({ code: ERROR_BAD_RESPONSE, message: 'Unexpected response from the backend' });

function toEvidence(value: unknown): Evidence | null {
  if (!isRecord(value) || typeof value.quote !== 'string') return null;
  return { quote: value.quote, page: typeof value.page === 'number' ? value.page : null };
}

function toDifference(value: unknown): Difference {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    (value.type !== 'changed' && value.type !== 'added' && value.type !== 'removed')
  ) {
    throw bad();
  }
  return {
    id: value.id,
    type: value.type,
    explanation: typeof value.explanation === 'string' ? value.explanation : '',
    a: toEvidence(value.a),
    b: toEvidence(value.b),
  };
}

function toComparison(value: unknown): Comparison {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.documentAId !== 'string' ||
    typeof value.documentBId !== 'string' ||
    (value.status !== 'processing' && value.status !== 'ready' && value.status !== 'failed')
  ) {
    throw bad();
  }
  return {
    id: value.id,
    documentAId: value.documentAId,
    documentBId: value.documentBId,
    status: value.status,
    progress: typeof value.progress === 'number' ? value.progress : null,
    differences: Array.isArray(value.differences) ? value.differences.map(toDifference) : [],
    errorCode: isRecord(value.error) && typeof value.error.code === 'string' ? value.error.code : null,
  };
}

export async function createComparison(documentAId: string, documentBId: string): Promise<Comparison> {
  const response = await postJson('/comparisons', { documentAId, documentBId });
  return toComparison(await response.json());
}

export async function getComparison(id: string, signal?: AbortSignal): Promise<Comparison> {
  return toComparison(await getJson(`/comparisons/${encodeURIComponent(id)}`, signal));
}
