import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { documentFileUrl } from '@/api/documents';
import type { PdfInput } from '@/features/viewer/usePdfDocument';
import { getLocalFile } from '@/services/localFiles';
import { SAMPLE_DOCUMENT_URL, isSampleDocument } from '@/services/sampleDocument';
import type { DocumentModel } from '@/types/document';

export type PdfOrigin = 'backend' | 'browser' | 'sample';

export type DocumentSource =
  | { kind: 'checking' }
  | { kind: 'pdf'; origin: PdfOrigin; input: PdfInput }
  | { kind: 'unavailable'; reason: 'docx' | 'not-ready' | 'failed' };

/** Decides which real file the viewer can show. A file that cannot be shown is reported, never faked. */
export function useDocumentSource(doc: DocumentModel): DocumentSource {
  const needsLocalCopy = doc.kind === 'pdf' && doc.status === 'processing' && !isSampleDocument(doc.id);
  const local = useQuery({
    queryKey: ['local-file', doc.id],
    queryFn: () => getLocalFile(doc.id),
    enabled: needsLocalCopy,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  return useMemo<DocumentSource>(() => {
    if (isSampleDocument(doc.id)) return { kind: 'pdf', origin: 'sample', input: { type: 'url', url: SAMPLE_DOCUMENT_URL } };
    if (doc.status === 'failed') return { kind: 'unavailable', reason: 'failed' };
    if (doc.kind !== 'pdf') return { kind: 'unavailable', reason: 'docx' };
    if (doc.status === 'ready') return { kind: 'pdf', origin: 'backend', input: { type: 'url', url: documentFileUrl(doc.id) } };
    if (local.isPending) return { kind: 'checking' };
    if (local.data) return { kind: 'pdf', origin: 'browser', input: { type: 'blob', blob: local.data } };
    return { kind: 'unavailable', reason: 'not-ready' };
  }, [doc.id, doc.kind, doc.status, local.data, local.isPending]);
}
