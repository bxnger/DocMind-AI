import { useEffect, useState } from 'react';
import { CheckCheck, ClipboardList, FileText, ListChecks, MessageSquareText, MoreHorizontal, Network, Trash2, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { ModeSelect } from '@/features/userModes/ModeSelector';
import type { LeftView, Pane } from '@/features/workspace/workspaceView';
import { isNativeApp } from '@/features/native/platform';
import { cn } from '@/lib/cn';

type Main = 'document' | 'assistant' | 'procurement';

interface Props {
  pane: Pane;
  view: LeftView;
  views: readonly LeftView[];
  canDelete: boolean;
  onGo: (pane: Pane, view: LeftView) => void;
  onDelete: () => void;
}

const MORE: ReadonlyArray<{ view: 'verify' | 'map' | 'facts'; Icon: LucideIcon }> = [
  { view: 'verify', Icon: CheckCheck },
  { view: 'map', Icon: Network },
  { view: 'facts', Icon: ListChecks },
];

/**
 * The keyboard needs the room, so the bar steps aside while it is open. In the app the keyboard itself says so: Back can
 * close it while the field keeps its focus. In a browser preview, focus in a text field stands in for it.
 */
function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (isNativeApp()) {
      const handles: Array<Promise<{ remove: () => Promise<void> }>> = [];
      void import('@capacitor/keyboard').then(({ Keyboard }) => {
        handles.push(Keyboard.addListener('keyboardWillShow', () => setTyping(true)), Keyboard.addListener('keyboardWillHide', () => setTyping(false)));
      });
      return () => handles.forEach((handle) => void handle.then((h) => h.remove()));
    }
    const isField = (target: EventTarget | null) => target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'button'].includes(target.type));
    const onIn = (event: FocusEvent) => setTyping(isField(event.target));
    const onOut = () => setTyping(false);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return typing;
}

/**
 * A document on a phone: three main places at the bottom, the document, the assistant and its parts and purchase,
 * and the other tools behind More. Nothing is removed: the same views as on the website.
 */
export function DocumentNav({ pane, view, views, canDelete, onGo, onDelete }: Props) {
  const { t } = useTranslation();
  const typing = useTyping();
  const [more, setMore] = useState(false);
  const current: Main | 'more' = pane === 'assistant' ? 'assistant' : view === 'document' ? 'document' : view === 'procurement' ? 'procurement' : 'more';
  const items: ReadonlyArray<{ key: Main | 'more'; Icon: LucideIcon; label: string; onClick: () => void }> = [
    { key: 'document', Icon: FileText, label: t('mobile.doc.document'), onClick: () => onGo('document', 'document') },
    { key: 'assistant', Icon: MessageSquareText, label: t('mobile.doc.assistant'), onClick: () => onGo('assistant', view) },
    ...(views.includes('procurement') ? [{ key: 'procurement' as const, Icon: ClipboardList, label: t('mobile.doc.parts'), onClick: () => onGo('document', 'procurement') }] : []),
    { key: 'more', Icon: MoreHorizontal, label: t('mobile.doc.more'), onClick: () => setMore(true) },
  ];
  const tools = MORE.filter((tool) => views.includes(tool.view));
  return (
    <>
      {!typing && (
        <nav aria-label={t('mobile.doc.sections')} data-testid="document-nav" className="shrink-0 border-t border-line bg-sidebar pb-[var(--sa-bottom)]">
          <ul className="flex">
            {items.map(({ key, Icon, label, onClick }) => (
              <li key={key} className="min-w-0 flex-1">
                <button type="button" data-testid={`doc-nav-${key}`} aria-current={current === key ? 'page' : undefined} onClick={onClick} className={cn('pressable flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium', current === key ? 'text-accent-strong' : 'text-muted')}>
                  <span className={cn('inline-flex h-7 w-12 items-center justify-center rounded-full', current === key && 'bg-accent-tint')}><Icon size={20} aria-hidden /></span>
                  <span className="max-w-full truncate px-0.5">{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <Modal open={more} onClose={() => setMore(false)} title={t('mobile.doc.moreTitle')}>
        <ul data-testid="doc-more" className="px-2 pb-2">
          {tools.map(({ view: tool, Icon }) => (
            <li key={tool}>
              <button type="button" data-testid={`doc-more-${tool}`} onClick={() => { setMore(false); onGo('document', tool); }} className="pressable flex min-h-14 w-full items-center gap-3 rounded-control px-3 text-left hover:bg-hover">
                <Icon size={18} className="shrink-0 text-accent" aria-hidden />
                <span className="min-w-0 flex-1"><span className="block font-medium">{t(`workspace.segments.${tool}`)}</span><span className="block text-xs text-muted">{t(`mobile.doc.toolHint.${tool}`)}</span></span>
              </button>
            </li>
          ))}
          <li className="flex min-h-14 items-center justify-between gap-2 px-3">
            <span className="text-sm text-muted">{t('userModes.title')}</span>
            <ModeSelect />
          </li>
          {canDelete && (
            <li>
              <button type="button" data-testid="doc-more-delete" onClick={() => { setMore(false); onDelete(); }} className="pressable flex min-h-14 w-full items-center gap-3 rounded-control px-3 text-left text-danger hover:bg-danger-tint">
                <Trash2 size={18} aria-hidden />{t('common.delete')}
              </button>
            </li>
          )}
        </ul>
      </Modal>
    </>
  );
}
