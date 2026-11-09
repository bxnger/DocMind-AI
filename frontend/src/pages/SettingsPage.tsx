import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { isNativeApp } from '@/features/native/platform';
import { PrivacyFacts } from '@/features/settings/PrivacyFacts';
import { InterfaceChoice } from '@/mobile/InterfaceChoice';
import { StartOver } from '@/features/session/StartOver';
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
        <div className="mt-6"><PrivacyFacts /></div>
        {!isNativeApp() && <div className="mt-4"><InterfaceChoice /></div>}
        <div className="mt-4"><StartOver /></div>
      </div>
    </PageContainer>
  );
}
