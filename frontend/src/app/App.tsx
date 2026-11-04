import { lazy, Suspense, useEffect } from 'react';
import { MotionConfig } from 'motion/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/components/layout/AppShell';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToastProvider } from '@/components/ui/Toast';
import { useMotionPreference } from '@/features/settings/preferences';
import { UploadProvider } from '@/features/upload/UploadProvider';
import { AppError } from '@/api/client';
import { ComparePage } from '@/pages/ComparePage';
import { DocumentsPage } from '@/pages/DocumentsPage';
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RecentPage } from '@/pages/RecentPage';
import { SettingsPage } from '@/pages/SettingsPage';

// PDF.js and markdown are heavy, so only the workspace route loads them.
const WorkspacePage = lazy(() => import('@/pages/WorkspacePage').then((module) => ({ default: module.WorkspacePage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => error instanceof AppError && error.retryable && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});

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
          <BrowserRouter>
            <UploadProvider>
              <DocumentLanguage />
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
                  <Route path="recent" element={<RecentPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </UploadProvider>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </MotionConfig>
  );
}
