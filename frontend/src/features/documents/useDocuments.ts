import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { deleteDocument, getDocument, listDocuments } from '@/api/documents';
import { AppError } from '@/api/client';
import { deleteLiveConversation } from '@/services/chat/live/liveChatAdapter';
import { deleteLocalFile } from '@/services/localFiles';
import { forgetRecent } from '@/services/recents';
import { clearConversation } from '@/features/chat/conversationStore';
import { isSampleDocument, sampleDocument } from '@/services/sampleDocument';
import type { DocumentModel } from '@/types/document';

export const DOCUMENTS_KEY = ['documents'] as const;

const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 30_000;
/** A document queued for longer than this is flagged in the UI, and polled less often. */
export const STALE_PROCESSING_MS = 2 * 60_000;

export function isStaleProcessing(doc: DocumentModel, now = Date.now()): boolean {
  return doc.status === 'processing' && now - new Date(doc.createdAt).getTime() > STALE_PROCESSING_MS;
}

/** Polls only while something is processing, and backs off once it looks stuck. */
function pollInterval(docs: DocumentModel[] | undefined): number | false {
  const processing = docs?.filter((doc) => doc.status === 'processing') ?? [];
  if (processing.length === 0) return false;
  return processing.every((doc) => isStaleProcessing(doc)) ? SLOW_POLL_MS : FAST_POLL_MS;
}

export function useDocuments() {
  return useQuery({
    queryKey: DOCUMENTS_KEY,
    queryFn: ({ signal }) => listDocuments(signal),
    refetchInterval: (query) => pollInterval(query.state.data),
  });
}

export function useDocument(id: string) {
  const { i18n } = useTranslation();
  return useQuery({
    // The sample is a different file in each interface language.
    queryKey: isSampleDocument(id) ? [...DOCUMENTS_KEY, id, i18n.language] : [...DOCUMENTS_KEY, id],
    queryFn: ({ signal }) => (isSampleDocument(id) ? sampleDocument(i18n.language) : getDocument(id, signal)),
    refetchInterval: (query) => pollInterval(query.state.data ? [query.state.data] : undefined),
    retry: (count, error) => !(error instanceof AppError && error.status === 404) && count < 1,
  });
}

export function useDeleteDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // The backend keeps a deleted document's conversations, so they are removed first.
      await deleteLiveConversation(id).catch((error: unknown) => console.warn('Could not delete the conversation', error));
      await deleteDocument(id);
    },
    onSuccess: async (_result, id) => {
      forgetRecent(id);
      clearConversation(id);
      client.removeQueries({ queryKey: [...DOCUMENTS_KEY, id] });
      await client.invalidateQueries({ queryKey: DOCUMENTS_KEY, exact: true });
      // The server copy is gone either way, so a leftover browser copy must not fail the delete.
      await deleteLocalFile(id).catch((error: unknown) => console.warn('Could not remove the browser copy', error));
    },
  });
}
