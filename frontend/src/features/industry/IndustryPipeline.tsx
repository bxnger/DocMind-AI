import { Calculator, Camera, FileText, ScanSearch, Store, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const STEPS: ReadonlyArray<{ key: 'upload' | 'parts' | 'photo' | 'offers' | 'budget'; Icon: LucideIcon }> = [
  { key: 'upload', Icon: FileText },
  { key: 'parts', Icon: ScanSearch },
  { key: 'photo', Icon: Camera },
  { key: 'offers', Icon: Store },
  { key: 'budget', Icon: Calculator },
];

/** The whole path on one line, so what the product does is clear before anything is uploaded. */
export function IndustryPipeline() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="pipeline-title" data-testid="industry-pipeline" className="mt-6">
      <h2 id="pipeline-title" className="micro-label mb-2">{t('home.flowTitle')}</h2>
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map(({ key, Icon }, index) => (
          <li key={key} data-testid="pipeline-step" className="relative flex gap-3 rounded-panel border border-line bg-card p-3 lg:block">
            <span className="flex shrink-0 items-center gap-2 lg:mb-2">
              <span className="tabular inline-flex size-6 items-center justify-center rounded-full border border-line-strong text-xs font-semibold">{index + 1}</span>
              <Icon size={16} className="text-accent" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">{t(`home.flow.${key}.title`)}</span>
              <span className="mt-0.5 block text-xs text-muted">{t(`home.flow.${key}.body`)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
