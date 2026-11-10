import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getSessionToken, invalidateSession } from '@/api/session';
import { PDF_OPTIONS, pdfjs } from './pdfjs';
import { isUnauthorized, pdfUrlSource, type PdfInput } from './pdfSource';

export type { PdfInput } from './pdfSource';
export type PdfErrorKind = 'password' | 'invalid' | 'load';

export type PdfState =
  | { status: 'idle' }
  /** `progress` is real bytes received, or null when the total size is unknown. */
  | { status: 'loading'; progress: number | null }
  | { status: 'ready'; pdf: PDFDocumentProxy }
  | { status: 'error'; kind: PdfErrorKind };

function classify(error: unknown): PdfErrorKind {
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') return 'password';
  if (name === 'InvalidPDFException') return 'invalid';
  return 'load';
}

export function usePdfDocument(input: PdfInput | null, attempt: number): PdfState {
  const [result, setResult] = useState<{ input: PdfInput; attempt: number; state: PdfState } | null>(null);

  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    const setState = (state: PdfState) => setResult({ input, attempt, state });

    let token: string | null = null;

    const load = async () => {
      if (input.type === 'url' && input.authenticated) token = await getSessionToken();
      const source =
        input.type === 'url'
          ? pdfUrlSource(input.url, token)
          : { data: new Uint8Array(await input.blob.arrayBuffer()) };
      if (cancelled) return;
      // Damaged files are reported through the UI, so PDF.js only needs to log real errors.
      task = pdfjs.getDocument({ ...source, ...PDF_OPTIONS, verbosity: pdfjs.VerbosityLevel.ERRORS });
      task.onProgress = ({ loaded, total }: { loaded: number; total?: number }) => {
        if (!cancelled && total) setState({ status: 'loading', progress: Math.min(loaded / total, 1) });
      };
      const pdf = await task.promise;
      if (!cancelled) setState({ status: 'ready', pdf });
    };

    load().catch((error: unknown) => {
      if (token && isUnauthorized(error)) invalidateSession(token);
      if (!cancelled) setState({ status: 'error', kind: classify(error) });
    });

    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [input, attempt]);

  if (!input) return { status: 'idle' };
  // A result for an earlier file or attempt is stale, so this load counts as just started.
  return result?.input === input && result.attempt === attempt ? result.state : { status: 'loading', progress: null };
}
