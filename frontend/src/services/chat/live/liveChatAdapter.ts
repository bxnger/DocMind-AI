import { AppError } from '@/api/client';
import { createConversation, deleteConversation, listMessages, sendMessage } from '@/api/conversations';
import { readStored, writeStored } from '@/lib/storage';
import type { ChatAdapter } from '../types';

const KEY = 'docmind.conversations';

const readMap = () => readStored<Record<string, string>>('local', KEY, {});

function remember(documentId: string, conversationId: string | null) {
  const map = readMap();
  if (conversationId) map[documentId] = conversationId;
  else delete map[documentId];
  writeStored('local', KEY, map);
}

const isMissing = (error: unknown) => error instanceof AppError && error.code === 'CONVERSATION_NOT_FOUND';

/** The backend keeps conversations when a document is deleted, so this removes them explicitly. */
export async function deleteLiveConversation(documentId: string): Promise<void> {
  const id = readMap()[documentId];
  if (!id) return;
  try {
    await deleteConversation(id);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  remember(documentId, null);
}

/** Real answers from the backend: conversations plus the SSE stream from docs/api-contract.md. */
export function createLiveChatAdapter(documentId: string, documentName: string): ChatAdapter {
  const ensureConversation = async () => {
    const known = readMap()[documentId];
    if (known) return known;
    const created = await createConversation([documentId], documentName);
    remember(documentId, created);
    return created;
  };

  return {
    mode: 'live',
    async history(signal) {
      const id = readMap()[documentId];
      if (!id) return [];
      try {
        return await listMessages(id, signal);
      } catch (error) {
        if (!isMissing(error)) throw error;
        remember(documentId, null);
        return [];
      }
    },
    clear: () => deleteLiveConversation(documentId),
    async *stream(request, signal) {
      let id = await ensureConversation();
      let events = sendMessage(id, request.question, signal);
      let first = await events.next().catch(async (error: unknown) => {
        if (!isMissing(error)) throw error;
        // The stored conversation is gone, for example after a backend reset. Start a new one.
        remember(documentId, null);
        id = await ensureConversation();
        events = sendMessage(id, request.question, signal);
        return events.next();
      });
      while (!first.done) {
        const event = first.value;
        if (event.type === 'token') yield { type: 'delta', text: event.text };
        else if (event.type === 'sources') yield { type: 'sources', sources: event.sources };
        else if (event.type === 'done') yield { type: 'done', answerStatus: event.answerStatus };
        first = await events.next();
      }
    },
  };
}
