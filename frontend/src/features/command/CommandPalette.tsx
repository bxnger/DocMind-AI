import { useMemo, useState, type ReactNode } from 'react';
import { FileText, FlaskConical, FolderOpen, GitCompareArrows, History, Home, Search, Settings, Upload } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { useDocuments } from '@/features/documents/useDocuments';
import { useUpload } from '@/features/upload/UploadProvider';
import { cn } from '@/lib/cn';
import { SAMPLE_DOCUMENT_ID } from '@/services/sampleDocument';

interface Command {
  id: string;
  label: string;
  group: 'documents' | 'actions';
  icon: ReactNode;
  run: () => void;
}

function Palette({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const documents = useDocuments();
  const { openPicker } = useUpload();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => navigate(path);
    const docs: Command[] = (documents.data ?? []).map((doc) => ({
      id: doc.id,
      label: doc.name,
      group: 'documents',
      icon: <FileText size={16} aria-hidden />,
      run: go(`/documents/${doc.id}`),
    }));
    const actions: Command[] = [
      { id: 'upload', label: t('nav.upload'), group: 'actions', icon: <Upload size={16} aria-hidden />, run: openPicker },
      { id: 'sample', label: t('home.openSample'), group: 'actions', icon: <FlaskConical size={16} aria-hidden />, run: go(`/documents/${SAMPLE_DOCUMENT_ID}`) },
      { id: 'home', label: t('nav.home'), group: 'actions', icon: <Home size={16} aria-hidden />, run: go('/') },
      { id: 'documents', label: t('nav.documents'), group: 'actions', icon: <FolderOpen size={16} aria-hidden />, run: go('/documents') },
      { id: 'compare', label: t('nav.compare'), group: 'actions', icon: <GitCompareArrows size={16} aria-hidden />, run: go('/compare') },
      { id: 'recent', label: t('nav.recent'), group: 'actions', icon: <History size={16} aria-hidden />, run: go('/recent') },
      { id: 'settings', label: t('nav.settings'), group: 'actions', icon: <Settings size={16} aria-hidden />, run: go('/settings') },
    ];
    return [...docs, ...actions];
  }, [documents.data, navigate, openPicker, t]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? commands.filter((command) => command.label.toLowerCase().includes(needle)) : commands;
  }, [commands, query]);

  const safeIndex = Math.min(index, Math.max(filtered.length - 1, 0));
  const execute = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <>
      <div className="flex h-12 items-center gap-3 border-b border-line px-4">
        <Search size={16} className="shrink-0 text-muted" aria-hidden />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          aria-activedescendant={filtered[safeIndex] ? `command-${filtered[safeIndex].id}` : undefined}
          aria-label={t('command.placeholder')}
          placeholder={t('command.placeholder')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex((safeIndex + 1) % Math.max(filtered.length, 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((safeIndex - 1 + filtered.length) % Math.max(filtered.length, 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              execute(filtered[safeIndex]);
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
        />
      </div>
      <ul id="command-list" role="listbox" aria-label={t('command.results')} className="max-h-80 overflow-y-auto p-2">
        {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{t('command.empty')}</li>}
        {filtered.map((command, position) => (
          <li
            key={command.id}
            id={`command-${command.id}`}
            role="option"
            aria-selected={position === safeIndex}
            onMouseMove={() => setIndex(position)}
            onClick={() => execute(command)}
            className={cn(
              'flex h-10 cursor-pointer items-center gap-3 rounded-[10px] px-3 text-sm',
              position === safeIndex ? 'bg-accent-tint text-fg' : 'text-muted',
            )}
          >
            <span className="shrink-0">{command.icon}</span>
            <span className="min-w-0 flex-1 truncate">{command.label}</span>
            <span className="shrink-0 text-xs text-muted">{t(`command.group.${command.group}`)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={t('command.title')} hideTitle className="max-w-xl overflow-hidden">
      <Palette onClose={onClose} />
    </Modal>
  );
}
