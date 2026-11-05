import type { UseQueryResult } from '@tanstack/react-query';
import { CircleAlert, CornerDownLeft, Crosshair, ListChecks, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FACT_KINDS, type DocumentFacts } from '@/api/documents';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { useDocumentBlocks } from '@/features/documents/useDocumentContent';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import type { EvidenceSource } from '@/types/chat';
import type { DocumentModel } from '@/types/document';
import { canOpenFact, factSource } from './factSources';

export { factMessage } from './factSources';

interface Props {
  doc: DocumentModel;
  query: UseQueryResult<DocumentFacts>;
  onOpen: (source: EvidenceSource) => void;
  onAsk: (question: string) => void;
}

/** Dates, deadlines and amounts the server found by patterns, each with the sentence it came from. */
export function FactsPanel({ doc, query, onOpen, onAsk }: Props) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const blocks = useDocumentBlocks(doc.id, doc.kind === 'docx' && doc.status === 'ready');
  const quoteLang = doc.language && doc.language !== 'mixed' ? doc.language : undefined;

  const center = (content: React.ReactNode) => <div className="flex h-full items-center justify-center overflow-y-auto">{content}</div>;

  if (doc.status !== 'ready') {
    return center(<StateBlock icon={<ListChecks size={18} aria-hidden />} title={t('facts.title')} description={t(doc.status === 'failed' ? 'facts.failed' : 'facts.notReady')} />);
  }
  if (query.isPending) {
    return (
      <div role="status" aria-label={t('facts.loading')} className="mx-auto w-full max-w-2xl space-y-3 p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (query.isError) {
    return center(
      <StateBlock
        tone="danger"
        icon={<CircleAlert size={18} aria-hidden />}
        title={t('facts.errorTitle')}
        description={errorMessage(query.error)}
        actions={<Button icon={<RotateCcw size={14} aria-hidden />} loading={query.isFetching} onClick={() => void query.refetch()}>{t('common.retry')}</Button>}
      />,
    );
  }

  const { facts, suggestedQuestions } = query.data;

  return (
    <div data-testid="facts-panel" className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-5 sm:px-6">
        <p className="text-xs text-muted">{t('facts.note')}</p>

        {suggestedQuestions.length > 0 && (
          <section data-testid="facts-questions">
            <h2 className="micro-label mb-2">{t('facts.suggested')}</h2>
            <ul className="space-y-1" lang={quoteLang}>
              {suggestedQuestions.map((question) => (
                <li key={question}>
                  <button
                    type="button"
                    onClick={() => onAsk(question)}
                    className="pressable flex min-h-10 w-full items-start gap-2 rounded-control border border-line bg-card px-3 py-2 text-left text-sm hover:border-line-strong hover:bg-card-raised"
                  >
                    <CornerDownLeft size={14} className="mt-[3px] shrink-0 text-muted" aria-hidden />
                    {question}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-muted">{t('facts.suggestedHint')}</p>
          </section>
        )}

        {facts.length === 0 && <StateBlock icon={<ListChecks size={18} aria-hidden />} title={t('facts.emptyTitle')} description={t('facts.emptyBody')} />}

        {FACT_KINDS.map((kind) => {
          const group = facts.filter((fact) => fact.kind === kind);
          if (!group.length) return null;
          return (
            <section key={kind} data-kind={kind}>
              <h2 className="mb-2 font-display text-lg font-semibold">{t(`facts.kinds.${kind}`)}</h2>
              <ul className="space-y-2">
                {group.map((fact, position) => {
                  const source = factSource(fact, doc.id, doc.name, blocks.data);
                  const place = fact.page !== null ? t('sources.page', { page: fact.page }) : fact.location;
                  return (
                    <li key={`${position}:${fact.quote}`} data-testid="fact" className="rounded-control border border-line bg-card p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="font-semibold break-words [overflow-wrap:anywhere]" lang={quoteLang}>{fact.value}</p>
                        {place && <p className="tabular min-w-0 truncate text-xs font-medium text-muted" title={place}>{place}</p>}
                      </div>
                      <blockquote lang={quoteLang} className="mt-2 border-l-2 border-accent-2-line pl-3 font-quote text-[15px] leading-[23px] break-words [overflow-wrap:anywhere] text-fg/90">
                        {fact.quote}
                      </blockquote>
                      {canOpenFact(source) ? (
                        <Button size="sm" className="mt-2" icon={<Crosshair size={14} aria-hidden />} onClick={() => onOpen(source)}>
                          {t('facts.show')}
                        </Button>
                      ) : (
                        !blocks.isPending && <p className="mt-2 text-xs text-muted">{t('facts.noJump')}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
