import { ClipboardList, FlaskConical } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { deletePriceList, listPriceLists, uploadPriceList } from '@/api/procurement';
import { Button } from '@/components/ui/Button';
import { EquipmentList } from '@/features/industry/EquipmentList';
import { useOpenWorkflow } from '@/features/industry/useWorkflowStart';
import { PriceListsCard } from '@/features/procurement/PriceListsCard';
import { sheetStorageKey } from '@/features/procurement/useProcurement';
import type { SheetLine } from '@/features/procurement/sheetLines';
import { useCapabilities } from '@/features/system/useSystem';
import { readStored } from '@/lib/storage';

const LIVE_API = { isDemo: false, uploadPriceList, deletePriceList };

export function ProcurementPage() {
  const { t } = useTranslation();
  const capabilities = useCapabilities();
  const open = useOpenWorkflow();
  const live = capabilities.data?.features.priceLists === true;
  const lists = useQuery({ queryKey: ['procurement', 'overview', 'lists'], queryFn: ({ signal }) => listPriceLists(signal), enabled: live });
  const chosenIn = (documentId: string) => Object.values(readStored<Record<string, SheetLine>>('session', sheetStorageKey(documentId), {})).filter((line) => line.offerId).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] space-y-4 px-4 py-6 md:px-8 md:py-8">
        <div>
          <h1 className="font-display text-2xl font-medium tracking-[-0.015em]">{t('industry.procurementTitle')}</h1>
          <p className="mt-1 max-w-[65ch] text-muted">{t('industry.procurementBody')}</p>
        </div>
        {/* Only a server that answered can be said not to keep price lists; an unreachable one is shown by the offline banner. */}
        {capabilities.isSuccess && (live ? <PriceListsCard api={LIVE_API} lists={lists.data} /> : (
          <p data-testid="prices-demo" role="note" className="flex gap-2 rounded-control bg-warning-tint p-2.5 text-xs text-warning">
            <FlaskConical size={14} className="mt-px shrink-0" aria-hidden />
            <span>{t('industry.pricesDemo')}</span>
          </p>
        ))}
        <section aria-labelledby="sheets-title">
          <h2 id="sheets-title" className="mb-2 font-display text-lg font-medium">{t('industry.sheetsTitle')}</h2>
          <EquipmentList
            renderNote={(doc) => {
              const chosen = chosenIn(doc.id);
              return chosen ? <p data-testid="sheet-chosen" className="mt-0.5 text-xs text-accent-strong">{t('industry.chosenOffers', { count: chosen })}</p> : null;
            }}
            renderAction={({ doc }) => <Button size="sm" data-testid="sheet-open" disabled={doc.status === 'failed'} icon={<ClipboardList size={14} aria-hidden />} onClick={() => open(doc.id, 'sheet')}>{t('industry.openSheet')}</Button>}
          />
        </section>
      </div>
    </div>
  );
}
