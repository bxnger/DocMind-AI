import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { SheetLine } from '@/features/procurement/sheetLines';
import type { ProcurementStep } from '@/features/procurement/WorkflowStepper';
import type { Part, PartOffers, Quote } from '@/types/procurement';

interface Props {
  parts: readonly Part[];
  lines: Record<string, SheetLine>;
  offers: readonly PartOffers[] | undefined;
  quote: Quote | undefined;
  next: ProcurementStep | undefined;
  onNext: () => void;
}

/** What is known so far, counted from the data on screen, and the next step. Shown on phones only. */
export function ProcurementSummary({ parts, lines, offers, quote, next, onNext }: Props) {
  const { t } = useTranslation();
  const fromDocument = parts.filter((part) => part.verified && part.sources.length > 0).length;
  const toCheck = parts.filter((part) => !part.verified && part.sources.length > 0).length;
  const byPhoto = parts.filter((part) => lines[part.id]?.decision === 'confirmed').length;
  const noOffers = offers ? offers.filter((item) => item.offers.length === 0 && item.similar.length === 0).length : null;
  const demo = Boolean(quote?.items.some((item) => item.status === 'priced' && item.offer?.demo));
  const rows: ReadonlyArray<{ key: 'fromDocument' | 'toCheck' | 'byPhoto' | 'noOffers'; value: number | null; tone?: string | undefined }> = [
    { key: 'fromDocument', value: fromDocument, tone: 'text-success' },
    { key: 'toCheck', value: toCheck, tone: toCheck ? 'text-warning' : undefined },
    { key: 'byPhoto', value: byPhoto },
    { key: 'noOffers', value: noOffers, tone: noOffers ? 'text-warning' : undefined },
  ];
  return (
    <section data-testid="procurement-summary" aria-label={t('mobile.summary.label')} className="rounded-panel border border-line bg-card p-3">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        {rows.filter((row) => row.value !== null).map(({ key, value, tone }) => (
          <div key={key} className="flex items-baseline justify-between gap-2">
            <dt className="text-muted">{t(`mobile.summary.${key}`)}</dt>
            <dd data-testid={`summary-${key}`} className={cn('tabular font-semibold', tone)}>{value}</dd>
          </div>
        ))}
      </dl>
      {demo && <p data-testid="summary-demo" className="mt-1 text-xs text-warning">{t('procurement.budget.usesDemo')}</p>}
      {next && <Button variant="primary" data-testid="summary-next" className="mt-2 h-11 w-full" onClick={onNext}>{t('mobile.summary.next', { step: t(`procurement.steps.${next}`) })}<ArrowRight size={16} aria-hidden /></Button>}
    </section>
  );
}
