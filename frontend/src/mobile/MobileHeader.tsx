import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/IconButton';

/** One header for every phone screen: an optional Back, the title, and up to two actions. */
export function MobileHeader({ title, back = false, actions }: { title: string; back?: boolean; actions?: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-bg px-2">
      {back && <IconButton label={t('mobile.back')} icon={<ArrowLeft size={20} aria-hidden />} onClick={() => void navigate(-1)} className="size-11" />}
      <h1 className={`min-w-0 flex-1 truncate font-display text-xl font-medium ${back ? '' : 'pl-2'}`}>{title}</h1>
      {actions}
    </header>
  );
}

export function MobileScreen({ title, back, actions, children }: { title: string; back?: boolean; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <MobileHeader title={title} back={back} actions={actions} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[640px] space-y-4 px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
