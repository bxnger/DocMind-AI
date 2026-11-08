import { useState } from 'react';
import { FileText, GitCompareArrows, Network, Play, RotateCcw, Send, Upload } from 'lucide-react';
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
import { MODE_SAMPLE_QUESTIONS } from '@/features/userModes/sampleQuestions';
import { useUserMode } from '@/features/userModes/useUserMode';
import { IndustryPipeline } from '@/features/industry/IndustryPipeline';
import { BearingHero } from '@/features/industry/hero3d/BearingHero';
import { useWorkflowStart } from '@/features/industry/useWorkflowStart';
import { useUpload } from '@/features/upload/UploadProvider';
import { formatBytes } from '@/lib/format';
import { HomeModeStrip } from '@/features/userModes/HomeModeStrip';
import type { DocumentModel } from '@/types/document';

const HOME_DOCS = 5;
// The same backend answers in Telegram. An empty VITE_TELEGRAM_BOT_URL hides the link.
const TELEGRAM_BOT_URL = import.meta.env.VITE_TELEGRAM_BOT_URL ?? 'https://t.me/DOCMIND67_bot';

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
              <DocumentRow key={doc.id} doc={doc} tag={doc.isDemo ? t('documents.demoTag') : undefined} onDelete={doc.isDemo ? undefined : setDeleting} />
            ))}
          </ul>
        )}
      </div>
      <DeleteDocumentDialog doc={deleting} onClose={() => setDeleting(null)} />
    </section>
  );
}

export function HomePage() {
  const { t, i18n } = useTranslation();
  const documents = useDocuments();
  const capabilities = useCapabilities();
  const userMode = useUserMode();
  const { maxBytes } = useUpload();
  const { analyze, demo, demoBusy, demoFailed } = useWorkflowStart();
  const maxPages = capabilities.data?.limits.maxPages;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-6 md:px-8 md:py-8">
        <section data-testid="industry-hero" className="blueprint relative grid grid-cols-[minmax(0,1fr)] items-center gap-4 overflow-hidden rounded-panel border border-line bg-card px-5 py-7 sm:grid-cols-[minmax(0,1fr)_auto] md:px-8 md:py-10">
          <BearingHero className="mx-auto size-[180px] sm:order-last sm:size-[200px] md:size-[240px] lg:size-[300px] xl:size-[340px]" />
          <div className="relative min-w-0 max-w-[640px]">
            <p className="micro-label mb-2" translate="no">DOCMIND INDUSTRY</p>
            <h1 className="font-display text-[28px] leading-[34px] font-medium tracking-[-0.02em] sm:text-[36px] sm:leading-[42px] md:text-[44px] md:leading-[50px]">{t('home.title')}</h1>
            <p className="mt-3 text-base text-muted sm:text-md">{t('home.subtitle')}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" size="lg" data-testid="home-analyze" className="max-sm:w-full max-sm:whitespace-normal max-sm:h-auto max-sm:min-h-11 max-sm:py-2" icon={<Upload size={16} aria-hidden />} onClick={analyze}>{t('home.analyze')}</Button>
              <Button size="lg" data-testid="home-demo" className="max-sm:w-full max-sm:min-h-11" icon={<Play size={16} aria-hidden />} loading={demoBusy} onClick={() => void demo()}>{t('home.demo')}</Button>
            </div>
            {demoFailed && <p role="alert" data-testid="home-demo-error" className="mt-2 text-sm text-danger">{t('home.demoFailed')}</p>}
            <p className="tabular mt-3 text-xs text-muted">
              <span className="pointer-coarse:hidden">{t('home.dropHint')} </span>
              {t('upload.limits', { size: formatBytes(maxBytes, i18n.language) })}
              {maxPages ? ` ${t('upload.pagesLimit', { count: maxPages })}` : ''}
            </p>
            <p data-testid="home-demo-note" className="mt-1 text-xs text-muted">{t('home.demoNote')}</p>
          </div>
        </section>
        <IndustryPipeline />
        <RecentDocuments />
        <section aria-labelledby="home-chat-title" data-testid="home-chat" className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
          <div className="min-w-0">
            <h2 id="home-chat-title" className="font-display text-lg font-medium">{t('home.chatTitle')}</h2>
            <p className="mt-1 text-sm text-muted">{t('home.chatBody')}</p>
            <section aria-label={t('home.tryLabel')} data-testid="home-try" className="mt-4">
              <h3 className="micro-label mb-1.5">{t('home.tryLabel')}</h3>
              <ul className="flex flex-wrap gap-1.5">
                {MODE_SAMPLE_QUESTIONS[userMode].slice(0, 3).map(({ key }) => (
                  <li key={key} className="min-w-0">
                    <Link to={`/documents/${SAMPLE_DOCUMENT_ID}`} state={{ prefill: t(`home.sample.${key}`) }} className="pressable inline-flex min-h-8 max-w-full items-center rounded-full border border-line bg-card px-3 py-1 text-sm hover:border-line-strong hover:bg-card-raised pointer-coarse:min-h-10">
                      {t(`home.sample.${key}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
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
              {TELEGRAM_BOT_URL && (
                <a
                  href={TELEGRAM_BOT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-6 items-center gap-1.5 text-muted hover:text-accent pointer-coarse:min-h-10"
                >
                  <Send size={14} aria-hidden />
                  {t('home.shortcutTelegram')}
                  <span className="sr-only"> ({t('home.opensInNewTab')})</span>
                </a>
              )}
            </nav>
          </div>
          <EvidencePreview />
        </section>
        <HomeModeStrip hasDocuments={(documents.data?.length ?? 0) > 0} />
      </div>
    </div>
  );
}
