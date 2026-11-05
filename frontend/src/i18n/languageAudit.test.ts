import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import kk from './locales/kk.json';
import ru from './locales/ru.json';

const flatten = (value: object, prefix = ''): Array<[string, string]> =>
  Object.entries(value).flatMap(([key, child]): Array<[string, string]> =>
    typeof child === 'string' ? [[`${prefix}${key}`, child]] : flatten(child as object, `${prefix}${key}.`),
  );

/** Product names, formats and key names keep their Latin spelling in every language. */
const ALLOWED = new Set(['AI', 'API', 'DOCMIND', 'DOCX', 'PDF', 'OCR', 'Telegram', 'Enter', 'Shift', 'Esc']);
const latinWords = (text: string) => (text.replace(/\{\{\w+\}\}/g, '').match(/[A-Za-z]{2,}/g) ?? []).filter((word) => !ALLOWED.has(word));

describe('no mixed-language interface text', () => {
  it.each([['ru', ru], ['kk', kk]])('%s has no stray English words', (_name, locale) => {
    expect(flatten(locale).filter(([, text]) => latinWords(text).length > 0)).toEqual([]);
  });

  it('no locale says "backend" to the user', () => {
    for (const locale of [en, ru, kk]) expect(flatten(locale).filter(([, text]) => /backend/i.test(text))).toEqual([]);
  });

  it.each([['ru', ru], ['kk', kk]])('%s is actually translated, not a copy of English', (_name, locale) => {
    const english = new Map(flatten(en));
    const same = flatten(locale).filter(([key, text]) => english.get(key) === text && /[A-Za-z]{4,}/.test(text) && latinWords(text).length > 0);
    expect(same).toEqual([]);
  });

  it('Kazakh uses Kazakh letters, not lookalike Latin or plain Cyrillic stand-ins', () => {
    const text = JSON.stringify(kk);
    for (const letter of 'әғқңөұүі') expect(text.includes(letter), letter).toBe(true);
    // A Latin letter glued to Cyrillic is the classic copy-paste error.
    expect(text.match(/[а-яәғқңөұүһі][A-Za-z]|[A-Za-z][а-яәғқңөұүһі]/gi) ?? []).toEqual([]);
  });

  it('app-authored sample questions exist in every language', () => {
    expect(ru.home.sample.notice).not.toBe(en.home.sample.notice);
    expect(kk.home.sample.notice).not.toBe(en.home.sample.notice);
  });
});
