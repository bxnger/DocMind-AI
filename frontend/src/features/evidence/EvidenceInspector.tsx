import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, Copy, CornerUpLeft, Crosshair, FileText, Loader2, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { useCopyCitation } from '@/features/sources/useCopyCitation';
import { cn } from '@/lib/cn';
import { CAN_SHOW_ON_PAGE, type EvidenceStatus } from './status';
import type { ResolvedEvidence } from './evidenceState';

interface Props {
  evidence: ResolvedEvidence;
  status: EvidenceStatus;
  onSelect: (sourceIndex: number) => void;
  onStep: (delta: 1 | -1) => void;
  onRefocus: () => void;
  onClose: () => void;
  /** Only on narrow screens, where the answer is on another tab. */
  onBack: (() => void) | null;
  backLabel?: string;
}

const TONE: Record<EvidenceStatus, 'precise' | 'caution' | 'danger' | 'quiet'> = {
  coordinates: 'precise',
  text: 'precise',
  page: 'caution',
  unknown: 'quiet',
  section: 'quiet',
  viewerLoading: 'quiet',
  viewerError: 'danger',
  viewerUnavailable: 'caution',
  otherDocument: 'caution',
};

function StatusLine({ status }: { status: EvidenceStatus }) {
  const { t } = useTranslation();
  const tone = TONE[status];
  const busy = status === 'viewerLoading' || status === 'unknown';
  return (
    <p
      role="status"
      data-status={status}
      className={cn(
        'mt-3 flex items-start gap-2 text-xs',
        tone === 'danger' ? 'text-danger' : tone === 'caution' ? 'text-warning' : tone === 'precise' ? 'text-accent-2' : 'text-muted',
      )}
    >
      {busy ? <Loader2 size={14} className="spin mt-px shrink-0" aria-hidden /> : tone === 'danger' ? <CircleAlert size={14} className="mt-px shrink-0" aria-hidden /> : <Crosshair size={14} className="mt-px shrink-0" aria-hidden />}
      <span>{t(`evidence.status.${status}`)}</span>
    </p>
  );
}

/** Floating panel over the document: which source is shown, what it says, and how precisely it was found. */
export function EvidenceInspector({ evidence, status, onSelect, onStep, onRefocus, onClose, onBack, backLabel }: Props) {
  const { t } = useTranslation();
  const { source, sources, position } = evidence;
  const [collapsed, setCollapsed] = useState(false);
  const tabs = useRef(new Map<number, HTMLButtonElement>());
  const { copied, copy } = useCopyCitation(source);
  const many = sources.length > 1;

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Escape belongs to a text field, search or dialog first.
      if (event.target instanceof Element && event.target.closest('input, textarea, select, dialog')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onTabKey = (event: KeyboardEvent) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const target = sources[(position + delta + sources.length) % sources.length];
    if (!target) return;
    onSelect(target.index);
    tabs.current.get(target.index)?.focus();
  };

  return (
    <motion.section
      aria-label={t('evidence.inspector')}
      data-testid="evidence-inspector"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8, transition: { duration: 0.12 } }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-x-2 bottom-2 z-20 mx-auto max-w-[560px] overflow-hidden rounded-panel border border-accent-line bg-card shadow-float sm:inset-x-4 sm:bottom-4"
    >
      <header className="flex items-center gap-1.5 px-3 pt-2.5 pb-1">
        <span className="micro-label hidden text-accent-2 min-[420px]:inline">{t('evidence.title')}</span>
        {many ? (
          <div role="tablist" aria-label={t('evidence.sources')} onKeyDown={onTabKey} className="flex gap-0.5">
            {sources.map((candidate) => {
              const selected = candidate.index === source.index;
              return (
                <button
                  key={candidate.index}
                  ref={(element) => {
                    if (element) tabs.current.set(candidate.index, element);
                    else tabs.current.delete(candidate.index);
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  aria-label={t('evidence.sourceN', { index: candidate.index })}
                  onClick={() => onSelect(candidate.index)}
                  className={cn('pressable tabular relative h-7 min-w-7 rounded-lg px-2 text-xs font-medium', selected ? 'text-fg' : 'text-muted hover:bg-hover hover:text-fg')}
                >
                  {selected && (
                    <motion.span layoutId="evidence-tab" transition={{ duration: 0.18 }} className="absolute inset-0 rounded-lg border border-accent-line bg-accent-tint" />
                  )}
                  <span className="relative">{candidate.index}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <span className="tabular rounded-lg border border-accent-line bg-accent-tint px-2 py-0.5 text-xs font-medium">{source.index}</span>
        )}
        <span className="flex-1" />
        {many && (
          <span className="flex items-center max-sm:hidden">
            <IconButton dense label={t('evidence.prev')} icon={<ChevronLeft size={16} aria-hidden />} onClick={() => onStep(-1)} />
            <span className="tabular px-1 text-xs text-muted">{t('evidence.position', { current: position + 1, total: sources.length })}</span>
            <IconButton dense label={t('evidence.next')} icon={<ChevronRight size={16} aria-hidden />} onClick={() => onStep(1)} />
          </span>
        )}
        {onBack && <IconButton dense label={backLabel ?? t('workspace.backToAnswer')} icon={<CornerUpLeft size={16} aria-hidden />} onClick={onBack} />}
        <IconButton
          dense
          label={collapsed ? t('evidence.expand') : t('evidence.collapse')}
          aria-expanded={!collapsed}
          icon={collapsed ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
          onClick={() => setCollapsed(!collapsed)}
        />
        <IconButton dense label={t('evidence.close')} icon={<X size={16} aria-hidden />} onClick={onClose} />
      </header>

      <div className="expand" data-open={!collapsed} inert={collapsed}>
        <div>
          <div className="px-3 pb-3">
            <p className="flex items-center gap-2 text-xs text-muted">
              <FileText size={12} className="shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={source.documentName}>{source.documentName}</span>
              <span className="tabular max-w-[50%] shrink-0 truncate font-medium text-fg" title={source.location ?? undefined}>
                {source.page !== null ? t('sources.page', { page: source.page }) : (source.location ?? t('evidence.noPage'))}
              </span>
            </p>
            <AnimatePresence mode="wait" initial={false}>
              <motion.blockquote
                key={source.index}
                aria-label={t('evidence.quoteLabel')}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.08 } }}
                transition={{ duration: 0.14 }}
                className="mt-2 max-h-36 overflow-y-auto border-l-2 border-accent-2 pl-3 font-quote text-[15px] leading-[23px] break-words text-fg/90"
              >
                {source.quote}
              </motion.blockquote>
            </AnimatePresence>
            <StatusLine status={status} />
            <div className="mt-3 flex flex-wrap items-center gap-1">
              {CAN_SHOW_ON_PAGE.has(status) && (
                <Button size="sm" icon={<Crosshair size={14} aria-hidden />} onClick={onRefocus}>
                  {t('evidence.showOnPage')}
                </Button>
              )}
              <Button variant="ghost" size="sm" icon={copied ? <Check size={14} className="text-success" aria-hidden /> : <Copy size={14} aria-hidden />} onClick={() => void copy()}>
                {copied ? t('sources.copied') : t('sources.copy')}
              </Button>
              {many && <span className="ml-auto hidden text-xs text-muted pointer-fine:inline">{t('evidence.keys')}</span>}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
