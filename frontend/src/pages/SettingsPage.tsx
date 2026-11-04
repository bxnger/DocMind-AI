import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import {
  AboutSection,
  AccountSection,
  AppearanceSection,
  LanguageSection,
  LocalDataSection,
} from '@/features/settings/SettingsSections';

export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <PageContainer title={t('settings.title')}>
      <div className="-mt-6">
        <LanguageSection />
        <AppearanceSection />
        <AccountSection />
        <LocalDataSection />
        <AboutSection />
      </div>
    </PageContainer>
  );
}
