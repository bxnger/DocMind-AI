/** Mirrors `Source` in the backend's docs/api-contract.md. */
export interface EvidenceRect {
  /** Fractions of the page, from 0 to 1. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EvidenceSource {
  /** The [n] marker in the answer. */
  index: number;
  documentId: string;
  documentName: string;
  /** 1-based PDF page. Null for DOCX, which has no pages. */
  page: number | null;
  /** Heading of the section. DOCX only. */
  location: string | null;
  /** Verbatim text from the document. Never paraphrased. */
  quote: string;
  /** Absent when the quote could not be located on the page. */
  highlights?: EvidenceRect[];
}

export type ChatMode = 'demo' | 'live';
export type AnswerStatus = 'answered' | 'not_found';

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  question: string;
  mode: ChatMode;
  text: string;
  sources: EvidenceSource[];
  status: 'pending' | 'done' | 'stopped' | 'error';
  answerStatus: AnswerStatus | null;
  errorMessage?: string;
  errorCode?: string;
  retryable?: boolean;
}

export type ChatMessage = UserMessage | AssistantMessage;
