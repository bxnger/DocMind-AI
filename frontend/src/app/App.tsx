import { Fragment, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/components/layout/AppShell';
import { useNativeBackButton } from '@/features/native/useNativeBackButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToastProvider } from '@/components/ui/Toast';
import { useMotionPreference } from '@/features/settings/preferences';
import { UploadProvider } from '@/features/upload/UploadProvider';
import { queryRetryDelay, shouldRetryQuery } from '@/api/retry';
import { onSessionReplaced, setSessionCleaner, useSessionEpoch } from '@/api/session';
import { useToast } from '@/components/ui/Toast';
import { clearUserData } from '@/services/userData';
import { ComparePage } from '@/pages/ComparePage';
import { DocumentsPage } from '@/pages/DocumentsPage';
import { EquipmentPage } from '@/pages/EquipmentPage';
import { HomePage } from '@/pages/HomePage';
import { ProcurementPage } from '@/pages/ProcurementPage';
import { HrPage } from '@/pages/HrPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RecentPage } from '@/pages/RecentPage';
import { SettingsPage } from '@/pages/SettingsPage';

// PDF.js and markdown are heavy, so only the workspace route loads them.
const WorkspacePage = lazy(() => import('@/pages/WorkspacePage').then((module) => ({ default: module.WorkspacePage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
      refetchOnWindowFocus: false,
    },
  },
});

setSessionCleaner(clearUserData);
// Registered before anything renders, so no screen of the new guest can read the old guest's cache.
onSessionReplaced(() => {
  void queryClient.cancelQueries();
  queryClient.clear();
});

/** A new guest starts from nothing: every screen, chat, upload and selection below is rebuilt. */
function SessionScope({ children }: { children: ReactNode }) {
  const epoch = useSessionEpoch();
  return <Fragment key={epoch}>{children}</Fragment>;
}

function SessionNotice() {
  const { t } = useTranslation();
  const toast = useToast();
  useEffect(() => onSessionReplaced(() => toast.show(t('errors.sessionReplaced'), 'error')), [t, toast]);
  return null;
}

/** Only does something inside the Android or iOS app. */
function NativeBridge() {
  useNativeBackButton();
  return null;
}

function DocumentLanguage() {
  const { i18n, t } = useTranslation();
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.title = t('app.title');
  }, [i18n.language, t]);
  return null;
}

export function App() {
  const motion = useMotionPreference();
  return (
    <MotionConfig reducedMotion={motion === 'reduced' ? 'always' : 'user'}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionNotice />
          <BrowserRouter>
            <SessionScope>
            <UploadProvider>
              <DocumentLanguage />
              <NativeBridge />
              <Routes>
                <Route element={<AppShell />}>
                  <Route index element={<HomePage />} />
                  <Route path="documents" element={<DocumentsPage />} />
                  <Route
                    path="documents/:id"
                    element={
                      <Suspense fallback={<Skeleton className="m-4 h-[calc(100%-32px)]" />}>
                        <WorkspacePage />
                      </Suspense>
                    }
                  />
                  <Route path="compare" element={<ComparePage />} />
                  <Route path="hr" element={<HrPage />} />
                  <Route path="equipment" element={<EquipmentPage />} />
                  <Route path="procurement" element={<ProcurementPage />} />
                  <Route path="recent" element={<RecentPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </UploadProvider>
            </SessionScope>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </MotionConfig>
  );
}
