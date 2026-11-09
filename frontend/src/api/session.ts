import { useSyncExternalStore } from 'react';
import { readStored, removeStored, writeStored } from '@/lib/storage';
import { AppError, ERROR_BAD_RESPONSE, errorFromResponse, isRecord, request } from './transport';

/**
 * The guest session. The token goes only into the Authorization header: never a URL, a log or an event.
 * Its expiry is not checked against this computer's clock, which may be wrong: the server's 401 decides.
 */
export const SESSION_KEY = 'docmind.session.v1';
const LOCK_NAME = 'docmind.session';

let current: string | null = null;
let lastSeen: string | null = null;
let creating: Promise<string> | null = null;
let epoch = 0;
let cleaner: (shared: boolean) => Promise<void> | void = () => undefined;
const listeners = new Set<() => void>();
const replacedListeners = new Set<() => void>();

function storedToken(): string | null {
  const stored = readStored<unknown>('local', SESSION_KEY, null);
  return isRecord(stored) && typeof stored.token === 'string' && stored.token ? stored.token : null;
}

function adopt(token: string): string {
  current = token;
  lastSeen = token;
  return token;
}

/** What belongs to a guest but lives in this browser. `shared`: also what other tabs see. */
export function setSessionCleaner(clean: (shared: boolean) => Promise<void> | void): void {
  cleaner = clean;
}

async function createSession(): Promise<string> {
  // Another tab may have finished while this one waited for the lock.
  const stored = storedToken();
  if (stored) return adopt(stored);
  // Nothing kept from an earlier guest may be shown to this one.
  await cleaner(true);
  const response = await request('/sessions', { method: 'POST' });
  if (!response.ok) throw await errorFromResponse(response);
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || typeof body.token !== 'string' || !body.token) {
    throw new AppError({ code: ERROR_BAD_RESPONSE, message: 'Unexpected response from the backend' });
  }
  writeStored('local', SESSION_KEY, { token: body.token, expiresAt: body.expiresAt });
  return adopt(body.token);
}

/** One session however many requests ask at once, in this tab and, where the browser has locks, across tabs. */
export function getSessionToken(): Promise<string> {
  if (current) return Promise.resolve(current);
  const stored = storedToken();
  if (stored) return Promise.resolve(adopt(stored));
  creating ??= (async () => {
    try {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return await (locks ? locks.request(LOCK_NAME, createSession) : createSession());
    } finally {
      creating = null;
    }
  })();
  return creating;
}

/**
 * Ends this guest on purpose: the server deletes the session and everything it owns, then this browser forgets
 * the token and its copies. Throws when the server cannot confirm, so nothing is left behind on it unnoticed.
 */
export async function endSession(): Promise<void> {
  const token = current ?? storedToken();
  if (token) {
    const response = await request('/sessions/current', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    // 401: the server had already forgotten this guest, which is the same outcome.
    if (!response.ok && response.status !== 401) throw await errorFromResponse(response);
  }
  removeStored('local', SESSION_KEY);
  await cleaner(true);
  current = null;
  lastSeen = null;
}

function announceReplaced(): void {
  epoch += 1;
  replacedListeners.forEach((listener) => listener());
  listeners.forEach((listener) => listener());
}

/**
 * The server refused this token. Parallel requests all report the same one, and only the first counts.
 * A token this tab has already moved on from changes nothing.
 */
export function invalidateSession(token: string): void {
  if (storedToken() === token) removeStored('local', SESSION_KEY);
  if (current !== token && lastSeen !== token) return;
  current = null;
  lastSeen = null;
  announceReplaced();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== SESSION_KEY) return;
  const next = storedToken();
  if (next === current) return;
  const previous = lastSeen;
  current = next;
  if (!next) return; // the other tab is getting a new one, and the next event brings it
  lastSeen = next;
  if (previous && previous !== next) {
    void cleaner(false);
    announceReplaced();
  }
}

if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);

export function onSessionReplaced(listener: () => void): () => void {
  replacedListeners.add(listener);
  return () => replacedListeners.delete(listener);
}

/** Changes when another guest takes over this browser. */
export function useSessionEpoch(): number {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => epoch,
  );
}

/** Forgets what this module holds in memory. For tests. */
export function resetSessionState(): void {
  current = null;
  lastSeen = null;
  creating = null;
  epoch = 0;
  cleaner = () => undefined;
  replacedListeners.clear();
  listeners.clear();
}
