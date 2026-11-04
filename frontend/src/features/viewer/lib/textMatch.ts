/**
 * Locates text inside PDF.js text items. Whitespace is ignored when matching because a quote can
 * wrap across lines while the items keep their own spacing.
 */
export interface ItemSpan {
  item: number;
  start: number;
  end: number;
}

export type TextMatch = ItemSpan[];

const isSpace = (char: string) => /\s/.test(char);

function buildIndex(items: string[], foldCase: boolean) {
  let text = '';
  const positions: Array<{ item: number; offset: number }> = [];
  items.forEach((str, item) => {
    for (let offset = 0; offset < str.length; offset += 1) {
      const char = str.charAt(offset);
      if (isSpace(char)) continue;
      const lower = char.toLowerCase();
      // Case folding that changes length (rare) would break the position map, so keep such chars.
      text += foldCase && lower.length === 1 ? lower : char;
      positions.push({ item, offset });
    }
  });
  return { text, positions };
}

const compact = (value: string, foldCase: boolean) => {
  const stripped = value.replace(/\s+/g, '');
  return foldCase ? stripped.toLowerCase() : stripped;
};

export function findMatches(
  items: string[],
  needle: string,
  { foldCase = false, limit = Infinity }: { foldCase?: boolean; limit?: number } = {},
): TextMatch[] {
  const target = compact(needle, foldCase);
  if (!target) return [];
  const { text, positions } = buildIndex(items, foldCase);

  const matches: TextMatch[] = [];
  let from = text.indexOf(target);
  while (from !== -1 && matches.length < limit) {
    const spans: ItemSpan[] = [];
    for (let i = from; i < from + target.length; i += 1) {
      const position = positions[i];
      if (!position) continue;
      const last = spans[spans.length - 1];
      if (last && last.item === position.item) last.end = position.offset + 1;
      else spans.push({ item: position.item, start: position.offset, end: position.offset + 1 });
    }
    matches.push(spans);
    from = text.indexOf(target, from + target.length);
  }
  return matches;
}

export interface MarkSpan {
  start: number;
  end: number;
  className: string;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Builds the HTML for one text item. Everything from the PDF is escaped. */
export function renderItemHtml(str: string, marks: MarkSpan[] | undefined): string {
  if (!marks?.length) return escapeHtml(str);
  const sorted = [...marks].sort((a, b) => a.start - b.start);
  let html = '';
  let cursor = 0;
  for (const mark of sorted) {
    if (mark.start < cursor) continue;
    html += escapeHtml(str.slice(cursor, mark.start));
    html += `<mark class="${mark.className}">${escapeHtml(str.slice(mark.start, mark.end))}</mark>`;
    cursor = mark.end;
  }
  return html + escapeHtml(str.slice(cursor));
}
