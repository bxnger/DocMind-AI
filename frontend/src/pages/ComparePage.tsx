import { useMemo, useState } from 'react';
import { CircleAlert, GitCompareArrows, RotateCcw } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { DifferenceCard } from '@/features/comparison/DifferenceCard';
import { useComparison, useStartComparison } from '@/features/comparison/useComparison';
import { useDocuments } from '@/features/documents/useDocuments';
import { useCodeMessage, useErrorMessage } from '@/features/system/useErrorMessage';
import { cn } from '@/lib/cn';
import type { DocumentModel } from '@/types/document';
import type { DifferenceType } from '@/types/comparison';

const FILTERS = ['all', 'changed', 'added', 'removed'] as const;
const PAGE_SIZE = 100;

function Picker({ label, value, docs, onChange }: { label: string; value: string; docs: DocumentModel[]; onChange: (id: string) => void }) {
  return (
    <label className="min-w-0 flex-1 text-sm text-muted">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-control border border-line bg-card px-3 text-fg outline-none focus:border-accent"
      >
        {docs.map((doc) => (
          <option key={doc.id} value={doc.id}>{doc.name}</option>
        ))}
      </select>
    </label>
  );
}

function Results({ id }: { id: string }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const codeMessage = useCodeMessage();
  const documents = useDocuments();
  const comparison = useComparison(id);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const data = comparison.data;

  const nameOf = (docId: string) => documents.data?.find((doc) => doc.id === docId)?.name ?? t('compare.deletedDocument');
  const countOf = (type: DifferenceType) => data?.differences.filter((d) => d.type === type).length ?? 0;
  const visible = useMemo(
    () => (data?.differences ?? []).filter((d) => filter === 'all' || d.type === filter),
    [data, filter],
  );

  if (comparison.isPending) return <Skeleton className="h-40" />;
  if (!data) {
    return (
      <StateBlock
        tone="danger"
        icon={<CircleAlert size={18} aria-hidden />}
        title={t('compare.loadError')}
        description={errorMessage(comparison.error)}
        actions={<Button icon={<RotateCcw size={14} aria-hidden />} onClick={() => void comparison.refetch()}>{t('common.retry')}</Button>}
      />
    );
  }
  if (data.status === 'failed') {
    return <StateBlock tone="danger" icon={<CircleAlert size={18} aria-hidden />} title={t('compare.failed')} description={codeMessage(data.errorCode)} />;
  }
  if (data.status === 'processing') {
    const percent = data.progress === null ? null : Math.round(data.progress * 100);
    return (
      <div role="status" className="rounded-panel border border-line bg-sidebar p-4 text-sm">
        <p>{percent === null ? t('compare.running') : t('compare.runningPercent', { percent })}</p>
        {data.progress !== null && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
            <div className="h-full origin-left rounded-full bg-accent transition-transform duration-150" style={{ transform: `scaleX(${data.progress})` }} />
          </div>
        )}
      </div>
    );
  }

  const a = { id: data.documentAId, name: nameOf(data.documentAId) };
  const b = { id: data.documentBId, name: nameOf(data.documentBId) };
  if (data.differences.length === 0) {
    return <StateBlock icon={<GitCompareArrows size={18} aria-hidden />} title={t('compare.noDifferences')} description={t('compare.noDifferencesBody')} />;
  }
  return (
    <section aria-label={t('compare.results')}>
      <div role="radiogroup" aria-label={t('compare.filter')} className="mb-3 inline-flex flex-wrap rounded-[10px] border border-line bg-card p-0.5">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={filter === value}
            onClick={() => { setFilter(value); setLimit(PAGE_SIZE); }}
            className={cn('pressable tabular h-8 rounded-lg px-3 text-sm font-medium', filter === value ? 'bg-accent-tint text-fg' : 'text-muted hover:text-fg')}
          >
            {value === 'all' ? `${t('compare.all')} ${data.differences.length}` : `${t(`compare.type.${value}`)} ${countOf(value)}`}
          </button>
        ))}
      </div>
      <ul className="space-y-3">
        {visible.slice(0, limit).map((difference) => (
          <DifferenceCard key={difference.id} difference={difference} a={a} b={b} />
        ))}
      </ul>
      {visible.length > limit && (
        <Button className="mt-3" onClick={() => setLimit(limit + PAGE_SIZE)}>{t('compare.showMore')}</Button>
      )}
    </section>
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

  return (
    <PageContainer title={t('compare.title')} description={t('compare.subtitle')}>
      <p data-testid="compare-notice" className="mb-4 rounded-control border border-line bg-card px-3 py-2 text-sm text-muted">
        <strong className="font-medium text-fg">{t('compare.noticeTitle')}</strong> {t('compare.noticeBody')}
      </p>
      {documents.isPending ? (
        <Skeleton className="h-24" />
      ) : documents.isError ? (
        <StateBlock tone="danger" icon={<CircleAlert size={18} aria-hidden />} title={t('documents.loadError')} description={errorMessage(documents.error)}
          actions={<Button icon={<RotateCcw size={14} aria-hidden />} onClick={() => void documents.refetch()}>{t('common.retry')}</Button>} />
      ) : ready.length < 2 ? (
        !id && <StateBlock icon={<GitCompareArrows size={18} aria-hidden />} title={t('compare.needTwo')} description={t('compare.needTwoBody')} />
      ) : (
        <form
          className="mb-6 flex flex-wrap items-end gap-3"
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
      {id && <Results key={id} id={id} />}
    </PageContainer>
  );
}
