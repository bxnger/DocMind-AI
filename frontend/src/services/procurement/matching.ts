import type { MarkingCandidate, MarkingStatus, Part } from '@/types/procurement';

/** The rules of docs/api-contract.md, for the demonstration adapter. With the real API the server decides. */
const LOOK_ALIKE: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'R', С: 'S', Т: 'T', Х: 'X', У: 'Y' };
const CONFUSABLE: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8' };
const BRAND = /^([A-ZА-Я]{2,10})\s+(?=\S*\d)/;
const MIN_CODE = 3;
const MAX_EDITS = 2;

/** Р in a code usually stands for a printed R, but in Russian markings it reads as Р: both forms count as the same. */
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

const tailOf = (code: string) => code.split(/[\s\-./_]/).slice(1).join('-') || code;

export function compareMarking(marking: string, part: Pick<Part, 'rawCode' | 'brand'>): MarkingCandidate['status'] {
  const seen = splitBrand(marking);
  const wanted = splitBrand(part.rawCode);
  const a = normalizeCode(seen.code);
  const b = normalizeCode(wanted.code);
  if (a.length < MIN_CODE) return 'insufficient';
  const wantedBrand = wanted.brand ?? part.brand?.toUpperCase() ?? null;
  const sameCode = a === b;
  if (sameCode) return seen.brand && wantedBrand && seen.brand !== wantedBrand ? 'conflict' : 'exact';
  if (a.startsWith(b) || b.startsWith(a) || blur(a) === blur(b)) return 'possible';
  const base = (code: string) => normalizeCode(code.split(/[\s\-./_]/)[0] ?? '');
  const sameBase = base(seen.code).length >= MIN_CODE && base(seen.code) === base(wanted.code);
  return sameBase || edits(a, b) <= MAX_EDITS ? 'conflict' : 'insufficient';
}

const RANK: Record<MarkingStatus, number> = { exact: 3, possible: 2, conflict: 1, insufficient: 0 };

export function matchMarking(marking: string, parts: readonly Part[]): { status: MarkingStatus; matchedPartId: string | null; candidates: MarkingCandidate[] } {
  const candidates = parts.flatMap((part): MarkingCandidate[] => {
    const status = compareMarking(marking, part);
    if (status === 'insufficient') return [];
    const differences = status === 'conflict' ? [{ document: tailOf(splitBrand(part.rawCode).code), marking: tailOf(splitBrand(marking).code) }] : [];
    return [{ partId: part.id, status, differences }];
  }).sort((x, y) => RANK[y.status] - RANK[x.status]);
  const best = candidates[0];
  return { status: best?.status ?? 'insufficient', matchedPartId: best?.partId ?? null, candidates };
}
