import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { buttonClasses } from '@/components/ui/Button';
import { SAMPLE_DOCUMENT, SAMPLE_DOCUMENT_ID } from '@/services/sampleDocument';

/** Verbatim from public/demo/sample-agreement.pdf. A unit test keeps the two in sync. */
export const PREVIEW_QUOTE = 'Either party may terminate this Agreement for convenience by giving the other party at least 60 days of written notice.';
export const PREVIEW_PAGE = 3;

/** Shows the product's loop on real sample content, so its value is clear before any upload. */
export function EvidencePreview() {
  const { t } = useTranslation();
  return (
    <section aria-label={t('home.exampleLabel')} className="flex flex-col rounded-panel border border-line bg-sidebar p-4">
      <p className="micro-label mb-3">{t('home.exampleLabel')}</p>
      <p lang="en" className="ml-auto max-w-[85%] rounded-control rounded-br-sm border border-line bg-card-raised px-3 py-2 text-sm">
        What is the notice period for termination?
      </p>
      <div className="mt-3 rounded-control border border-line bg-card p-3">
        <header className="flex items-center gap-2 text-xs text-muted">
          <span className="tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md border border-accent-2-line px-1 font-medium text-accent-2">1</span>
          <span className="min-w-0 flex-1 truncate">{SAMPLE_DOCUMENT.name}</span>
          <span className="tabular shrink-0 font-medium text-fg">{t('sources.page', { page: PREVIEW_PAGE })}</span>
        </header>
        <blockquote lang="en" className="mt-3 border-l-2 border-accent-2 pl-3 font-quote text-[15px] leading-[23px] text-fg/90">
          {PREVIEW_QUOTE}
        </blockquote>
      </div>
      <Link to={`/documents/${SAMPLE_DOCUMENT_ID}`} className={`${buttonClasses('secondary', 'md')} mt-4`}>
        {t('home.openSample')}
        <ArrowRight size={14} aria-hidden />
      </Link>
    </section>
  );
}
