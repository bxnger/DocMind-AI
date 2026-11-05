import { useSyncExternalStore } from 'react';
import { loadUserMode, saveUserMode, type UserMode } from './modes';

const listeners = new Set<() => void>();
let current: UserMode = loadUserMode();

export function setUserMode(mode: UserMode): void {
  current = mode;
  saveUserMode(mode);
  listeners.forEach((listener) => listener());
}

/** A display preference only: it is not sent to the backend and does not touch chats or documents. */
export function useUserMode(): UserMode {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => current,
  );
}
