import type { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function PageContainer({ title, description, actions, children }: Props) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1040px] px-4 py-6 md:px-8 md:py-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-medium tracking-[-0.015em]">{title}</h1>
            {description && <p className="mt-1 max-w-[65ch] text-muted">{description}</p>}
          </div>
          {actions}
        </header>
        {children}
      </div>
    </div>
  );
}
