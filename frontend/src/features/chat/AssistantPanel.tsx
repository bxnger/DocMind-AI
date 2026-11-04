import { useRef } from 'react';
import { CircleAlert, CornerDownRight, FlaskConical, FileQuestion, FileX2, Loader2, ScanLine, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { useCodeMessage } from '@/features/system/useErrorMessage';
import { cn } from '@/lib/cn';
import { StateBlock } from '@/components/ui/StateBlock';
import type { DocumentModel } from '@/types/document';
import type { ChatMode } from '@/types/chat';
import { Composer, type ComposerHandle } from './Composer';
import { MessageList } from './MessageList';
import type { ChatController } from './useChat';

export type AssistantAvailability =
  | { state: 'preparing'; reason: 'text' | 'processing' }
  | { state: 'ready'; suggestions: string[]; suggestionLang: string | undefined }
  | { state: 'unavailable'; reason: UnavailableReason };

type UnavailableReason = 'docx' | 'no-text' | 'no-file' | 'pdf-error' | 'failed';

interface Props {
  mode: ChatMode;
  canSwitchMode: boolean;
  onModeChange: (mode: ChatMode) => void;
  doc: DocumentModel;
  availability: AssistantAvailability;
  chat: ChatController;
  autoFocus: boolean;
}

function DemoNotice() {
  const { t } = useTranslation();
  return (
    <div data-testid="demo-notice" className="flex gap-2 [@media(max-height:500px)]:hidden border-b border-line bg-accent-tint px-4 py-2 text-xs text-fg/90">
      <FlaskConical size={14} className="mt-px shrink-0 text-accent-strong" aria-hidden />
      <p>
        <strong className="font-medium">{t('chat.demoTitle')}</strong> {t('chat.demoBody')}
      </p>
    </div>
  );
}

function Unavailable({ reason, doc }: { reason: UnavailableReason; doc: DocumentModel }) {
  const { t } = useTranslation();
  const codeMessage = useCodeMessage();
  const icons = {
    docx: <FileQuestion size={18} aria-hidden />,
    'no-text': <ScanLine size={18} aria-hidden />,
    'no-file': <FileX2 size={18} aria-hidden />,
    'pdf-error': <FileX2 size={18} aria-hidden />,
    failed: <FileX2 size={18} aria-hidden />,
  };
  return (
    <StateBlock
      icon={icons[reason]}
      title={t(`chat.unavailable.${reason}.title`)}
      description={reason === 'failed' ? codeMessage(doc.error?.code) : t(`chat.unavailable.${reason}.body`)}
      className="my-auto"
    />
  );
}

export function AssistantPanel({ mode, canSwitchMode, onModeChange, doc, availability, chat, autoFocus }: Props) {
  const { t } = useTranslation();
  const composer = useRef<ComposerHandle>(null);

  const disabledReason =
    availability.state === 'preparing'
      ? t(availability.reason === 'processing' ? 'chat.waitingProcessing' : 'chat.preparing')
      : availability.state === 'unavailable'
        ? t('chat.unavailablePlaceholder')
        : null;

  return (
    <section aria-label={t('chat.title')} className="flex h-full min-h-0 flex-col bg-sidebar">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          {t('chat.title')}
          {canSwitchMode ? (
            <span role="radiogroup" aria-label={t('chat.modeLabel')} className="inline-flex rounded-lg border border-line bg-card p-px">
              {(['live', 'demo'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  disabled={chat.pending}
                  onClick={() => onModeChange(value)}
                  className={cn('pressable rounded-md px-2 text-xs font-medium disabled:cursor-not-allowed', mode === value ? 'bg-accent-tint text-fg' : 'text-muted hover:text-fg')}
                >
                  {t(value === 'live' ? 'chat.modeLive' : 'chat.demoBadge')}
                </button>
              ))}
            </span>
          ) : (
            <span className="rounded-full border border-accent-line px-2 text-xs font-medium text-accent-strong">{t('chat.demoBadge')}</span>
          )}
        </h2>
        <IconButton
          dense
          label={t('chat.clear')}
          icon={<Trash2 size={14} aria-hidden />}
          disabled={chat.messages.length === 0}
          onClick={chat.clear}
        />
      </header>
      {mode === 'demo' && <DemoNotice />}

      {chat.historyState === 'loading' ? (
        <div role="status" aria-label={t('common.loading')} className="flex-1 space-y-3 p-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-24" />
        </div>
      ) : chat.historyState === 'error' ? (
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <StateBlock
            tone="danger"
            icon={<CircleAlert size={18} aria-hidden />}
            title={t('chat.historyError')}
            actions={<Button onClick={chat.reloadHistory}>{t('common.retry')}</Button>}
            className="my-auto"
          />
        </div>
      ) : chat.messages.length > 0 ? (
        <MessageList
          messages={chat.messages}
          onRetry={chat.retry}
          onRephrase={() => composer.current?.focus()}
          onUseDemo={canSwitchMode && doc.kind === 'pdf' ? () => onModeChange('demo') : null}
        />
      ) : availability.state === 'unavailable' ? (
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <Unavailable reason={availability.reason} doc={doc} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {/* mt-auto rather than justify-end: tall content must stay reachable by scrolling. */}
          <h3 className="mt-auto text-md font-semibold">{t('chat.emptyTitle')}</h3>
          <p className="mt-1 max-w-[60ch] text-sm text-muted">{t('chat.emptyBody')}</p>
          {availability.state === 'preparing' ? (
            <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted">
              <Loader2 size={14} className="spin" aria-hidden />
              {t(availability.reason === 'processing' ? 'chat.waitingProcessing' : 'chat.preparing')}
            </p>
          ) : (
            availability.suggestions.length > 0 && (
              <ul className="mt-4 space-y-1" lang={availability.suggestionLang}>
                {availability.suggestions.map((question) => (
                  <li key={question}>
                    <button
                      type="button"
                      onClick={() => chat.send(question)}
                      className="pressable flex w-full items-start gap-2 rounded-control border border-line bg-card px-3 py-2 text-left text-sm hover:border-line-strong hover:bg-card-raised"
                    >
                      <CornerDownRight size={14} className="mt-[3px] shrink-0 text-muted" aria-hidden />
                      {question}
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}

      <Composer
        ref={composer}
        documentName={doc.name}
        disabledReason={disabledReason}
        pending={chat.pending}
        autoFocus={autoFocus}
        onSend={chat.send}
        onStop={chat.stop}
      />
    </section>
  );
}
