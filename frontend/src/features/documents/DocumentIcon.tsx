import { FileText, FileType2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DocumentKind } from '@/types/document';

/** Kind is shown with a shape and a label, never colour alone. */
export function DocumentIcon({ kind, className }: { kind: DocumentKind; className?: string }) {
  const Icon = kind === 'pdf' ? FileText : FileType2;
  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 flex-col items-center justify-center rounded-[10px] border border-line bg-card text-muted',
        className,
      )}
    >
      <Icon size={14} aria-hidden />
      <span className="mt-px text-[9px] leading-[10px] font-medium tracking-[0.04em] uppercase">{kind}</span>
    </span>
  );
}
