import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('sample document', () => {
  it('contains the quote the home page shows, on the page it claims', async () => {
    const source = readFileSync('src/features/documents/EvidencePreview.tsx', 'utf8');
    const quote = /PREVIEW_QUOTE = '([^']+)'/.exec(source)?.[1];
    const page = Number(/PREVIEW_PAGE = (\d+)/.exec(source)?.[1]);
    expect(quote).toBeTruthy();

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(readFileSync('public/demo/sample-agreement.pdf'));
    const task = pdfjs.getDocument({ data, verbosity: 0, standardFontDataUrl: 'public/pdfjs/standard_fonts/' });
    const doc = await task.promise;
    const content = await (await doc.getPage(page)).getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str + (item.hasEOL ? ' ' : '') : ''))
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(text).toContain(quote);
    await task.destroy();
  });
});
