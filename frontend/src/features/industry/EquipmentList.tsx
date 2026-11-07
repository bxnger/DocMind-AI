import type { ReactNode } from 'react';
import { CircleAlert, Cog, Upload } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppError } from '@/api/client';
import { getParts } from '@/api/procurement';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { useDocuments } from '@/features/documents/useDocuments';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { useCapabilities } from '@/features/system/useSystem';
import { useUpload } from '@/features/upload/UploadProvider';
import { isDemoDocument } from '@/services/industryDemo';
import type { DocumentModel } from '@/types/document';
import type { PartList } from '@/types/procurement';

const MAX_DOCUMENTS = 20;

interface RowProps {
  doc: DocumentModel;
  list: PartList | null | undefined;
  loading: boolean;
}

/**
 * The documents of a session, with what the server already extracted from each. It only reads: extraction costs model
 * calls, so it starts when the person opens a document's workflow.
 */
export function EquipmentList({ renderAction, renderNote }: { renderAction: (props: RowProps) => ReactNode; renderNote?: (doc: DocumentModel) => ReactNode }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const documents = useDocuments();
  const capabilities = useCapabilities();
  const { openPicker } = useUpload();
  const live = capabilities.data?.features.parts === true;
  const docs = (documents.data ?? []).slice(0, MAX_DOCUMENTS);
  const lists = useQueries({
    queries: docs.map((doc) => ({
      queryKey: ['procurement', 'overview', doc.id],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await getParts(doc.id, signal);
        } catch (error) {
          if (error instanceof AppError && error.code === 'PARTS_NOT_STARTED') return null;
          throw error;
        }
      },
      enabled: live && doc.status === 'ready',
      retry: false,
    })),
  });

  if (documents.isPending) return <div role="status" aria-label={t('common.loading')} className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>;
  if (documents.isError) return <StateBlock tone="danger" icon={<CircleAlert size={18} aria-hidden />} title={t('documents.loadError')} description={errorMessage(documents.error)} actions={<Button loading={documents.isFetching} onClick={() => void documents.refetch()}>{t('common.retry')}</Button>} />;
  if (docs.length === 0) return <StateBlock icon={<Cog size={18} aria-hidden />} title={t('industry.emptyTitle')} description={t('industry.emptyBody')} actions={<Button variant="primary" icon={<Upload size={14} aria-hidden />} onClick={openPicker}>{t('home.analyze')}</Button>} />;

  return (
    <ul className="space-y-2">
      {docs.map((doc, index) => {
        const query = lists[index];
        const list = query?.data;
        const equipment = list?.equipment;
        const title = [equipment?.name, equipment?.model].filter(Boolean).join(' ');
        const unverified = list?.summary.unverified ?? 0;
        return (
          <li key={doc.id} data-testid="equipment-row" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-line bg-card p-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-line bg-sidebar text-accent"><Cog size={16} aria-hidden /></span>
            <div className="min-w-0 flex-1 basis-48">
              <p className="font-semibold break-words [overflow-wrap:anywhere]">{title || doc.name}</p>
              <p className="text-xs break-words text-muted [overflow-wrap:anywhere]">
                {title ? `${doc.name} · ` : ''}
                {isDemoDocument(doc.name) ? `${t('industry.demoDocumentTag')} · ` : ''}
                <span data-testid="equipment-status">
                  {doc.status !== 'ready' ? t(`status.${doc.status}`)
                    : !live ? t('industry.statusDemo')
                      : query?.isError ? t('industry.statusError')
                        : !query || query.isPending ? t('common.loading')
                          : !list ? t('industry.statusNotStarted')
                            : list.status === 'processing' ? t('procurement.loading')
                              : list.status === 'failed' ? t('industry.statusFailed')
                                : t('industry.statusParts', { count: list.parts.length })}
                </span>
                {unverified > 0 && <span className="text-warning"> · {t('procurement.needsCheck', { count: unverified })}</span>}
              </p>
              {renderNote?.(doc)}
            </div>
            {renderAction({ doc, list, loading: Boolean(query?.isPending && live && doc.status === 'ready') })}
          </li>
        );
      })}
    </ul>
  );
}
