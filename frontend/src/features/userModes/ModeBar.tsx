import { useState } from 'react';
import { ChevronDown, ChevronUp, CornerDownLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/IconButton';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { ComposerHandle } from '@/features/chat/Composer';
import { MODE_ACTIONS, type ActionState } from './modes';
import { useUserMode } from './useUserMode';

interface Props {
  state: ActionState;
  hasMessages: boolean;
  composer: React.RefObject<ComposerHandle | null>;
}

/** Sits above the composer. Actions only fill the composer: sending stays the user's own step. */
export function ModeBar({ state, hasMessages, composer }: Props) {
  const { t } = useTranslation();
  const mode = useUserMode();
  const shortScreen = useMediaQuery('(max-height: 500px)');
  // Open while there is nothing to read; once a chat has started, the answers need the room.
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? (!hasMessages && !shortScreen);
  const [feedback, setFeedback] = useState<string | null>(null);

  const note =
    state === 'demo' ? t('userModes.demoNote') : state === 'waiting' ? t('userModes.waitingNote') : state === 'unavailable' ? t('userModes.unavailableNote') : null;

  return (
    <div data-testid="mode-bar" className="shrink-0 border-t border-line px-3 pt-2">
      <div className="flex items-center gap-2">
        <p className="micro-label min-w-0 flex-1 truncate">{t('userModes.actionsLabel', { mode: t(`userModes.modes.${mode}.name`) })}</p>
        <IconButton
          dense
          label={open ? t('userModes.hideActions') : t('userModes.showActions')}
          aria-expanded={open}
          icon={open ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
          onClick={() => setChoice(!open)}
        />
      </div>
      {open && (
        <div className="pt-2">
          {note ? (
            <p data-testid="mode-note" className="text-xs text-muted">{note}</p>
          ) : (
            <ul aria-label={t('userModes.actionsLabel', { mode: t(`userModes.modes.${mode}.name`) })} className="flex max-h-28 flex-wrap gap-1 overflow-y-auto p-px max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:overflow-y-hidden">
              {MODE_ACTIONS[mode].map((action) => (
                <li key={action} className="shrink-0">
                  <button
                    type="button"
                    data-action={action}
                    aria-description={t('userModes.insertHint')}
                    onClick={() => {
                      const result = composer.current?.insert(t(`userModes.actions.${action}.prompt`));
                      setFeedback(result === 'too-long' ? t('userModes.tooLong') : null);
                    }}
                    className="pressable inline-flex min-h-7 items-center gap-1.5 rounded-lg border pointer-coarse:min-h-10 max-sm:whitespace-nowrap border-line bg-card px-2 text-left text-xs font-medium text-fg/90 hover:border-accent-line hover:bg-card-raised"
                  >
                    <CornerDownLeft size={12} className="shrink-0 text-muted" aria-hidden />
                    {t(`userModes.actions.${action}.label`)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!note && mode === 'legal' && <p className="mt-1.5 text-xs text-muted">{t('userModes.legalNote')}</p>}
          {!note && mode === 'hr' && <p data-testid="hr-note" className="mt-1.5 text-xs text-muted">{t('userModes.hrNote')}</p>}
          <p role="status" className="text-xs text-warning empty:hidden">{feedback}</p>
        </div>
      )}
    </div>
  );
}
