import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import type { DocumentModel } from '@/types/document';
import { useDeleteDocument } from './useDocuments';

interface Props {
  doc: DocumentModel | null;
  onClose: () => void;
  onDeleted?: () => void;
}

export function DeleteDocumentDialog({ doc, onClose, onDeleted }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const remove = useDeleteDocument();

  const confirm = () => {
    if (!doc) return;
    remove.mutate(doc.id, {
      onSuccess: () => {
        toast.show(t('documents.deleted'));
        onClose();
        onDeleted?.();
      },
      onError: (error) => {
        toast.show(errorMessage(error), 'error');
        onClose();
      },
    });
  };

  return (
    <Modal open={doc !== null} onClose={onClose} title={t('documents.deleteTitle')}>
      <div className="px-5 pt-1 pb-5">
        <p className="text-sm break-words text-muted">{t('documents.deleteBody', { name: doc?.name ?? '' })}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} autoFocus>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={confirm}>
            {t('common.delete')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
