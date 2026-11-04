import { useEffect, useMemo, useState } from 'react';
import type { DocumentText } from '@/services/chat';
import { findMatches, type TextMatch } from './lib/textMatch';

export interface SearchHit {
  page: number;
  match: TextMatch;
}

const MAX_HITS = 500;
const DEBOUNCE_MS = 180;

export function useDocumentSearch(text: DocumentText | undefined, query: string) {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  return useMemo<SearchHit[]>(() => {
    if (!text || debounced.trim().length < 2) return [];
    const hits: SearchHit[] = [];
    for (const page of text) {
      const left = MAX_HITS - hits.length;
      if (left <= 0) break;
      for (const match of findMatches(page.items, debounced, { foldCase: true, limit: left })) {
        hits.push({ page: page.page, match });
      }
    }
    return hits;
  }, [text, debounced]);
}
