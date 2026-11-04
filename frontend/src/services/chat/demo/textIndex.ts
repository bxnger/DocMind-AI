/** Real text of one PDF page, as PDF.js reports it. `items` lines up with the text layer. */
export interface PageText {
  page: number;
  items: string[];
  text: string;
}

export type DocumentText = PageText[];

export interface PageTextSource {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: Array<object> }>;
  }>;
}

const hasStr = (item: object): item is { str: string; hasEOL?: boolean } =>
  'str' in item && typeof item.str === 'string';

export async function extractDocumentText(pdf: PageTextSource): Promise<DocumentText> {
  const pages: DocumentText = [];
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const proxy = await pdf.getPage(page);
    const content = await proxy.getTextContent();
    const items: string[] = [];
    let text = '';
    for (const item of content.items) {
      // Keep positions aligned with react-pdf's itemIndex, including non-text entries.
      if (!hasStr(item)) {
        items.push('');
        continue;
      }
      items.push(item.str);
      text += item.str + (item.hasEOL ? ' ' : '');
    }
    pages.push({ page, items, text: text.replace(/\s+/g, ' ').trim() });
  }
  return pages;
}

/** Below this the PDF is treated as a scan: nothing searchable without OCR. */
const MIN_TEXT_CHARS = 20;

export function hasSearchableText(pages: DocumentText): boolean {
  return pages.reduce((total, page) => total + page.text.length, 0) >= MIN_TEXT_CHARS;
}
