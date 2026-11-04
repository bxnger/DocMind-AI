import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronDown, ChevronUp, Columns2, GitCompareArrows, Info, Lock, Rows3, Unlock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { StateBlock } from '@/components/ui/StateBlock';
import type { JumpRequest } from '@/features/viewer/PdfViewer';
import { SPLIT_PANE_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import type { Comparison, Difference } from '@/types/comparison';
import type { DocumentModel } from '@/types/document';
import { ChangeRow, TypeBadge } from './ChangeRow';
import { annotationsFor, countChanges, filterChanges, looksUnrelated, mirrorTop, stepChange, type ChangeFilter, type Side } from './compareModel';
import { ComparePane } from './ComparePane';

const FILTERS: ChangeFilter[] = ['all', 'added', 'removed', 'changed'];
const PAGE_SIZE = 100;
/** A jump moves each document to its own passage, so the lock waits until that has finished. */
const LOCK_PAUSE_MS = 1800;

interface Props {
  comparison: Comparison;
  docA: DocumentModel | undefined;
  docB: DocumentModel | undefined;
}

const hasPreview = (doc: DocumentModel | undefined) => doc?.kind === 'pdf';

export function CompareResults({ comparison, docA, docB }: Props) {
  const { t } = useTranslation();
  const wide = useMediaQuery(SPLIT_PANE_QUERY);
  const all = comparison.differences;
  const counts = useMemo(() => countChanges(all), [all]);
  const [filter, setFilter] = useState<ChangeFilter>('all');
  const [selected, setSelected] = useState<{ id: string; nonce: number } | null>(null);
  const [view, setView] = useState<'changes' | 'documents'>('changes');
  const [documentsOpened, setDocumentsOpened] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [mobileSide, setMobileSide] = useState<Side>('a');
  const [lockChoice, setLockChoice] = useState<boolean | null>(null);
  const nonce = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const driver = useRef<Side | null>(null);
  const pausedUntil = useRef(0);

  const visible = useMemo(() => filterChanges(all, filter), [all, filter]);
  const current = all.find((difference) => difference.id === selected?.id) ?? null;
  const position = current ? visible.indexOf(current) : -1;
  const previews = hasPreview(docA) || hasPreview(docB);
  const bothPdf = hasPreview(docA) && hasPreview(docB);
  // On by default only where it means something: two PDFs of equal length.
  const locked = bothPdf && (lockChoice ?? docA?.pageCount === docB?.pageCount);

  const select = (difference: Difference) => {
    nonce.current += 1;
    pausedUntil.current = Date.now() + LOCK_PAUSE_MS;
    setSelected({ id: difference.id, nonce: nonce.current });
    if (!wide) setMobileSide(difference.a ? 'a' : 'b');
    const index = visible.indexOf(difference);
    if (index >= limit) setLimit(index + PAGE_SIZE);
  };
  const step = (delta: 1 | -1) => {
    const target = stepChange(visible, selected?.id ?? null, delta);
    if (target) select(target);
  };
  const openDocuments = () => {
    setDocumentsOpened(true);
    setView('documents');
  };

  useEffect(() => {
    if (selected) listRef.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, view]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, dialog')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'j') step(1);
      else if (event.key === 'k') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const jumpFor = (side: Side): JumpRequest | null => {
    const evidence = current?.[side];
    return evidence && evidence.page !== null && selected ? { page: evidence.page, quote: evidence.quote, nonce: selected.nonce } : null;
  };
  // Stable per selection: a new object would make the viewer jump again on every render.
  const jumpA = useMemo(() => jumpFor('a'), [selected?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const jumpB = useMemo(() => jumpFor('b'), [selected?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const annotationsA = useMemo(() => annotationsFor(all, 'a'), [all]);
  const annotationsB = useMemo(() => annotationsFor(all, 'b'), [all]);

  const claimPane = (event: React.SyntheticEvent<HTMLDivElement>) => {
    driver.current = event.currentTarget.dataset.side === 'b' ? 'b' : 'a';
  };
  const onPaneScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const side = event.currentTarget.dataset.side;
    if (!locked || driver.current !== side || Date.now() < pausedUntil.current) return;
    const from = event.target;
    if (!(from instanceof HTMLElement) || from.dataset.testid !== 'pdf-scroller') return;
    const other = event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-testid=compare-pane-${side === 'a' ? 'b' : 'a'}] [data-testid=pdf-scroller]`);
    if (other) other.scrollTop = mirrorTop({ top: from.scrollTop, range: from.scrollHeight - from.clientHeight }, other.scrollHeight - other.clientHeight);
  };

  const notes = [
    looksUnrelated(all) && t('compare.noteUnrelated'),
    (docA?.kind === 'docx' || docB?.kind === 'docx') && t('compare.noteDocx'),
    (docA?.ocrUsed || docB?.ocrUsed) && t('compare.noteOcr'),
  ].filter((note): note is string => Boolean(note));

  if (all.length === 0) {
    return <StateBlock icon={<GitCompareArrows size={18} aria-hidden />} title={t('compare.noDifferences')} description={t('compare.noDifferencesBody')} className="my-auto" />;
  }

  const nameA = docA?.name ?? t('compare.deletedDocument');
  const nameB = docB?.name ?? t('compare.deletedDocument');

  return (
    <section aria-label={t('compare.results')} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 md:px-4">
        <div role="radiogroup" aria-label={t('compare.filter')} className="inline-flex flex-wrap rounded-[10px] border border-line bg-card p-0.5">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={filter === value}
              onClick={() => {
                setFilter(value);
                setLimit(PAGE_SIZE);
              }}
              className={cn('pressable tabular relative h-8 rounded-lg px-2.5 text-sm font-medium', filter === value ? 'text-fg' : 'text-muted hover:text-fg')}
            >
              {filter === value && <motion.span layoutId="compare-filter" transition={{ duration: 0.16 }} className="absolute inset-0 rounded-lg bg-accent-tint" />}
              <span className="relative">
                {value === 'all' ? t('compare.all') : t(`compare.type.${value}`)} <span className={filter === value ? 'text-fg' : 'text-muted'}>{counts[value]}</span>
              </span>
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <div className="flex items-center">
          <IconButton dense label={t('compare.prev')} icon={<ChevronUp size={16} aria-hidden />} disabled={visible.length === 0} onClick={() => step(-1)} />
          <span aria-live="polite" data-testid="change-position" className="tabular min-w-14 text-center text-xs text-muted">
            {position >= 0 ? t('compare.position', { current: position + 1, total: visible.length }) : t('compare.positionNone', { total: visible.length })}
          </span>
          <IconButton dense label={t('compare.next')} icon={<ChevronDown size={16} aria-hidden />} disabled={visible.length === 0} onClick={() => step(1)} />
        </div>
        {view === 'documents' && bothPdf && wide && (
          <Button variant="ghost" size="sm" aria-pressed={locked} icon={locked ? <Lock size={14} aria-hidden /> : <Unlock size={14} aria-hidden />} title={t('compare.lockHint')} onClick={() => setLockChoice(!locked)}>
            {t('compare.scrollLock')}
          </Button>
        )}
        {previews && (
          <div role="group" aria-label={t('compare.viewLabel')} className="inline-flex rounded-[10px] border border-line bg-card p-0.5">
            <button type="button" aria-pressed={view === 'changes'} onClick={() => setView('changes')} className={cn('pressable inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium', view === 'changes' ? 'bg-accent-tint text-fg' : 'text-muted hover:text-fg')}>
              <Rows3 size={14} aria-hidden />
              {t('compare.viewChanges')}
            </button>
            <button type="button" aria-pressed={view === 'documents'} onClick={openDocuments} className={cn('pressable inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium', view === 'documents' ? 'bg-accent-tint text-fg' : 'text-muted hover:text-fg')}>
              <Columns2 size={14} aria-hidden />
              {t('compare.viewDocuments')}
            </button>
          </div>
        )}
      </div>

      {notes.map((note) => (
        <p key={note} role="note" className="flex items-start gap-2 border-b border-line bg-warning-tint px-4 py-1.5 text-xs text-warning">
          <Info size={14} className="mt-px shrink-0" aria-hidden />
          {note}
        </p>
      ))}

      <div ref={listRef} className={cn('min-h-0 flex-1 overflow-y-auto p-3 md:p-4', view !== 'changes' && 'hidden')}>
        {visible.length === 0 ? (
          <StateBlock icon={<GitCompareArrows size={18} aria-hidden />} title={t('compare.filterEmpty')} actions={<Button onClick={() => setFilter('all')}>{t('compare.all')}</Button>} />
        ) : (
          <ul className="mx-auto max-w-[1280px] space-y-2">
            {visible.slice(0, limit).map((difference) => (
              <ChangeRow
                key={difference.id}
                difference={difference}
                number={all.indexOf(difference) + 1}
                selected={difference.id === selected?.id}
                docA={{ id: docA?.id ?? null, name: nameA }}
                docB={{ id: docB?.id ?? null, name: nameB }}
                canShowInDocuments={previews}
                onSelect={() => select(difference)}
                onShowInDocuments={() => {
                  select(difference);
                  openDocuments();
                }}
              />
            ))}
          </ul>
        )}
        {visible.length > limit && (
          <div className="mt-3 text-center">
            <Button onClick={() => setLimit(limit + PAGE_SIZE)}>{t('compare.showMore')}</Button>
          </div>
        )}
      </div>

      {/* Stay mounted once opened, so switching views does not reload the PDFs. */}
      {documentsOpened && (
        <div className={cn('flex min-h-0 flex-1 flex-col', view !== 'documents' && 'hidden')}>
          {!wide && (
            <div role="group" aria-label={t('compare.viewLabel')} className="flex gap-1 border-b border-line p-2">
              {(['a', 'b'] as const).map((side) => (
                <button key={side} type="button" aria-pressed={mobileSide === side} onClick={() => setMobileSide(side)} className={cn('pressable h-9 min-w-0 flex-1 truncate rounded-lg px-2 text-sm font-medium', mobileSide === side ? 'bg-accent-tint text-fg' : 'text-muted')}>
                  {side.toUpperCase()} · {side === 'a' ? nameA : nameB}
                </button>
              ))}
            </div>
          )}
          {current && (
            <p data-testid="current-change" className="flex items-center gap-2 border-b border-line bg-sidebar px-3 py-1.5 text-xs text-muted">
              <TypeBadge type={current.type} />
              <span className="min-w-0 flex-1 truncate font-quote text-sm text-fg/90">{(current.b ?? current.a)?.quote}</span>
            </p>
          )}
          <div className="flex min-h-0 flex-1 divide-x divide-line">
            <div data-side="a" data-testid="compare-pane-a" aria-label={docA?.name ?? t('compare.deletedDocument')} onPointerEnter={claimPane} onWheelCapture={claimPane} onFocusCapture={claimPane} onScrollCapture={onPaneScroll} role="region" className={cn('min-w-0 flex-1', !wide && mobileSide !== 'a' && 'hidden')}>
              <ComparePane doc={docA} jump={jumpA} annotations={annotationsA} />
            </div>
            <div data-side="b" data-testid="compare-pane-b" aria-label={docB?.name ?? t('compare.deletedDocument')} onPointerEnter={claimPane} onWheelCapture={claimPane} onFocusCapture={claimPane} onScrollCapture={onPaneScroll} role="region" className={cn('min-w-0 flex-1', !wide && mobileSide !== 'b' && 'hidden')}>
              <ComparePane doc={docB} jump={jumpB} annotations={annotationsB} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
