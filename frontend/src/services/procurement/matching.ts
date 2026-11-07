import type { Part, PhotoCandidate, PhotoMatch } from '@/types/procurement';

/** For the demonstration only. With the real API the server's code decides. */
const LOOK_ALIKE: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'R', С: 'S', Т: 'T', Х: 'X', У: 'Y' };
const CONFUSABLE: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8' };
const BRAND = /^([A-ZА-Я]{2,10})\s+(?=\S*\d)/;
const MIN_CODE = 3;
const MAX_EDITS = 2;

export const normalizeCode = (code: string): string =>
  [...code.toUpperCase()].map((char) => LOOK_ALIKE[char] ?? char).join('').replace(/[\s\-./_]/g, '');

export function splitBrand(raw: string): { brand: string | null; code: string } {
  const upper = raw.trim().toUpperCase();
  const match = BRAND.exec(upper);
  return match?.[1] ? { brand: match[1], code: upper.slice(match[0].length) } : { brand: null, code: upper };
}

const blur = (code: string) => [...code].map((char) => CONFUSABLE[char] ?? char).join('');

function edits(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) next.push(Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)));
    row = next;
  }
  return row[b.length] ?? 0;
}

/** exact, close (a different designation of the same family), partial (one is the start of the other), or nothing. */
export function compareCode(marking: string, part: Pick<Part, 'partNumber' | 'manufacturer'>): PhotoCandidate['match'] | null {
  const seen = splitBrand(marking);
  const wanted = splitBrand(part.partNumber);
  const a = normalizeCode(seen.code);
  const b = normalizeCode(wanted.code);
  if (a.length < MIN_CODE) return null;
  const brand = wanted.brand ?? part.manufacturer?.toUpperCase() ?? null;
  if (a === b) return seen.brand && brand && seen.brand !== brand ? 'close' : 'exact';
  if (a.startsWith(b) || b.startsWith(a)) return 'partial';
  if (blur(a) === blur(b)) return 'close';
  const base = (code: string) => normalizeCode(code.split(/[\s\-./_]/)[0] ?? '');
  const sameBase = base(seen.code).length >= MIN_CODE && base(seen.code) === base(wanted.code);
  return sameBase || edits(a, b) <= MAX_EDITS ? 'close' : null;
}

const RANK = { exact: 3, partial: 2, close: 1 };

export function demoIdentify(text: string, parts: readonly Part[]): PhotoMatch {
  const { brand, code } = splitBrand(text);
  const recognized = { text, partNumber: code || null, manufacturer: brand, markings: [], readability: null };
  if (normalizeCode(code).length < MIN_CODE) return { matchStatus: 'unreadable', recognized, matches: [], message: null };
  const matches = parts.flatMap((part): PhotoCandidate[] => {
    const match = compareCode(text, part);
    return match ? [{ partId: part.id, partNumber: part.partNumber, name: part.name, match, difference: match === 'exact' ? null : `${code} ≠ ${splitBrand(part.partNumber).code}`, sources: part.sources }] : [];
  }).sort((x, y) => RANK[y.match] - RANK[x.match]);
  const exact = matches.filter((match) => match.match === 'exact');
  const matchStatus = exact.length === 1 ? 'matched' : matches.length ? 'needs_confirmation' : 'no_match';
  return { matchStatus, recognized, matches, message: null };
}
