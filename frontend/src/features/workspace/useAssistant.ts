import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AssistantAvailability } from '@/features/chat/AssistantPanel';
import type { PdfState } from '@/features/viewer/usePdfDocument';
import {
  createDemoChatAdapter,
  createLiveChatAdapter,
  extractDocumentText,
  frequentTerms,
  hasSearchableText,
} from '@/services/chat';
import { SAMPLE_QUESTIONS, isSampleDocument } from '@/services/sampleDocument';
import type { ChatMode } from '@/types/chat';
import type { DocumentModel } from '@/types/document';
import type { DocumentSource } from './useDocumentSource';

/** Chooses the adapter: real AI through the backend, or the separate demo search. */
export function useAssistant(doc: DocumentModel, source: DocumentSource, pdf: PdfState, requestedMode: ChatMode) {
  const { t, i18n } = useTranslation();
  const proxy = pdf.status === 'ready' ? pdf.pdf : null;
  // The sample is not on the backend, so real AI cannot answer about it.
  const mode: ChatMode = isSampleDocument(doc.id) ? 'demo' : requestedMode;

  const textQuery = useQuery({
    queryKey: ['pdf-text', doc.id, proxy?.fingerprints[0]],
    queryFn: () => {
      if (!proxy) throw new Error('PDF is not loaded');
      return extractDocumentText(proxy);
    },
    enabled: proxy !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const text = textQuery.data;

  const liveReady = mode === 'live' && doc.status === 'ready';
  // Kept apart on purpose: a changed adapter reloads the conversation and cancels an answer in progress.
  // Real answers do not depend on the PDF's text, so finishing to read it must not touch them.
  const liveAdapter = useMemo(() => (liveReady ? createLiveChatAdapter(doc.id, doc.name) : null), [doc.id, doc.name, liveReady]);
  const demoAdapter = useMemo(
    () => (mode === 'demo' && text && hasSearchableText(text) ? createDemoChatAdapter(doc.id, text) : null),
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
        suggestionLang: i18n.language,
      };
    }
    if (source.kind === 'unavailable') return { state: 'unavailable', reason: source.reason === 'docx' ? 'docx' : 'no-file' };
    if (pdf.status === 'error' || textQuery.isError) return { state: 'unavailable', reason: 'pdf-error' };
    if (!text) return { state: 'preparing', reason: 'text' };
    if (!adapter) return { state: 'unavailable', reason: 'no-text' };
    return isSampleDocument(doc.id)
      ? { state: 'ready', suggestions: SAMPLE_QUESTIONS, suggestionLang: 'en' }
      : { state: 'ready', suggestions: frequentTerms(text).map((term) => t('chat.suggestWhere', { term })), suggestionLang: i18n.language };
  }, [adapter, doc.id, doc.status, i18n.language, mode, pdf.status, source, t, text, textQuery.isError]);

  return { text, adapter, availability, mode };
}
