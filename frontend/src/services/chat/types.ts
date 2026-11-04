import type { AnswerStatus, ChatMessage, ChatMode, EvidenceSource } from '@/types/chat';

export interface ChatRequest {
  question: string;
  documentId: string;
  documentName: string;
  language: string;
}

/** The UI consumes these events and does not know which adapter produced them. */
export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: EvidenceSource[] }
  | { type: 'done'; answerStatus: AnswerStatus };

export interface ChatAdapter {
  readonly mode: ChatMode;
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
  history(signal: AbortSignal): Promise<ChatMessage[]>;
  /** Only for adapters that keep history on the client. */
  persist?(messages: ChatMessage[]): void;
  clear(): Promise<void>;
}
