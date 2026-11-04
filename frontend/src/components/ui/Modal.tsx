import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name. Rendered as the heading unless `hideTitle` is set. */
  title: string;
  hideTitle?: boolean;
  className?: string;
  children: ReactNode;
}

/** Native <dialog> provides the focus trap, Escape handling and focus restoration. */
export function Modal({ open, onClose, title, hideTitle = false, className, children }: ModalProps) {
  const titleId = useId();
  return (
    <AnimatePresence>
      {open && (
        <ModalDialog onClose={onClose} titleId={titleId} title={title} hideTitle={hideTitle} className={className}>
          {children}
        </ModalDialog>
      )}
    </AnimatePresence>
  );
}

function ModalDialog({
  onClose,
  titleId,
  title,
  hideTitle,
  className,
  children,
}: Omit<ModalProps, 'open' | 'title' | 'hideTitle'> & { titleId: string; title: string; hideTitle: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Read during render: autoFocus inside the dialog runs before any effect would.
  const [trigger] = useState(() => document.activeElement);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      // The dialog is already detached here, so the browser can't restore focus by itself.
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [trigger]);

  return (
    <motion.dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none items-start justify-center bg-black/60 p-4 pt-[12vh] outline-none backdrop:bg-transparent"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
    >
      <motion.div
        className={cn(
          'w-full max-w-md rounded-panel border border-line bg-card text-fg shadow-float',
          className,
        )}
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, scale: 0.98 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 id={titleId} className={hideTitle ? 'sr-only' : 'px-5 pt-5 text-md font-semibold'}>
          {title}
        </h2>
        {children}
      </motion.div>
    </motion.dialog>
  );
}
