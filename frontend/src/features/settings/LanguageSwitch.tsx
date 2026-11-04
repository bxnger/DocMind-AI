import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { LANGUAGES, type Language } from '@/i18n';

/** Each language is written in its own name, so it stays findable whatever the current UI language. */
export function LanguageSwitch({ variant = 'compact' }: { variant?: 'compact' | 'full' }) {
  const { t, i18n } = useTranslation();
  return (
    <div role="radiogroup" aria-label={t('settings.language')} className="inline-flex rounded-[10px] border border-line bg-card p-0.5">
      {LANGUAGES.map((language: Language) => {
        const active = i18n.language === language.code;
        return (
          <button
            key={language.code}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={language.name}
            lang={language.code}
            onClick={() => void i18n.changeLanguage(language.code)}
            className={cn(
              'pressable rounded-lg font-medium',
              variant === 'full' ? 'h-8 px-3 text-sm' : 'h-6 px-2 text-xs pointer-coarse:h-9 pointer-coarse:px-3',
              active ? 'bg-accent-tint text-fg' : 'text-muted hover:text-fg',
            )}
          >
            {variant === 'full' ? language.name : language.short}
          </button>
        );
      })}
    </div>
  );
}
