import { useMemo } from 'react';
import { History } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button, buttonClasses } from '@/components/ui/Button';
import { StateBlock } from '@/components/ui/StateBlock';
import { DocumentRow, DocumentRowSkeleton } from '@/features/documents/DocumentRow';
import { useDocuments } from '@/features/documents/useDocuments';
import { formatRelative } from '@/lib/format';
import { clearRecents, useRecents } from '@/services/recents';
import { isSampleDocument, sampleDocument } from '@/services/sampleDocument';

export function RecentPage() {
  const { t, i18n } = useTranslation();
  const recents = useRecents();
  const documents = useDocuments();

  const rows = useMemo(
    () =>
      recents.flatMap((entry) => {
        const doc = isSampleDocument(entry.id)
          ? sampleDocument(i18n.language)
          : documents.data?.find((candidate) => candidate.id === entry.id);
        return doc ? [{ doc, openedAt: entry.openedAt }] : [];
      }),
    [documents.data, i18n.language, recents],
  );

  return (
    <PageContainer
      title={t('recent.title')}
      description={t('recent.subtitle')}
      actions={
        rows.length > 0 && (
          <Button variant="ghost" onClick={clearRecents}>
            {t('recent.clear')}
          </Button>
        )
      }
    >
      <div className="overflow-hidden rounded-panel border border-line bg-sidebar">
        {documents.isPending && recents.length > 0 ? (
          <ul role="status" aria-label={t('common.loading')}>
            <DocumentRowSkeleton />
            <DocumentRowSkeleton />
          </ul>
        ) : rows.length === 0 ? (
          <StateBlock
            icon={<History size={18} aria-hidden />}
            title={t('recent.emptyTitle')}
            description={t('recent.emptyBody')}
            actions={
              <Link to="/documents" className={buttonClasses('secondary')}>
                {t('recent.browse')}
              </Link>
            }
          />
        ) : (
          <ul>
            {rows.map(({ doc, openedAt }) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                tag={isSampleDocument(doc.id) ? t('documents.sampleTag') : undefined}
                meta={t('recent.opened', { when: formatRelative(openedAt, i18n.language) })}
              />
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
