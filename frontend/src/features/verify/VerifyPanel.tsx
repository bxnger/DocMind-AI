import { useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, CircleHelp, CircleOff, CircleX, FileText, ShieldCheck } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MAX_CLAIM_LENGTH, verifyClaim } from '@/api/verify';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { useCapabilities } from '@/features/system/useSystem';
import { cn } from '@/lib/cn';
import type { EvidenceSource } from '@/types/chat';
import type { DocumentModel } from '@/types/document';
import type { ClaimCheck, Verdict } from '@/types/verify';

const LOOK: Record<Verdict, { Icon: typeof CircleCheck; tone: string }> = {
  supported: { Icon: CircleCheck, tone: 'bg-success-tint text-success' },
  partly: { Icon: CircleHelp, tone: 'bg-warning-tint text-warning' },
  contradicted: { Icon: CircleX, tone: 'bg-danger-tint text-danger' },
  not_found: { Icon: CircleOff, tone: 'bg-hover text-muted' },
};

function Result({ result, onOpenSource }: { result: ClaimCheck; onOpenSource: (source: EvidenceSource) => void }) {
  const { t } = useTranslation();
  const { Icon, tone } = LOOK[result.verdict];
  const place = (source: EvidenceSource) => (source.page !== null ? t('sources.page', { page: source.page }) : (source.location ?? t('procurement.inText')));
  return (
    <section data-testid="verify-result" data-verdict={result.verdict} aria-live="polite" className="rounded-panel border border-line bg-card p-3">
      <p className={cn('inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium', tone)}>
        <Icon size={14} className="shrink-0" aria-hidden />
        {t(`verify.verdict.${result.verdict}`)}
      </p>
      {result.explanation && <p data-testid="verify-explanation" className="mt-2 break-words [overflow-wrap:anywhere]">{result.explanation}</p>}
      {result.verdict === 'not_found' && <p data-testid="verify-not-found" className="mt-2 text-sm text-muted">{t(result.reason ? `chat.notFoundReason.${result.reason}` : 'verify.notFoundBody')}</p>}
      {result.sources.length > 0 && (
        <>
          <h3 className="micro-label mt-3 mb-1">{t('verify.sources')}</h3>
          <ul className="space-y-1.5">
            {result.sources.map((source) => (
              <li key={`${source.index}-${source.quote}`}>
                <button type="button" data-testid="verify-source" onClick={() => onOpenSource(source)} aria-label={t('procurement.source', { place: place(source) })} className="pressable w-full rounded-control border border-line bg-sidebar p-2 text-left hover:border-accent-2-line">
                  <span className="mb-1 flex items-center gap-1 text-xs font-medium"><FileText size={12} className="shrink-0 text-muted" aria-hidden /><span className="min-w-0 truncate">[{source.index}] {place(source)}</span></span>
                  <span className="line-clamp-4 border-l-2 border-accent-2 pl-2 font-quote text-[14px] leading-[21px] break-words text-fg/90">{source.quote}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 text-xs text-muted">{t('verify.limit')}</p>
    </section>
  );
}

const Frame = ({ children }: { children: ReactNode }) => <div className="h-full overflow-y-auto"><div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-4 sm:px-6">{children}</div></div>;

export function VerifyPanel({ doc, onOpenSource }: { doc: DocumentModel; onOpenSource: (source: EvidenceSource) => void }) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const capabilities = useCapabilities();
  const [claim, setClaim] = useState('');
  const check = useMutation({ mutationFn: (text: string) => verifyClaim(doc.id, doc.name, text, i18n.language) });

  if (capabilities.isPending) return <Frame><Skeleton className="h-40" /></Frame>;
  if (capabilities.data?.features.claimCheck !== true) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <div data-testid="verify-unavailable"><StateBlock icon={<ShieldCheck size={18} aria-hidden />} title={t('verify.unavailableTitle')} description={t('verify.unavailableBody')} /></div>
      </div>
    );
  }
  if (doc.status !== 'ready') {
    return <div className="flex h-full items-center justify-center overflow-y-auto"><div data-testid="verify-not-ready"><StateBlock icon={<CircleAlert size={18} aria-hidden />} title={t('verify.notReadyTitle')} description={t('verify.notReadyBody')} /></div></div>;
  }

  const text = claim.trim();
  const tooLong = claim.length > MAX_CLAIM_LENGTH;
  const canSend = text.length > 0 && !tooLong && !check.isPending;
  const send = () => {
    if (canSend) check.mutate(text);
  };

  return (
    <Frame>
      <div data-testid="verify-panel">
        <h2 className="font-display text-lg font-semibold">{t('verify.title')}</h2>
        <p className="mt-0.5 text-sm text-muted">{t('verify.subtitle')}</p>
      </div>
      <form
        className="rounded-panel border border-line bg-card p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="block text-sm font-medium" htmlFor="verify-claim">{t('verify.label')}</label>
        <textarea
          id="verify-claim"
          data-testid="verify-input"
          rows={3}
          value={claim}
          onChange={(event) => setClaim(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={t('verify.placeholder')}
          aria-describedby="verify-count"
          className="mt-1 w-full resize-y rounded-control border border-line bg-bg p-2 text-[16px] text-fg outline-none placeholder:text-muted focus:border-accent md:text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" data-testid="verify-submit" loading={check.isPending} disabled={!text || tooLong}>{t('verify.submit')}</Button>
          <span id="verify-count" data-testid="verify-count" className={cn('tabular ml-auto text-xs', tooLong ? 'text-danger' : 'text-muted')}>{claim.length} / {MAX_CLAIM_LENGTH}</span>
        </div>
        {tooLong && <p role="alert" data-testid="verify-too-long" className="mt-1 text-sm text-danger">{t('verify.tooLong', { max: MAX_CLAIM_LENGTH })}</p>}
      </form>
      {check.isPending && <div role="status" aria-label={t('verify.checking')} className="space-y-2"><p className="text-sm text-muted">{t('verify.checking')}</p><Skeleton className="h-24" /></div>}
      {check.isError && !check.isPending && (
        <p role="alert" data-testid="verify-error" className="rounded-control bg-danger-tint p-2.5 text-sm text-danger">{errorMessage(check.error)}</p>
      )}
      {check.data && !check.isPending && <Result result={check.data} onOpenSource={onOpenSource} />}
    </Frame>
  );
}
