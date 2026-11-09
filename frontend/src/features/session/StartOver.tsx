import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { endSession } from '@/api/session';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useErrorMessage } from '@/features/system/useErrorMessage';

/**
 * Back to a clean start, for example between two demonstrations: the server deletes this guest's documents,
 * chats and sheets, and the app reloads empty. Theme, language and mode are preferences and stay.
 */
export function StartOver({ className }: { className?: string }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await endSession();
      window.location.assign('/');
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };
  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  return (
    <>
      <Button data-testid="start-over" className={className} icon={<RotateCcw size={14} aria-hidden />} onClick={() => setOpen(true)}>
        {t('startOver.button')}
      </Button>
      <Modal open={open} onClose={close} title={t('startOver.title')}>
        <div className="px-5 pt-1 pb-5">
          <p className="text-sm text-muted">{t('startOver.body')}</p>
          {error && <p role="alert" data-testid="start-over-error" className="mt-3 text-sm break-words text-danger">{t('startOver.failed')} {error}</p>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button onClick={close} autoFocus disabled={busy}>{t('common.cancel')}</Button>
            <Button variant="danger" data-testid="start-over-confirm" loading={busy} onClick={() => void confirm()}>{t('startOver.confirm')}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
