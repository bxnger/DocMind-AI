import { Play, ScanSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dropzone } from '@/features/upload/Dropzone';
import { EquipmentList } from '@/features/industry/EquipmentList';
import { useOpenWorkflow, useWorkflowStart } from '@/features/industry/useWorkflowStart';

export function EquipmentPage() {
  const { t } = useTranslation();
  const open = useOpenWorkflow();
  const { demo, demoBusy, demoFailed } = useWorkflowStart();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] space-y-4 px-4 py-6 md:px-8 md:py-8">
        <div>
          <h1 className="font-display text-2xl font-medium tracking-[-0.015em]">{t('industry.equipmentTitle')}</h1>
          <p className="mt-1 max-w-[65ch] text-muted">{t('industry.equipmentBody')}</p>
          <Dropzone className="mt-3" />
          <Button className="mt-2" icon={<Play size={14} aria-hidden />} loading={demoBusy} onClick={() => void demo()}>{t('home.demo')}</Button>
          {demoFailed && <p role="alert" className="mt-2 text-sm text-danger">{t('home.demoFailed')}</p>}
        </div>
        <EquipmentList
          renderAction={({ doc, list }) => (
            <Button size="sm" data-testid="equipment-open" disabled={doc.status === 'failed'} icon={<ScanSearch size={14} aria-hidden />} onClick={() => open(doc.id)}>
              {list ? t('industry.openParts') : t('industry.findParts')}
            </Button>
          )}
        />
      </div>
    </div>
  );
}
