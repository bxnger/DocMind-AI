import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronDown, ChevronUp, Columns2, FileText, GitCompareArrows, Info, ListTree, Lock, Rows3, Unlock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { StateBlock } from '@/components/ui/StateBlock';
import { SPLIT_PANE_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import type { Comparison, Difference } from '@/types/comparison';
import type { DocumentModel } from '@/types/document';
import { TONE } from './changeTone';
import { ChangeRow, TypeBadge } from './ChangeRow';
import { alignmentOf, annotationsFor, countChanges, filterChanges, isMoved, looksUnrelated, mirrorTop, stepChange, textMarksFor, type ChangeFilter, type Side } from './compareModel';
import { ComparePane, type PaneFocus } from './ComparePane';
import { UnifiedView } from './UnifiedView';

const FILTERS: ChangeFilter[] = ['all', 'added', 'removed', 'changed'];
const PAGE_SIZE = 100;
/** A jump moves each document to its own passage, so the lock waits until that has finished. */
const LOCK_PAUSE_MS = 1800;
/** Arrow keys that scroll a document or type in a field belong to it. */
const KEEPS_ARROWS = 'input, textarea, select, dialog, [data-testid=pdf-scroller], [data-testid=docx-reader], [data-testid=unified-view]';

type Mode = 'side' | 'unified';
type NarrowView = 'changes' | Side | 'unified';

interface Props {
  comparison: Comparison;
  docA: DocumentModel | undefined;
  docB: DocumentModel | undefined;
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; icon?: React.ReactNode }>; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full rounded-[10px] border border-line bg-card p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn('pressable inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium pointer-coarse:h-10', value === option.value ? 'bg-accent-tint text-fg' : 'text-muted hover:text-fg')}
        >
          {option.icon}
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/** What is known about one document at the current change: its role, its name, and where this change is in it. */
function SheetHeader({ side, doc, current, focus }: { side: Side; doc: DocumentModel | undefined; current: Difference | null; focus: PaneFocus | null }) {
  const { t } = useTranslation();
  const name = doc?.name ?? t('compare.deletedDocument');
  const absent = current && !current[side];
  return (
    <header className="flex min-h-10 shrink-0 items-center gap-2 border-b border-line bg-sidebar px-3 py-1">
      <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-fg text-[11px] font-semibold text-bg">{side.toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="micro-label block leading-3">{t(side === 'a' ? 'compare.original' : 'compare.revised')}</span>
        <span className="block truncate text-sm leading-5 font-medium" title={name}>{name}</span>
      </span>
      {doc?.kind === 'docx' && <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted"><FileText size={12} aria-hidden />{t('compare.textView')}</span>}
      {absent && <span data-testid={`absent-${side}`} className="shrink-0 rounded-full bg-hover px-2 py-0.5 text-xs text-muted">{t('compare.absentShort')}</span>}
      {focus && focus.page !== null && <span className="tabular shrink-0 text-xs font-medium">{t('sources.page', { page: focus.page })}</span>}
    </header>
  );
}

export function CompareResults({ comparison, docA, docB }: Props) {
  const { t } = useTranslation();
  const wide = useMediaQuery(SPLIT_PANE_QUERY);
  const all = comparison.differences;
  const counts = useMemo(() => countChanges(all), [all]);
  const [filter, setFilter] = useState<ChangeFilter>('all');
  // Opens on the first change, so the two documents immediately show what the comparison found.
  const [selected, setSelected] = useState<{ id: string; nonce: number } | null>(() => (all[0] ? { id: all[0].id, nonce: 1 } : null));
  const [mode, setMode] = useState<Mode>('side');
  const [narrowView, setNarrowView] = useState<NarrowView>('changes');
  const [panesOpened, setPanesOpened] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [lockChoice, setLockChoice] = useState<boolean | null>(null);
  const [hideUnchanged, setHideUnchanged] = useState(true);
  const nonce = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const driver = useRef<Side | null>(null);
  const pausedUntil = useRef(0);

  const visible = useMemo(() => filterChanges(all, filter), [all, filter]);
  const current = all.find((difference) => difference.id === selected?.id) ?? null;
  const position = current ? visible.indexOf(current) : -1;
  const alignment = alignmentOf(docA, docB);
  // On by default only where it means something: two PDFs of equal length.
  const locked = alignment !== 'none' && (lockChoice ?? alignment === 'same-length');
  const showSide = wide ? mode === 'side' : narrowView === 'a' || narrowView === 'b';
  const showUnified = wide ? mode === 'unified' : narrowView === 'unified';
  const panesMounted = wide || panesOpened || showSide;

  const select = (difference: Difference) => {
    nonce.current += 1;
    pausedUntil.current = Date.now() + LOCK_PAUSE_MS;
    setSelected({ id: difference.id, nonce: nonce.current });
    const index = visible.indexOf(difference);
    if (index >= limit) setLimit(index + PAGE_SIZE);
    // A side without this change has nothing to show, so a phone goes to the side that has it.
    if (!wide && (narrowView === 'a' || narrowView === 'b') && !difference[narrowView]) setNarrowView(difference.a ? 'a' : 'b');
  };
  const step = (delta: 1 | -1) => {
    const target = stepChange(visible, selected?.id ?? null, delta);
    if (target) select(target);
  };

  useEffect(() => {
    if (selected) listRef.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, narrowView]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.target instanceof Element && event.target.closest(KEEPS_ARROWS)) return;
      if (event.key === 'j' || event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'k' || event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const focusFor = (side: Side): PaneFocus | null => {
    const evidence = current?.[side];
    return evidence && selected ? { page: evidence.page, quote: evidence.quote, nonce: selected.nonce } : null;
  };
  // Stable per selection, and new when the documents swap: a new object makes the viewer jump.
  const focusA = useMemo(() => focusFor('a'), [selected?.nonce, comparison]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusB = useMemo(() => focusFor('b'), [selected?.nonce, comparison]); // eslint-disable-line react-hooks/exhaustive-deps
  const annotationsA = useMemo(() => annotationsFor(visible, 'a'), [visible]);
  const annotationsB = useMemo(() => annotationsFor(visible, 'b'), [visible]);
  const marksA = useMemo(() => textMarksFor(visible, 'a'), [visible]);
  const marksB = useMemo(() => textMarksFor(visible, 'b'), [visible]);

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
    alignment === 'none' && t('compare.noteNoAlignment'),
    alignment === 'proportional' && showSide && t('compare.noteProportional', { a: docA?.pageCount, b: docB?.pageCount }),
    (docA?.ocrUsed || docB?.ocrUsed) && t('compare.noteOcr'),
  ].filter((note): note is string => Boolean(note));

  if (all.length === 0) {
    return <StateBlock icon={<GitCompareArrows size={18} aria-hidden />} title={t('compare.noDifferences')} description={t('compare.noDifferencesBody')} className="my-auto" />;
  }

  const nameA = docA?.name ?? t('compare.deletedDocument');
  const nameB = docB?.name ?? t('compare.deletedDocument');
  const changes = (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
      {visible.length === 0 ? (
        <StateBlock icon={<GitCompareArrows size={18} aria-hidden />} title={t('compare.filterEmpty')} actions={<Button onClick={() => setFilter('all')}>{t('compare.all')}</Button>} />
      ) : (
        <ul className="space-y-1.5">
          {visible.slice(0, limit).map((difference) => (
            <ChangeRow
              key={difference.id}
              difference={difference}
              number={all.indexOf(difference) + 1}
              selected={difference.id === selected?.id}
              docA={{ id: docA?.id ?? null, name: nameA }}
              docB={{ id: docB?.id ?? null, name: nameB }}
              onSelect={() => select(difference)}
              onShowIn={wide ? undefined : (side) => {
                setPanesOpened(true);
                setNarrowView(side);
              }}
            />
          ))}
        </ul>
      )}
      {visible.length > limit && (
        <div className="mt-2 text-center">
          <Button size="sm" onClick={() => setLimit(limit + PAGE_SIZE)}>{t('compare.showMore')}</Button>
        </div>
      )}
    </div>
  );

  const stepper = (
    <div className="flex items-center">
      <IconButton dense label={t('compare.prev')} icon={<ChevronUp size={16} aria-hidden />} disabled={visible.length === 0} onClick={() => step(-1)} />
      <span aria-live="polite" data-testid="change-position" className="tabular min-w-14 text-center text-xs text-muted">
        {position >= 0 ? t('compare.position', { current: position + 1, total: visible.length }) : t('compare.positionNone', { total: visible.length })}
      </span>
      <IconButton dense label={t('compare.next')} icon={<ChevronDown size={16} aria-hidden />} disabled={visible.length === 0} onClick={() => step(1)} />
    </div>
  );

  return (
    <section aria-label={t('compare.results')} className="flex min-h-0 flex-1 flex-col">
      {/* The summary and the filter are one thing: how many of each kind, and which are shown. */}
      <div className={cn('flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 md:px-4', !wide && narrowView !== 'changes' && 'hidden')}>
        <div role="radiogroup" aria-label={t('compare.filter')} className="inline-flex max-w-full overflow-x-auto rounded-[10px] border border-line bg-card p-0.5">
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
              className={cn('pressable tabular relative h-8 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium pointer-coarse:h-10', filter === value ? 'text-fg' : 'text-muted hover:text-fg')}
            >
              {filter === value && <motion.span layoutId="compare-filter" transition={{ duration: 0.16 }} className="absolute inset-0 rounded-lg bg-accent-tint" />}
              <span className="relative inline-flex items-center gap-1.5">
                {value !== 'all' && <span aria-hidden className={cn('size-2.5 rounded-sm ring-1', TONE[value].dot)} />}
                {value === 'all' ? t('compare.all') : t(`compare.type.${value}`)} <span className={filter === value ? 'text-fg' : 'text-muted'}>{counts[value]}</span>
              </span>
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {wide && <span className="inline-flex items-center gap-1.5 text-xs text-muted"><span aria-hidden className="size-2.5 rounded-sm bg-[#f7e8ab] ring-1 ring-[#c9a93c]" />{t('compare.current')}</span>}
        {(wide || narrowView === 'changes') && stepper}
        {wide && mode === 'side' && alignment !== 'none' && (
          <Button variant="ghost" size="sm" aria-pressed={locked} icon={locked ? <Lock size={14} aria-hidden /> : <Unlock size={14} aria-hidden />} title={t('compare.lockHint')} onClick={() => setLockChoice(!locked)}>
            {t('compare.scrollLock')}
          </Button>
        )}
        {wide && showUnified && (
          <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-sm text-muted pointer-coarse:min-h-10">
            <input type="checkbox" checked={hideUnchanged} onChange={(event) => setHideUnchanged(event.target.checked)} className="size-4 accent-[var(--color-accent)]" />
            {t('compare.hideUnchanged')}
          </label>
        )}
        {wide && (
          <Segmented
            label={t('compare.viewLabel')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'side', label: t('compare.modeSide'), icon: <Columns2 size={14} aria-hidden /> },
              { value: 'unified', label: t('compare.modeUnified'), icon: <Rows3 size={14} aria-hidden /> },
            ]}
          />
        )}
      </div>

      {!wide && (
        <div role="tablist" aria-label={t('compare.viewLabel')} className="flex gap-0.5 border-b border-line p-1">
          {(['changes', 'a', 'b', 'unified'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={narrowView === value}
              onClick={() => {
                setNarrowView(value);
                if (value === 'a' || value === 'b') setPanesOpened(true);
              }}
              className={cn('pressable inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1 text-sm font-medium', narrowView === value ? 'bg-accent text-on-accent' : 'text-muted')}
            >
              {value === 'changes' && <ListTree size={14} className="shrink-0" aria-hidden />}
              <span className="truncate">{value === 'changes' ? t('compare.viewChanges') : value === 'unified' ? t('compare.modeUnifiedShort') : value.toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}

      {notes.map((note) => (
        <p key={note} role="note" className="flex items-start gap-2 border-b border-line bg-warning-tint px-4 py-1 text-xs text-warning">
          <Info size={14} className="mt-px shrink-0" aria-hidden />
          {note}
        </p>
      ))}

      {!wide && narrowView !== 'changes' && current && (
        <div data-testid="current-change" className="flex items-center gap-2 border-b border-line bg-sidebar px-3 py-1.5 text-xs text-muted">
          <TypeBadge type={current.type} moved={isMoved(current)} />
          <span className="min-w-0 flex-1 truncate font-quote text-sm text-fg/90">{(current.b ?? current.a)?.quote}</span>
          {stepper}
        </div>
      )}

      {!wide && showUnified && (
        <label className="flex min-h-10 cursor-pointer items-center gap-1.5 border-b border-line px-3 text-sm text-muted">
          <input type="checkbox" checked={hideUnchanged} onChange={(event) => setHideUnchanged(event.target.checked)} className="size-4 accent-[var(--color-accent)]" />
          {t('compare.hideUnchanged')}
        </label>
      )}

      <div className="flex min-h-0 flex-1">
        {(wide || narrowView === 'changes') && (
          <aside aria-label={t('compare.viewChanges')} data-testid="changes-panel" className={cn('flex min-h-0 flex-col bg-sidebar', wide ? 'w-[clamp(270px,24vw,360px)] shrink-0 border-r border-line' : 'min-w-0 flex-1')}>
            {changes}
          </aside>
        )}
        {panesMounted && (
          <div data-testid="compare-desk" className={cn('compare-desk flex min-h-0 min-w-0 flex-1', !showSide && 'hidden')}>
            {(['a', 'b'] as const).map((side) => {
              const doc = side === 'a' ? docA : docB;
              const focus = side === 'a' ? focusA : focusB;
              const hiddenOnPhone = !wide && narrowView !== side;
              return (
                // Keyed by document: swapping moves the open viewers instead of loading them again.
                <div
                  key={doc?.id ?? side}
                  data-side={side}
                  data-testid={`compare-pane-${side}`}
                  aria-label={doc?.name ?? t('compare.deletedDocument')}
                  onPointerEnter={claimPane}
                  onWheelCapture={claimPane}
                  onTouchStart={claimPane}
                  onScrollCapture={onPaneScroll}
                  className={cn('sheet-in flex min-h-0 min-w-0 flex-1 basis-0 flex-col', side === 'b' && wide && 'border-l border-line', hiddenOnPhone && 'hidden')}
                >
                  <SheetHeader side={side} doc={doc} current={current} focus={focus} />
                  <div className="relative min-h-0 flex-1">
                    <ComparePane doc={doc} focus={focus} annotations={side === 'a' ? annotationsA : annotationsB} textMarks={side === 'a' ? marksA : marksB} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {showUnified && (
          <div className="min-h-0 min-w-0 flex-1">
            <UnifiedView docA={docA} docB={docB} all={all} visible={visible} selectedId={selected?.id ?? null} nonce={selected?.nonce ?? 0} hideUnchanged={hideUnchanged} onSelect={select} />
          </div>
        )}
      </div>
    </section>
  );
}
