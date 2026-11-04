import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { placePreview, type Placement } from '@/features/evidence/placement';
import { SourcePreview } from '@/features/evidence/SourcePreview';
import { cn } from '@/lib/cn';
import type { EvidenceSource } from '@/types/chat';

interface Props {
  source: EvidenceSource;
  /** Hovered or focused, here or on the matching source card. */
  active: boolean;
  /** This source is the one open in the inspector. */
  selected: boolean;
  onActivate: (marker: number | null) => void;
  onOpen: () => void;
}

/** A short pause, so moving the pointer across a paragraph of markers does not flash previews. */
const PREVIEW_DELAY_MS = 220;

export function CitationMarker({ source, active, selected, onActivate, onOpen }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const showPreview = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPlacement(placePreview(rect, { width: window.innerWidth, height: window.innerHeight }));
  };
  const hidePreview = () => {
    window.clearTimeout(timer.current);
    setPlacement(null);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The preview is fixed to the screen, so it would drift away from its marker if anything scrolled.
  useEffect(() => {
    if (!placement) return;
    const hide = () => setPlacement(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [placement]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          hidePreview();
          onOpen();
        }}
        onPointerEnter={(event) => {
          onActivate(source.index);
          // Touch has no hover: a tap opens the source, so there is no preview to show.
          if (event.pointerType !== 'touch') timer.current = window.setTimeout(showPreview, PREVIEW_DELAY_MS);
        }}
        onPointerLeave={() => {
          onActivate(null);
          hidePreview();
        }}
        onFocus={(event) => {
          onActivate(source.index);
          if (event.currentTarget.matches(':focus-visible')) showPreview();
        }}
        onBlur={() => {
          onActivate(null);
          hidePreview();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') hidePreview();
        }}
        aria-describedby={placement ? id : undefined}
        aria-current={selected || undefined}
        aria-label={
          source.page === null
            ? t('sources.markerSection', { marker: source.index, location: source.location ?? '' })
            : t('sources.openMarker', { marker: source.index, page: source.page })
        }
        className={cn(
          'pressable tabular mx-px inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md border px-1 align-[1px] text-xs font-medium',
          selected
            ? 'border-accent bg-accent text-on-accent'
            : active
              ? 'border-accent-2 bg-accent-2-tint text-accent-2'
              : 'border-accent-2-line text-accent-2 hover:bg-accent-2-tint',
        )}
      >
        {source.index}
      </button>
      <AnimatePresence>{placement && <SourcePreview id={id} source={source} placement={placement} />}</AnimatePresence>
    </>
  );
}
