import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getJson, deleteResource, getPublicJson, postJson, send } from './client';
import { queryRetryDelay, shouldRetryQuery } from './retry';
import { endSession, getSessionToken, invalidateSession, onSessionReplaced, resetSessionState, SESSION_KEY, setSessionCleaner } from './session';
import { AppError, parseRetryAfter } from './transport';
import { pdfUrlSource, isUnauthorized } from '@/features/viewer/pdfSource';
import { uploadDocument } from './documents';
import { sendMessage } from './conversations';
import { getCapabilities } from './system';

type Call = { url: string; method: string; auth: string | null };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const apiError = (status: number, code: string, retryable = false, headers = {}) =>
  json(status, { error: { code, message: 'server text', retryable, requestId: 'r' } }, headers);

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

let calls: Call[];
let storage: ReturnType<typeof fakeStorage>;
let handler: (call: Call) => Response | Promise<Response>;
let issued: number;
let valid: Set<string>;

function server(call: Call): Response {
  if (call.url.endsWith('/sessions')) {
    issued += 1;
    valid.add(`token-${issued}`);
    return json(201, { token: `token-${issued}`, expiresAt: '2030-01-01T00:00:00+00:00' });
  }
  if (!call.auth || !valid.has(call.auth.replace('Bearer ', ''))) return apiError(401, 'SESSION_EXPIRED');
  return json(200, { ok: true, as: call.auth });
}

beforeEach(() => {
  calls = [];
  issued = 0;
  valid = new Set();
  storage = fakeStorage();
  handler = server;
  resetSessionState();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const call = { url, method: init.method ?? 'GET', auth: new Headers(init.headers).get('Authorization') };
    calls.push(call);
    return handler(call);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const posts = () => calls.filter((call) => call.url.endsWith('/sessions')).length;

describe('getting a session', () => {
  it('creates one on the first request and sends it', async () => {
    await getJson('/documents');
    expect(posts()).toBe(1);
    expect(calls[1]).toMatchObject({ auth: 'Bearer token-1' });
    expect(calls[0]?.auth).toBeNull();
  });
  it('keeps the token across reloads', async () => {
    await getJson('/documents');
    expect(JSON.parse(storage.values.get(SESSION_KEY) ?? '{}').token).toBe('token-1');
    resetSessionState(); // what a reload does to this module
    await getJson('/documents');
    expect(posts()).toBe(1);
  });
  it('creates a single session for parallel requests', async () => {
    await Promise.all([getJson('/a'), getJson('/b'), getJson('/c'), getSessionToken(), postJson('/d', {})]);
    expect(posts()).toBe(1);
    expect(calls.filter((call) => !call.url.endsWith('/sessions')).every((call) => call.auth === 'Bearer token-1')).toBe(true);
  });
  it('uses the lock, so tabs share one session', async () => {
    const request = vi.fn((_name: string, work: () => Promise<string>) => work());
    vi.stubGlobal('navigator', { locks: { request } });
    await getSessionToken();
    expect(request).toHaveBeenCalledOnce();
  });
  it('adopts a session another tab made while waiting for the lock', async () => {
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, work: () => Promise<string>) => {
          storage.setItem(SESSION_KEY, JSON.stringify({ token: 'from-other-tab' }));
          return work();
        },
      },
    });
    expect(await getSessionToken()).toBe('from-other-tab');
    expect(posts()).toBe(0);
  });
  it('works when storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    await Promise.all([getJson('/a'), getJson('/b')]);
    await getJson('/c');
    expect(posts()).toBe(1);
  });
  it('a failed creation is reported and tried again next time', async () => {
    handler = () => Promise.reject(new TypeError('offline'));
    await expect(getJson('/a')).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    handler = server;
    await expect(getJson('/a')).resolves.toMatchObject({ as: 'Bearer token-1' });
    expect(posts()).toBe(2); // the failed attempt and the one that worked
  });
  it('a refused creation carries its Retry-After', async () => {
    handler = () => apiError(429, 'RATE_LIMITED', true, { 'Retry-After': '7' });
    await expect(getJson('/a')).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfter: 7 });
  });
  it('an unusable stored value counts as none', async () => {
    storage.setItem(SESSION_KEY, '{broken');
    await getJson('/a');
    expect(calls[1]?.auth).toBe('Bearer token-1');
  });
  it('public routes need no session', async () => {
    handler = () => json(200, { status: 'ok' });
    await getPublicJson('/health');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.auth).toBeNull();
  });
});

