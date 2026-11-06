import type { ReactNode } from 'react';
import { CircleAlert, FileLock2, FileWarning, FileX2, Hourglass, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { StateBlock } from '@/components/ui/StateBlock';
import { Skeleton } from '@/components/ui/Skeleton';
import { DocxReader, type DocxTarget } from '@/features/docx/DocxReader';
import type { QuoteMark } from '@/features/docx/quoteParts';
import { useDocumentFailure } from '@/features/system/useErrorMessage';
import { PdfViewer, type Annotation, type JumpRequest } from '@/features/viewer/PdfViewer';
import type { PdfState } from '@/features/viewer/usePdfDocument';
import type { DocumentText } from '@/services/chat';
import type { DocumentModel } from '@/types/document';
import type { DocumentSource } from './useDocumentSource';

interface Props {
  doc: DocumentModel;
  source: DocumentSource;
  pdf: PdfState;
  text: DocumentText | undefined;
  jump: JumpRequest | null;
  docxTarget?: DocxTarget | null;
  docxMarks?: readonly QuoteMark[];
  citedPages: ReadonlySet<number>;
  quoteNotice: boolean;
  annotations?: Annotation[];
  compact?: boolean;
  roomForInspector?: boolean;
  onRetry: () => void;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center overflow-y-auto">{children}</div>;
}

function Loading({ progress }: { progress: number | null }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex h-full flex-col items-center p-6">
      <p className="tabular mb-4 text-sm text-muted">
        {progress === null ? t('viewer.loading') : t('viewer.loadingPercent', { percent: Math.round(progress * 100) })}
      </p>
      <Skeleton className="w-full max-w-xl flex-1" />
    </div>
  );
}

export function ViewerPane({ doc, source, pdf, text, jump, docxTarget, docxMarks, citedPages, quoteNotice, annotations, compact, roomForInspector, onRetry }: Props) {
  const { t } = useTranslation();
  const failure = useDocumentFailure();

  if (source.kind === 'checking') return <Loading progress={null} />;

  if (source.kind === 'unavailable') {
    if (source.reason === 'docx') {
      if (doc.status === 'ready') return <DocxReader doc={doc} target={docxTarget ?? null} roomForInspector={roomForInspector ?? false} marks={docxMarks} />;
      return (
        <Centered>
          <StateBlock icon={<FileWarning size={18} aria-hidden />} title={t('viewer.notReadyTitle')} description={t('viewer.docxBody')} />
        </Centered>
      );
    }
    if (source.reason === 'failed') {
      return (
        <Centered>
          <StateBlock
            tone="danger"
            icon={<CircleAlert size={18} aria-hidden />}
            title={t('viewer.failedTitle')}
            description={doc.error ? failure(doc) : t('viewer.failedBody')}
          />
        </Centered>
      );
    }
    return (
      <Centered>
        <StateBlock icon={<Hourglass size={18} aria-hidden />} title={t('viewer.notReadyTitle')} description={t('viewer.notReadyBody')} />
      </Centered>
    );
  }

  if (pdf.status === 'error') {
    const content = {
      password: { icon: <FileLock2 size={18} aria-hidden />, title: t('viewer.passwordTitle'), body: t('viewer.passwordBody') },
      invalid: { icon: <FileX2 size={18} aria-hidden />, title: t('viewer.invalidTitle'), body: t('viewer.invalidBody') },
      load: { icon: <CircleAlert size={18} aria-hidden />, title: t('viewer.loadTitle'), body: t('viewer.loadBody') },
    }[pdf.kind];
    return (
      <Centered>
        <StateBlock
          tone={pdf.kind === 'load' ? 'danger' : 'warning'}
          icon={content.icon}
          title={content.title}
          description={content.body}
          actions={
            pdf.kind === 'load' && (
              <Button icon={<RotateCcw size={14} aria-hidden />} onClick={onRetry}>
                {t('common.retry')}
              </Button>
            )
          }
        />
      </Centered>
    );
  }

  if (pdf.status !== 'ready') return <Loading progress={pdf.status === 'loading' ? pdf.progress : null} />;

  return <PdfViewer pdf={pdf.pdf} text={text} jump={jump} citedPages={citedPages} quoteNotice={quoteNotice} annotations={annotations} compact={compact} roomForInspector={roomForInspector} />;
}
