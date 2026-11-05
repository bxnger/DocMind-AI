import { useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minus, PanelLeft, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/IconButton';

interface Props {
  page: number;
  pageCount: number;
  scale: number;
  fit: boolean;
  railOpen: boolean;
  hideRailToggle?: boolean;
  searchOpen: boolean;
  onPage: (page: number) => void;
  onZoomStep: (direction: 1 | -1) => void;
  onFit: () => void;
  onToggleRail: () => void;
  onToggleSearch: () => void;
}

export function ViewerToolbar(props: Props) {
  const { page, pageCount, scale, fit, railOpen, hideRailToggle, searchOpen, onPage, onZoomStep, onFit, onToggleRail, onToggleSearch } = props;
  const { t } = useTranslation();
  /** Null unless the user is typing, so the field otherwise follows the scroll position. */
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const value = Number.parseInt(draft, 10);
    if (Number.isInteger(value) && value >= 1 && value <= pageCount) onPage(value);
    setDraft(null);
  };

  return (
    <div role="toolbar" aria-label={t('viewer.toolbar')} className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2">
      {!hideRailToggle && <IconButton dense label={t('viewer.pages')} active={railOpen} aria-pressed={railOpen} icon={<PanelLeft size={16} aria-hidden />} onClick={onToggleRail} className="max-sm:hidden" />}
      <div className="mx-auto flex items-center gap-1">
        <IconButton dense label={t('viewer.prevPage')} icon={<ChevronLeft size={16} aria-hidden />} disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <input
          value={draft ?? String(page)}
          inputMode="numeric"
          aria-label={t('viewer.pageInput', { count: pageCount })}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
          className="tabular h-7 w-10 rounded-lg border border-line bg-card text-center text-sm outline-none focus:border-accent"
        />
        <span className="tabular px-1 text-sm whitespace-nowrap text-muted">/ {pageCount}</span>
        <IconButton dense label={t('viewer.nextPage')} icon={<ChevronRight size={16} aria-hidden />} disabled={page >= pageCount} onClick={() => onPage(page + 1)} />
        <span className="mx-1 h-4 w-px shrink-0 bg-line max-sm:hidden" aria-hidden />
        <IconButton dense label={t('viewer.zoomOut')} icon={<Minus size={16} aria-hidden />} onClick={() => onZoomStep(-1)} />
        <span aria-live="polite" className="tabular w-10 text-center text-sm text-muted max-[359px]:sr-only">
          {Math.round(scale * 100)}%
        </span>
        <IconButton dense label={t('viewer.zoomIn')} icon={<Plus size={16} aria-hidden />} onClick={() => onZoomStep(1)} />
        <IconButton dense label={t('viewer.fitWidth')} active={fit} aria-pressed={fit} icon={<Maximize2 size={15} aria-hidden />} onClick={onFit} />
      </div>
      <IconButton dense label={t('viewer.search')} active={searchOpen} aria-pressed={searchOpen} icon={<Search size={16} aria-hidden />} onClick={onToggleSearch} />
    </div>
  );
}
