import { useState, type DragEvent } from 'react';
import { motion } from 'motion/react';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { useUpload } from './UploadProvider';

export function Dropzone({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const { addFiles, openPicker, maxBytes } = useUpload();
  const [dragging, setDragging] = useState(false);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    // Stops the app-wide drop overlay from adding the same files a second time.
    event.stopPropagation();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  return (
    <motion.div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      animate={{ scale: dragging ? 1.01 : 1 }}
      transition={{ duration: 0.14 }}
      data-testid="dropzone"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-3 rounded-panel border border-dashed p-4 transition-colors duration-150',
        dragging ? 'border-accent bg-accent-tint' : 'border-line-strong bg-card',
        className,
      )}
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-control border border-line bg-sidebar text-accent">
        <Upload size={18} aria-hidden />
      </span>
      <div className="min-w-0 flex-1 basis-48">
      <p className="font-medium">
        {/* Touch screens have nothing to drop. */}
        <span className="pointer-coarse:hidden">{t('upload.dropTitle')}</span>
        <span className="hidden pointer-coarse:inline">{t('upload.tapTitle')}</span>
      </p>
      <p className="tabular text-sm text-muted">
        {t('upload.limits', { size: formatBytes(maxBytes, i18n.language) })}
      </p>
      </div>
      <Button variant="primary" size="lg" className="max-sm:w-full" onClick={openPicker}>
        {t('upload.choose')}
      </Button>
    </motion.div>
  );
}
