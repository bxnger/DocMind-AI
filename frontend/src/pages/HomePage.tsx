import { useState } from 'react';
import { FileText, GitCompareArrows, Network, RotateCcw } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { StateBlock } from '@/components/ui/StateBlock';
import { DeleteDocumentDialog } from '@/features/documents/DeleteDocumentDialog';
import { DocumentRow, DocumentRowSkeleton } from '@/features/documents/DocumentRow';
import { EvidencePreview } from '@/features/documents/EvidencePreview';
import { useDocuments } from '@/features/documents/useDocuments';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { useCapabilities } from '@/features/system/useSystem';
import { SAMPLE_DOCUMENT_ID } from '@/services/sampleDocument';
import { Dropzone } from '@/features/upload/Dropzone';
import { HomeModeStrip } from '@/features/userModes/HomeModeStrip';
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
        <h2 className="font-display text-lg font-medium">{t('home.latest')}</h2>
        {(documents.data?.length ?? 0) > 0 && (
          <Link to="/documents" className="inline-flex min-h-6 items-center text-sm text-muted hover:text-fg pointer-coarse:min-h-10">
            {t('home.viewAll')}
          </Link>
        )}
      </div>
      <div className="rounded-panel border border-line bg-card">
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
          <p className="flex items-center gap-3 px-4 py-3 text-sm text-muted">
            <FileText size={16} className="shrink-0" aria-hidden />
            <span><strong className="font-medium text-fg">{t('documents.emptyTitle')}.</strong> {t('documents.emptyBody')}</span>
          </p>
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
  const documents = useDocuments();
  const capabilities = useCapabilities();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1040px] px-4 py-6 md:px-8 md:py-10">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
          <div className="min-w-0">
            <h1 className="font-display text-[26px] leading-[32px] font-medium sm:text-[32px] sm:leading-[38px] tracking-[-0.02em] md:text-[40px] md:leading-[46px]">{t('home.title')}</h1>
            <p className="mt-3 max-w-[58ch] text-base text-muted sm:text-md">{t('home.subtitle')}</p>
            <Dropzone className="mt-6" />
            <nav aria-label={t('home.shortcuts')} className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {capabilities.data?.comparison && (
                <Link to="/compare" className="inline-flex min-h-6 items-center gap-1.5 text-muted hover:text-accent pointer-coarse:min-h-10">
                  <GitCompareArrows size={14} aria-hidden />
                  {t('home.shortcutCompare')}
                </Link>
              )}
              <Link to={`/documents/${SAMPLE_DOCUMENT_ID}`} state={{ view: 'map' }} className="inline-flex min-h-6 items-center gap-1.5 text-muted hover:text-accent pointer-coarse:min-h-10">
                <Network size={14} aria-hidden />
                {t('home.shortcutMap')}
              </Link>
            </nav>
          </div>
          <EvidencePreview />
        </div>
        <RecentDocuments />
        <HomeModeStrip hasDocuments={(documents.data?.length ?? 0) > 0} />
      </div>
    </div>
  );
}
