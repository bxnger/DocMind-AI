import { RotateCcw, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useBackendHealth } from '@/features/system/useSystem';

/** Says the server can't be reached, in words, with a retry. The address itself is for the About screen only. */
export function OfflineNotice() {
  const { t } = useTranslation();
  const health = useBackendHealth();
  if (health.status !== 'offline') return null;
  return (
    <div role="alert" data-testid="offline-notice" className="flex shrink-0 items-center gap-3 border-b border-danger/30 bg-danger-tint px-4 py-2 text-sm">
      <WifiOff size={18} className="shrink-0 text-danger" aria-hidden />
      <p className="min-w-0 flex-1">{t('mobile.offline')}</p>
      <Button size="sm" loading={health.isRetrying} icon={<RotateCcw size={14} aria-hidden />} onClick={health.retry}>{t('common.retry')}</Button>
    </div>
  );
}
