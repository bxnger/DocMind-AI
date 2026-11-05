import { Briefcase, GraduationCap, type LucideIcon, Presentation, Scale, Sparkles } from 'lucide-react';
import { readStored, writeStored } from '@/lib/storage';

export const USER_MODES = ['general', 'student', 'teacher', 'legal', 'business'] as const;
export type UserMode = (typeof USER_MODES)[number];
export const DEFAULT_USER_MODE: UserMode = 'general';

export const MODE_ICONS: Record<UserMode, LucideIcon> = {
  general: Sparkles,
  student: GraduationCap,
  teacher: Presentation,
  legal: Scale,
  business: Briefcase,
};

/** Keys into `userModes.actions` in the locale files, where each has a short label and an editable prompt. */
export const MODE_ACTIONS = {
  general: ['general.summary', 'general.dates', 'general.requirements'],
  student: ['student.explain', 'student.summary', 'student.guide', 'student.questions', 'student.definitions'],
  teacher: ['teacher.outline', 'teacher.discussion', 'teacher.objectives', 'teacher.summary', 'teacher.activities'],
  legal: ['legal.clauses', 'legal.obligations', 'legal.terms', 'legal.risks', 'legal.definitions'],
  business: ['business.insights', 'business.figures', 'business.summary', 'business.terms', 'business.actions'],
} as const satisfies Record<UserMode, readonly string[]>;

export type ModeAction = (typeof MODE_ACTIONS)[UserMode][number];

export const isUserMode = (value: unknown): value is UserMode => USER_MODES.some((mode) => mode === value);

const KEY = 'docmind.userMode';

/** Unknown stored values, for example from an older version, fall back to General. */
export function loadUserMode(): UserMode {
  const stored = readStored<unknown>('local', KEY, DEFAULT_USER_MODE);
  return isUserMode(stored) ? stored : DEFAULT_USER_MODE;
}

export function saveUserMode(mode: UserMode): void {
  writeStored('local', KEY, mode);
}

export type InsertResult = { status: 'inserted' | 'appended' | 'already'; text: string } | { status: 'too-long'; text: string };

/** Puts a prompt in the composer without ever losing what the user already typed. */
export function insertPrompt(current: string, prompt: string, maxChars: number): InsertResult {
  if (!current.trim()) return { status: 'inserted', text: prompt };
  if (current.includes(prompt)) return { status: 'already', text: current };
  const text = `${current.trimEnd()}\n\n${prompt}`;
  return text.length > maxChars ? { status: 'too-long', text: current } : { status: 'appended', text };
}

export type ActionState = 'ready' | 'waiting' | 'demo' | 'unavailable';

/**
 * Prompts are written for the AI. Demo search matches keywords, so long prompts would nearly always
 * come back as "not found"; there the actions are replaced by a note instead.
 */
export function actionState(availability: 'ready' | 'preparing' | 'unavailable', chatMode: 'live' | 'demo'): ActionState {
  if (availability === 'unavailable') return 'unavailable';
  if (availability === 'preparing') return 'waiting';
  return chatMode === 'demo' ? 'demo' : 'ready';
}

/**
 * Backend search matches the words of the question, so a prompt in another language than the document
 * usually finds nothing. Returns the document's language when that risk exists, otherwise null.
 */
export function mismatchedDocumentLanguage(interfaceLanguage: string, documentLanguage: string | null): 'en' | 'ru' | 'kk' | null {
  if (documentLanguage !== 'en' && documentLanguage !== 'ru' && documentLanguage !== 'kk') return null;
  return documentLanguage === interfaceLanguage ? null : documentLanguage;
}
