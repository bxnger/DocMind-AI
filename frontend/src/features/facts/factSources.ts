import type { DocumentFact, TextBlock } from '@/api/documents';
import type { AssistantMessage, EvidenceSource } from '@/types/chat';

/**
 * A fact in the shape Evidence Jump reads. The server gives a DOCX fact no block index, and its quote can run
 * across blocks (a heading with its paragraph, or table rows). So its block is one that contains the quote, or
 * a part of the quote that holds the fact's value. Without a page or such a block, it stays a quote.
 */
export function factSource(fact: DocumentFact, documentId: string, documentName: string, blocks: readonly TextBlock[] | undefined): EvidenceSource {
  const paragraph = fact.page === null
    ? (blocks?.find((block) => block.text.includes(fact.quote)) ?? blocks?.find((block) => block.text.includes(fact.value) && fact.quote.includes(block.text)))?.index
    : undefined;
  return {
    index: 1,
    documentId,
    documentName,
    page: fact.page,
    location: fact.location,
    quote: fact.quote,
    ...(fact.highlights.length ? { highlights: fact.highlights } : {}),
    ...(paragraph === undefined ? {} : { paragraph }),
  };
}

export const canOpenFact = (source: EvidenceSource): boolean => source.page !== null || source.paragraph !== undefined;

/** Never enters the chat: it only gives the inspector something to read. */
export function factMessage(source: EvidenceSource): AssistantMessage {
  return {
    id: `facts:${source.page ?? source.paragraph ?? ''}:${source.quote}`,
    role: 'assistant',
    question: '',
    mode: 'demo',
    text: '',
    status: 'done',
    answerStatus: 'answered',
    sources: [source],
  };
}
