import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/Skeleton';
import { ComparePage } from '@/pages/ComparePage';
import { HrPage } from '@/pages/HrPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RecentPage } from '@/pages/RecentPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { MobileHeader } from './MobileHeader';
import { MobileShell } from './MobileShell';
import { MobileDocuments } from './screens/MobileDocuments';
import { MobileHome } from './screens/MobileHome';
import { MobileProcurement } from './screens/MobileProcurement';
import { MobileProfile } from './screens/MobileProfile';
import { MobileScanner } from './screens/MobileScanner';
import { Onboarding } from './screens/Onboarding';

const WorkspacePage = lazy(() => import('@/pages/WorkspacePage').then((module) => ({ default: module.WorkspacePage })));

/** A website page reached from Profile: the phone header with Back over it, and its own title hidden. */
function Subpage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <MobileHeader title={title} back />
      <div className="min-h-0 flex-1 [&_h1]:sr-only">{children}</div>
    </div>
  );
}

export function MobileRoutes() {
  const { t } = useTranslation();
  return (
    <Routes>
      <Route path="welcome" element={<Onboarding />} />
      <Route element={<MobileShell />}>
        <Route index element={<MobileHome />} />
        <Route path="documents" element={<MobileDocuments />} />
        <Route path="documents/:id" element={<Suspense fallback={<Skeleton className="m-4 h-[calc(100%-32px)]" />}><WorkspacePage /></Suspense>} />
        <Route path="scanner" element={<MobileScanner />} />
        <Route path="procurement" element={<MobileProcurement />} />
        <Route path="equipment" element={<MobileScanner />} />
        <Route path="profile" element={<MobileProfile />} />
        <Route path="compare" element={<Subpage title={t('nav.compare')}><ComparePage /></Subpage>} />
        <Route path="hr" element={<Subpage title={t('nav.hr')}><HrPage /></Subpage>} />
        <Route path="recent" element={<Subpage title={t('nav.recent')}><RecentPage /></Subpage>} />
        <Route path="settings" element={<Subpage title={t('settings.title')}><SettingsPage /></Subpage>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
