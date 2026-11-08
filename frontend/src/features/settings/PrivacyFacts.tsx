import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const FACTS = ['storage', 'ocr', 'ai', 'photos', 'provider', 'advice'] as const;

/** What happens to documents and photos, as the backend does it. No promise beyond that. */
export function PrivacyFacts() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="privacy-title" data-testid="privacy-facts" className="rounded-panel border border-line bg-card p-4">
      <h2 id="privacy-title" className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} className="text-accent" aria-hidden />{t('privacy.title')}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
        {FACTS.map((key) => <li key={key}>{t(`privacy.${key}`)}</li>)}
      </ul>
    </section>
  );
}
