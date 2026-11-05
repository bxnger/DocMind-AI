import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DocumentText } from '@/services/chat';
import { retrievePassages } from '@/services/chat/demo/retrieval';
import { SAMPLE_QUESTION_KEYS, SAMPLE_VARIANTS, sampleLanguage, type SampleLanguage } from '@/services/sampleDocument';

const LANGUAGES = Object.keys(SAMPLE_VARIANTS) as SampleLanguage[];

async function pagesOf(file: string): Promise<DocumentText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(`public${file}`));
  const task = pdfjs.getDocument({ data, verbosity: 0, standardFontDataUrl: 'public/pdfjs/standard_fonts/' });
  const doc = await task.promise;
  const pages: DocumentText = [];
  for (let page = 1; page <= doc.numPages; page += 1) {
    const content = await (await doc.getPage(page)).getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str + (item.hasEOL ? ' ' : '') : ''))
      .join(' ')
      .replace(/\s+/g, ' ');
    pages.push({ page, items: [], text });
  }
  await task.destroy();
  return pages;
}

function locale(language: SampleLanguage): Record<string, unknown> {
  return JSON.parse(readFileSync(`src/i18n/locales/${language}.json`, 'utf8')) as Record<string, unknown>;
}

describe.each(LANGUAGES)('sample document (%s)', (language) => {
  const variant = SAMPLE_VARIANTS[language];

  it('has four pages and contains the quote the home page shows, on the page it claims', async () => {
    const pages = await pagesOf(variant.url);
    expect(pages).toHaveLength(4);
    expect(pages[variant.previewPage - 1]?.text).toContain(variant.previewQuote);
  });

  it('answers the sample questions in its own language, and the one it does not cover with nothing', async () => {
    const pages = await pagesOf(variant.url);
    const sample = (locale(language).home as { sample: Record<string, string> }).sample;
    for (const key of SAMPLE_QUESTION_KEYS) {
      const found = retrievePassages(pages, sample[key] ?? '');
      if (key === 'leave') expect(found, key).toEqual([]);
      else expect(found.length, key).toBeGreaterThan(0);
    }
  });
});

describe('sampleLanguage', () => {
  it('picks the sample from the interface language', () => {
    expect(['ru', 'ru-RU', 'kk', 'kk-KZ', 'en', 'en-US', 'de', undefined].map(sampleLanguage)).toEqual(['ru', 'ru', 'kk', 'kk', 'en', 'en', 'en', 'en']);
  });
});
