import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/IconButton';
import { nextThemePreference, type ThemePreference } from '@/lib/themeCore';
import { setThemePreference, useThemePreference } from './theme';

const ICONS = { light: Sun, dark: Moon, system: Monitor };
const LABELS = { light: 'settings.themeLight', dark: 'settings.themeDark', system: 'settings.themeSystem' } as const;

/** Compact control: one button that steps through Light, Dark and System and says which is active. */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const current: ThemePreference = useThemePreference();
  const next = nextThemePreference(current);
  const Icon = ICONS[current];
  return (
    <IconButton
      data-testid="theme-toggle"
      data-theme-choice={current}
      label={t('settings.themeToggle', { current: t(LABELS[current]), next: t(LABELS[next]) })}
      icon={<Icon size={16} aria-hidden />}
      onClick={() => setThemePreference(next)}
      className={className}
    />
  );
}
