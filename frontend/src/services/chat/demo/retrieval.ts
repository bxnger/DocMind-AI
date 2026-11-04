import type { DocumentText } from './textIndex';

/**
 * Keyword retrieval over the document's real text. Nothing here generates language: results are
 * verbatim sentences with their real page numbers, or nothing at all. This is the demo stand-in
 * for the backend's future RAG pipeline, and the UI says so.
 */
export interface Passage {
  page: number;
  quote: string;
}

const STOPWORDS = new Set(
  `a an and any are as at be been but by can could did do does for from had has have how i if in into is it its
  of on or our should so than that the their them then there these they this to under was we were what when where
  which who whom why will with would you your about document mention mentions mentioned say says said tell give show
  и в во на не что как где когда кто какой какая какие каков какова или но а о об от по за из для при с со к ко у же ли
  бы это этот эта эти то та те есть был была были быть ещё уже их его её мы вы он она они документ документе документа
  упоминается говорится сказано расскажи покажи
  және мен да де ма ме ба бе пен бен қай қандай қалай неше не кім қашан қайда ол бұл осы сол бар жоқ үшін туралы деген
  құжат құжатта құжаттың құжатты жерде аталады айтылған көрсет`
    .split(/\s+/)
    .filter(Boolean),
);

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Light prefix stemming so inflected forms match in English, Russian and Kazakh. */
function stem(token: string): string {
  return token.length < 6 ? token : token.slice(0, Math.max(5, Math.floor(token.length * 0.7)));
}

function matches(term: string, token: string): boolean {
  return term.length === token.length || term.length < 5 ? term === token : token.startsWith(term);
}

export function queryTerms(question: string): string[] {
  const terms = tokenize(question).filter((token) => !STOPWORDS.has(token));
  return [...new Set(terms.map(stem))];
}

const MAX_QUOTE_CHARS = 480;
const MIN_QUOTE_CHARS = 25;

function splitLong(sentence: string): string[] {
  if (sentence.length <= MAX_QUOTE_CHARS) return [sentence];
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_QUOTE_CHARS) {
    const cut = rest.lastIndexOf(' ', MAX_QUOTE_CHARS);
    const at = cut > 0 ? cut : MAX_QUOTE_CHARS;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  parts.push(rest);
  return parts;
}

export function splitPassages(text: string): string[] {
  // A boundary is end punctuation followed by a capital, a digit or an opening quote.
  const sentences = text.split(/(?<=[.!?…:;])\s+(?=[\p{Lu}\p{N}«"“])/u);
  const merged: string[] = [];
  for (const sentence of sentences) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && previous.length < MIN_QUOTE_CHARS) {
      merged[merged.length - 1] = `${previous} ${sentence}`;
    } else {
      merged.push(sentence);
    }
  }
  return merged.flatMap(splitLong).filter((passage) => passage.length >= MIN_QUOTE_CHARS);
}

interface Candidate {
  page: number;
  quote: string;
  tokens: string[];
}

export function retrievePassages(pages: DocumentText, question: string, limit = 3): Passage[] {
  const terms = queryTerms(question);
  if (terms.length === 0) return [];

  const candidates: Candidate[] = pages.flatMap((page) =>
    splitPassages(page.text).map((quote) => ({ page: page.page, quote, tokens: tokenize(quote) })),
  );

  // Rare terms count for more than common ones.
  const weight = new Map(
    terms.map((term) => {
      const frequency = candidates.filter((c) => c.tokens.some((t) => matches(term, t))).length;
      return [term, frequency === 0 ? 0 : Math.log(1 + candidates.length / frequency)];
    }),
  );
  // Words absent from the document still count, so an off-topic question cannot pass on one common word.
  const present = [...weight.values()].filter((w) => w > 0);
  const average = present.length ? present.reduce((a, b) => a + b, 0) / present.length : 1;
  const total = terms.reduce((sum, term) => sum + (weight.get(term) || average), 0);
  const requiredCoverage = terms.length === 1 ? 1 : 0.5;

  const seen = new Set<string>();
  return candidates
    .map((candidate) => {
      const matched = terms.filter((term) => candidate.tokens.some((token) => matches(term, token)));
      const score = matched.reduce((sum, term) => sum + (weight.get(term) ?? 0), 0);
      return {
        ...candidate,
        coverage: score / total,
        matched: matched.length,
        density: matched.length / Math.max(candidate.tokens.length, 1),
      };
    })
    .filter((candidate) => candidate.coverage >= requiredCoverage)
    // More query words first, then the most focused passage rather than the longest.
    .sort((a, b) => b.matched - a.matched || b.density - a.density || a.page - b.page)
    .filter((candidate) => {
      if (seen.has(candidate.quote)) return false;
      seen.add(candidate.quote);
      return true;
    })
    .slice(0, limit)
    .map(({ page, quote }) => ({ page, quote }));
}

/** Suggestions are built from words that actually occur in this document. */
export function frequentTerms(pages: DocumentText, limit = 3): string[] {
  const pagesByWord = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const token of tokenize(page.text)) {
      if (token.length < 5 || STOPWORDS.has(token) || /^\p{N}+$/u.test(token)) continue;
      const set = pagesByWord.get(token) ?? new Set<number>();
      set.add(page.page);
      pagesByWord.set(token, set);
    }
  }
  const picked: string[] = [];
  const stems = new Set<string>();
  const ranked = [...pagesByWord.entries()]
    .filter(([, set]) => pages.length === 1 || set.size < pages.length)
    .sort((a, b) => b[1].size - a[1].size || b[0].length - a[0].length);
  for (const [word] of ranked) {
    const s = stem(word);
    if (stems.has(s)) continue;
    stems.add(s);
    picked.push(word);
    if (picked.length === limit) break;
  }
  return picked;
}
