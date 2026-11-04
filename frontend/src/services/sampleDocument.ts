import type { DocumentModel } from '@/types/document';

/**
 * A fictional contract shipped with the app and labelled as a sample everywhere it appears.
 * It lives outside the backend, so it still opens when the backend is down.
 */
export const SAMPLE_DOCUMENT_ID = 'sample';
export const SAMPLE_DOCUMENT_URL = '/demo/sample-agreement.pdf';

export const SAMPLE_DOCUMENT: DocumentModel = {
  id: SAMPLE_DOCUMENT_ID,
  name: 'Sample Master Service Agreement.pdf',
  kind: 'pdf',
  sizeBytes: 11000,
  status: 'ready',
  stage: null,
  pageCount: 4,
  language: 'en',
  ocrUsed: false,
  hasPreview: true,
  createdAt: '2026-03-01T00:00:00.000Z',
  error: null,
};

export const isSampleDocument = (id: string): boolean => id === SAMPLE_DOCUMENT_ID;

/** The sample is in English, so its suggestions stay in English in every UI language. */
export const SAMPLE_QUESTIONS = [
  'What is the notice period for termination?',
  'How much late payment interest applies?',
  'Is there a cap on liability?',
  'Does the agreement cover parental leave?',
];
