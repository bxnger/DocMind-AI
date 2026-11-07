import type { UserMode } from './modes';
import { SAMPLE_QUESTION_KEYS } from '@/services/sampleDocument';

type SampleQuestionKey = (typeof SAMPLE_QUESTION_KEYS)[number];
type SampleQuestion = { readonly key: string; readonly source: SampleQuestionKey };

/** The sample PDF is always a fictional service agreement.
 * Show questions relevant to the selected profession, without pretending the sample is a different document.
 * Each specialized question maps to a factual question that the keyword-only offline demo can answer.
 */
export const MODE_SAMPLE_QUESTIONS = {
  general: [
    { key: 'notice', source: 'notice' },
    { key: 'interest', source: 'interest' },
    { key: 'cap', source: 'cap' },
    { key: 'leave', source: 'leave' },
  ],
  student: [
    { key: 'studentNotice', source: 'notice' },
    { key: 'studentInterest', source: 'interest' },
    { key: 'studentCap', source: 'cap' },
  ],
  teacher: [
    { key: 'teacherNotice', source: 'notice' },
    { key: 'teacherInterest', source: 'interest' },
    { key: 'teacherCap', source: 'cap' },
  ],
  legal: [
    { key: 'legalCap', source: 'cap' },
    { key: 'legalNotice', source: 'notice' },
    { key: 'legalInterest', source: 'interest' },
  ],
  business: [
    { key: 'businessInterest', source: 'interest' },
    { key: 'businessCap', source: 'cap' },
    { key: 'businessNotice', source: 'notice' },
  ],
} as const satisfies Record<UserMode, readonly SampleQuestion[]>;

/** Keeps demo evidence retrieval grounded when a professional question is phrased differently. */
export function sampleQuestionAliases(translate: (key: string) => string): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  for (const questions of Object.values(MODE_SAMPLE_QUESTIONS)) {
    for (const { key, source } of questions) {
      if (key !== source) aliases.set(translate(`home.sample.${key}`), translate(`home.sample.${source}`));
    }
  }
  return aliases;
}
