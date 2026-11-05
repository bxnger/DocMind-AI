import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/locales/en.json';
import kk from '@/i18n/locales/kk.json';
import ru from '@/i18n/locales/ru.json';
import { DEFAULT_USER_MODE, MODE_ACTIONS, USER_MODES, actionState, insertPrompt, isUserMode, loadUserMode, saveUserMode } from './modes';

const MAX = 2000;
const locales = { en, ru, kk } as const;
const lookup = (locale: object, action: string) => {
  const [mode = '', key = ''] = action.split('.');
  return (locale as { userModes: { actions: Record<string, Record<string, { label: string; prompt: string }>> } }).userModes.actions[mode]?.[key];
};

describe('modes', () => {
  it('has exactly the five modes, General by default', () => {
    expect(USER_MODES).toEqual(['general', 'student', 'teacher', 'legal', 'business']);
    expect(DEFAULT_USER_MODE).toBe('general');
    expect(isUserMode('legal')).toBe(true);
    expect(isUserMode('admin')).toBe(false);
  });

  it('offers 3 to 5 actions in every mode', () => {
    for (const mode of USER_MODES) {
      expect(MODE_ACTIONS[mode].length).toBeGreaterThanOrEqual(3);
      expect(MODE_ACTIONS[mode].length).toBeLessThanOrEqual(5);
    }
  });
});

describe.each(Object.entries(locales))('prompts in %s', (_name, locale) => {
  const all = USER_MODES.flatMap((mode) => [...MODE_ACTIONS[mode]]);

  it('every action has a short label and a specific prompt within the backend limit', () => {
    for (const action of all) {
      const entry = lookup(locale, action);
      expect(entry, action).toBeDefined();
      expect(entry?.label.length, action).toBeLessThanOrEqual(34);
      expect(entry?.prompt.length, action).toBeGreaterThan(70);
      expect(entry?.prompt.length, action).toBeLessThan(MAX / 2);
    }
  });

  it('no two actions share a prompt', () => {
    expect(new Set(all.map((action) => lookup(locale, action)?.prompt)).size).toBe(all.length);
  });

  it('names and descriptions exist for every mode', () => {
    for (const mode of USER_MODES) {
      expect(locale.userModes.modes[mode].name).toBeTruthy();
      expect(locale.userModes.modes[mode].description).toBeTruthy();
    }
  });
});

describe('grounding', () => {
  const cites = { en: /cite/i, ru: /цит|ссыл/i, kk: /дәйексөз|сілтеме/i };
  it.each(Object.entries(locales))('every %s prompt asks for citations', (name, locale) => {
    for (const mode of USER_MODES) {
      for (const action of MODE_ACTIONS[mode]) expect(lookup(locale, action)?.prompt, action).toMatch(cites[name as keyof typeof cites]);
    }
  });

  it('legal prompts in English refuse legal conclusions, and the note says it is not advice', () => {
    expect(lookup(en, 'legal.risks')?.prompt).toMatch(/do not (invent|give) legal/i);
    expect(en.userModes.legalNote).toMatch(/not legal advice/i);
    expect(ru.userModes.legalNote).toMatch(/не юридическ/i);
    expect(kk.userModes.legalNote).toMatch(/заң/i);
  });

  it('no prompt asks to skip or ignore evidence', () => {
    const text = JSON.stringify(en.userModes.actions);
    expect(text).not.toMatch(/ignore|even if|without citations/i);
  });
});

describe('insertPrompt', () => {
  it('fills an empty composer', () => {
    expect(insertPrompt('', 'P', MAX)).toEqual({ status: 'inserted', text: 'P' });
    expect(insertPrompt('  \n', 'P', MAX)).toEqual({ status: 'inserted', text: 'P' });
  });
  it('keeps unsent text and adds the prompt after it', () => {
    expect(insertPrompt('my words ', 'P', MAX)).toEqual({ status: 'appended', text: 'my words\n\nP' });
  });
  it('does not insert the same prompt twice', () => {
    expect(insertPrompt('my words\n\nP', 'P', MAX)).toEqual({ status: 'already', text: 'my words\n\nP' });
  });
  it('leaves the text untouched when the result would exceed the limit', () => {
    const long = 'x'.repeat(MAX - 2);
    expect(insertPrompt(long, 'P', MAX)).toEqual({ status: 'too-long', text: long });
  });
});

describe('actionState', () => {
  it('offers actions only when the AI can receive them', () => {
    expect(actionState('ready', 'live')).toBe('ready');
    expect(actionState('ready', 'demo')).toBe('demo');
    expect(actionState('preparing', 'live')).toBe('waiting');
    expect(actionState('unavailable', 'live')).toBe('unavailable');
    expect(actionState('unavailable', 'demo')).toBe('unavailable');
  });
});

describe('persistence', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to General for a first-time user', () => {
    expect(loadUserMode()).toBe('general');
  });
  it('survives a reload for every mode', () => {
    for (const mode of USER_MODES) {
      saveUserMode(mode);
      expect(loadUserMode()).toBe(mode);
    }
  });
  it('falls back to General for bad stored values', () => {
    store.set('docmind.userMode', '"admin"');
    expect(loadUserMode()).toBe('general');
    store.set('docmind.userMode', '{broken');
    expect(loadUserMode()).toBe('general');
  });
  it('still works when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(loadUserMode()).toBe('general');
    expect(() => saveUserMode('legal')).not.toThrow();
  });
});

