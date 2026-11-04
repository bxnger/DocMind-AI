import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { EvidenceSource } from '@/types/chat';
import { PREVIEW_WIDTH, type Placement } from './placement';

interface Props {
  id: string;
  source: EvidenceSource;
  placement: Placement;
}

/** Compact look at a source while the pointer or keyboard focus is on its [n] marker: where it is, and the quote. */
export function SourcePreview({ id, source, placement }: Props) {
  const { t } = useTranslation();
  const above = placement.bottom !== undefined;
  return createPortal(
    <motion.div
      id={id}
      role="tooltip"
      initial={{ opacity: 0, y: above ? 4 : -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
      style={{ position: 'fixed', left: placement.left, top: placement.top, bottom: placement.bottom, width: PREVIEW_WIDTH }}
      className="pointer-events-none z-50 rounded-control border border-accent-2-line bg-card-raised p-3 shadow-float"
    >
      <p className="flex items-center gap-2 text-xs text-muted">
        <span className="tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md border border-accent-2-line px-1 font-medium text-accent-2">
          {source.index}
        </span>
        <span className="min-w-0 flex-1 truncate">{source.documentName}</span>
        <span className="tabular shrink-0 font-medium text-fg">
          {source.page !== null ? t('sources.page', { page: source.page }) : source.location}
        </span>
      </p>
      <blockquote className="mt-2 border-l-2 border-accent-2 pl-3">
        <p className="font-quote line-clamp-4 text-[14px] leading-[21px] break-words text-fg/90">{source.quote}</p>
      </blockquote>
      <p className="mt-2 text-xs text-muted">{t('evidence.previewHint')}</p>
    </motion.div>,
    document.body,
  );
}