describe('the token never leaves the header', () => {
  it('is in no URL', async () => {
    await getJson('/documents');
    await postJson('/conversations', { documentIds: [] });
    await deleteResource('/documents/x');
    expect(calls.some((call) => call.url.includes('token-1'))).toBe(false);
  });
  it('is not logged', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')];
    await getJson('/documents');
    handler = () => apiError(401, 'SESSION_EXPIRED');
    await getJson('/documents').catch(() => undefined);
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain('token-');
      spy.mockRestore();
    }
  });
});

describe('a session the server refuses', () => {
  it('replaces it and repeats a read once', async () => {
    await getSessionToken();
    valid.clear();
    const replaced = vi.fn();
    onSessionReplaced(replaced);
    await expect(getJson('/documents')).resolves.toMatchObject({ as: 'Bearer token-2' });
    expect(replaced).toHaveBeenCalledOnce();
    expect(posts()).toBe(2);
  });
  it.each([
    ['chat', () => postJson('/conversations/c/messages', { content: 'q' })],
    ['delete', () => deleteResource('/documents/d')],
  ])('never repeats %s by itself', async (_name, action) => {
    await getSessionToken();
    valid.clear();
    await expect(action()).rejects.toMatchObject({ code: 'SESSION_EXPIRED', retryable: false, status: 401 });
    expect(calls.filter((call) => call.method !== 'GET' && !call.url.endsWith('/sessions'))).toHaveLength(1);
  });
  it('parallel 401s replace it once', async () => {
    await getSessionToken();
    valid.clear();
    const replaced = vi.fn();
    onSessionReplaced(replaced);
    await Promise.all([getJson('/a'), getJson('/b'), getJson('/c')]);
    expect(replaced).toHaveBeenCalledOnce();
    expect(posts()).toBe(2);
  });
  it('does not loop when the new session is refused too', async () => {
    await getSessionToken();
    handler = (call) => (call.url.endsWith('/sessions') ? server(call) : apiError(401, 'UNAUTHORIZED'));
    await expect(getJson('/a')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(calls.filter((call) => call.url.endsWith('/a'))).toHaveLength(2);
  });
  it('a late report about an old token changes nothing', async () => {
    const old = await getSessionToken();
    invalidateSession(old);
    const next = await getSessionToken();
    const replaced = vi.fn();
    onSessionReplaced(replaced);
    invalidateSession(old);
    expect(replaced).not.toHaveBeenCalled();
    expect(await getSessionToken()).toBe(next);
  });
  it('clears the old guest data before the new session exists', async () => {
    const order: string[] = [];
    await getSessionToken();
    setSessionCleaner((shared) => void order.push(`clean:${shared}`));
    handler = (call) => {
      order.push(call.url.endsWith('/sessions') ? 'create' : 'request');
      return server(call);
    };
    invalidateSession('token-1');
    await getSessionToken();
    expect(order).toEqual(['clean:true', 'create']);
  });
  it('does not clear a working session on reload', async () => {
    await getSessionToken();
    resetSessionState();
    const clean = vi.fn();
    setSessionCleaner(clean);
    await getJson('/a');
    expect(clean).not.toHaveBeenCalled();
  });
});

describe('errors', () => {
  it.each([
    [403, 'DEMO_READ_ONLY', false], [404, 'DOCUMENT_NOT_FOUND', false], [429, 'QUOTA_EXCEEDED', false],
    [429, 'AI_SESSION_BUDGET_EXCEEDED', false], [429, 'AI_BUDGET_EXCEEDED', false], [429, 'RATE_LIMITED', true], [503, 'STORAGE_FULL', true],
  ])('%i %s keeps retryable=%s from the server', async (status, code, retryable) => {
    await getSessionToken();
    handler = () => apiError(status, code, retryable);
    await expect(send('/x')).rejects.toMatchObject({ status, code, retryable });
  });
  it('the server can say a 5xx is not worth retrying', async () => {
    await getSessionToken();
    handler = () => apiError(503, 'X', false);
    await expect(send('/x')).rejects.toMatchObject({ retryable: false });
  });
  it('an error without a body falls back on the status', async () => {
    await getSessionToken();
    handler = () => new Response('<html>', { status: 502 });
    await expect(send('/x')).rejects.toMatchObject({ code: 'HTTP_502', retryable: true });
  });
  it('reads Retry-After', () => {
    expect(parseRetryAfter('12')).toBe(12);
    expect(parseRetryAfter('Wed, 21 Oct 2026')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
  it('a chat refused before the stream is plain JSON, not SSE', async () => {
    await getSessionToken();
    handler = () => apiError(429, 'AI_SESSION_BUDGET_EXCEEDED', false, { 'Retry-After': '3600' });
    await expect(sendMessage('c', 'q', new AbortController().signal).next()).rejects.toMatchObject({ code: 'AI_SESSION_BUDGET_EXCEEDED', retryable: false, retryAfter: 3600 });
  });
  it('an error inside the stream keeps its fields', async () => {
    await getSessionToken();
    handler = () => new Response('event: start\ndata: {"messageId":"m"}\n\nevent: error\ndata: {"code":"LLM_TIMEOUT","message":"x","retryable":true}\n\n', { status: 200 });
    const stream = sendMessage('c', 'q', new AbortController().signal);
    await stream.next();
    await expect(stream.next()).rejects.toMatchObject({ code: 'LLM_TIMEOUT', retryable: true });
  });
});

describe('automatic retries of reading', () => {
  const error = (retryable: boolean, retryAfter: number | null = null) => new AppError({ code: 'X', message: '', retryable, retryAfter });
  it('follow the server', () => {
    expect(shouldRetryQuery(0, error(true))).toBe(true);
    expect(shouldRetryQuery(0, error(false))).toBe(false);
    expect(shouldRetryQuery(1, error(true))).toBe(false);
    expect(shouldRetryQuery(0, new Error('x'))).toBe(false);
  });
  it('wait as long as asked, and leave a long wait to the person', () => {
    expect(queryRetryDelay(0, error(true, 5))).toBe(5000);
    expect(shouldRetryQuery(0, error(true, 600))).toBe(false);
  });
});

describe('PDF.js', () => {
  it('gets the token as a header, and not in the URL', () => {
    const source = pdfUrlSource('https://api/documents/d/file', 'secret');
    expect(source.httpHeaders).toEqual({ Authorization: 'Bearer secret' });
    expect(source.url).not.toContain('secret');
  });
  it('the bundled sample gets none', () => {
    expect(pdfUrlSource('/demo/sample.pdf', null)).toEqual({ url: '/demo/sample.pdf' });
  });
  it('recognizes a refused session', () => {
    expect(isUnauthorized(Object.assign(new Error('x'), { status: 401 }))).toBe(true);
    expect(isUnauthorized(Object.assign(new Error('x'), { status: 404 }))).toBe(false);
    expect(isUnauthorized(new Error('x'))).toBe(false);
  });
});

describe('upload', () => {
  class FakeXhr {
    static last: FakeXhr;
    static status = 202;
    static body: unknown = { id: 'd', name: 'a.pdf', kind: 'pdf', sizeBytes: 1, status: 'processing', createdAt: 'now', isDemo: false };
    headers: Record<string, string> = {};
    url = '';
    upload = {};
    status = 0;
    responseText = '';
    responseType = '';
    timeout = 0;
    onload?: () => void;
    open(_method: string, url: string) { this.url = url; FakeXhr.last = this; }
    setRequestHeader(name: string, value: string) { this.headers[name] = value; }
    getResponseHeader() { return '9'; }
    abort() {}
    send() {
      this.status = FakeXhr.status;
      this.responseText = JSON.stringify(FakeXhr.body);
      this.onload?.();
    }
  }
  const go = () => uploadDocument(new Blob(['x']) as File, { onProgress: () => undefined, signal: new AbortController().signal });
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal('FormData', class { append() {} });
    FakeXhr.status = 202;
  });
  it('sends the token as a header', async () => {
    await go();
    expect(FakeXhr.last.headers.Authorization).toBe('Bearer token-1');
    expect(FakeXhr.last.url).not.toContain('token-1');
  });
  it('a 401 replaces the session and does not upload again', async () => {
    FakeXhr.status = 401;
    FakeXhr.body = { error: { code: 'SESSION_EXPIRED', message: 'x', retryable: false } };
    const replaced = vi.fn();
    onSessionReplaced(replaced);
    await expect(go()).rejects.toMatchObject({ code: 'SESSION_EXPIRED', retryable: false });
    expect(replaced).toHaveBeenCalledOnce();
  });
  it('a quota refusal says so', async () => {
    FakeXhr.status = 429;
    FakeXhr.body = { error: { code: 'QUOTA_EXCEEDED', message: 'x', retryable: false } };
    await expect(go()).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', retryable: false, retryAfter: 9 });
  });
});

describe('capabilities', () => {
  const body = { version: '1', limits: { maxFileSizeBytes: 1, maxPages: 1, maxDocumentsPerConversation: 1 } };
  it('reads the flags from features, as the contract has them', async () => {
    handler = () => json(200, { ...body, procurement: true, features: { parts: true, photoIdentify: false, priceLists: true, procurement: true, hr: true, claimCheck: false }, limits: { ...body.limits, maxImageBytes: 8 } });
    const capabilities = await getCapabilities();
    expect(capabilities.features).toEqual({ parts: true, photoIdentify: false, priceLists: true, procurement: true, hr: true, claimCheck: false, priceCheck: false });
    expect(capabilities.limits.maxImageBytes).toBe(8);
  });
  it('a flag outside features turns nothing on', async () => {
    handler = () => json(200, { ...body, procurement: true, hr: true });
    const { features } = await getCapabilities();
    expect(features.procurement).toBe(false);
    expect(features.hr).toBe(false);
  });
});

describe('endSession', () => {
  it('asks the server to delete the guest, then forgets the token and the copies', async () => {
    await getJson('/documents');
    const cleaned: boolean[] = [];
    setSessionCleaner((shared) => void cleaned.push(shared));
    handler = (call) => (call.method === 'DELETE' && call.url.endsWith('/sessions/current') ? new Response(null, { status: 204 }) : server(call));
    await endSession();
    const del = calls.find((call) => call.method === 'DELETE');
    expect(del?.auth).toBe('Bearer token-1');
    expect(storage.values.has(SESSION_KEY)).toBe(false);
    expect(cleaned).toEqual([true]);
    setSessionCleaner(() => undefined);
    await getJson('/documents');
    expect(calls.at(-1)?.auth).toBe('Bearer token-2');
  });

  it('keeps everything when the server cannot confirm', async () => {
    await getJson('/documents');
    handler = (call) => (call.method === 'DELETE' ? apiError(503, 'UNAVAILABLE', true) : server(call));
    await expect(endSession()).rejects.toBeInstanceOf(AppError);
    expect(storage.values.has(SESSION_KEY)).toBe(true);
  });
});
