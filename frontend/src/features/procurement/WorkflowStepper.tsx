import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export const STEPS = ['parts', 'camera', 'offers', 'sheet'] as const;
export type ProcurementStep = (typeof STEPS)[number];

export const isProcurementStep = (value: unknown): value is ProcurementStep => STEPS.some((step) => step === value);

interface Props {
  current: ProcurementStep;
  done: Record<ProcurementStep, boolean>;
  notes: Record<ProcurementStep, string>;
  onSelect: (step: ProcurementStep) => void;
  onOpenDocument: () => void;
}

/** The order the work usually goes in, not a gate: every step stays open, and nothing is decided for the person. */
export function WorkflowStepper({ current, done, notes, onSelect, onOpenDocument }: Props) {
  const { t } = useTranslation();
  const number = STEPS.indexOf(current) + 2;
  const circle = 'inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular';
  return (
    <nav aria-label={t('procurement.steps.label')} data-testid="workflow-stepper" className="rounded-panel border border-line bg-card p-2">
      <ol className="flex items-stretch gap-1">
        <li className="min-w-0 flex-1 sm:flex-[0.8]">
          <button type="button" data-testid="step-document" onClick={onOpenDocument} aria-label={t('procurement.steps.document')} className="pressable flex h-full min-h-10 w-full flex-col items-center justify-center gap-0.5 rounded-control px-1 py-1 text-muted hover:bg-hover hover:text-fg sm:flex-row sm:justify-start sm:gap-2 sm:px-2 sm:text-left">
            <span className={cn(circle, 'border-success/40 bg-success-tint text-success')}><Check size={13} aria-hidden /></span>
            <span className="min-w-0 max-sm:hidden"><span className="block truncate text-sm font-medium">{t('procurement.steps.document')}</span></span>
          </button>
        </li>
        {STEPS.map((step, index) => {
          const active = step === current;
          return (
            <li key={step} className="min-w-0 flex-1">
              <button
                type="button"
                data-testid={`step-${step}`}
                data-done={done[step] || undefined}
                aria-current={active ? 'step' : undefined}
                aria-label={`${t(`procurement.steps.${step}`)}. ${notes[step]}`}
                onClick={() => onSelect(step)}
                className={cn('pressable flex h-full min-h-10 w-full flex-col items-center justify-center gap-0.5 rounded-control px-1 py-1 sm:flex-row sm:justify-start sm:gap-2 sm:px-2 sm:text-left', active ? 'bg-accent-tint text-fg' : 'text-muted hover:bg-hover hover:text-fg')}
              >
                <span className={cn(circle, active ? 'border-accent bg-accent text-on-accent' : done[step] ? 'border-success/40 bg-success-tint text-success' : 'border-line-strong')}>
                  {done[step] && !active ? <Check size={13} aria-hidden /> : index + 2}
                </span>
                <span className="min-w-0 max-sm:hidden">
                  <span className="block truncate text-sm font-medium">{t(`procurement.steps.${step}`)}</span>
                  <span className="block truncate text-xs text-muted">{notes[step]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p data-testid="step-current" className="mt-1 px-1 text-sm sm:hidden">
        <span className="text-muted">{t('procurement.steps.of', { number, total: STEPS.length + 1 })}</span>{' '}
        <strong className="font-semibold">{t(`procurement.steps.${current}`)}</strong>{' '}
        <span className="text-xs text-muted">{notes[current]}</span>
      </p>
    </nav>
  );
}
