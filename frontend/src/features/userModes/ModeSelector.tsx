import { useRef, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { MODE_ICONS, USER_MODES, isUserMode, type UserMode } from './modes';
import { setUserMode, useUserMode } from './useUserMode';

/** Icons for all modes, with the name shown on the selected one so it fits a narrow panel. */
export function ModeSelector({ showAllLabels = false }: { showAllLabels?: boolean }) {
  const { t } = useTranslation();
  const selected = useUserMode();
  const buttons = useRef(new Map<UserMode, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent) => {
    const at = USER_MODES.indexOf(selected);
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? USER_MODES[(at + 1) % USER_MODES.length]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? USER_MODES[(at - 1 + USER_MODES.length) % USER_MODES.length]
          : event.key === 'Home'
            ? USER_MODES[0]
            : event.key === 'End'
              ? USER_MODES[USER_MODES.length - 1]
              : undefined;
    if (!next) return;
    event.preventDefault();
    setUserMode(next);
    buttons.current.get(next)?.focus();
  };

  return (
    <div role="radiogroup" aria-label={t('userModes.selector')} onKeyDown={onKeyDown} data-testid="mode-selector" className="inline-flex max-w-full flex-wrap rounded-[10px] border border-line bg-card p-0.5">
      {USER_MODES.map((mode) => {
        const Icon = MODE_ICONS[mode];
        const active = mode === selected;
        const name = t(`userModes.modes.${mode}.name`);
        return (
          <button
            key={mode}
            ref={(element) => {
              if (element) buttons.current.set(mode, element);
              else buttons.current.delete(mode);
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={name}
            tabIndex={active ? 0 : -1}
            title={`${name}: ${t(`userModes.modes.${mode}.description`)}`}
            onClick={() => setUserMode(mode)}
            className={cn('pressable inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-lg border px-1.5 text-xs font-medium', active ? 'border-accent-line bg-accent-tint text-fg' : 'border-transparent text-muted hover:text-fg')}
          >
            <Icon size={14} className="shrink-0" aria-hidden />
            {(active || showAllLabels) && <span>{name}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Compact control for the assistant header. A native select keeps keyboard and phone behaviour free. */
export function ModeSelect() {
  const { t } = useTranslation();
  const selected = useUserMode();
  const Icon = MODE_ICONS[selected];
  return (
    <label data-testid="mode-select" title={t(`userModes.modes.${selected}.description`)} className="relative inline-flex h-7 min-w-0 items-center rounded-lg border border-line bg-card text-xs font-medium focus-within:border-accent hover:border-line-strong">
      <Icon size={13} className="pointer-events-none absolute left-2 text-accent" aria-hidden />
      <select
        aria-label={t('userModes.selector')}
        value={selected}
        onChange={(event) => {
          if (isUserMode(event.target.value)) setUserMode(event.target.value);
        }}
        className="h-full min-w-0 cursor-pointer appearance-none rounded-lg bg-transparent pr-6 pl-7 outline-none"
      >
        {USER_MODES.map((mode) => (
          <option key={mode} value={mode}>{t(`userModes.modes.${mode}.name`)}</option>
        ))}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-1.5 text-muted" aria-hidden />
    </label>
  );
}
