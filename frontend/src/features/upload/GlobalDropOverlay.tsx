import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpload } from './UploadProvider';

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

/** Dropping a file anywhere in the app uploads it, not just over the dropzone. */
export function GlobalDropOverlay() {
  const { t } = useTranslation();
  const { addFiles } = useUpload();
  const [visible, setVisible] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current += 1;
      setVisible(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setVisible(false);
    };
    const onOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      addFiles(event.dataTransfer.files);
    };
    // The capture listener resets the overlay even when the dropzone stops propagation,
    // which is also what keeps the bubbling listener from adding the same files twice.
    const reset = () => {
      depth.current = 0;
      setVisible(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', reset, true);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', reset, true);
      window.removeEventListener('drop', onDrop);
    };
  }, [addFiles]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-bg/80 p-6"
        >
          <div className="flex h-full max-h-80 w-full max-w-xl flex-col items-center justify-center rounded-panel border border-dashed border-accent bg-accent-tint text-center">
            <Upload size={24} className="mb-3 text-accent" aria-hidden />
            <p className="text-md font-medium">{t('upload.dropAnywhere')}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
