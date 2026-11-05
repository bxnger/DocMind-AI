import { useTranslation } from 'react-i18next';
import { MODE_ACTIONS } from './modes';
import { ModeSelect, ModeSelector } from './ModeSelector';
import { useUserMode } from './useUserMode';

/** Lets a user pick a mode before any document exists. The actions are only named here: there is nothing to analyze yet. */
export function HomeModeStrip({ hasDocuments }: { hasDocuments: boolean }) {
  const { t } = useTranslation();
  const mode = useUserMode();
  return (
    <section aria-label={t('userModes.selector')} data-testid="home-mode-strip" className="mt-4 rounded-panel border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-semibold">{t('userModes.title')}</h2>
        <span className="max-sm:hidden"><ModeSelector showAllLabels /></span>
        <span className="sm:hidden"><ModeSelect /></span>
      </div>
      <p className="mt-2 text-sm text-muted">{t(`userModes.modes.${mode}.description`)}</p>
      <p className="mt-1 text-xs text-muted">{MODE_ACTIONS[mode].map((action) => t(`userModes.actions.${action}.label`)).join(' · ')}</p>
      <p data-testid="home-mode-hint" className="mt-2 text-xs text-accent-strong">{hasDocuments ? t('userModes.openDocumentFirst') : t('userModes.uploadFirst')}</p>
    </section>
  );
}
