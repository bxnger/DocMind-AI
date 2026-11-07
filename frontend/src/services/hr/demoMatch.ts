import { getDocumentText, type TextBlock } from '@/api/documents';
import { onSessionReplaced } from '@/api/session';
import { AppError } from '@/api/client';
import type { EvidenceSource } from '@/types/chat';
import type { HrCoverage, HrMatch, HrRequirement, RequirementStatus } from '@/types/hr';

/**
 * Stands in until the backend has /hr/matches, and says so on screen. It only compares words: every requirement and quote
 * is real text of the two documents, and it understands nothing. Personal traits are never read as requirements.
 */
const SENTENCE = /(?<=[.!?;])\s+|\n+/;
const MIN_LENGTH = 15;
const MAX_LENGTH = 220;
const MAX_REQUIREMENTS = 20;
const NICE = /желательн|будет плюсом|плюсом|nice to have|preferred|desirable|артықшылық|қалаулы/i;
const REQUIREMENT = /требован|опыт|знани|умени|навык|образован|обязанн|experience|required|must|knowledge|skill|degree|responsib|тәжірибе|білім|дағды|міндет|талап/i;
const PERSONAL = /возраст|\bпол\b|семейн|националь|здоров|фото|\bage\b|gender|marital|nationality|health|photo|жас\b|жынысы|отбасы|ұлты|денсаулық/i;
const SHORT_WORDS = /^(для|это|или|что|как|при|the|and|with|for|from|that|have|және|үшін)$/;

const STEM = 5;
const TOKENS = /[a-z+#][a-z0-9+#.]+|[\p{L}]{3,}/gu;
const LATIN = /^[a-z+#]/;

/** Word starts, so that "тесты" and "тестов" meet only as far as a plain comparison can tell. */
const words = (text: string) => new Set((text.toLowerCase().match(TOKENS) ?? []).filter((word) => !SHORT_WORDS.test(word)).map((word) => (LATIN.test(word) ? word : word.slice(0, STEM))));

/** In Russian or Kazakh text the Latin words are the named skills: Python says more than "опыт работы". */
function judge(wanted: Set<string>, found: Set<string>): { status: RequirementStatus; weight: number } {
  const shared = (list: string[]) => list.filter((word) => found.has(word)).length;
  const all = [...wanted];
  const skills = all.filter((word) => LATIN.test(word));
  const share = all.length ? shared(all) / all.length : 0;
  if (skills.length && skills.length < all.length) {
    const named = shared(skills) / skills.length;
    if (named === 0) return { status: 'not_found', weight: 0 };
    return { status: named === 1 && share >= 0.5 ? 'confirmed' : 'partial', weight: named + share };
  }
  return { status: share >= 0.6 ? 'confirmed' : share >= 0.3 ? 'partial' : 'not_found', weight: share };
}

interface Named {
  id: string;
  name: string;
  blocks: readonly TextBlock[];
}

const sourceOf = (doc: Named, block: TextBlock, quote: string): EvidenceSource => ({
  index: 1,
  documentId: doc.id,
  documentName: doc.name,
  page: block.page ?? null,
  location: block.section,
  quote,
  ...(block.page == null ? { paragraph: block.index } : {}),
});

const sentencesOf = (doc: Named) =>
  doc.blocks.flatMap((block) => block.text.split(SENTENCE).filter((quote) => quote.length >= MIN_LENGTH && quote.length <= MAX_LENGTH).map((quote) => ({ block, quote })));

const empty = (): HrCoverage => ({ confirmed: 0, partial: 0, notFound: 0 });

export function compareTexts(resume: Named, vacancy: Named, id = 'demo'): HrMatch {
  const resumeSentences = sentencesOf(resume).map((item) => ({ ...item, words: words(item.quote) }));
  const seen = new Set<string>();
  const requirements = sentencesOf(vacancy)
    .filter(({ quote }) => REQUIREMENT.test(quote) && !PERSONAL.test(quote) && !seen.has(quote) && seen.add(quote))
    .slice(0, MAX_REQUIREMENTS)
    .map(({ block, quote }): HrRequirement => {
      const wanted = words(quote);
      const best = resumeSentences
        .map((item) => ({ item, ...judge(wanted, item.words) }))
        .sort((x, y) => y.weight - x.weight)[0];
      const status = best?.status ?? 'not_found';
      return {
        requirement: quote,
        kind: NICE.test(quote) ? 'nice' : 'must',
        status,
        explanation: '',
        evidence: status === 'not_found' || !best ? [] : [sourceOf(resume, best.item.block, best.item.quote)],
        vacancySource: sourceOf(vacancy, block, quote),
      };
    });
  const coverage = { must: empty(), nice: empty() };
  for (const item of requirements) {
    const group = coverage[item.kind];
    if (item.status === 'confirmed') group.confirmed += 1;
    else if (item.status === 'partial') group.partial += 1;
    else group.notFound += 1;
  }
  return { id, status: 'ready', errorCode: null, requirements, skills: [], coverage, notice: null };
}

const held = new Map<string, HrMatch>();
onSessionReplaced(() => held.clear());

export async function startDemoMatch(resume: { id: string; name: string }, vacancy: { id: string; name: string }): Promise<HrMatch> {
  const [resumeBlocks, vacancyBlocks] = await Promise.all([getDocumentText(resume.id), getDocumentText(vacancy.id)]);
  const id = `demo-${held.size + 1}`;
  const match = compareTexts({ ...resume, blocks: resumeBlocks }, { ...vacancy, blocks: vacancyBlocks }, id);
  held.set(id, match);
  return match;
}

export function getDemoMatch(id: string): HrMatch {
  const match = held.get(id);
  if (!match) throw new AppError({ code: 'HR_MATCH_NOT_FOUND', message: 'Not found', status: 404 });
  return match;
}
