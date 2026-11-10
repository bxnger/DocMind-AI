import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearUserData } from './userData';
import { getRecentsForTest, markOpened } from './recents';

function store(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return new Proxy({}, {
    get: (_t, key: string) => ({ getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) })[key],
    ownKeys: () => [...map.keys()],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  }) as Storage & object;
}

describe('a new guest', () => {
  let local: Storage;
  let session: Storage;
  const clear = vi.fn();
  beforeEach(() => {
    local = store({ 'docmind.conversations': '{"d":"c"}', 'docmind.theme': '"dark"', 'docmind.language': '"kk"', 'docmind.userMode': '"legal"', 'docmind.recents': '[]' });
    session = store({ 'docmind.chat.demo.v2.sample': '[]', other: 'x' });
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    const request = () => {
      const open: { result: unknown; onsuccess?: () => void; onupgradeneeded?: () => void; onerror?: () => void } = { result: null };
      const transaction = { objectStore: () => ({ clear: () => { clear(); return {}; } }), oncomplete: undefined as undefined | (() => void) };
      open.result = { transaction: () => { queueMicrotask(() => transaction.oncomplete?.()); return transaction; }, close: () => undefined };
      queueMicrotask(() => open.onsuccess?.());
      return open;
    };
    vi.stubGlobal('indexedDB', { open: request });
    clear.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('gets no documents, conversations, recents or browser copies of the old one', async () => {
    markOpened('old-document');
    await clearUserData(true);
    expect(local.getItem('docmind.conversations')).toBeNull();
    expect(session.getItem('docmind.chat.demo.v2.sample')).toBeNull();
    expect(getRecentsForTest()).toEqual([]);
    expect(clear).toHaveBeenCalledOnce();
  });
  it('keeps preferences', async () => {
    await clearUserData(true);
    expect(local.getItem('docmind.theme')).toBe('"dark"');
    expect(local.getItem('docmind.language')).toBe('"kk"');
    expect(local.getItem('docmind.userMode')).toBe('"legal"');
  });
  it('another tab clears only what is its own', async () => {
    await clearUserData(false);
    expect(local.getItem('docmind.conversations')).toBe('{"d":"c"}');
    expect(session.getItem('docmind.chat.demo.v2.sample')).toBeNull();
    expect(clear).not.toHaveBeenCalled();
  });
  it('survives having no IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(clearUserData(true)).resolves.toBeUndefined();
  });
});
