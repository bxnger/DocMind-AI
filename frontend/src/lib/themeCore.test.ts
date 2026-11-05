import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEME_COLORS, THEME_PREFERENCES, nextThemePreference, parseThemePreference, resolveTheme, type ThemePreference } from './themeCore';

describe('theme preference', () => {
  it('defaults to System and rejects bad stored values', () => {
    expect(DEFAULT_THEME).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('neon')).toBe('system');
    expect(parseThemePreference(7)).toBe('system');
    expect(parseThemePreference('dark')).toBe('dark');
  });
  it('System follows the operating system, explicit choices do not', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('the toggle visits all three and returns', () => {
    let at: ThemePreference = THEME_PREFERENCES[0];
    const seen = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      seen.add(at);
      at = nextThemePreference(at);
    }
    expect(seen.size).toBe(3);
    expect(at).toBe(THEME_PREFERENCES[0]);
  });
});

/** Runs the real inline script from index.html against a fake browser. */
function firstPaintTheme(stored: string | null, systemDark: boolean, blocked = false) {
  const html = readFileSync('index.html', 'utf8');
  const code = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  const root = { dataset: {} as Record<string, string> };
  let color = '';
  new Function('localStorage', 'window', 'document', code)(
    { getItem: () => { if (blocked) throw new Error('blocked'); return stored; } },
    { matchMedia: () => ({ matches: systemDark }) },
    { documentElement: root, querySelector: () => ({ setAttribute: (_: string, v: string) => (color = v) }) },
  );
  return { theme: root.dataset.theme, color };
}

describe('first paint script in index.html', () => {
  it('matches the app for every case', () => {
    for (const stored of ['light', 'dark', 'system', null] as const) {
      for (const dark of [true, false]) {
        const expected = resolveTheme(parseThemePreference(stored), dark);
        const result = firstPaintTheme(stored === null ? null : JSON.stringify(stored), dark);
        expect(result.theme).toBe(expected);
        expect(result.color).toBe(THEME_COLORS[expected]);
      }
    }
  });
  it('survives blocked storage and corrupt values', () => {
    expect(firstPaintTheme(null, true, true).theme).toBe('dark');
    expect(firstPaintTheme('{broken', false).theme).toBe('light');
  });
});
