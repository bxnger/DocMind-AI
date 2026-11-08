import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, CircleCheck, Loader2, RotateCcw, X } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, buttonClasses } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { formatBytes } from '@/lib/format';
import { useUpload, type UploadItem } from './UploadProvider';

function PhaseLine({ item }: { item: UploadItem }) {
  const { t, i18n } = useTranslation();
  const { phase, file } = item;
  const size = formatBytes(file.size, i18n.language);
  switch (phase.status) {
    case 'queued':
      return <>{t('upload.queued', { size })}</>;
    case 'uploading':
      return <>{t('upload.uploading', { percent: Math.round(phase.progress * 100), size })}</>;
    case 'finishing':
      return <>{t('upload.finishing')}</>;
    case 'success':
      return <>{t('upload.success')}</>;
    case 'error':
      return <span className="text-danger">{phase.message}</span>;
  }
}

function Row({ item }: { item: UploadItem }) {
  const { t } = useTranslation();
  const { cancel, dismiss, retry } = useUpload();
  const { phase } = item;
  const failed = phase.status === 'error';
  const finished = phase.status === 'success' || failed;

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className={failed ? 'shake px-3 py-2' : 'px-3 py-2'}
    >
      <div className="flex items-center gap-2">
        {phase.status === 'success' && <CircleCheck size={16} className="shrink-0 text-success" aria-hidden />}
        {failed && <CircleAlert size={16} className="shrink-0 text-danger" aria-hidden />}
        {!finished && <Loader2 size={16} className="spin shrink-0 text-muted" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={item.file.name}>
            {item.file.name}
          </p>
          <p className="tabular text-xs break-words text-muted">
            <PhaseLine item={item} />
          </p>
        </div>
        {phase.status === 'success' && (
          <Link to={`/documents/${phase.documentId}`} onClick={() => dismiss(item.id)} className={buttonClasses('secondary', 'sm')}>
            {t('common.open')}
          </Link>
        )}
        {failed && phase.retryable && (
          <IconButton label={t('common.retry')} icon={<RotateCcw size={14} aria-hidden />} onClick={() => retry(item.id)} />
        )}
        <IconButton
          label={finished ? t('common.dismiss') : t('common.cancel')}
          icon={<X size={14} aria-hidden />}
          onClick={() => (finished ? dismiss(item.id) : cancel(item.id))}
        />
      </div>
      {phase.status === 'uploading' && (
        <div
          role="progressbar"
          aria-label={item.file.name}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(phase.progress * 100)}
          className="mt-2 h-1 overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full origin-left rounded-full bg-accent transition-transform duration-150 ease-out"
            style={{ transform: `scaleX(${phase.progress})` }}
          />
        </div>
      )}
    </motion.li>
  );
}

export function UploadTray() {
  const { t } = useTranslation();
  const { items, dismissFinished } = useUpload();
  const hasFinished = items.some((item) => item.phase.status === 'success' || item.phase.status === 'error');

  return (
    <AnimatePresence>
      {items.length > 0 && (
        <motion.section
          aria-label={t('upload.trayLabel')}
          aria-live="polite"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.2 }}
          className="fixed right-4 bottom-[calc(16px+var(--sa-bottom)+var(--tab-bar-height,0px))] z-30 w-[min(380px,calc(100vw-32px))] rounded-panel border border-line bg-card shadow-float"
        >
          <header className="flex h-10 items-center justify-between border-b border-line pr-2 pl-3">
            <h2 className="text-sm font-medium">{t('upload.trayTitle', { count: items.length })}</h2>
            {hasFinished && (
              <Button variant="ghost" size="sm" onClick={dismissFinished}>
                {t('upload.clearFinished')}
              </Button>
            )}
          </header>
          <ul className="max-h-64 divide-y divide-line overflow-y-auto">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <Row key={item.id} item={item} />
              ))}
            </AnimatePresence>
          </ul>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
