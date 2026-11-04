import { readStored, removeStored, writeStored } from '@/lib/storage';
import type { ChatMessage } from '@/types/chat';

const keyFor = (documentId: string) => `docmind.chat.demo.v2.${documentId}`;

/** Conversations last for the browser session. Demo results are not worth keeping longer. */
export function loadConversation(documentId: string): ChatMessage[] {
  const messages = readStored<ChatMessage[]>('session', keyFor(documentId), []);
  // A reload can interrupt a pending answer. It must not come back as a spinner forever.
  return messages.map((message) =>
    message.role === 'assistant' && message.status === 'pending' ? { ...message, status: 'stopped' } : message,
  );
}

export function saveConversation(documentId: string, messages: ChatMessage[]): void {
  writeStored('session', keyFor(documentId), messages);
}

export function clearConversation(documentId: string): void {
  removeStored('session', keyFor(documentId));
}
