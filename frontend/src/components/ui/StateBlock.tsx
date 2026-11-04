import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface StateBlockProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: 'neutral' | 'danger' | 'warning';
  className?: string;
}

const TONES = {
  neutral: 'border-line bg-card text-muted',
  danger: 'border-danger/30 bg-danger-tint text-danger',
  warning: 'border-warning/30 bg-warning-tint text-warning',
};

/** Shared layout for empty, error and unavailable states. */
export function StateBlock({ icon, title, description, actions, tone = 'neutral', className }: StateBlockProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={cn('mx-auto flex max-w-md flex-col items-center px-6 py-8 text-center', className)}
    >
      <span className={cn('mb-4 inline-flex size-10 items-center justify-center rounded-control border', TONES[tone])}>
        {icon}
      </span>
      <h2 className="text-md font-semibold text-fg">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      {actions && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
