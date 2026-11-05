import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from '@/lib/storage';
import { THEME_COLORS, THEME_STORAGE_KEY, parseThemePreference, resolveTheme, type ThemePreference } from '@/lib/themeCore';

const listeners = new Set<() => void>();
const media = window.matchMedia('(prefers-color-scheme: dark)');
let preference = parseThemePreference(readStored<unknown>('local', THEME_STORAGE_KEY, null));

function apply() {
  const theme = resolveTheme(preference, media.matches);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}
apply();

// Only matters for System, and apply() then follows the operating system.
media.addEventListener('change', apply);

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  writeStored('local', THEME_STORAGE_KEY, next);
  apply();
  listeners.forEach((listener) => listener());
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => preference,
  );
}
