import { RotateCcw, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API_BASE_URL } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { useBackendHealth } from '@/features/system/useSystem';

export function BackendBanner() {
  const { t } = useTranslation();
  const health = useBackendHealth();
  if (health.status !== 'offline') return null;
  return (
    <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-danger/30 bg-danger-tint py-1 pr-2 pl-4 text-sm">
      <Unplug size={14} className="shrink-0 text-danger" aria-hidden />
      <p className="min-w-0 flex-1 break-words">
        {t('system.offlineBanner')} <code className="text-xs text-muted">{API_BASE_URL}</code>
      </p>
      <Button variant="ghost" size="sm" loading={health.isRetrying} icon={<RotateCcw size={14} aria-hidden />} onClick={health.retry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
