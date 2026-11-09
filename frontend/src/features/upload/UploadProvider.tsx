import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppError } from '@/api/client';
import { uploadDocument } from '@/api/documents';
import { useToast } from '@/components/ui/Toast';
import { DOCUMENTS_KEY } from '@/features/documents/useDocuments';
import { useCapabilities } from '@/features/system/useSystem';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { formatBytes, shortFileName } from '@/lib/format';
import { saveLocalFile } from '@/services/localFiles';
import { FALLBACK_MAX_BYTES, validateFile } from './validateFile';

export type UploadPhase =
  | { status: 'queued' }
  | { status: 'uploading'; progress: number }
  /** All bytes sent, waiting for the server's response. There is no progress to report here. */
  | { status: 'finishing' }
  | { status: 'success'; documentId: string }
  | { status: 'error'; message: string; retryable: boolean };

export interface UploadItem {
  id: number;
  file: File;
  phase: UploadPhase;
}

interface UploadApi {
  items: UploadItem[];
  maxBytes: number;
  addFiles: (files: Iterable<File>) => void;
  openPicker: () => void;
  cancel: (id: number) => void;
  retry: (id: number) => void;
  dismiss: (id: number) => void;
  dismissFinished: () => void;
}

const UploadContext = createContext<UploadApi | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const capabilities = useCapabilities();
  const maxBytes = capabilities.data?.limits.maxFileSizeBytes ?? FALLBACK_MAX_BYTES;

  const [items, setItems] = useState<UploadItem[]>([]);
  const nextId = useRef(1);
  const active = useRef<{ id: number; controller: AbortController } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setPhase = useCallback((id: number, phase: UploadPhase) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, phase } : item)));
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      const added: UploadItem[] = [...files].map((file) => {
        const problem = validateFile(file, maxBytes);
        const id = nextId.current++;
        if (!problem) return { id, file, phase: { status: 'queued' } };
        const message =
          problem.code === 'unsupported'
            ? t('errors.unsupportedType')
            : problem.code === 'empty'
              ? t('errors.emptyFile')
              : t('errors.tooLarge', { limit: formatBytes(problem.limitBytes, i18n.language) });
        return { id, file, phase: { status: 'error', message, retryable: false } };
      });
      setItems((current) => [...current, ...added]);
    },
    [i18n.language, maxBytes, t],
  );

  const run = useCallback(
    async (item: UploadItem) => {
      const controller = new AbortController();
      active.current = { id: item.id, controller };
      setPhase(item.id, { status: 'uploading', progress: 0 });
      try {
        const doc = await uploadDocument(item.file, {
          signal: controller.signal,
          onProgress: (fraction) =>
            setPhase(item.id, fraction >= 1 ? { status: 'finishing' } : { status: 'uploading', progress: fraction }),
        });
        if (doc.kind === 'pdf') {
          await saveLocalFile(doc.id, item.file).catch((error: unknown) => {
            console.warn('Could not keep a browser copy', error);
            toast.show(t('upload.noLocalCopy', { name: shortFileName(doc.name) }), 'info');
          });
        }
        setPhase(item.id, { status: 'success', documentId: doc.id });
        await client.invalidateQueries({ queryKey: DOCUMENTS_KEY, exact: true });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          dismiss(item.id);
        } else {
          setPhase(item.id, {
            status: 'error',
            message: errorMessage(error),
            retryable: error instanceof AppError && error.retryable,
          });
        }
      } finally {
        active.current = null;
        // Wakes the queue effect below, even if the item's phase did not change it.
        setItems((current) => [...current]);
      }
    },
    [client, dismiss, errorMessage, setPhase, t, toast],
  );

  // One upload at a time keeps progress honest and server load predictable.
  useEffect(() => {
    if (active.current) return;
    const next = items.find((item) => item.phase.status === 'queued');
    // Starting an upload is the external system this effect synchronizes with.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next) void run(next);
  }, [items, run]);

  const api = useMemo<UploadApi>(
    () => ({
      items,
      maxBytes,
      addFiles,
      dismiss,
      openPicker: () => inputRef.current?.click(),
      cancel: (id) => {
        if (active.current?.id === id) active.current.controller.abort();
        else dismiss(id);
      },
      retry: (id) => setPhase(id, { status: 'queued' }),
      dismissFinished: () =>
        setItems((current) =>
          current.filter((item) => item.phase.status !== 'success' && item.phase.status !== 'error'),
        ),
    }),
    [addFiles, dismiss, items, maxBytes, setPhase],
  );

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = '';
  };

  return (
    <UploadContext.Provider value={api}>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        hidden
        data-testid="file-input"
        onChange={onPick}
      />
    </UploadContext.Provider>
  );
}

export function useUpload(): UploadApi {
  const context = useContext(UploadContext);
  if (!context) throw new Error('useUpload must be used inside UploadProvider');
  return context;
}
