import { useMemo, useState } from 'react';
import { CircleAlert, FileText, FlaskConical, Plus, RotateCcw, Upload, UserSearch } from 'lucide-react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AppError } from '@/api/client';
import { getHrMatch, startHrMatch } from '@/api/hr';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { useDocuments } from '@/features/documents/useDocuments';
import { useCodeMessage, useErrorMessage } from '@/features/system/useErrorMessage';
import { useCapabilities } from '@/features/system/useSystem';
import { useUpload } from '@/features/upload/UploadProvider';
import { cn } from '@/lib/cn';
import { getDemoMatch, startDemoMatch } from '@/services/hr/demoMatch';
import type { EvidenceSource } from '@/types/chat';
import type { HrCoverage, HrMatch, HrRequirement, RequirementStatus } from '@/types/hr';
import type { DocumentModel } from '@/types/document';

const POLL_MS = 1500;
const TONE: Record<RequirementStatus, string> = {
  confirmed: 'bg-success-tint text-success',
  partial: 'bg-warning-tint text-warning',
  not_found: 'bg-hover text-muted',
};
const STATUSES: RequirementStatus[] = ['confirmed', 'partial', 'not_found'];

function SourceLink({ source, label }: { source: EvidenceSource; label: string }) {
  const { t } = useTranslation();
  const place = source.page !== null ? t('sources.page', { page: source.page }) : (source.location ?? t('procurement.inText'));
  return (
    <Link data-testid="hr-source" to={`/documents/${encodeURIComponent(source.documentId)}`} state={{ source }} className="pressable block rounded-control border border-line bg-sidebar p-2 text-left hover:border-accent-2-line">
      <span className="mb-1 flex items-center gap-1 text-xs font-medium">
        <FileText size={12} className="shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 truncate">{label} · {place}</span>
      </span>
      <span className="line-clamp-3 border-l-2 border-accent-2 pl-2 font-quote text-[14px] leading-[21px] break-words text-fg/90">{source.quote}</span>
    </Link>
  );
}

function Requirement({ item }: { item: HrRequirement }) {
  const { t } = useTranslation();
  return (
    <li data-testid="hr-requirement" data-kind={item.kind} data-status={item.status} className="rounded-panel border border-line bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex min-h-5 items-center rounded-full px-2 text-xs font-medium', TONE[item.status])}>{t(`hr.status.${item.status}`)}</span>
        <span className="text-xs text-muted">{t(`hr.kind.${item.kind}`)}</span>
      </div>
      <p className="mt-1.5 font-medium break-words [overflow-wrap:anywhere]">{item.requirement}</p>
      {item.explanation && <p className="mt-1 text-sm text-muted">{item.explanation}</p>}
      {item.status === 'not_found' && <p className="mt-1 text-xs text-muted">{t('hr.notFoundHint')}</p>}
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {item.vacancySource && <SourceLink source={item.vacancySource} label={t('hr.vacancy')} />}
        {item.evidence.map((source) => <SourceLink key={`${source.page}-${source.quote}`} source={source} label={t('hr.resume')} />)}
      </div>
    </li>
  );
}

function CoverageRow({ title, coverage }: { title: string; coverage: HrCoverage }) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 flex-1 basis-56 rounded-panel border border-line bg-card p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="tabular mt-1 flex flex-wrap gap-x-3 text-sm">
        <span className="text-success">{t('hr.status.confirmed')}: {coverage.confirmed}</span>
        <span className="text-warning">{t('hr.status.partial')}: {coverage.partial}</span>
        <span className="text-muted">{t('hr.status.not_found')}: {coverage.notFound}</span>
      </p>
    </div>
  );
}

function DemoNote() {
  const { t } = useTranslation();
  return (
    <p data-testid="hr-demo" role="note" className="flex gap-2 rounded-control bg-warning-tint p-2.5 text-xs text-warning">
      <FlaskConical size={14} className="mt-px shrink-0" aria-hidden />
      <span><strong className="font-semibold">{t('hr.demoTitle')}</strong> {t('hr.demoBody')}</span>
    </p>
  );
}

