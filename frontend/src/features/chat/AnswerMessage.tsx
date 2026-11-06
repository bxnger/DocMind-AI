import { useState } from 'react';
import { motion } from 'motion/react';
import { CircleAlert, RotateCcw, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useEvidenceApi } from '@/features/evidence/EvidenceContext';
import { AnswerMarkdown } from '@/features/sources/AnswerMarkdown';
import { SourceCard } from '@/features/sources/SourceCard';
import type { AssistantMessage, EvidenceSource, NotFoundReason } from '@/types/chat';

interface Props {
  message: AssistantMessage;
  animate: boolean;
  onRetry: (id: string) => void;
  onRephrase: () => void;
  onUseDemo: (() => void) | null;
}

function Working({ live }: { live: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="pulse-dot size-1.5 rounded-full bg-muted" style={{ animationDelay: `${dot * 160}ms` }} />
        ))}
      </span>
      {t(live ? 'chat.workingLive' : 'chat.working')}
    </div>
  );
}

function NotFound({ reason, onRephrase }: { reason: NotFoundReason | undefined; onRephrase: () => void }) {
  const { t } = useTranslation();
  // Saved history has no reason, and a rejected answer is a different thing from a document that lacks it.
  const rejected = reason === 'no_citation' || reason === 'citations_failed_verification' || reason === 'empty_answer';
  return (
    <div data-testid="not-found" data-reason={reason} className="rounded-control border border-line bg-card p-3">
      <p className="flex items-center gap-2 font-medium">
        <SearchX size={16} className="shrink-0 text-warning" aria-hidden />
        {t(rejected ? 'chat.notVerifiedTitle' : 'chat.notFoundTitle')}
      </p>
      <p className="mt-1 text-sm text-muted">{t(reason ? `chat.notFoundReason.${reason}` : 'chat.notFoundBody')}</p>
      <Button size="sm" className="mt-3" onClick={onRephrase}>
        {t('chat.rephrase')}
      </Button>
    </div>
  );
}

export function AnswerMessage({ message, animate, onRetry, onRephrase, onUseDemo }: Props) {
  const { t } = useTranslation();
  const [activeMarker, setActiveMarker] = useState<number | null>(null);
  const evidence = useEvidenceApi();
  const selectedMarker = evidence.selected?.messageId === message.id ? evidence.selected.sourceIndex : null;
  // Pages open in the viewer. A DOCX source has no page, so the inspector shows its section and quote instead.
  const open = (source: EvidenceSource) => evidence.open(message.id, source);
  const notFound = message.answerStatus === 'not_found';
  const streaming = message.status === 'pending' && Boolean(message.text);
  const label = message.mode === 'demo' ? t('chat.labelDemo') : t('chat.labelAnswer');

  return (
    <motion.section
      aria-label={label}
      data-testid="answer"
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-3"
    >
      {/* An error is not an answer, so it doesn't sit under the answer's label. */}
      {message.status !== 'error' && <p className="micro-label">{label}</p>}

      {message.status === 'pending' && !message.text && <Working live={message.mode === 'live'} />}
      {notFound && <NotFound reason={message.notFoundReason} onRephrase={onRephrase} />}
      {message.text && !notFound && (
        <AnswerMarkdown
          text={message.text}
          sources={message.sources}
          activeMarker={activeMarker}
          selectedMarker={selectedMarker}
          onActivate={setActiveMarker}
          onOpenSource={open}
        />
      )}

      {streaming && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted">
          <span className="pulse-dot size-1.5 rounded-full bg-accent" aria-hidden />
          {t('chat.streaming')}
        </p>
      )}

      {message.sources.length > 0 && !notFound && (
        <div className="space-y-2">
          <h3 className="micro-label text-accent-2">{t('sources.heading')}</h3>
          {message.sources.map((source) => (
            <SourceCard
              key={source.index}
              id={`source-${message.id}-${source.index}`}
              source={source}
              active={activeMarker === source.index}
              selected={selectedMarker === source.index}
              onActivate={setActiveMarker}
              onOpen={open}
            />
          ))}
        </div>
      )}

      {message.status === 'stopped' && (
        <p className="text-sm text-muted">{message.mode === 'live' && message.text ? t('chat.stoppedUnverified') : t('chat.stopped')}</p>
      )}
      {(message.status === 'error' || message.status === 'stopped') && (
        <div role={message.status === 'error' ? 'alert' : undefined} className="space-y-2">
          {message.errorMessage && (
            <p className="flex items-center gap-2 text-sm text-danger">
              <CircleAlert size={14} aria-hidden />
              {message.errorMessage}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(message.status === 'stopped' || message.retryable === true) && (
              <Button size="sm" icon={<RotateCcw size={14} aria-hidden />} onClick={() => onRetry(message.id)}>
                {t('common.retry')}
              </Button>
            )}
            {(message.errorCode === 'LLM_UNAVAILABLE' || message.errorCode === 'AI_SESSION_BUDGET_EXCEEDED' || message.errorCode === 'AI_BUDGET_EXCEEDED') && onUseDemo && (
              <Button size="sm" onClick={onUseDemo}>{t('chat.useDemo')}</Button>
            )}
          </div>
        </div>
      )}
    </motion.section>
  );
}
