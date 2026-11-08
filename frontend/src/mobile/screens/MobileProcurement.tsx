import { useTranslation } from 'react-i18next';
import { ProcurementPage } from '@/pages/ProcurementPage';
import { MobileHeader } from '../MobileHeader';

/** Price lists and each document's purchase sheet: the website's page, under the phone's header. */
export function MobileProcurement() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col">
      <MobileHeader title={t('mobile.tab.procurement')} />
      <div className="min-h-0 flex-1 [&_h1]:hidden">
        <ProcurementPage />
      </div>
    </div>
  );
}