function Result({ match, demo }: { match: HrMatch; demo: boolean }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<RequirementStatus | 'all'>('all');
  const shown = match.requirements.filter((item) => filter === 'all' || item.status === filter);
  const must = shown.filter((item) => item.kind === 'must');
  const nice = shown.filter((item) => item.kind === 'nice');
  return (
    <div data-testid="hr-result" className="space-y-3">
      {demo && <DemoNote />}
      <p data-testid="hr-notice" role="note" className="rounded-control border border-accent-line bg-accent-tint p-2.5 text-sm font-medium">{t('hr.notice')}</p>
      <div className="flex flex-wrap gap-2">
        <CoverageRow title={t('hr.kindPlural.must')} coverage={match.coverage.must} />
        <CoverageRow title={t('hr.kindPlural.nice')} coverage={match.coverage.nice} />
      </div>
      <div role="group" aria-label={t('hr.filter')} className="inline-flex max-w-full overflow-x-auto rounded-[10px] border border-line bg-card p-0.5">
        {(['all', ...STATUSES] as const).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={cn('pressable h-8 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium pointer-coarse:h-10', filter === value ? 'bg-accent-tint text-fg' : 'text-muted hover:text-fg')}>
            {value === 'all' ? t('hr.all') : t(`hr.status.${value}`)}
          </button>
        ))}
      </div>
      {match.requirements.length === 0 && <StateBlock icon={<UserSearch size={18} aria-hidden />} title={t('hr.emptyTitle')} description={t('hr.emptyBody')} />}
      {must.length > 0 && <section><h2 className="mb-2 font-display text-lg font-semibold">{t('hr.kindPlural.must')}</h2><ul className="space-y-2">{must.map((item) => <Requirement key={item.requirement} item={item} />)}</ul></section>}
      {nice.length > 0 && <section><h2 className="mb-2 font-display text-lg font-semibold">{t('hr.kindPlural.nice')}</h2><ul className="space-y-2">{nice.map((item) => <Requirement key={item.requirement} item={item} />)}</ul></section>}
      {match.skills.length > 0 && (
        <section data-testid="hr-skills">
          <h2 className="mb-2 font-display text-lg font-semibold">{t('hr.skills')}</h2>
          <ul className="grid gap-2 md:grid-cols-2">
            {match.skills.map((skill) => <li key={skill.name} className="space-y-1"><p className="font-medium">{skill.name}</p>{skill.evidence.map((source) => <SourceLink key={source.quote} source={source} label={t('hr.resume')} />)}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function Picker({ label, value, docs, onChange }: { label: string; value: string; docs: DocumentModel[]; onChange: (id: string) => void }) {
  return (
    <label className="block min-w-0 flex-1 basis-56 text-sm text-muted">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-control border border-line bg-card px-3 text-fg">
        {docs.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
      </select>
    </label>
  );
}

export function HrPage() {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const codeMessage = useCodeMessage();
  const documents = useDocuments();
  const capabilities = useCapabilities();
  const { openPicker } = useUpload();
  const [params, setParams] = useSearchParams();
  const [pickResume, setPickResume] = useState('');
  const [pickVacancy, setPickVacancy] = useState('');
  const id = params.get('id');
  const live = capabilities.data?.features.hr === true;
  const demo = !live;

  const ready = useMemo(() => (documents.data ?? []).filter((doc) => doc.status === 'ready'), [documents.data]);
  const resume = ready.find((doc) => doc.id === pickResume) ?? ready[0];
  const vacancy = ready.find((doc) => doc.id === pickVacancy) ?? ready.find((doc) => doc.id !== resume?.id);

  const start = useMutation({
    mutationFn: async () => {
      if (!resume || !vacancy) throw new AppError({ code: 'VALIDATION_ERROR', message: 'Choose two documents' });
      return live ? startHrMatch(resume.id, vacancy.id, i18n.language) : startDemoMatch(resume, vacancy);
    },
    onSuccess: (match) => setParams({ id: match.id }),
  });
  const match = useQuery({
    queryKey: ['hr-match', id, live],
    queryFn: async ({ signal }) => (live ? getHrMatch(id ?? '', signal) : getDemoMatch(id ?? '')),
    enabled: id !== null && !capabilities.isPending,
    refetchInterval: (query) => (query.state.data?.status === 'processing' ? POLL_MS : false),
    placeholderData: keepPreviousData,
    retry: false,
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] space-y-4 px-4 py-6 md:px-8 md:py-8">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="font-display text-2xl font-medium tracking-[-0.015em]">{t('hr.title')}</h1>
            <p className="mt-1 max-w-[65ch] text-muted">{t('hr.subtitle')}</p>
          </div>
          {id && <Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => setParams({})}>{t('hr.new')}</Button>}
        </div>

        {id ? (
          match.isPending || match.data?.status === 'processing' ? (
            <div role="status" aria-label={t('hr.running')} className="space-y-2">
              <p className="text-sm text-muted">{t('hr.running')}</p>
              <Skeleton className="h-16" />
              <Skeleton className="h-32" />
            </div>
          ) : match.isError || match.data?.status === 'failed' ? (
            <StateBlock
              tone="danger"
              icon={<CircleAlert size={18} aria-hidden />}
              title={t('hr.failed')}
              description={match.isError ? (match.error instanceof AppError && match.error.status === 404 ? t('hr.gone') : errorMessage(match.error)) : codeMessage(match.data?.errorCode)}
              actions={<Button icon={<RotateCcw size={14} aria-hidden />} onClick={() => setParams({})}>{t('hr.new')}</Button>}
            />
          ) : match.data ? <Result match={match.data} demo={demo} /> : null
        ) : (
          <>
            {demo && !capabilities.isPending && <DemoNote />}
            <p data-testid="hr-notice" role="note" className="rounded-control border border-accent-line bg-accent-tint p-2.5 text-sm font-medium">{t('hr.notice')}</p>
            {documents.isPending ? <Skeleton className="h-32" /> : documents.isError ? (
              <StateBlock tone="danger" icon={<CircleAlert size={18} aria-hidden />} title={t('documents.loadError')} description={errorMessage(documents.error)} actions={<Button loading={documents.isFetching} onClick={() => void documents.refetch()}>{t('common.retry')}</Button>} />
            ) : ready.length < 2 ? (
              <StateBlock icon={<UserSearch size={18} aria-hidden />} title={t('hr.needTwo')} description={t('hr.needTwoBody')} actions={<Button variant="primary" icon={<Upload size={14} aria-hidden />} onClick={openPicker}>{t('upload.choose')}</Button>} />
            ) : (
              <form
                className="rounded-panel border border-line bg-card p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  start.mutate();
                }}
              >
                <div className="flex flex-wrap gap-3">
                  <Picker label={t('hr.resume')} value={resume?.id ?? ''} docs={ready} onChange={setPickResume} />
                  <Picker label={t('hr.vacancy')} value={vacancy?.id ?? ''} docs={ready} onChange={setPickVacancy} />
                </div>
                {resume?.id === vacancy?.id && <p className="mt-2 text-sm text-warning">{t('errors.codes.SAME_DOCUMENT')}</p>}
                {start.isError && <p role="alert" className="mt-2 text-sm text-danger">{errorMessage(start.error)}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button type="submit" variant="primary" size="lg" data-testid="hr-start" loading={start.isPending} disabled={capabilities.isPending || resume?.id === vacancy?.id}>{t('hr.start')}</Button>
                  <button type="button" onClick={openPicker} className={buttonClasses('ghost', 'md')}><Upload size={14} aria-hidden />{t('upload.choose')}</button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
