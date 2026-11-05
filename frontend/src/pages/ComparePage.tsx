import { useMemo, useState } from 'react';
import { ArrowLeftRight, CircleAlert, GitCompareArrows, Plus, RotateCcw } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { CompareResults } from '@/features/comparison/CompareResults';
import { useComparison, useStartComparison } from '@/features/comparison/useComparison';
import { useDocuments } from '@/features/documents/useDocuments';
import { useCodeMessage, useErrorMessage } from '@/features/system/useErrorMessage';
import { formatDate } from '@/lib/format';
import type { DocumentModel } from '@/types/document';

function Picker({ label, value, docs, onChange }: { label: string; value: string; docs: DocumentModel[]; onChange: (id: string) => void }) {
  const { i18n } = useTranslation();
  const isDuplicate = (doc: DocumentModel) => docs.filter((other) => other.name === doc.name).length > 1;
  return (
    <label className="min-w-0 flex-1 basis-56 text-sm text-muted">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-control border border-line bg-card px-3 text-fg outline-none focus:border-accent">
        {docs.map((doc) => (
          <option key={doc.id} value={doc.id}>
            {doc.name}{doc.kind === 'docx' ? ' (DOCX)' : ''}{isDuplicate(doc) ? ` · ${formatDate(doc.createdAt, i18n.language)}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function Notice() {
  const { t } = useTranslation();
  return (
    <p data-testid="compare-notice" className="text-xs text-muted">
      <strong className="font-medium text-fg">{t('compare.noticeTitle')}</strong> {t('compare.noticeBody')}
    </p>
  );
}

function Results({ id, documents, onNew }: { id: string; documents: DocumentModel[]; onNew: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const codeMessage = useCodeMessage();
  const comparison = useComparison(id);
  const data = comparison.data;
  const docA = documents.find((doc) => doc.id === data?.documentAId);
  const docB = documents.find((doc) => doc.id === data?.documentBId);
  const failure = (title: string, description: string) => (
    <StateBlock
      tone="danger"
      icon={<CircleAlert size={18} aria-hidden />}
      title={title}
      description={description}
      className="my-auto"
      actions={<Button onClick={onNew}>{t('compare.newComparison')}</Button>}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 md:px-4">
        <h1 className="flex min-w-0 flex-1 basis-64 items-center gap-2 text-sm font-medium">
          <span className="min-w-0 truncate" title={docA?.name}>{docA?.name ?? t('compare.title')}</span>
          {data && (
            <>
              <ArrowLeftRight size={14} className="shrink-0 text-muted" aria-label={t('compare.versus')} />
              <span className="min-w-0 truncate" title={docB?.name}>{docB?.name ?? t('compare.deletedDocument')}</span>
            </>
          )}
        </h1>
        <div className="max-w-xl max-lg:hidden"><Notice /></div>
        <Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={onNew}>{t('compare.newComparison')}</Button>
      </header>
      <details className="border-b border-line px-3 py-1.5 text-xs lg:hidden">
        <summary className="flex min-h-6 cursor-pointer items-center gap-1 text-muted pointer-coarse:min-h-9"><strong className="font-medium text-fg">{t('compare.noticeTitle')}</strong> {t('compare.noticeMore')}</summary>
        <Notice />
      </details>
      {comparison.isPending ? (
        <div role="status" aria-label={t('compare.running')} className="space-y-2 p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : !data ? (
        failure(t('compare.loadError'), errorMessage(comparison.error))
      ) : data.status === 'failed' ? (
        failure(t('compare.failed'), codeMessage(data.errorCode))
      ) : data.status === 'processing' ? (
        <div role="status" className="m-4 rounded-panel border border-line bg-sidebar p-4 text-sm">
          <p>{data.progress === null ? t('compare.running') : t('compare.runningPercent', { percent: Math.round(data.progress * 100) })}</p>
          {data.progress !== null && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full origin-left rounded-full bg-accent transition-transform duration-150" style={{ transform: `scaleX(${data.progress})` }} />
            </div>
          )}
        </div>
      ) : (
        <CompareResults key={data.id} comparison={data} docA={docA} docB={docB} />
      )}
    </div>
  );
}

export function ComparePage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const documents = useDocuments();
  const start = useStartComparison();
  const [params, setParams] = useSearchParams();
  const [pickA, setPickA] = useState('');
  const [pickB, setPickB] = useState('');
  const id = params.get('id');

  const ready = useMemo(() => (documents.data ?? []).filter((doc) => doc.status === 'ready'), [documents.data]);
  const a = ready.some((doc) => doc.id === pickA) ? pickA : (ready[0]?.id ?? '');
  const b = ready.some((doc) => doc.id === pickB) ? pickB : (ready.find((doc) => doc.id !== a)?.id ?? '');
  const waiting = (documents.data ?? []).length - ready.length;

  if (id) return <Results key={id} id={id} documents={documents.data ?? []} onNew={() => setParams({})} />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-4 py-6 md:px-8 md:py-10">
        <h1 className="font-display text-2xl font-medium tracking-[-0.015em]">{t('compare.title')}</h1>
        <p className="mt-1 max-w-[65ch] text-muted">{t('compare.subtitle')}</p>
        <div className="mt-3"><Notice /></div>
        <div className="mt-6 rounded-panel border border-line bg-card p-4">
          {documents.isPending ? (
            <Skeleton className="h-24" />
          ) : documents.isError ? (
            <StateBlock tone="danger" icon={<CircleAlert size={18} aria-hidden />} title={t('documents.loadError')} description={errorMessage(documents.error)} actions={<Button icon={<RotateCcw size={14} aria-hidden />} onClick={() => void documents.refetch()}>{t('common.retry')}</Button>} />
          ) : ready.length < 2 ? (
            <StateBlock icon={<GitCompareArrows size={18} aria-hidden />} title={t('compare.needTwo')} description={waiting > 0 ? t('compare.needTwoWaiting') : t('compare.needTwoBody')} />
          ) : (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                start.mutate({ a, b }, { onSuccess: (created) => setParams({ id: created.id }) });
              }}
            >
              <Picker label={t('compare.documentA')} value={a} docs={ready} onChange={setPickA} />
              <Picker label={t('compare.documentB')} value={b} docs={ready} onChange={setPickB} />
              <Button type="submit" variant="primary" size="lg" loading={start.isPending} disabled={a === b}>{t('compare.start')}</Button>
              {a === b && <p className="w-full text-sm text-warning">{t('errors.codes.SAME_DOCUMENT')}</p>}
              {start.isError && <p role="alert" className="w-full text-sm text-danger">{errorMessage(start.error)}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
