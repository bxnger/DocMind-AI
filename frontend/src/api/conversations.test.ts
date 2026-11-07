import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionState } from './session';
import { RESPONSE_TIMEOUT_MS, send } from './client';
import type { ChatMessage } from '@/types/chat';
import { listMessages, tidyHistory, toSource } from './conversations';
import { toDocument } from './documents';

const base = { index: 2, documentId: 'd', documentName: 'n', quote: 'q' };

describe('toSource', () => {
  it('keeps PDF page and highlights', () => {
    const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.01 };
    expect(toSource({ ...base, page: 4, highlights: [rect] })).toMatchObject({ index: 2, page: 4, location: null, highlights: [rect] });
  });
  it('keeps a null page and the location for DOCX', () => {
    const source = toSource({ ...base, page: null, location: 'Terms' });
    expect(source.page).toBeNull();
    expect(source.location).toBe('Terms');
    expect(source.highlights).toBeUndefined();
  });
  it('rejects the old marker field', () => {
    expect(() => toSource({ marker: 1, documentId: 'd', documentName: 'n', quote: 'q' })).toThrow();
  });
});

describe('history after failed attempts', () => {
  const user = (id: string, text: string): ChatMessage => ({ id, role: 'user', text });
  const answer = (id: string, question: string): ChatMessage => ({ id, role: 'assistant', question, mode: 'live', text: 'a', sources: [], status: 'done', answerStatus: 'answered' });
  it('shows a retried question once', () => {
    const tidy = tidyHistory([user('1', 'q'), user('2', 'q'), user('3', 'q'), answer('4', 'q')]);
    expect(tidy.map((message) => message.id)).toEqual(['3', '4']);
  });
  it('gives an unanswered question a reply that can be retried', () => {
    const tidy = tidyHistory([user('1', 'first'), user('2', 'second'), answer('3', 'second'), user('4', 'last')]);
    expect(tidy.map((message) => message.id)).toEqual(['1', '1:unanswered', '2', '3', '4', '4:unanswered']);
    const last = tidy.at(-1);
    expect(last).toMatchObject({ role: 'assistant', status: 'stopped', question: 'last', text: '' });
  });
  it('leaves a normal conversation alone, including the same question asked again later', () => {
    const list = [user('1', 'q'), answer('2', 'q'), user('3', 'q'), answer('4', 'q')];
    expect(tidyHistory(list)).toEqual(list);
  });
});

describe('waiting for the server', () => {
  beforeEach(() => {
    resetSessionState();
    vi.stubGlobal('navigator', {}); // the hanging server below would hold a real lock for the next test
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const hanging = () => vi.fn((_: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  it('turns a server that never responds into a retryable timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hanging());
    const result = send('/x').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(RESPONSE_TIMEOUT_MS);
    expect(await result).toMatchObject({ code: 'REQUEST_TIMEOUT', retryable: true });
  });
  it('keeps a stop by the user a stop, not an error', async () => {
    vi.stubGlobal('fetch', hanging());
    const controller = new AbortController();
    const result = send('/x', { signal: controller.signal }).catch((error: unknown) => error);
    controller.abort();
    expect((await result as DOMException).name).toBe('AbortError');
  });
  it('reports an unreachable server as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('failed'))));
    await expect(send('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });
});

describe('saved answers', () => {
  it('keep the reason of a not_found', async () => {
    resetSessionState();
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/sessions')
      ? new Response(JSON.stringify({ token: 't', expiresAt: 'x' }), { status: 201 })
      : new Response(JSON.stringify({ items: [{ id: '1', role: 'user', content: 'q' }, { id: '2', role: 'assistant', content: '', answerStatus: 'not_found', reason: 'model_refused' }] }))));
    const [, answer] = await listMessages('c');
    expect(answer).toMatchObject({ notFoundReason: 'model_refused', text: '' });
    vi.unstubAllGlobals();
  });
});

describe('documents from the server', () => {
  const dto = { id: 'd', name: 'n', kind: 'pdf', sizeBytes: 1, status: 'ready', createdAt: 'now' };
  it('reads isDemo strictly', () => {
    expect(toDocument({ ...dto, isDemo: true }).isDemo).toBe(true);
    expect(toDocument({ ...dto, isDemo: 'yes' }).isDemo).toBe(false);
    expect(toDocument(dto).isDemo).toBe(false);
  });
});
