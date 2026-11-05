import { useQuery } from '@tanstack/react-query';
import { getDocumentFacts, getDocumentText } from '@/api/documents';

/** A processed document does not change, so these are fetched once per id. */
export function useDocumentBlocks(id: string, enabled: boolean) {
  return useQuery({ queryKey: ['document-text', id], queryFn: ({ signal }) => getDocumentText(id, signal), enabled, staleTime: Infinity });
}

export function useDocumentFacts(id: string, enabled: boolean) {
  return useQuery({ queryKey: ['document-facts', id], queryFn: ({ signal }) => getDocumentFacts(id, signal), enabled, staleTime: Infinity });
}
