import i18n from '@/i18n';
import type { EvidenceSource } from '@/types/chat';
import { clearConversation, loadConversation, saveConversation } from '@/features/chat/conversationStore';
import type { ChatAdapter, ChatEvent, ChatRequest } from '../types';
import { retrievePassages } from './retrieval';
import type { DocumentText } from './textIndex';

/**
 * DEMO ONLY. Clearly separated from the real API layer: it makes no network requests and uses no
 * AI model. Quotes and page numbers are read from the PDF in the browser, so they are real, but the
 * answer is a keyword match. Kept for trying the interface without an API key.
 */
export function createDemoChatAdapter(documentId: string, pages: DocumentText, searchAliases?: ReadonlyMap<string, string>): ChatAdapter {
  return {
    mode: 'demo',
    history: async () => loadConversation(documentId),
    persist: (messages) => saveConversation(documentId, messages),
    clear: async () => clearConversation(documentId),
    async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
      const passages = retrievePassages(pages, searchAliases?.get(request.question) ?? request.question);
      if (signal.aborted) return;

      if (passages.length === 0) {
        yield { type: 'done', answerStatus: 'not_found' };
        return;
      }

      const sources: EvidenceSource[] = passages.map((passage, index) => ({
        index: index + 1,
        documentId: request.documentId,
        documentName: request.documentName,
        page: passage.page,
        location: null,
        quote: passage.quote,
      }));
      const markers = sources.map((source) => `[${source.index}]`).join(' ');
      yield {
        type: 'delta',
        text: i18n.t('chat.demoAnswer', { lng: request.language, count: sources.length, markers }),
      };
      yield { type: 'sources', sources };
      yield { type: 'done', answerStatus: 'answered' };
    },
  };
}
