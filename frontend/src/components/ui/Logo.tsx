import { cn } from '@/lib/cn';

/** Brand mark: lines of a document held inside citation brackets. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={cn('shrink-0', className)}>
      <g strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7.5 3.5H4v17h3.5M16.5 3.5H20v17h-3.5" className="stroke-accent" />
        <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" className="stroke-accent-2" />
      </g>
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2" translate="no">
      <LogoMark />
      {!compact && (
        <span className="text-[15px] font-semibold tracking-[-0.01em] whitespace-nowrap text-fg max-[360px]:text-[13px]">
          DOCMIND <span className="font-normal text-muted">INDUSTRY</span>
        </span>
      )}
    </span>
  );
}
