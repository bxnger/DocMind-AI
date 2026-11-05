import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { buttonClasses } from '@/components/ui/Button';
import { SAMPLE_DOCUMENT_ID, sampleLanguage, sampleVariant } from '@/services/sampleDocument';

/** Shows the product's loop on real sample content, so its value is clear before any upload. */
export function EvidencePreview() {
  const { t, i18n } = useTranslation();
  const sample = sampleVariant(i18n.language);
  return (
    <section aria-label={t('home.exampleLabel')} className="flex flex-col rounded-panel border border-line bg-card p-4">
      <p className="micro-label mb-3">{t('home.exampleLabel')}</p>
      <p className="ml-auto max-w-[85%] rounded-control rounded-br-sm border border-line bg-card-raised px-3 py-2 text-sm">
        {t('home.sample.notice')}
      </p>
      <div className="mt-3 rounded-control border border-line bg-card p-3">
        <header className="flex items-center gap-2 text-xs text-muted">
          <span className="tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md border border-accent-2-line bg-accent-2-tint px-1 font-medium text-fg">1</span>
          <span className="min-w-0 flex-1 truncate">{sample.name}</span>
          <span className="tabular shrink-0 font-medium text-fg">{t('sources.page', { page: sample.previewPage })}</span>
        </header>
        <blockquote lang={sampleLanguage(i18n.language)} className="mt-3 border-l-2 border-accent-2-line pl-3 font-quote text-[15px] leading-[23px] text-fg/90">
          <mark className="rounded-sm bg-accent-2-tint text-fg">{sample.previewQuote}</mark>
        </blockquote>
      </div>
      <Link to={`/documents/${SAMPLE_DOCUMENT_ID}`} className={`${buttonClasses('secondary', 'md')} mt-4`}>
        {t('home.openSample')}
        <ArrowRight size={14} aria-hidden />
      </Link>
    </section>
  );
}
