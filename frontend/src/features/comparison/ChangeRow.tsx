import { useMemo } from 'react';
import { ArrowLeftRight, Columns2, ExternalLink, Minus, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, buttonClasses } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { Difference, DifferenceType, Evidence } from '@/types/comparison';
import { diffWords, type Segment } from './wordDiff';

export const TONE: Record<DifferenceType, { badge: string; rail: string; Icon: typeof Plus }> = {
  added: { badge: 'bg-success-tint text-success', rail: 'border-l-success', Icon: Plus },
  removed: { badge: 'bg-danger-tint text-danger', rail: 'border-l-danger', Icon: Minus },
  changed: { badge: 'bg-accent-tint text-accent-strong', rail: 'border-l-accent', Icon: ArrowLeftRight },
};

export function TypeBadge({ type }: { type: DifferenceType }) {
  const { t } = useTranslation();
  const { badge, Icon } = TONE[type];
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium', badge)}>
      <Icon size={12} aria-hidden />
      {t(`compare.type.${type}`)}
    </span>
  );
}

interface SideProps {
  documentId: string | null;
  name: string;
  letter: 'A' | 'B';
  evidence: Evidence | null;
  type: DifferenceType;
  segments: Segment[] | null;
  tone: 'removed' | 'added';
}

function Side({ documentId, name, letter, evidence, type, segments, tone }: SideProps) {
  const { t } = useTranslation();
  // A pair is 'changed', so a missing side there means the server could not verify its quote, not that it is absent.
  const emptyText = type === 'changed' ? t('compare.unverified') : t('compare.absent');
  const whole = type === (tone === 'removed' ? 'removed' : 'added');
  const mark = tone === 'removed' ? 'rounded-sm bg-danger-tint text-danger line-through decoration-danger/60' : 'rounded-sm bg-success-tint text-success underline decoration-success/60 underline-offset-2';
  return (
    <div data-side={letter} className="min-w-0 p-3">
      <p className="mb-2 flex min-h-5 items-center gap-2 text-xs text-muted">
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-fg text-[11px] font-semibold text-bg" aria-label={t(letter === 'A' ? 'compare.documentA' : 'compare.documentB')}>{letter}</span>
        <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
        {evidence && <span className="tabular shrink-0 font-medium text-fg">{evidence.page !== null ? t('sources.page', { page: evidence.page }) : t('compare.noLocation')}</span>}
      </p>
      {evidence ? (
        <>
          <p className={cn('font-quote text-[15px] leading-[23px] break-words text-fg/90', whole && (tone === 'removed' ? 'text-danger line-through decoration-danger/40' : 'text-success underline decoration-success/40 underline-offset-2'))}>
            {segments ? segments.map((segment, index) => (segment.changed ? <mark key={index} className={cn(mark, 'px-0.5')}>{segment.text}</mark> : <span key={index}>{segment.text}</span>)) : evidence.quote}
          </p>
          {evidence.page !== null && documentId && (
            <Link to={`/documents/${documentId}`} state={{ jump: { page: evidence.page, quote: evidence.quote } }} className={cn(buttonClasses('ghost', 'sm'), 'mt-2 -ml-2')}>
              <ExternalLink size={14} aria-hidden />
              {t('compare.openInDocument', { page: evidence.page })}
            </Link>
          )}
        </>
      ) : (
        <p className="text-sm text-muted italic">{emptyText}</p>
      )}
    </div>
  );
}

interface Props {
  difference: Difference;
  number: number;
  selected: boolean;
  docA: { id: string | null; name: string };
  docB: { id: string | null; name: string };
  canShowInDocuments: boolean;
  onSelect: () => void;
  onShowInDocuments: () => void;
}

/** One change with both sides aligned, so the two columns always stay in step. */
export function ChangeRow({ difference, number, selected, docA, docB, canShowInDocuments, onSelect, onShowInDocuments }: Props) {
  const { t } = useTranslation();
  const { a, b, type } = difference;
  const diff = useMemo(() => (a && b ? diffWords(a.quote, b.quote) : null), [a, b]);
  return (
    <li
      data-testid="difference"
      data-type={type}
      data-selected={selected || undefined}
      className={cn('overflow-hidden rounded-control border border-l-[3px] bg-card transition-colors duration-150', TONE[type].rail, selected ? 'border-y-accent-line border-r-accent-line shadow-[0_0_0_1px_var(--color-accent-line)]' : 'border-y-line border-r-line')}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line py-1 pr-1 pl-3">
        <button type="button" onClick={onSelect} aria-pressed={selected} className="relative flex min-h-8 min-w-40 flex-1 items-center gap-2 rounded-lg text-left">
          <span className="tabular text-xs text-muted">{number}</span>
          <TypeBadge type={type} />
          {diff && (
            <span className="tabular text-xs">
              <span className="text-danger">−{diff.removedWords}</span> <span className="text-success">+{diff.addedWords}</span>
              <span className="sr-only"> {t('compare.words')}</span>
            </span>
          )}
        </button>
        {canShowInDocuments && (
          <Button variant="ghost" size="sm" icon={<Columns2 size={14} aria-hidden />} onClick={onShowInDocuments}>
            {t('compare.showInDocuments')}
          </Button>
        )}
      </div>
      <div className="grid divide-line max-md:divide-y md:grid-cols-2 md:divide-x">
        <Side documentId={docA.id} name={docA.name} letter="A" evidence={a} type={type} segments={diff?.a ?? null} tone="removed" />
        <Side documentId={docB.id} name={docB.name} letter="B" evidence={b} type={type} segments={diff?.b ?? null} tone="added" />
      </div>
    </li>
  );
}
