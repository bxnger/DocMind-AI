import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ChatMessage } from '@/types/chat';
import { AnswerMessage } from './AnswerMessage';

const BOTTOM_TOLERANCE = 48;

interface Props {
  messages: ChatMessage[];
  onRetry: (id: string) => void;
  onRephrase: () => void;
  onUseDemo: (() => void) | null;
}

export function MessageList({ messages, onRetry, onRephrase, onUseDemo }: Props) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Answers restored from the session appear without an entrance animation.
  const [restored] = useState(() => new Set(messages.map((message) => message.id)));
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.id;
  const previousUser = useRef(lastUserMessage);

  const toBottom = () => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  };

  // Follow new content only if the reader is already at the end.
  useLayoutEffect(() => {
    if (atBottom) toBottom();
  }, [messages, atBottom]);

  // Asking a new question always brings the answer into view.
  useEffect(() => {
    if (lastUserMessage !== previousUser.current) {
      previousUser.current = lastUserMessage;
      toBottom();
      setAtBottom(true);
    }
  }, [lastUserMessage]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label={t('chat.history')}
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_TOLERANCE);
        }}
        className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 outline-offset-[-2px]"
      >
        {messages.map((message) =>
          message.role === 'user' ? (
            <div key={message.id} className="ml-8 flex justify-end">
              <p className="rounded-control rounded-br-sm border border-line bg-card-raised px-3 py-2 break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
                {message.text}
              </p>
            </div>
          ) : (
            <AnswerMessage
              key={message.id}
              message={message}
              animate={!restored.has(message.id)}
              onRetry={onRetry}
              onRephrase={onRephrase}
              onUseDemo={onUseDemo}
            />
          ),
        )}
      </div>
      {!atBottom && (
        // A row of its own: floating over the list, it covered the buttons of the cards below it.
        <div className="flex shrink-0 justify-center border-t border-line py-1.5">
          <Button size="sm" icon={<ArrowDown size={14} aria-hidden />} onClick={toBottom}>
            {t('chat.jumpLatest')}
          </Button>
        </div>
      )}
    </div>
  );
}
