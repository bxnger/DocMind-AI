import type { DocumentText } from '@/services/chat';
import type { EvidenceRect } from '@/types/chat';
import { findMatches, type TextMatch } from './textMatch';

/**
 * How precisely a source can be shown on the page, from the most to the least precise:
 * - coordinates: the backend sent rectangles for the quote
 * - text: no rectangles, but the quote was found verbatim in the page's text layer
 * - page: only the page is known, so nothing is highlighted
 * - unknown: the page text has not been read yet, so it cannot be said yet
 * - section: a DOCX source, which has a heading and no page
 */
export type LocatorKind = 'coordinates' | 'text' | 'page' | 'unknown' | 'section';

export interface Locatable {
  page: number | null;
  quote: string | null;
  highlights?: EvidenceRect[];
}

export interface Located {
  kind: LocatorKind;
  match: TextMatch | null;
}

/** Never invents a location: a highlight exists only if the backend sent it or the quote is really on the page. */
export function locateEvidence(target: Locatable, pages: DocumentText | undefined): Located {
  if (target.page === null) return { kind: 'section', match: null };
  if (target.highlights?.length) return { kind: 'coordinates', match: null };
  if (!target.quote) return { kind: 'page', match: null };
  if (!pages) return { kind: 'unknown', match: null };
  const pageText = pages[target.page - 1];
  const [match] = pageText ? findMatches(pageText.items, target.quote, { limit: 1 }) : [];
  return match ? { kind: 'text', match } : { kind: 'page', match: null };
}
