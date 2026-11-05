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
