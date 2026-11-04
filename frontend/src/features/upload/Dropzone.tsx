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
        'flex flex-col items-center justify-center rounded-panel border border-dashed px-6 py-8 text-center transition-colors duration-150',
        dragging ? 'border-accent bg-accent-tint' : 'border-line-strong bg-sidebar',
        className,
      )}
    >
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-control border border-line bg-card text-accent">
        <Upload size={18} aria-hidden />
      </span>
      <p className="text-md font-medium">{t('upload.dropTitle')}</p>
      <p className="tabular mt-1 text-sm text-muted">
        {t('upload.limits', { size: formatBytes(maxBytes, i18n.language) })}
      </p>
      <Button variant="primary" size="lg" className="mt-4" onClick={openPicker}>
        {t('upload.choose')}
      </Button>
    </motion.div>
  );
}
