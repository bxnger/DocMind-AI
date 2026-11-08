import { Camera, Cog, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EquipmentList } from '@/features/industry/EquipmentList';
import { useOpenWorkflow, useWorkflowStart } from '@/features/industry/useWorkflowStart';
import { MobileScreen } from '../MobileHeader';

/**
 * A marking is matched against a document's parts, so the scanner starts by choosing the machine's document and opens
 * its photo step. The same server reading and the same person's confirmation as on the website.
 */
export function MobileScanner() {
  const { t } = useTranslation();
  const open = useOpenWorkflow();
  const { analyze } = useWorkflowStart();
  return (
    <MobileScreen title={t('mobile.tab.scanner')}>
      <div className="rounded-panel border border-line bg-card p-4">
        <Camera size={24} className="text-accent" aria-hidden />
        <h2 className="mt-2 font-semibold">{t('mobile.scanner.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('mobile.scanner.body')}</p>
      </div>
      <h2 className="font-semibold">{t('mobile.scanner.choose')}</h2>
      <EquipmentList
        renderAction={({ doc }) => (
          <Button size="sm" data-testid="scanner-open" className="min-h-11" disabled={doc.status !== 'ready'} icon={<Camera size={14} aria-hidden />} onClick={() => open(doc.id, 'camera')}>{t('mobile.scanner.open')}</Button>
        )}
      />
      <Button variant="ghost" className="w-full" icon={<Upload size={16} aria-hidden />} onClick={analyze}>{t('mobile.scanner.newDocument')}</Button>
      <p className="flex items-start gap-2 text-xs text-muted"><Cog size={14} className="mt-0.5 shrink-0" aria-hidden />{t('mobile.scanner.privacy')}</p>
    </MobileScreen>
  );
}
