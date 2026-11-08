import { useState } from 'react';
import { CircleAlert, FileText, Search, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { DeleteDocumentDialog } from '@/features/documents/DeleteDocumentDialog';
import { DocumentRow } from '@/features/documents/DocumentRow';
import { useDocuments } from '@/features/documents/useDocuments';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { useUpload } from '@/features/upload/UploadProvider';
import type { DocumentModel } from '@/types/document';
import { MobileScreen } from '../MobileHeader';

export function MobileDocuments() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const documents = useDocuments();
  const { openPicker } = useUpload();
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<DocumentModel | null>(null);
  const list = (documents.data ?? []).filter((doc) => doc.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <MobileScreen title={t('mobile.tab.documents')}>
      <Button variant="primary" size="lg" data-testid="documents-upload" className="h-12 w-full" icon={<Upload size={18} aria-hidden />} onClick={openPicker}>{t('mobile.documents.upload')}</Button>
      <p className="text-xs text-muted">{t('mobile.documents.formats')}</p>
      {(documents.data?.length ?? 0) > 3 && (
        <label className="relative block">
          <span className="sr-only">{t('documents.searchLabel')}</span>
          <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('documents.searchPlaceholder')} className="h-12 w-full rounded-control border border-line bg-card pr-3 pl-9 text-[16px] outline-none focus:border-accent" />
        </label>
      )}
      {documents.isPending && <Skeleton className="h-40" />}
      {documents.isError && <StateBlock tone="danger" icon={<CircleAlert size={18} aria-hidden />} title={t('documents.loadError')} description={errorMessage(documents.error)} actions={<Button loading={documents.isFetching} onClick={() => void documents.refetch()}>{t('common.retry')}</Button>} />}
      {documents.data?.length === 0 && <StateBlock icon={<FileText size={18} aria-hidden />} title={t('documents.emptyTitle')} description={t('mobile.documents.empty')} />}
      {list.length > 0 && (
        <ul data-testid="documents-list" className="overflow-hidden rounded-panel border border-line bg-card">
          {list.map((doc) => <DocumentRow key={doc.id} doc={doc} tag={doc.isDemo ? t('documents.demoTag') : undefined} onDelete={doc.isDemo ? undefined : setDeleting} />)}
        </ul>
      )}
      <DeleteDocumentDialog doc={deleting} onClose={() => setDeleting(null)} />
    </MobileScreen>
  );
}
