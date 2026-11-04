import { useState } from 'react';
import { FileQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StateBlock } from '@/components/ui/StateBlock';
import type { Annotation, JumpRequest } from '@/features/viewer/PdfViewer';
import { usePdfDocument, type PdfInput } from '@/features/viewer/usePdfDocument';
import { usePdfText } from '@/features/viewer/usePdfText';
import { useDocumentSource } from '@/features/workspace/useDocumentSource';
import { ViewerPane } from '@/features/workspace/ViewerPane';
import type { DocumentModel } from '@/types/document';

const NO_PAGES: ReadonlySet<number> = new Set();

/** The app's own viewer for one side, with that side's changes marked where they are really found on the page. */
function LoadedPane({ doc, jump, annotations }: { doc: DocumentModel; jump: JumpRequest | null; annotations: Annotation[] }) {
  const [attempt, setAttempt] = useState(0);
  const source = useDocumentSource(doc);
  const input: PdfInput | null = source.kind === 'pdf' ? source.input : null;
  const pdf = usePdfDocument(input, attempt);
  const text = usePdfText(doc.id, pdf);
  return (
    <ViewerPane
      doc={doc}
      source={source}
      pdf={pdf}
      text={text.data}
      jump={jump}
      citedPages={NO_PAGES}
      quoteNotice
      annotations={annotations}
      compact
      onRetry={() => setAttempt(attempt + 1)}
    />
  );
}

export function ComparePane({ doc, jump, annotations }: { doc: DocumentModel | undefined; jump: JumpRequest | null; annotations: Annotation[] }) {
  const { t } = useTranslation();
  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center">
        <StateBlock icon={<FileQuestion size={18} aria-hidden />} title={t('compare.deletedDocument')} description={t('compare.deletedBody')} />
      </div>
    );
  }
  return <LoadedPane key={doc.id} doc={doc} jump={jump} annotations={annotations} />;
}
