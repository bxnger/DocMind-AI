/**
 * Part numbers as people type them and as documents print them: case, Cyrillic look-alike letters, dashes and spaces
 * differ, the designation does not. Nothing here guesses compatibility. "close" only means "worth a look", and the
 * screen says so.
 */

const LOOK_ALIKES: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y' };

/** Upper case, Latin letters, one kind of dash, single spaces. The soft hyphen some PDFs print is removed. */
export function normalizeCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/­/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[АВЕКМНОРСТХУ]/g, (letter) => LOOK_ALIKES[letter] ?? letter)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Letters and digits only: "6205-2RS", "6205 2RS" and "6205‑2rs" are the same designation. */
export const codeKey = (value: string): string => normalizeCode(value).replace(/[^0-9A-Z]/g, '');

/** The base number before the first separator: 6205 in "6205-2RS" and in "6205-2Z". */
const baseOf = (value: string): string => codeKey(normalizeCode(value).split(/[-\s/.]/)[0] ?? '');

export type CodeMatch = 'exact' | 'close';

/**
 * exact: the same designation. close: the same base number with another suffix (6205 and 6205-2RS), or one contains
 * the other. A bearing's suffix is its seal or clearance, so "close" is never treated as the same part.
 */
export function compareCodes(query: string, candidate: string): CodeMatch | null {
  const a = codeKey(query);
  const b = codeKey(candidate);
  if (!a || !b) return null;
  if (a === b) return 'exact';
  const baseA = baseOf(query);
  if (baseA.length >= 3 && baseA === baseOf(candidate)) return 'close';
  if (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))) return 'close';
  return null;
}

/** A query that reads like a designation rather than words: digits in it, no long phrase. */
export const looksLikeCode = (value: string): boolean => /\d/.test(value) && normalizeCode(value).length <= 40 && normalizeCode(value).split(' ').length <= 3;

/** Every word of the query, two letters or more, appears in the name. */
export function nameMatches(query: string, name: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length >= 2);
  const haystack = name.toLowerCase();
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

export type ScanFormat = 'ean_13' | 'ean_8' | 'upc_a' | 'qr_code';

export type ScanReading =
  | { kind: 'product'; format: Exclude<ScanFormat, 'qr_code'>; code: string }
  | { kind: 'badChecksum'; format: Exclude<ScanFormat, 'qr_code'>; code: string }
  | { kind: 'url'; url: string; host: string }
  | { kind: 'text'; text: string; codeLike: boolean };

/** GS1 check digit: weights 3 and 1 from the right, over EAN-8, UPC-A (12) and EAN-13. */
export function validGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop() ?? 0;
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * What a scanned code is. A QR code holds anything, so it becomes a product code only if it is one: a link stays a
 * link, which the app never opens by itself.
 */
export function classifyScan(format: ScanFormat, raw: string): ScanReading {
  const text = raw.trim();
  if (format !== 'qr_code') return { kind: validGtin(text) ? 'product' : 'badChecksum', format, code: text };
  if (/^https?:\/\//i.test(text)) {
    try {
      return { kind: 'url', url: text, host: new URL(text).host };
    } catch {
      return { kind: 'text', text, codeLike: false };
    }
  }
  if (/^\d{8}$|^\d{12,13}$/.test(text) && validGtin(text)) return { kind: 'product', format: text.length === 8 ? 'ean_8' : text.length === 12 ? 'upc_a' : 'ean_13', code: text };
  return { kind: 'text', text, codeLike: looksLikeCode(text) && !/\s{2,}|\n/.test(text) };
}
