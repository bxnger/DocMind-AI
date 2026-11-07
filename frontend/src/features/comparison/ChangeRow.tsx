import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, buttonClasses } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { Difference, DifferenceType, Evidence } from '@/types/comparison';
import { TONE } from './changeTone';
import { isMoved, type Side } from './compareModel';
import { diffWords, type Segment } from './wordDiff';

export function TypeBadge({ type, moved = false }: { type: DifferenceType; moved?: boolean }) {
  const { t } = useTranslation();
  const { badge, Icon } = TONE[type];
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-xs font-medium', badge)}>
      <Icon size={11} aria-hidden />
      {moved ? t('compare.moved') : t(`compare.type.${type}`)}
    </span>
  );
}

/** One side of a change: the real quote, with its changed words marked. */
export function DiffLine({ side, evidence, segments }: { side: Side; evidence: Evidence; segments: Segment[] | null }) {
  const { t } = useTranslation();
  const tone = side === 'a' ? 'bg-danger-tint text-danger line-through decoration-danger/60' : 'bg-success-tint text-success';
  return (
    <p data-line={side} className="flex gap-1.5 font-quote text-[14px] leading-[21px] break-words [overflow-wrap:anywhere] text-fg/90">
      <span aria-hidden className={cn('tabular w-3 shrink-0 text-center font-sans font-semibold', side === 'a' ? 'text-danger' : 'text-success')}>{side === 'a' ? '−' : '+'}</span>
      <span className="sr-only">{t(side === 'a' ? 'compare.lineRemoved' : 'compare.lineAdded')}</span>
      <span className="min-w-0">
        {segments
          ? segments.map((segment, index) => (segment.changed ? <mark key={index} className={cn('rounded-sm px-0.5', tone)}>{segment.text}</mark> : <span key={index}>{segment.text}</span>))
          : evidence.quote}
      </span>
    </p>
  );
}

export function useChangeLines(difference: Difference) {
  const { a, b } = difference;
  return useMemo(() => (a && b && a.quote !== b.quote ? diffWords(a.quote, b.quote) : null), [a, b]);
}

interface Props {
  difference: Difference;
  number: number;
  selected: boolean;
  docA: { id: string | null; name: string };
  docB: { id: string | null; name: string };
  onSelect: () => void;
  /** On a phone the documents are behind tabs, so a chosen change offers the way to them. */
  onShowIn?: (side: Side) => void;
}

function PageChip({ letter, evidence }: { letter: 'A' | 'B'; evidence: Evidence | null }) {
  const { t } = useTranslation();
  return (
    <span className="tabular inline-flex items-center gap-1 text-xs text-muted">
      <span className="font-semibold text-fg/80">{letter}</span>{' '}
      {!evidence ? '—' : evidence.page !== null ? t('sources.page', { page: evidence.page }) : t('compare.inText')}
    </span>
  );
}

/** One line of the change list. It shows the real text, and choosing it moves both documents to that change. */
export function ChangeRow({ difference, number, selected, docA, docB, onSelect, onShowIn }: Props) {
  const { t } = useTranslation();
  const { a, b, type } = difference;
  const moved = isMoved(difference);
  const diff = useChangeLines(difference);
  return (
    <li
      data-testid="difference"
      data-type={type}
      data-selected={selected || undefined}
      className={cn('rounded-control border border-l-[3px] transition-colors duration-150', TONE[type].rail, selected ? 'border-y-accent-line border-r-accent-line bg-card-raised' : 'border-y-line border-r-line bg-card hover:bg-card-raised')}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} className="block w-full rounded-control px-2.5 py-2 text-left outline-offset-[-2px]">
        <span className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="tabular min-w-4 text-xs font-medium text-muted">{number}</span>
          <TypeBadge type={type} moved={moved} />
          {diff && (
            <span className="tabular text-xs">
              <span className="text-danger">−{diff.removedWords}</span> <span className="text-success">+{diff.addedWords}</span>
              <span className="sr-only"> {t('compare.words')}</span>
            </span>
          )}
          <span className="ml-auto flex gap-2">
            <PageChip letter="A" evidence={a} />
            <PageChip letter="B" evidence={b} />
          </span>
        </span>
        <span className={cn('block space-y-1', !selected && 'line-clamp-3')}>
          {moved ? b && <DiffLine side="b" evidence={b} segments={null} /> : (
            <>
              {a && <DiffLine side="a" evidence={a} segments={diff?.a ?? null} />}
              {b && <DiffLine side="b" evidence={b} segments={diff?.b ?? null} />}
            </>
          )}
          {!a && !b && <span className="text-sm text-muted italic">{t('compare.unverified')}</span>}
        </span>
      </button>
      {selected && onShowIn && (a || b) && (
        <div className="flex flex-wrap gap-1 px-1.5 pb-1">
          {a && <Button size="sm" variant="primary" onClick={() => onShowIn('a')}>{t('compare.showIn', { letter: 'A' })}</Button>}
          {b && <Button size="sm" variant="primary" onClick={() => onShowIn('b')}>{t('compare.showIn', { letter: 'B' })}</Button>}
        </div>
      )}
      {selected && (a?.page != null || b?.page != null) && (
        <div className="flex flex-wrap gap-1 px-1.5 pb-1.5">
          {a?.page != null && docA.id && (
            <Link to={`/documents/${docA.id}`} state={{ jump: { page: a.page, quote: a.quote } }} className={buttonClasses('ghost', 'sm')}>
              <ExternalLink size={13} aria-hidden />
              {t('compare.openSide', { letter: 'A', page: a.page })}
            </Link>
          )}
          {b?.page != null && docB.id && (
            <Link to={`/documents/${docB.id}`} state={{ jump: { page: b.page, quote: b.quote } }} className={buttonClasses('ghost', 'sm')}>
              <ExternalLink size={13} aria-hidden />
              {t('compare.openSide', { letter: 'B', page: b.page })}
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
