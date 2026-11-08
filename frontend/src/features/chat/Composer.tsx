import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/IconButton';
import { insertPrompt, type InsertResult } from '@/features/userModes/modes';
import { cn } from '@/lib/cn';

export interface ComposerHandle {
  focus: () => void;
  setText: (text: string) => void;
  /** Adds a prompt for the user to review. It never sends and never drops text already typed. */
  insert: (prompt: string) => InsertResult['status'];
}

interface Props {
  documentName: string;
  disabledReason: string | null;
  pending: boolean;
  autoFocus: boolean;
  onSend: (question: string) => void;
  onStop: () => void;
}

const MAX_HEIGHT = 160;
/** The backend's limit for one message. */
const MAX_CHARS = 2000;
const COUNTER_FROM = 1800;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { documentName, disabledReason, pending, autoFocus, onSend, onStop },
  ref,
) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const caretToEnd = useRef(false);
  const disabled = disabledReason !== null;

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setText: (value) => {
      setText(value);
      inputRef.current?.focus();
    },
    insert: (prompt) => {
      const result = insertPrompt(text, prompt, MAX_CHARS);
      setText(result.text);
      inputRef.current?.focus();
      caretToEnd.current = true;
      return result.status;
    },
  }));

  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    // In the same commit as the new value, so typing right after an insert lands at the end.
    if (caretToEnd.current) {
      caretToEnd.current = false;
      element.setSelectionRange(text.length, text.length);
    }
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const wasDisabled = useRef(disabled);
  useLayoutEffect(() => {
    // Ready for input after upload or text extraction: put the cursor there.
    if (autoFocus && !disabled && (wasDisabled.current || !inputRef.current?.value)) inputRef.current?.focus();
    wasDisabled.current = disabled;
  }, [autoFocus, disabled]);

  const submit = () => {
    if (!text.trim() || pending || disabled) return;
    onSend(text);
    setText('');
  };

  return (
    <div data-composer className="shrink-0 p-3 pb-[calc(12px+var(--sa-bottom))]">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className={cn(
          'rounded-panel border border-line bg-card transition-colors duration-150 focus-within:border-accent',
          disabled && 'opacity-60',
        )}
      >
        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          maxLength={MAX_CHARS}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          aria-label={t('chat.inputLabel')}
          placeholder={disabledReason ?? t('chat.placeholder')}
          className="block w-full resize-none bg-transparent px-3 pt-3 pb-1 outline-none placeholder:text-muted disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-2 py-2 pr-2 pl-3">
          <span className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted" title={documentName}>
            <FileText size={12} className="shrink-0" aria-hidden />
            <span className="truncate">{documentName}</span>
          </span>
          {text.length >= COUNTER_FROM && (
            <span aria-live="polite" className="tabular shrink-0 text-xs text-muted">{text.length}/{MAX_CHARS}</span>
          )}
          {pending ? (
            <IconButton dense type="button" label={t('chat.stop')} icon={<Square size={14} aria-hidden />} onClick={onStop} className="border border-line" />
          ) : (
            <IconButton
              dense
              type="submit"
              label={t('chat.send')}
              icon={<ArrowUp size={16} aria-hidden />}
              disabled={disabled || !text.trim()}
              className="bg-accent text-on-accent hover:bg-accent-strong hover:text-on-accent disabled:bg-line disabled:text-muted disabled:hover:bg-line"
            />
          )}
        </div>
      </form>
      <p className="mt-2 hidden text-center text-xs text-muted pointer-fine:block [@media(max-height:500px)]:hidden">{t('chat.hint')}</p>
    </div>
  );
});
