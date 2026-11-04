import { CircleAlert, CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { DocumentModel } from '@/types/document';

export function StatusBadge({ doc, compact = false }: { doc: DocumentModel; compact?: boolean }) {
  const { t } = useTranslation();
  // The stage comes straight from the backend. No stage is inferred or simulated here.
  const label =
    doc.status === 'ready'
      ? t('status.ready')
      : doc.status === 'failed'
        ? t('status.failed')
        : doc.stage
          ? t(`status.stage.${doc.stage}`)
          : t('status.processing');

  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap',
        doc.status === 'ready' && 'bg-success-tint text-success',
        doc.status === 'failed' && 'bg-danger-tint text-danger',
        doc.status === 'processing' && 'bg-warning-tint text-warning',
      )}
    >
      {doc.status === 'ready' && <CircleCheck size={12} aria-hidden />}
      {doc.status === 'failed' && <CircleAlert size={12} aria-hidden />}
      {doc.status === 'processing' && <span className="pulse-dot size-1.5 rounded-full bg-warning" aria-hidden />}
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </span>
  );
}
