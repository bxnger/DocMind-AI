import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { Menu, Search } from 'lucide-react';
import { Outlet, useLocation, useMatch } from 'react-router';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/IconButton';
import { Logo } from '@/components/ui/Logo';
import { CommandPalette } from '@/features/command/CommandPalette';
import { useBackendHealth } from '@/features/system/useSystem';
import { GlobalDropOverlay } from '@/features/upload/GlobalDropOverlay';
import { UploadTray } from '@/features/upload/UploadTray';
import { MOBILE_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { usePersistentState } from '@/hooks/usePersistentState';
import { BackendBanner } from './BackendBanner';
import { Sidebar } from './Sidebar';

function useRefetchOnReconnect() {
  const client = useQueryClient();
  const { status } = useBackendHealth();
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current === 'offline' && status === 'online') void client.invalidateQueries();
    previous.current = status;
  }, [client, status]);
}

export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const isWorkspace = useMatch('/documents/:id') !== null;
  const isCompare = useMatch('/compare') !== null;
  const mobile = useMediaQuery(MOBILE_QUERY);
  const tablet = useMediaQuery('(max-width: 1023px)');
  const [collapsedPreference, setCollapsedPreference] = usePersistentState('docmind.sidebar.collapsed', false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useRefetchOnReconnect();

  // The workspace and tablets get the rail, so the document has the room it needs.
  const forcedRail = isWorkspace || isCompare || tablet;
  const collapsed = forcedRail || collapsedPreference;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const openSearch = () => {
    setDrawerOpen(false);
    setPaletteOpen(true);
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      {!mobile && (
        <Sidebar
          collapsed={collapsed}
          canToggle={!forcedRail}
          onToggle={() => setCollapsedPreference(!collapsedPreference)}
          onOpenSearch={openSearch}
        />
      )}

      <AnimatePresence>
        {mobile && drawerOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-30 bg-fg/45"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.div
              key="drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-y-0 left-0 z-30 max-w-[85vw]"
            >
              <Sidebar
                collapsed={false}
                drawer
                canToggle={false}
                onToggle={() => undefined}
                onClose={() => setDrawerOpen(false)}
                onOpenSearch={openSearch}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        {mobile && (
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-sidebar px-2">
            <IconButton label={t('nav.openMenu')} aria-expanded={drawerOpen} icon={<Menu size={18} aria-hidden />} onClick={() => setDrawerOpen(true)} />
            <div className="flex-1">
              <Logo />
            </div>
            <IconButton label={t('nav.search')} icon={<Search size={18} aria-hidden />} onClick={openSearch} />
          </header>
        )}
        <BackendBanner />
        <main className="min-h-0 flex-1">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.14 }}
            className="h-full"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      <UploadTray />
      <GlobalDropOverlay />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
