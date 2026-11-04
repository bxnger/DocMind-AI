import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import kk from './locales/kk.json';
import ru from './locales/ru.json';

function flatten(value: object, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') out[path] = child;
    else Object.assign(out, flatten(child as object, path));
  }
  return out;
}

/** Plural forms differ by language, so `_one`/`_few`/`_many`/`_other` collapse to one base key. */
const baseKeys = (locale: object) =>
  [...new Set(Object.keys(flatten(locale)).map((key) => key.replace(/_(one|few|many|other)$/, '')))].sort();

const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();

describe('locales', () => {
  it.each([['ru', ru], ['kk', kk]])('%s has exactly the same keys as en', (_name, locale) => {
    expect(baseKeys(locale)).toEqual(baseKeys(en));
  });

  it.each([['ru', ru], ['kk', kk]])('%s uses the same placeholders as en', (_name, locale) => {
    const source = flatten(en);
    const target = flatten(locale);
    for (const [key, text] of Object.entries(target)) {
      const counterpart = source[key] ?? source[`${key.replace(/_(one|few|many|other)$/, '')}_other`];
      if (counterpart === undefined) continue;
      expect([key, placeholders(text).filter((p) => p !== '{{count}}')]).toEqual([
        key,
        placeholders(counterpart).filter((p) => p !== '{{count}}'),
      ]);
    }
  });

  it('kk contains Kazakh-specific letters', () => {
    expect(JSON.stringify(kk)).toMatch(/[әғқңөұүһі]/);
  });
});
