/**
 * localStorage and sessionStorage can throw in private windows or when blocked. These are
 * conveniences (panel width, recents), so a failure falls back to the default on purpose.
 */
export function readStored<T>(storage: 'local' | 'session', key: string, fallback: T): T {
  try {
    const raw = (storage === 'local' ? localStorage : sessionStorage).getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStored(storage: 'local' | 'session', key: string, value: unknown): void {
  try {
    (storage === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
  } catch {
    // Not persisting is acceptable: the value stays in memory for this session.
  }
}

export function removeStored(storage: 'local' | 'session', key: string): void {
  try {
    (storage === 'local' ? localStorage : sessionStorage).removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

export function removeStoredByPrefix(storage: 'local' | 'session', prefix: string): void {
  try {
    const store = storage === 'local' ? localStorage : sessionStorage;
    for (const key of Object.keys(store)) if (key.startsWith(prefix)) store.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
