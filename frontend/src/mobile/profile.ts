import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from '@/lib/storage';

/** Who uses the app. It only tailors the starting mode and greeting, and never leaves this device. */
export const USER_TYPES = ['company', 'engineer', 'procurement', 'personal'] as const;
export type UserType = (typeof USER_TYPES)[number];

export interface Profile {
  completed: boolean;
  userType: UserType | null;
  organization: string;
}

const KEY = 'docmind.profile';
export const EMPTY_PROFILE: Profile = { completed: false, userType: null, organization: '' };
export const MAX_ORGANIZATION = 80;

export function parseProfile(value: unknown): Profile {
  if (typeof value !== 'object' || value === null) return EMPTY_PROFILE;
  const record = value as Record<string, unknown>;
  const userType = USER_TYPES.find((type) => type === record.userType) ?? null;
  const organization = typeof record.organization === 'string' ? record.organization.trim().slice(0, MAX_ORGANIZATION) : '';
  return { completed: record.completed === true, userType, organization };
}

const listeners = new Set<() => void>();
let current = parseProfile(readStored<unknown>('local', KEY, null));

export function saveProfile(next: Profile): void {
  current = parseProfile(next);
  writeStored('local', KEY, current);
  listeners.forEach((listener) => listener());
}

export function useProfile(): Profile {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => current,
  );
}

/** Personal use starts with the general document chat. Work starts with production and procurement. */
export const modeFor = (type: UserType | null): 'general' | 'procurement' => (type === 'personal' ? 'general' : 'procurement');
