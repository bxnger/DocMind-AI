import { useMemo, useState } from 'react';
import { FileText, RotateCcw, Search, SearchX, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { StateBlock } from '@/components/ui/StateBlock';
import { DeleteDocumentDialog } from '@/features/documents/DeleteDocumentDialog';
import { DocumentRow, DocumentRowSkeleton } from '@/features/documents/DocumentRow';
import { useDocuments } from '@/features/documents/useDocuments';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { useUpload } from '@/features/upload/UploadProvider';
import { sampleDocument } from '@/services/sampleDocument';
import type { DocumentModel, DocumentStatus } from '@/types/document';

const GROUPS: DocumentStatus[] = ['processing', 'ready', 'failed'];

export function DocumentsPage() {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const { openPicker } = useUpload();
  const documents = useDocuments();
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<DocumentModel | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (documents.data ?? []).filter((doc) => doc.name.toLowerCase().includes(needle));
  }, [documents.data, query]);
  const total = documents.data?.length ?? 0;

  return (
    <PageContainer
      title={t('documents.title')}
      description={t('documents.subtitle')}
      actions={
        <Button variant="primary" size="lg" icon={<Upload size={16} aria-hidden />} onClick={openPicker}>
          {t('nav.upload')}
        </Button>
      }
    >
      <div className="relative mb-4">
        <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('documents.searchLabel')}
          placeholder={t('documents.searchPlaceholder')}
          className="h-10 w-full rounded-control border border-line bg-card pr-3 pl-9 outline-none transition-colors duration-150 placeholder:text-muted focus:border-accent"
        />
      </div>

      <div className="overflow-hidden rounded-panel border border-line bg-sidebar">
        {documents.isPending && (
          <ul role="status" aria-label={t('common.loading')}>
            <DocumentRowSkeleton />
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
        {documents.data && total === 0 && (
          <StateBlock
            icon={<FileText size={18} aria-hidden />}
            title={t('documents.emptyTitle')}
            description={t('documents.emptyBody')}
          />
        )}
        {total > 0 && visible.length === 0 && (
          <StateBlock
            icon={<SearchX size={18} aria-hidden />}
            title={t('documents.noMatches')}
            actions={<Button onClick={() => setQuery('')}>{t('documents.clearSearch')}</Button>}
          />
        )}
        {GROUPS.map((status) => {
          const group = visible.filter((doc) => doc.status === status);
          if (group.length === 0) return null;
          return (
            <section key={status} aria-label={t(`status.${status}`)}>
              <h2 className="flex h-9 items-center gap-2 border-b border-line bg-card px-3 text-sm font-medium">
                {t(`status.${status}`)}
                <span className="tabular text-muted">{group.length}</span>
              </h2>
              <ul>
                {group.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} tag={doc.isDemo ? t('documents.demoTag') : undefined} onDelete={doc.isDemo ? undefined : setDeleting} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="mt-6">
        <h2 className="micro-label mb-2">{t('documents.sampleHeading')}</h2>
        <ul className="overflow-hidden rounded-panel border border-line bg-sidebar">
          <DocumentRow doc={sampleDocument(i18n.language)} tag={t('documents.sampleTag')} meta={t('documents.sampleMeta')} />
        </ul>
      </section>

      <DeleteDocumentDialog doc={deleting} onClose={() => setDeleting(null)} />
    </PageContainer>
  );
}
