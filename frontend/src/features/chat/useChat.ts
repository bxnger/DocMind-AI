import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppError } from '@/api/client';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import type { ChatAdapter } from '@/services/chat';
import type { AssistantMessage, ChatMessage } from '@/types/chat';

const newId = () => crypto.randomUUID();

export interface ChatController {
  messages: ChatMessage[];
  pending: boolean;
  historyState: 'loading' | 'ready' | 'error';
  reloadHistory: () => void;
  citedPages: ReadonlySet<number>;
  send: (question: string) => void;
  retry: (assistantId: string) => void;
  stop: () => void;
  clear: () => void;
}

interface Loaded {
  owner: ChatAdapter;
  state: 'ready' | 'error';
  messages: ChatMessage[];
}

export function useChat(documentId: string, documentName: string, adapter: ChatAdapter | null): ChatController {
  const { i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const current = adapter && loaded?.owner === adapter ? loaded : null;
  const messages = useMemo(() => current?.messages ?? [], [current]);

  // Each adapter has its own conversation: real AI answers and demo results never mix.
  useEffect(() => {
    if (!adapter) return;
    const controller = new AbortController();
    adapter
      .history(controller.signal)
      .then((history) => setLoaded({ owner: adapter, state: 'ready', messages: history }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Could not load the conversation', error);
        setLoaded({ owner: adapter, state: 'error', messages: [] });
      });
    return () => {
      controller.abort();
      controllerRef.current?.abort();
    };
  }, [adapter, reload]);

  useEffect(() => {
    if (current?.state === 'ready') current.owner.persist?.(current.messages);
  }, [current]);

  const update = useCallback((change: (messages: ChatMessage[]) => ChatMessage[]) => {
    setLoaded((state) => (state ? { ...state, messages: change(state.messages) } : state));
  }, []);

  const patch = useCallback(
    (id: string, change: Partial<AssistantMessage>) => {
      update((list) =>
        list.map((message) => (message.id === id && message.role === 'assistant' ? { ...message, ...change } : message)),
      );
    },
    [update],
  );

  const run = useCallback(
    async (id: string, question: string) => {
      if (!adapter) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      setPending(true);
      let text = '';
      try {
        const events = adapter.stream({ question, documentId, documentName, language: i18n.language }, controller.signal);
        for await (const event of events) {
          if (controller.signal.aborted) break;
          if (event.type === 'delta') {
            text += event.text;
            patch(id, { text });
          } else if (event.type === 'sources') {
            patch(id, { sources: event.sources });
          } else if (event.answerStatus === 'not_found') {
            // Tokens may already have arrived. Without a verified citation they must not stay visible.
            patch(id, { status: 'done', answerStatus: 'not_found', text: '', sources: [] });
          } else {
            patch(id, { status: 'done', answerStatus: 'answered' });
          }
        }
        if (controller.signal.aborted) patch(id, { status: 'stopped' });
      } catch (error) {
        if (controller.signal.aborted) {
          patch(id, { status: 'stopped' });
        } else {
          if (!(error instanceof AppError)) console.error('Chat request failed', error);
          // Partial text has no verified sources, so it is not left on screen as an answer.
          patch(id, {
            status: 'error',
            text: '',
            sources: [],
            errorMessage: errorMessage(error),
            errorCode: error instanceof AppError ? error.code : undefined,
            retryable: error instanceof AppError ? error.retryable : true,
          });
        }
      } finally {
        controllerRef.current = null;
        setPending(false);
      }
    },
    [adapter, documentId, documentName, errorMessage, i18n.language, patch],
  );

  const send = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || pending || !adapter) return;
      const answerId = newId();
      update((list) => [
        ...list,
        { id: newId(), role: 'user', text: trimmed },
        { id: answerId, role: 'assistant', question: trimmed, mode: adapter.mode, text: '', sources: [], status: 'pending', answerStatus: null },
      ]);
      void run(answerId, trimmed);
    },
    [adapter, pending, run, update],
  );

  const retry = useCallback(
    (assistantId: string) => {
      if (pending) return;
      const message = messages.find((candidate) => candidate.id === assistantId);
      if (message?.role !== 'assistant') return;
      patch(assistantId, { status: 'pending', text: '', sources: [], answerStatus: null, errorMessage: undefined, errorCode: undefined });
      void run(assistantId, message.question);
    },
    [messages, patch, pending, run],
  );

  const citedPages = useMemo(
    () =>
      new Set(
        messages.flatMap((message) =>
          message.role === 'assistant' ? message.sources.flatMap((source) => (source.page === null ? [] : [source.page])) : [],
        ),
      ),
    [messages],
  );

  return {
    messages,
    pending,
    historyState: !adapter ? 'ready' : (current?.state ?? 'loading'),
    reloadHistory: () => setReload((value) => value + 1),
    citedPages,
    send,
    retry,
    stop: () => controllerRef.current?.abort(),
    clear: () => {
      controllerRef.current?.abort();
      update(() => []);
      adapter?.clear().catch((error: unknown) => {
        console.error('Could not delete the conversation', error);
        setReload((value) => value + 1);
      });
    },
  };
}
