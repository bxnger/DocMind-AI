import type { DocumentModel } from '@/types/document';

/**
 * A fictional contract shipped with the app and labelled as a sample everywhere it appears.
 * It lives outside the backend, so it still opens when the backend is down.
 *
 * It exists in each interface language (same clauses, same pages), so the question, the file name and
 * the quote the user sees are all in one language. The id is the same for all of them.
 */
export const SAMPLE_DOCUMENT_ID = 'sample';

export type SampleLanguage = 'ru' | 'kk' | 'en';

interface SampleVariant {
  url: string;
  name: string;
  sizeBytes: number;
  /** Verbatim from the PDF at `url`. A unit test keeps them in sync. */
  previewQuote: string;
  previewPage: number;
}

export const SAMPLE_VARIANTS: Record<SampleLanguage, SampleVariant> = {
  en: {
    url: '/demo/sample-agreement.pdf',
    name: 'Sample Master Service Agreement.pdf',
    sizeBytes: 11000,
    previewQuote: 'Either party may terminate this Agreement for convenience by giving the other party at least 60 days of written notice.',
    previewPage: 3,
  },
  ru: {
    url: '/demo/sample-agreement.ru.pdf',
    name: 'Образец договора об оказании услуг.pdf',
    sizeBytes: 140000,
    previewQuote: 'Любая из сторон вправе расторгнуть настоящий Договор по собственному усмотрению, направив другой стороне письменное уведомление не менее чем за 60 дней.',
    previewPage: 4,
  },
  kk: {
    url: '/demo/sample-agreement.kk.pdf',
    name: 'Қызметтер көрсету туралы шарттың үлгісі.pdf',
    sizeBytes: 138000,
    previewQuote: 'Кез келген тарап осы Шартты өз қалауы бойынша бұзуға құқылы; Шартты бұзу туралы хабарлау мерзімі кемінде 60 күн, хабарлама екінші тарапқа жазбаша жіберіледі.',
    previewPage: 4,
  },
};

/** The sample for an interface language code such as "ru" or "ru-RU"; English for anything else. */
export function sampleLanguage(code: string | undefined): SampleLanguage {
  const base = (code ?? '').slice(0, 2).toLowerCase();
  return base === 'ru' || base === 'kk' ? base : 'en';
}

export const sampleVariant = (code: string | undefined): SampleVariant => SAMPLE_VARIANTS[sampleLanguage(code)];
export const sampleUrl = (code: string | undefined): string => sampleVariant(code).url;

export function sampleDocument(code: string | undefined): DocumentModel {
  const language = sampleLanguage(code);
  const variant = SAMPLE_VARIANTS[language];
  return {
    id: SAMPLE_DOCUMENT_ID,
    name: variant.name,
    kind: 'pdf',
    sizeBytes: variant.sizeBytes,
    status: 'ready',
    stage: null,
    pageCount: 4,
    language,
    ocrUsed: false,
    hasPreview: true,
    createdAt: '2026-03-01T00:00:00.000Z',
    error: null,
  };
}

export const isSampleDocument = (id: string): boolean => id === SAMPLE_DOCUMENT_ID;

/** Keys under `home.sample`. The questions are the app's own, so they follow the interface language. */
export const SAMPLE_QUESTION_KEYS = ['notice', 'interest', 'cap', 'leave'] as const;
