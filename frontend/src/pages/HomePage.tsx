import { useState } from 'react';
import { FileText, RotateCcw } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { StateBlock } from '@/components/ui/StateBlock';
import { DeleteDocumentDialog } from '@/features/documents/DeleteDocumentDialog';
import { DocumentRow, DocumentRowSkeleton } from '@/features/documents/DocumentRow';
import { EvidencePreview } from '@/features/documents/EvidencePreview';
import { useDocuments } from '@/features/documents/useDocuments';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { Dropzone } from '@/features/upload/Dropzone';
import type { DocumentModel } from '@/types/document';

const HOME_DOCS = 5;

function RecentDocuments() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const documents = useDocuments();
  const [deleting, setDeleting] = useState<DocumentModel | null>(null);

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{t('home.latest')}</h2>
        {(documents.data?.length ?? 0) > 0 && (
          <Link to="/documents" className="text-sm text-muted hover:text-fg">
            {t('home.viewAll')}
          </Link>
        )}
      </div>
      <div className="rounded-panel border border-line bg-sidebar">
        {documents.isPending && (
          <ul role="status" aria-label={t('common.loading')}>
            <DocumentRowSkeleton />
            <DocumentRowSkeleton />
            <DocumentRowSkeleton />
          </ul>
        )}
        {documents.isError && (
          <StateBlock
            tone="danger"
            icon={<FileText size={18} aria-hidden />}
            title={t('documents.loadError')}
            description={errorMessage(documents.error)}
            actions={
              <Button icon={<RotateCcw size={14} aria-hidden />} loading={documents.isFetching} onClick={() => void documents.refetch()}>
                {t('common.retry')}
              </Button>
            }
          />
        )}
        {documents.data?.length === 0 && (
          <StateBlock icon={<FileText size={18} aria-hidden />} title={t('documents.emptyTitle')} description={t('documents.emptyBody')} />
        )}
        {documents.data && documents.data.length > 0 && (
          <ul>
            {documents.data.slice(0, HOME_DOCS).map((doc) => (
              <DocumentRow key={doc.id} doc={doc} onDelete={setDeleting} />
            ))}
          </ul>
        )}
      </div>
      <DeleteDocumentDialog doc={deleting} onClose={() => setDeleting(null)} />
    </section>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1040px] px-4 py-6 md:px-8 md:py-10">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">{t('home.title')}</h1>
          <p className="mt-1 max-w-[65ch] text-muted">{t('home.subtitle')}</p>
        </header>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Dropzone className="min-h-64" />
          <EvidencePreview />
        </div>
        <RecentDocuments />
      </div>
    </div>
  );
}
