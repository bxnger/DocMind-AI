/**
 * Splits a block around the cited quote. A quote that runs past the block marks the whole block.
 * Null when they share nothing, so nothing false gets marked.
 */
export function quoteParts(text: string, quote: string): [string, string, string] | null {
  if (!quote) return null;
  const at = text.indexOf(quote);
  if (at >= 0) return [text.slice(0, at), quote, text.slice(at + quote.length)];
  return quote.includes(text) ? ['', text, ''] : null;
}

/** Long enough, or at its very start, so that a short common word is not taken for a part of the quote. */
export function blockInQuote(text: string, quote: string): boolean {
  return text.length > 0 && text.length < quote.length && (quote.startsWith(text) || (text.length >= 12 && quote.includes(text)));
}

export interface QuoteMark {
  quote: string;
  className: string;
}

export interface TextPart {
  text: string;
  className?: string;
}

/** A block cut into plain and marked parts. The first mark to claim a stretch of text keeps it. Joined, the parts are the block. */
export function markParts(text: string, marks: readonly QuoteMark[]): TextPart[] {
  const spans: Array<{ start: number; end: number; className: string }> = [];
  for (const mark of marks) {
    if (!mark.quote) continue;
    // A sentence can run across blocks, from a heading into its paragraph. Then this block is a part of it.
    if (blockInQuote(text, mark.quote)) return [{ text, className: mark.className }];
    const start = text.indexOf(mark.quote);
    if (start < 0) continue;
    const end = start + mark.quote.length;
    if (!spans.some((span) => start < span.end && end > span.start)) spans.push({ start, end, className: mark.className });
  }
  spans.sort((a, b) => a.start - b.start);
  const parts: TextPart[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.start > at) parts.push({ text: text.slice(at, span.start) });
    parts.push({ text: text.slice(span.start, span.end), className: span.className });
    at = span.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
