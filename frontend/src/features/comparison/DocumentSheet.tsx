import { useMemo } from 'react';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDocumentBlocks } from '@/features/documents/useDocumentContent';
import { Page } from '@/features/viewer/pdfjs';
import { usePdfDocument } from '@/features/viewer/usePdfDocument';
import { useDocumentSource } from '@/features/workspace/useDocumentSource';
import type { DocumentModel } from '@/types/document';

const SHEET_WIDTH = 224;
const TEXT_BLOCKS = 12;

function PdfFirstPage({ doc }: { doc: DocumentModel }) {
  const source = useDocumentSource(doc);
  const input = useMemo(() => (source.kind === 'pdf' ? source.input : null), [source]);
  const pdf = usePdfDocument(input, 0);
  if (pdf.status !== 'ready') return <div className="skeleton h-full rounded-none" />;
  return <Page pdf={pdf.pdf} pageNumber={1} width={SHEET_WIDTH} suspense={false} renderTextLayer={false} renderAnnotationLayer={false} loading={null} error={null} />;
}

function DocxFirstBlocks({ doc }: { doc: DocumentModel }) {
  const blocks = useDocumentBlocks(doc.id, doc.status === 'ready');
  return (
    <div lang={doc.language && doc.language !== 'mixed' ? doc.language : undefined} className="h-full overflow-hidden p-3 text-[9px] leading-[13px] text-[#202925]">
      {blocks.data?.slice(0, TEXT_BLOCKS).map((block) => (
        <p key={block.index} className={block.kind === 'heading' ? 'mt-1 mb-0.5 text-[11px] font-semibold' : 'mb-1'}>{block.text}</p>
      ))}
    </div>
  );
}

/** The chosen document itself: its real first page, or the start of its real text when it has no pages. */
export function DocumentSheet({ doc, side }: { doc: DocumentModel | undefined; side: 'a' | 'b' }) {
  const { t, i18n } = useTranslation();
  return (
    <figure data-testid={`sheet-${side}`} className="document-sheet flex flex-col items-center">
      <div className="relative overflow-hidden rounded-sm bg-white shadow-[0_1px_2px_rgb(0_0_0/0.14),0_10px_28px_rgb(0_0_0/0.14)] ring-1 ring-black/5" style={{ width: SHEET_WIDTH, height: SHEET_WIDTH * 1.32 }}>
        {doc?.kind === 'pdf' && <PdfFirstPage key={doc.id} doc={doc} />}
        {doc?.kind === 'docx' && <DocxFirstBlocks key={doc.id} doc={doc} />}
        {!doc && <FileText size={24} className="absolute inset-0 m-auto text-black/30" aria-hidden />}
      </div>
      {doc && (
        <figcaption className="tabular mt-2 text-xs text-muted">
          {doc.kind.toUpperCase()}{doc.pageCount !== null ? ` · ${t('documents.pages', { count: doc.pageCount, lng: i18n.language })}` : ''}
        </figcaption>
      )}
    </figure>
  );
}
