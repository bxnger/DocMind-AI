import { useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { EvidenceSource } from '@/types/chat';

interface Props {
  id?: string;
  source: EvidenceSource;
  active: boolean;
  onActivate: (marker: number | null) => void;
  onOpen: (source: EvidenceSource) => void;
}

const COLLAPSED_LINES = 4;

export function SourceCard({ id, source, active, onActivate, onOpen }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const quoteRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [copied, setCopied] = useState(false);

  useLayoutEffect(() => {
    const element = quoteRef.current;
    if (element && !expanded) setOverflows(element.scrollHeight > element.clientHeight + 1);
  }, [expanded, source.quote]);

  const copy = async () => {
    const citation =
      source.page === null
        ? t('sources.copyFormatSection', { quote: source.quote, name: source.documentName, location: source.location ?? '' })
        : t('sources.copyFormat', { quote: source.quote, name: source.documentName, page: source.page });
    try {
      await navigator.clipboard.writeText(citation);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn('Clipboard write failed', error);
      toast.show(t('sources.copyFailed'), 'error');
    }
  };

  return (
    <article
      id={id}
      data-testid="source-card"
      onMouseEnter={() => onActivate(source.index)}
      onMouseLeave={() => onActivate(null)}
      className={cn(
        'rounded-control border bg-card p-3 transition-colors duration-150',
        active ? 'border-accent-2-line bg-card-raised' : 'border-line',
      )}
    >
      <header className="flex items-center gap-2 text-xs text-muted">
        <span className="tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md border border-accent-2-line px-1 font-medium text-accent-2">
          {source.index}
        </span>
        <span className="min-w-0 flex-1 truncate" title={source.documentName}>
          {source.documentName}
        </span>
        {source.page !== null ? (
          <span className="tabular shrink-0 font-medium text-fg">{t('sources.page', { page: source.page })}</span>
        ) : (
          source.location && <span className="max-w-[50%] shrink-0 truncate font-medium text-fg" title={source.location}>{source.location}</span>
        )}
      </header>
      {/* The serif face and accent rule mark this as the document's words, not the assistant's. */}
      <blockquote className="mt-3 border-l-2 border-accent-2 pl-3">
        <p
          ref={quoteRef}
          className="font-quote text-[15px] leading-[23px] break-words text-fg/90"
          style={
            expanded
              ? undefined
              : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: COLLAPSED_LINES, overflow: 'hidden' }
          }
        >
          {source.quote}
        </p>
      </blockquote>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="mt-1 ml-3 text-xs font-medium text-muted hover:text-fg"
        >
          {expanded ? t('sources.showLess') : t('sources.showMore')}
        </button>
      )}
      <footer className="mt-3 flex flex-wrap items-center gap-1">
        {source.page !== null && (
          <Button size="sm" icon={<ExternalLink size={14} aria-hidden />} onClick={() => onOpen(source)}>
            {t('sources.openPage', { page: source.page })}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={copied ? <Check size={14} className="text-success" aria-hidden /> : <Copy size={14} aria-hidden />}
          onClick={() => void copy()}
        >
          {copied ? t('sources.copied') : t('sources.copy')}
        </Button>
      </footer>
    </article>
  );
}
