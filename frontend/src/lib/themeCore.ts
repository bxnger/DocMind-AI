export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'docmind.theme';
export const DEFAULT_THEME: ThemePreference = 'system';
/** Browser chrome colour for each theme. index.html repeats these for the first paint. */
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#f4f2ec', dark: '#151a19' };

export function parseThemePreference(value: unknown): ThemePreference {
  return THEME_PREFERENCES.find((theme) => theme === value) ?? DEFAULT_THEME;
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemIsDark ? 'dark' : 'light';
  return preference;
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  const at = THEME_PREFERENCES.indexOf(current);
  return THEME_PREFERENCES[(at + 1) % THEME_PREFERENCES.length] ?? DEFAULT_THEME;
}
