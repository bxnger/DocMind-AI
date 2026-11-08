import { Monitor, Smartphone, Sparkles, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { interfaceChoice, setInterfaceChoice, type InterfaceChoice as Choice } from './mobileMode';

const OPTIONS: ReadonlyArray<{ value: Choice; Icon: LucideIcon }> = [
  { value: 'auto', Icon: Sparkles },
  { value: 'phone', Icon: Smartphone },
  { value: 'desktop', Icon: Monitor },
];

/** Which interface to use on this device. The page reloads, because the interface is chosen once at start. */
export function InterfaceChoice() {
  const { t } = useTranslation();
  const current = interfaceChoice();
  return (
    <section aria-labelledby="interface-title" data-testid="interface-choice" className="rounded-panel border border-line bg-card p-4">
      <h2 id="interface-title" className="font-semibold">{t('mobile.interface.title')}</h2>
      <p className="mt-0.5 text-sm text-muted">{t('mobile.interface.body')}</p>
      <div role="radiogroup" aria-label={t('mobile.interface.title')} className="mt-2 flex flex-wrap gap-2">
        {OPTIONS.map(({ value, Icon }) => (
          <button key={value} type="button" role="radio" aria-checked={current === value} data-testid={`interface-${value}`} onClick={() => current !== value && setInterfaceChoice(value)} className={cn('pressable inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-medium', current === value ? 'border-accent bg-accent-tint' : 'border-line')}>
            <Icon size={16} aria-hidden />{t(`mobile.interface.${value}`)}
          </button>
        ))}
      </div>
    </section>
  );
}
