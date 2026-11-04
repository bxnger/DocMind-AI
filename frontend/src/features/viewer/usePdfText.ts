import { useQuery } from '@tanstack/react-query';
import { extractDocumentText } from '@/services/chat';
import type { PdfState } from './usePdfDocument';

/** The real text of a loaded PDF, read once per file. */
export function usePdfText(documentId: string, pdf: PdfState) {
  const proxy = pdf.status === 'ready' ? pdf.pdf : null;
  return useQuery({
    queryKey: ['pdf-text', documentId, proxy?.fingerprints[0]],
    queryFn: () => {
      if (!proxy) throw new Error('PDF is not loaded');
      return extractDocumentText(proxy);
    },
    enabled: proxy !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
}
