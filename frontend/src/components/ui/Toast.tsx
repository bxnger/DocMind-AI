import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './IconButton';

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'info' | 'error';
}

interface ToastApi {
  show: (message: string, tone?: Toast['tone']) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show: (message, tone = 'success') => {
        const id = nextId.current++;
        setToasts((current) => [...current, { id, message, tone }]);
        // Errors stay until dismissed so they cannot be missed.
        if (tone !== 'error') window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      },
    }),
    [dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed top-4 right-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto flex items-start gap-2 rounded-control border border-line bg-card-raised py-2 pr-2 pl-3 text-sm shadow-float"
            >
              {toast.tone === 'error' ? (
                <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
              ) : toast.tone === 'info' ? (
                <Info size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
              ) : (
                <CircleCheck size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
              )}
              <span className="min-w-0 flex-1 py-0.5 break-words">{toast.message}</span>
              <IconButton label={t('common.dismiss')} icon={<X size={14} />} onClick={() => dismiss(toast.id)} className="size-6" />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
