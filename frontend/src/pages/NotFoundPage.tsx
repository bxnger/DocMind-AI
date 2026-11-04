import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { buttonClasses } from '@/components/ui/Button';
import { StateBlock } from '@/components/ui/StateBlock';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center">
      <StateBlock
        icon={<Compass size={18} aria-hidden />}
        title={t('notFound.title')}
        description={t('notFound.body')}
        actions={
          <Link to="/" className={buttonClasses('secondary')}>
            {t('notFound.home')}
          </Link>
        }
      />
    </div>
  );
}
