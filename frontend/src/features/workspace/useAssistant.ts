import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AssistantAvailability } from '@/features/chat/AssistantPanel';
import type { PdfState } from '@/features/viewer/usePdfDocument';
import { usePdfText } from '@/features/viewer/usePdfText';
import {
  createDemoChatAdapter,
  createLiveChatAdapter,
  frequentTerms,
  hasSearchableText,
} from '@/services/chat';
import { SAMPLE_QUESTION_KEYS, isSampleDocument } from '@/services/sampleDocument';
import i18n, { LANGUAGES } from '@/i18n';
import type { ChatMode } from '@/types/chat';
import type { DocumentModel } from '@/types/document';
import type { DocumentSource } from './useDocumentSource';

/**
 * The sample is in English and demo search matches words, so the app's own translated questions
 * search with their English original. Anything the user types is searched as written.
 */
function sampleAliases(): Map<string, string> {
  return new Map(
    SAMPLE_QUESTION_KEYS.flatMap((key) =>
      LANGUAGES.map((language): [string, string] => [i18n.t(`home.sample.${key}`, { lng: language.code }), i18n.t(`home.sample.${key}`, { lng: 'en' })]),
    ),
  );
}

/** Chooses the adapter: real AI through the backend, or the separate demo search. */
export function useAssistant(doc: DocumentModel, source: DocumentSource, pdf: PdfState, requestedMode: ChatMode) {
  const { t, i18n: translator } = useTranslation();
  // The sample is not on the backend, so real AI cannot answer about it.
  const mode: ChatMode = isSampleDocument(doc.id) ? 'demo' : requestedMode;

  const textQuery = usePdfText(doc.id, pdf);
  const text = textQuery.data;

  const liveReady = mode === 'live' && doc.status === 'ready';
  // Kept apart on purpose: a changed adapter reloads the conversation and cancels an answer in progress.
  // Real answers do not depend on the PDF's text, so finishing to read it must not touch them.
  const liveAdapter = useMemo(() => (liveReady ? createLiveChatAdapter(doc.id, doc.name) : null), [doc.id, doc.name, liveReady]);
  const demoAdapter = useMemo(
    () => (mode === 'demo' && text && hasSearchableText(text) ? createDemoChatAdapter(doc.id, text, isSampleDocument(doc.id) ? sampleAliases() : undefined) : null),
    [doc.id, mode, text],
  );
  const adapter = mode === 'live' ? liveAdapter : demoAdapter;

  const availability = useMemo<AssistantAvailability>(() => {
    if (doc.status === 'failed') return { state: 'unavailable', reason: 'failed' };
    if (mode === 'live') {
      if (doc.status === 'processing') return { state: 'preparing', reason: 'processing' };
      return {
        state: 'ready',
        suggestions: [t('chat.suggestAbout'), t('chat.suggestDates'), t('chat.suggestRequirements')],
        suggestionLang: translator.language,
      };
    }
    if (source.kind === 'unavailable') return { state: 'unavailable', reason: source.reason === 'docx' ? 'docx' : 'no-file' };
    if (pdf.status === 'error' || textQuery.isError) return { state: 'unavailable', reason: 'pdf-error' };
    if (!text) return { state: 'preparing', reason: 'text' };
    if (!adapter) return { state: 'unavailable', reason: 'no-text' };
    return isSampleDocument(doc.id)
      ? { state: 'ready', suggestions: SAMPLE_QUESTION_KEYS.map((key) => t(`home.sample.${key}`)), suggestionLang: translator.language }
      : { state: 'ready', suggestions: frequentTerms(text).map((term) => t('chat.suggestWhere', { term })), suggestionLang: translator.language };
  }, [adapter, doc.id, doc.status, translator.language, mode, pdf.status, source, t, text, textQuery.isError]);

  return { text, adapter, availability, mode };
}
