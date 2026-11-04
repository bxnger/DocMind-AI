import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/IconButton';

interface Props {
  query: string;
  onQuery: (value: string) => void;
  count: number;
  active: number;
  textState: 'loading' | 'ready' | 'empty';
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
}

export function ViewerSearchBar({ query, onQuery, count, active, textState, onStep, onClose }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const status =
    textState === 'loading'
      ? t('viewer.searchPreparing')
      : textState === 'empty'
        ? t('viewer.searchNoText')
        : query.trim().length < 2
          ? ''
          : count === 0
            ? t('viewer.searchNone')
            : t('viewer.searchPosition', { active: active + 1, count });

  return (
    <div role="search" className="flex h-11 items-center gap-1 border-b border-line bg-sidebar pr-2 pl-3">
      <Search size={14} className="shrink-0 text-muted" aria-hidden />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          } else if (event.key === 'Escape') {
            onClose();
          }
        }}
        aria-label={t('viewer.searchLabel')}
        placeholder={t('viewer.searchPlaceholder')}
        disabled={textState !== 'ready'}
        className="h-full min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted disabled:cursor-not-allowed"
      />
      <span aria-live="polite" className="tabular shrink-0 px-1 text-xs text-muted">
        {status}
      </span>
      <IconButton dense label={t('viewer.searchPrev')} icon={<ChevronUp size={16} aria-hidden />} disabled={count === 0} onClick={() => onStep(-1)} />
      <IconButton dense label={t('viewer.searchNext')} icon={<ChevronDown size={16} aria-hidden />} disabled={count === 0} onClick={() => onStep(1)} />
      <IconButton dense label={t('viewer.searchClose')} icon={<X size={16} aria-hidden />} onClick={onClose} />
    </div>
  );
}
