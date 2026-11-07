import { useMemo, useState } from 'react';
import { FileQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StateBlock } from '@/components/ui/StateBlock';
import { useDocumentBlocks } from '@/features/documents/useDocumentContent';
import { blockInQuote, type QuoteMark } from '@/features/docx/quoteParts';
import type { Annotation, JumpRequest } from '@/features/viewer/PdfViewer';
import { usePdfDocument, type PdfInput } from '@/features/viewer/usePdfDocument';
import { usePdfText } from '@/features/viewer/usePdfText';
import { useDocumentSource } from '@/features/workspace/useDocumentSource';
import { ViewerPane } from '@/features/workspace/ViewerPane';
import type { DocumentModel } from '@/types/document';

const NO_PAGES: ReadonlySet<number> = new Set();

export interface PaneFocus {
  page: number | null;
  quote: string;
  nonce: number;
}

interface LoadedProps {
  doc: DocumentModel;
  focus: PaneFocus | null;
  annotations: Annotation[];
  textMarks: QuoteMark[];
}

/** The app's own viewer for one side: a PDF page, or the text of a DOCX. Changes are marked only where really found. */
function LoadedPane({ doc, focus, annotations, textMarks }: LoadedProps) {
  const [attempt, setAttempt] = useState(0);
  const source = useDocumentSource(doc);
  const input: PdfInput | null = source.kind === 'pdf' ? source.input : null;
  const pdf = usePdfDocument(input, attempt);
  const text = usePdfText(doc.id, pdf);
  const isDocx = doc.kind === 'docx';
  const blocks = useDocumentBlocks(doc.id, isDocx && doc.status === 'ready');

  // A new object per selection: the viewer moves when it changes.
  const jump = useMemo<JumpRequest | null>(() => (focus && focus.page !== null ? { page: focus.page, quote: focus.quote, nonce: focus.nonce } : null), [focus]);
  const docxTarget = useMemo(() => {
    if (!focus || !isDocx) return null;
    const list = blocks.data;
    const block = list?.find((candidate) => candidate.text.includes(focus.quote)) ?? list?.find((candidate) => blockInQuote(candidate.text, focus.quote));
    return block ? { paragraph: block.index, quote: focus.quote, nonce: focus.nonce } : null;
  }, [blocks.data, focus, isDocx]);

  return (
    <ViewerPane
      doc={doc}
      source={source}
      pdf={pdf}
      text={text.data}
      jump={jump}
      docxTarget={docxTarget}
      docxMarks={textMarks}
      citedPages={NO_PAGES}
      quoteNotice
      annotations={annotations}
      compact
      onRetry={() => setAttempt(attempt + 1)}
    />
  );
}

export function ComparePane({ doc, ...rest }: Omit<LoadedProps, 'doc'> & { doc: DocumentModel | undefined }) {
  const { t } = useTranslation();
  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center">
        <StateBlock icon={<FileQuestion size={18} aria-hidden />} title={t('compare.deletedDocument')} description={t('compare.deletedBody')} />
      </div>
    );
  }
  return <LoadedPane doc={doc} {...rest} />;
}
