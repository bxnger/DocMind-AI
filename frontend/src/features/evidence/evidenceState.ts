import type { JumpRequest } from '@/features/viewer/PdfViewer';
import type { AssistantMessage, ChatMessage, EvidenceSource } from '@/types/chat';

/** What the user picked: one source of one answer. Sources themselves are read from the chat, not copied. */
export interface EvidencePick {
  messageId: string;
  /** The source's own number, the [n] in the answer. */
  sourceIndex: number;
  /** Changes on every pick, so choosing the same source again moves the viewer again. */
  nonce: number;
}

export type EvidenceAction =
  | { type: 'open'; messageId: string; sourceIndex: number; nonce: number }
  | { type: 'select'; sourceIndex: number; nonce: number }
  | { type: 'refocus'; nonce: number }
  | { type: 'close' };

export function evidenceReducer(state: EvidencePick | null, action: EvidenceAction): EvidencePick | null {
  switch (action.type) {
    case 'open':
      return { messageId: action.messageId, sourceIndex: action.sourceIndex, nonce: action.nonce };
    case 'select':
      return state && { ...state, sourceIndex: action.sourceIndex, nonce: action.nonce };
    case 'refocus':
      return state && { ...state, nonce: action.nonce };
    case 'close':
      return null;
  }
}

export interface ResolvedEvidence {
  messageId: string;
  sources: readonly EvidenceSource[];
  /** Position of the picked source in `sources`. */
  position: number;
  source: EvidenceSource;
  nonce: number;
}

const isAnswer = (message: ChatMessage): message is AssistantMessage => message.role === 'assistant';

/**
 * The pick against the current conversation. It is null when the answer is gone (cleared, retried,
 * mode switched) or no longer has that source, so the inspector never shows something stale.
 */
export function resolveEvidence(pick: EvidencePick | null, messages: readonly ChatMessage[]): ResolvedEvidence | null {
  if (!pick) return null;
  const message = messages.find((candidate) => candidate.id === pick.messageId);
  if (!message || !isAnswer(message) || message.answerStatus === 'not_found') return null;
  const position = message.sources.findIndex((source) => source.index === pick.sourceIndex);
  const source = message.sources[position];
  return source ? { messageId: pick.messageId, sources: message.sources, position, source, nonce: pick.nonce } : null;
}

/** The source reached by moving `delta` steps, wrapping around at both ends. Null when there is nowhere to go. */
export function stepTarget(evidence: ResolvedEvidence, delta: 1 | -1): EvidenceSource | null {
  const count = evidence.sources.length;
  if (count < 2) return null;
  return evidence.sources[(evidence.position + delta + count) % count] ?? null;
}

/**
 * What the PDF viewer should do for a source. Null when there is nothing to show in this document:
 * a DOCX source has no page, and a source of another document cannot be shown in this one.
 */
export function sourceJump(source: EvidenceSource | null, nonce: number, documentId: string): JumpRequest | null {
  if (!source || source.page === null || source.documentId !== documentId) return null;
  return { page: source.page, quote: source.quote, highlights: source.highlights, nonce };
}

export function jumpFor(evidence: ResolvedEvidence | null, documentId: string): JumpRequest | null {
  return evidence ? sourceJump(evidence.source, evidence.nonce, documentId) : null;
}
