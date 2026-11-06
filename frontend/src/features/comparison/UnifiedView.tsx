import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsUpDown, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TextBlock } from '@/api/documents';
import { Skeleton } from '@/components/ui/Skeleton';
import { useDocumentBlocks } from '@/features/documents/useDocumentContent';
import { cn } from '@/lib/cn';
import type { Difference } from '@/types/comparison';
import type { DocumentModel } from '@/types/document';
import { DiffLine, TypeBadge, useChangeLines } from './ChangeRow';
import { TONE } from './changeTone';
import { isMoved } from './compareModel';
import { buildUnified, countWords } from './unifiedDiff';

const joined = (blocks: readonly TextBlock[] | undefined) => (blocks ?? []).map((block) => block.text).join(' ');

function Hunk({ difference, number, selected, onSelect }: { difference: Difference; number: number; selected: boolean; onSelect: () => void }) {
  const diff = useChangeLines(difference);
  const moved = isMoved(difference);
  return (
    <button
      type="button"
      data-hunk={difference.id}
      data-selected={selected || undefined}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn('my-2 block w-full rounded-control border border-l-[3px] px-3 py-2 text-left transition-colors duration-150', TONE[difference.type].rail, selected ? 'border-y-accent-line border-r-accent-line bg-card-raised' : 'border-y-line border-r-line bg-card hover:bg-card-raised')}
    >
      <span className="mb-1 flex items-center gap-2">
        <span className="tabular text-xs font-medium text-muted">{number}</span>
        <TypeBadge type={difference.type} moved={moved} />
      </span>
      <span className="block space-y-1">
        {!moved && difference.a && <DiffLine side="a" evidence={difference.a} segments={diff?.a ?? null} />}
        {difference.b && <DiffLine side="b" evidence={difference.b} segments={moved ? null : (diff?.b ?? null)} />}
      </span>
    </button>
  );
}

function SameRun({ text, hidden }: { text: string; hidden: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (hidden && !open) {
    return (
      <button type="button" data-testid="same-run" onClick={() => setOpen(true)} className="pressable my-1 flex min-h-7 w-full items-center justify-center gap-1.5 rounded-lg text-xs text-muted hover:bg-hover hover:text-fg pointer-coarse:min-h-10">
        <ChevronsUpDown size={12} aria-hidden />
        {t('compare.unchangedWords', { count: countWords(text) })}
      </button>
    );
  }
  return <p data-testid="same-text" className="my-2 font-quote text-[15px] leading-[24px] break-words [overflow-wrap:anywhere] text-muted">{text}</p>;
}

interface Props {
  docA: DocumentModel | undefined;
  docB: DocumentModel | undefined;
  all: readonly Difference[];
  visible: readonly Difference[];
  selectedId: string | null;
  nonce: number;
  hideUnchanged: boolean;
  onSelect: (difference: Difference) => void;
}

/** One reading order for both documents. Without their text, it says so and shows the changes alone. */
export function UnifiedView({ docA, docB, all, visible, selectedId, nonce, hideUnchanged, onSelect }: Props) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const a = useDocumentBlocks(docA?.id ?? '', Boolean(docA));
  const b = useDocumentBlocks(docB?.id ?? '', Boolean(docB));
  const haveText = Boolean(a.data && b.data);
  const unified = useMemo(() => (haveText ? buildUnified(joined(a.data), joined(b.data), all) : null), [a.data, all, b.data, haveText]);
  const shown = useMemo(() => new Set(visible.map((difference) => difference.id)), [visible]);
  const numberOf = (difference: Difference) => all.indexOf(difference) + 1;

  useEffect(() => {
    scroller.current?.querySelector('[data-hunk][data-selected]')?.scrollIntoView({ block: 'nearest' });
  }, [nonce, unified]);

  const loading = Boolean(docA && docB) && (a.isPending || b.isPending);
  const hunk = (difference: Difference) => <Hunk key={difference.id} difference={difference} number={numberOf(difference)} selected={difference.id === selectedId} onSelect={() => onSelect(difference)} />;
  const unplaced = unified ? unified.unplaced.filter((difference) => shown.has(difference.id)) : visible;

  return (
    <div ref={scroller} data-testid="unified-view" tabIndex={0} aria-label={t('compare.modeUnified')} className="h-full overflow-y-auto outline-offset-[-2px]">
      <div className="mx-auto w-full max-w-[860px] px-3 py-3 md:px-6">
        {loading ? (
          <div role="status" aria-label={t('common.loading')} className="space-y-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : (
          <>
            {!unified && (
              <p role="note" className="mb-2 flex items-start gap-2 rounded-control bg-warning-tint px-3 py-2 text-xs text-warning">
                <Info size={14} className="mt-px shrink-0" aria-hidden />
                {t('compare.noTextForUnified')}
              </p>
            )}
            {unified?.items.map((item, index) =>
              item.kind === 'same' ? <SameRun key={`same-${index}`} text={item.text} hidden={hideUnchanged} /> : shown.has(item.difference.id) ? hunk(item.difference) : null,
            )}
            {unplaced.length > 0 && (
              <section>
                {unified && <h3 className="micro-label mt-4 mb-1">{t('compare.unplaced')}</h3>}
                {unplaced.map(hunk)}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
