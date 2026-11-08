import { useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { isMobileApp } from '@/mobile/mobileMode';
import type { EvidenceSource } from '@/types/chat';
import { useCopyCitation } from './useCopyCitation';

interface Props {
  id?: string;
  source: EvidenceSource;
  active: boolean;
  /** This source is the one open in the inspector. */
  selected: boolean;
  onActivate: (marker: number | null) => void;
  onOpen: (source: EvidenceSource) => void;
}

const COLLAPSED_LINES = 4;
/** On a phone a source is a compact row: tap it to open the passage, expand it to read the whole quote and copy it. */
const PHONE = isMobileApp();
const PHONE_LINES = 2;

export function SourceCard({ id, source, active, selected, onActivate, onOpen }: Props) {
  const { t } = useTranslation();
  const quoteRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = quoteRef.current;
    if (element && !expanded) setOverflows(element.scrollHeight > element.clientHeight + 1);
  }, [expanded, source.quote]);

  const { copied, copy } = useCopyCitation(source);

  return (
    <article
      id={id}
      data-testid="source-card"
      onMouseEnter={() => onActivate(source.index)}
      onMouseLeave={() => onActivate(null)}
      data-selected={selected || undefined}
      aria-current={selected || undefined}
      className={cn(
        'group relative rounded-control border bg-card transition-colors duration-150',
        PHONE ? 'p-2.5' : 'p-3',
        selected
          ? 'border-accent-line bg-card-raised shadow-[inset_2px_0_0_var(--color-accent)]'
          : active
            ? 'border-accent-2-line bg-card-raised'
            : 'border-line hover:border-line-strong',
      )}
    >
      {/* The whole card opens the source. Buttons inside it sit above this layer. */}
      <button
        type="button"
        onClick={() => onOpen(source)}
        aria-label={t('evidence.cardLabel', { index: source.index })}
        className="absolute inset-0 rounded-control"
      />
      <header className="flex items-center gap-2 text-xs text-muted">
        <span className={cn("tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md border px-1 font-medium", selected ? "border-accent bg-accent text-on-accent" : "border-accent-2-line bg-accent-2-tint text-fg")}>
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
      <blockquote className={cn('border-l-2 border-accent-2 pl-3', PHONE ? 'mt-1.5' : 'mt-3')}>
        <p
          ref={quoteRef}
          className={cn('font-quote break-words text-fg/90', PHONE ? 'text-[14px] leading-[21px]' : 'text-[15px] leading-[23px]')}
          style={
            expanded
              ? undefined
              : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: PHONE ? PHONE_LINES : COLLAPSED_LINES, overflow: 'hidden' }
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
          data-testid="source-expand"
          className="relative z-10 mt-1 ml-3 inline-flex min-h-6 items-center text-xs font-medium text-muted hover:text-fg pointer-coarse:min-h-11"
        >
          {expanded ? t('sources.showLess') : t('sources.showMore')}
        </button>
      )}
      {(!PHONE || expanded) && <footer className="relative z-10 mt-3 flex flex-wrap items-center gap-1">
        <Button variant={selected ? 'primary' : 'secondary'} size="sm" icon={<ExternalLink size={14} aria-hidden />} onClick={() => onOpen(source)}>
          {source.page !== null ? t('sources.openPage', { page: source.page }) : t('evidence.inspect')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={copied ? <Check size={14} className="text-success" aria-hidden /> : <Copy size={14} aria-hidden />}
          onClick={() => void copy()}
        >
          {copied ? t('sources.copied') : t('sources.copy')}
        </Button>
      </footer>}
    </article>
  );
}
