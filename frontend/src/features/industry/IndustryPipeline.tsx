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

/** A radial bearing in section, drawn as a technical sheet would. It carries no data, so it is hidden from screen readers. */
export function BearingDrawing({ className }: { className?: string }) {
  const balls = Array.from({ length: 9 }, (_, index) => (index * 2 * Math.PI) / 9);
  return (
    <svg viewBox="0 0 240 240" fill="none" aria-hidden className={className}>
      <g className="stroke-line-strong" strokeWidth="1">
        <path d="M120 6v228M6 120h228" strokeDasharray="10 4 2 4" />
        <circle cx="120" cy="120" r="104" />
        <circle cx="120" cy="120" r="90" />
        <circle cx="120" cy="120" r="50" />
        <circle cx="120" cy="120" r="36" />
      </g>
      <g className="stroke-accent" strokeWidth="1.4">
        {balls.map((angle) => <circle key={angle} cx={120 + 70 * Math.cos(angle)} cy={120 + 70 * Math.sin(angle)} r="15" />)}
      </g>
      <circle cx="120" cy="120" r="70" className="stroke-accent-2" strokeWidth="1" strokeDasharray="3 5" />
    </svg>
  );
}
