import type React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useEffect } from 'react';
import { useUpload } from '@/features/upload/UploadProvider';
import { UploadTray } from '@/features/upload/UploadTray';
import { OfflineNotice } from './OfflineNotice';
import { useProfile } from './profile';
import { TabBar } from './TabBar';

/** The phone frame: system bar insets, the connection notice, the screen, and the tab bar outside a document. */
export function MobileShell() {
  const profile = useProfile();
  const location = useLocation();
  const { items, dismissFinished } = useUpload();
  // On a phone the tray covers the screen, so finished uploads leave it on their own. Errors stay until dismissed.
  const allDone = items.length > 0 && items.every((item) => item.phase.status === 'success');
  useEffect(() => {
    if (!allDone) return;
    const timer = window.setTimeout(dismissFinished, 4000);
    return () => window.clearTimeout(timer);
  }, [allDone, dismissFinished]);
  if (!profile.completed) return <Navigate to="/welcome" replace />;
  const inDocument = /^\/documents\/[^/]+/.test(location.pathname) || location.pathname.startsWith('/compare');
  return (
    <div data-testid="mobile-shell" style={{ "--tab-bar-height": inDocument ? "0px" : "4rem" } as React.CSSProperties} className="flex h-[100dvh] flex-col bg-bg [&_header_button]:min-h-11 [&_header_button]:min-w-11 pt-[var(--sa-top)] pr-[var(--sa-right)] pl-[var(--sa-left)]">
      <OfflineNotice />
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
      {!inDocument && <TabBar />}
      <UploadTray />
    </div>
  );
}
