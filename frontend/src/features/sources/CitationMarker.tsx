import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

interface Props {
  marker: number;
  page: number | null;
  location: string | null;
  active: boolean;
  onActivate: (marker: number | null) => void;
  onOpen: () => void;
}

export function CitationMarker({ marker, page, location, active, onActivate, onOpen }: Props) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => onActivate(marker)}
      onMouseLeave={() => onActivate(null)}
      onFocus={() => onActivate(marker)}
      onBlur={() => onActivate(null)}
      aria-label={page === null ? t('sources.markerSection', { marker, location: location ?? '' }) : t('sources.openMarker', { marker, page })}
      className={cn(
        'pressable tabular mx-px inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md border px-1 align-[1px] text-xs font-medium',
        active ? 'border-accent-2 bg-accent-2-tint text-accent-2' : 'border-accent-2-line text-accent-2 hover:bg-accent-2-tint',
      )}
    >
      {marker}
    </button>
  );
}
