import { NOT_FOUND_REASONS, type EvidenceSource } from '@/types/chat';
import type { ClaimCheck } from '@/types/verify';
import { AppError, ERROR_BAD_RESPONSE, isRecord, postJson } from './client';
import { createConversation, toSource } from './conversations';
import { onSessionReplaced } from './session';

export const MAX_CLAIM_LENGTH = 1000;

const bad = () => new AppError({ code: ERROR_BAD_RESPONSE, message: 'Unexpected response from the backend' });

/** A verdict stands only with a source. "Supported" with nothing to open is reported as no evidence found. */
export function toClaimCheck(value: unknown): ClaimCheck {
  if (!isRecord(value)) throw bad();
  const { verdict } = value;
  if (verdict !== 'supported' && verdict !== 'partly' && verdict !== 'contradicted' && verdict !== 'not_found') throw bad();
  const sources: EvidenceSource[] = verdict !== 'not_found' && Array.isArray(value.sources) ? value.sources.flatMap((item: unknown) => {
    try {
      return [toSource(item)];
    } catch {
      return [];
    }
  }) : [];
  const reason = NOT_FOUND_REASONS.find((item) => item === value.reason);
  if (verdict === 'not_found' || sources.length === 0) return { verdict: 'not_found', explanation: '', sources: [], ...(reason ? { reason } : {}) };
  return { verdict, explanation: typeof value.explanation === 'string' ? value.explanation : '', sources };
}

/** A conversation the check runs in, kept apart from the chat so that checks never appear among its messages. */
const conversations = new Map<string, Promise<string>>();
onSessionReplaced(() => conversations.clear());

function conversationFor(documentId: string, title: string): Promise<string> {
  const held = conversations.get(documentId);
  if (held) return held;
  const created = createConversation([documentId], title);
  conversations.set(documentId, created);
  created.catch(() => conversations.delete(documentId));
  return created;
}

export async function verifyClaim(documentId: string, title: string, claim: string, language: string): Promise<ClaimCheck> {
  const post = async () => {
    const id = await conversationFor(documentId, title);
    const response = await postJson(`/conversations/${encodeURIComponent(id)}/verify`, { claim, language });
    return toClaimCheck(await response.json());
  };
  try {
    return await post();
  } catch (error) {
    // The conversation is gone, for example after a server restart. Nothing was checked, so one new try is safe.
    if (!(error instanceof AppError) || error.status !== 404) throw error;
    conversations.delete(documentId);
    return post();
  }
}
