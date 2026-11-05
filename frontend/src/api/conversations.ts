import { NOT_FOUND_REASONS, type AnswerStatus, type ChatMessage, type EvidenceRect, type EvidenceSource, type NotFoundReason } from '@/types/chat';
import { AppError, ERROR_BAD_RESPONSE, deleteResource, getJson, isRecord, networkError, postJson } from './client';
import { SseParser } from './sse';

const bad = () => new AppError({ code: ERROR_BAD_RESPONSE, message: 'Unexpected response from the backend' });

function toRect(value: unknown): EvidenceRect | null {
  if (!isRecord(value)) return null;
  const { x, y, w, h } = value;
  return typeof x === 'number' && typeof y === 'number' && typeof w === 'number' && typeof h === 'number'
    ? { x, y, w, h }
    : null;
}

export function toSource(value: unknown): EvidenceSource {
  if (
    !isRecord(value) ||
    typeof value.index !== 'number' ||
    typeof value.documentId !== 'string' ||
    typeof value.documentName !== 'string' ||
    typeof value.quote !== 'string'
  ) {
    throw bad();
  }
  const highlights = Array.isArray(value.highlights)
    ? value.highlights.map(toRect).filter((rect): rect is EvidenceRect => rect !== null)
    : [];
  return {
    index: value.index,
    documentId: value.documentId,
    documentName: value.documentName,
    page: typeof value.page === 'number' ? value.page : null,
    location: typeof value.location === 'string' ? value.location : null,
    quote: value.quote,
    ...(highlights.length ? { highlights } : {}),
    ...(typeof value.paragraph === 'number' ? { paragraph: value.paragraph } : {}),
  };
}

const toAnswerStatus = (value: unknown): AnswerStatus | null =>
  value === 'answered' || value === 'not_found' ? value : null;

const toReason = (value: unknown): NotFoundReason | undefined => NOT_FOUND_REASONS.find((reason) => reason === value);

export async function createConversation(documentIds: string[], title: string): Promise<string> {
  const response = await postJson('/conversations', { documentIds, title });
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.id !== 'string') throw bad();
  return body.id;
}

export function deleteConversation(id: string): Promise<void> {
  return deleteResource(`/conversations/${encodeURIComponent(id)}`);
}

export async function listMessages(id: string, signal?: AbortSignal): Promise<ChatMessage[]> {
  const body = await getJson(`/conversations/${encodeURIComponent(id)}/messages`, signal);
  if (!isRecord(body) || !Array.isArray(body.items)) throw bad();
  let question = '';
  const items = body.items.map((item: unknown): ChatMessage => {
    if (!isRecord(item) || typeof item.id !== 'string') throw bad();
    const content = typeof item.content === 'string' ? item.content : '';
    if (item.role === 'user') {
      question = content;
      return { id: item.id, role: 'user', text: content };
    }
    const answerStatus = toAnswerStatus(item.answerStatus);
    return {
      id: item.id,
      role: 'assistant',
      question,
      mode: 'live',
      // The contract requires hiding the text of a not_found reply.
      text: answerStatus === 'not_found' ? '' : content,
      sources: answerStatus === 'answered' && Array.isArray(item.sources) ? item.sources.map(toSource) : [],
      status: 'done',
      answerStatus,
    };
  });
  return tidyHistory(items);
}

/**
 * The backend saves a question before answering it, and saves no reply after a provider error or a stop.
 * So a retried question is stored twice and an unanswered one has no reply. The reader sees each question
 * once, and one without a reply can be asked again.
 */
export function tidyHistory(items: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const closeUnanswered = () => {
    const last = result.at(-1);
    if (last?.role !== 'user') return;
    result.push({ id: `${last.id}:unanswered`, role: 'assistant', question: last.text, mode: 'live', text: '', sources: [], status: 'stopped', answerStatus: null });
  };
  for (const item of items) {
    const last = result.at(-1);
    if (item.role === 'user') {
      if (last?.role === 'user' && last.text === item.text) result.pop();
      else closeUnanswered();
    }
    result.push(item);
  }
  closeUnanswered();
  return result;
}

export type StreamEvent =
  | { type: 'start'; messageId: string }
  | { type: 'token'; text: string }
  | { type: 'sources'; sources: EvidenceSource[] }
  | { type: 'done'; answerStatus: AnswerStatus; reason?: NotFoundReason };

function parseEvent(event: string, raw: string): StreamEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw bad();
  }
  if (!isRecord(data)) throw bad();
  switch (event) {
    case 'start':
      return { type: 'start', messageId: String(data.messageId ?? '') };
    case 'token':
      return { type: 'token', text: typeof data.text === 'string' ? data.text : '' };
    case 'sources':
      if (!Array.isArray(data.sources)) throw bad();
      return { type: 'sources', sources: data.sources.map(toSource) };
    case 'done': {
      const answerStatus = toAnswerStatus(data.answerStatus);
      if (!answerStatus) throw bad();
      return { type: 'done', answerStatus, reason: toReason(data.reason) };
    }
    case 'error':
      throw new AppError({
        code: typeof data.code === 'string' ? data.code : 'UNKNOWN',
        message: typeof data.message === 'string' ? data.message : '',
        retryable: data.retryable === true,
        requestId: typeof data.requestId === 'string' ? data.requestId : null,
      });
    default:
      return null; // Unknown events are skipped so the contract can grow.
  }
}

/** Reads the answer stream with fetch. Aborting the signal closes the connection and stops generation. */
export async function* sendMessage(id: string, content: string, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const response = await postJson(`/conversations/${encodeURIComponent(id)}/messages`, { content }, signal);
  if (!response.body) throw bad();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new SseParser();
  let finished = false;
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<string>;
      try {
        chunk = await reader.read();
      } catch (cause) {
        if (signal.aborted) throw cause;
        throw networkError();
      }
      if (chunk.done) break;
      for (const message of parser.push(chunk.value)) {
        const event = parseEvent(message.event, message.data);
        if (!event) continue;
        yield event;
        if (event.type === 'done') finished = true;
      }
    }
  } finally {
    reader.cancel().catch(() => undefined); // Already closed is fine.
  }
  if (!finished && !signal.aborted) {
    throw new AppError({ code: 'STREAM_INTERRUPTED', message: 'The answer stream ended early', retryable: true });
  }
}
