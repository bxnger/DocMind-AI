import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from '@/lib/storage';

export interface RecentEntry {
  id: string;
  openedAt: string;
}

const KEY = 'docmind.recents';
const MAX_ENTRIES = 30;
const EMPTY: RecentEntry[] = [];

let cache: RecentEntry[] | null = null;
const listeners = new Set<() => void>();

function read(): RecentEntry[] {
  cache ??= readStored<RecentEntry[]>('local', KEY, EMPTY);
  return cache;
}

function write(next: RecentEntry[]): void {
  cache = next;
  writeStored('local', KEY, next);
  listeners.forEach((listener) => listener());
}

export function markOpened(id: string): void {
  const rest = read().filter((entry) => entry.id !== id);
  write([{ id, openedAt: new Date().toISOString() }, ...rest].slice(0, MAX_ENTRIES));
}

export function forgetRecent(id: string): void {
  write(read().filter((entry) => entry.id !== id));
}

export function clearRecents(): void {
  write([]);
}

export function useRecents(): RecentEntry[] {
  return useSyncExternalStore((notify) => {
    listeners.add(notify);
    return () => listeners.delete(notify);
  }, read);
}
