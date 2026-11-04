import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from '@/lib/storage';

export type MotionPreference = 'system' | 'reduced';

const KEY = 'docmind.motion';
const listeners = new Set<() => void>();
let current = readStored<MotionPreference>('local', KEY, 'system');

function apply(value: MotionPreference) {
  if (value === 'reduced') document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
}
apply(current);

export function setMotionPreference(value: MotionPreference): void {
  current = value;
  writeStored('local', KEY, value);
  apply(value);
  listeners.forEach((listener) => listener());
}

export function useMotionPreference(): MotionPreference {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => current,
  );
}
