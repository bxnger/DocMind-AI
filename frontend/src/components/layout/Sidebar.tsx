import { FolderOpen, GitCompareArrows, History, Home, PanelLeftClose, PanelLeftOpen, Search, Settings, Upload, X, UserSearch } from 'lucide-react';
import { NavLink, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Logo } from '@/components/ui/Logo';
import { useDocuments } from '@/features/documents/useDocuments';
import { LanguageSwitch } from '@/features/settings/LanguageSwitch';
import { ThemeToggle } from '@/features/settings/ThemeToggle';
import { useBackendHealth, useCapabilities } from '@/features/system/useSystem';
import { useUpload } from '@/features/upload/UploadProvider';
import { cn } from '@/lib/cn';

interface Props {
  collapsed: boolean;
  /** Rail collapse is unavailable in the mobile drawer, which closes instead. */
  drawer?: boolean;
  canToggle: boolean;
  onToggle: () => void;
  onClose?: () => void;
  onOpenSearch: () => void;
}

const NAV = [
  { to: '/', key: 'nav.home', Icon: Home, end: true },
  { to: '/documents', key: 'nav.documents', Icon: FolderOpen, end: true },
  { to: '/compare', key: 'nav.compare', Icon: GitCompareArrows, end: false },
  { to: '/hr', key: 'nav.hr', Icon: UserSearch, end: false },
  { to: '/recent', key: 'nav.recent', Icon: History, end: false },
  { to: '/settings', key: 'nav.settings', Icon: Settings, end: false },
] as const;

const STATUS_DOT = { processing: 'bg-warning pulse-dot', ready: 'bg-success', failed: 'bg-danger' } as const;
const SIDEBAR_DOCS = 8;

function SidebarDocuments({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const documents = useDocuments();
  return (
    <div className="mt-6 flex min-h-0 flex-1 flex-col">
      <h2 className="micro-label mb-1 px-3">{t('nav.documents')}</h2>
      {documents.isPending && (
        <div className="space-y-2 px-3 py-1" role="status" aria-label={t('common.loading')}>
          <div className="skeleton h-3 w-4/5" />
          <div className="skeleton h-3 w-3/5" />
          <div className="skeleton h-3 w-2/3" />
        </div>
      )}
      {documents.isError && <p className="px-3 text-xs text-muted">{t('documents.sidebarError')}</p>}
      {documents.data?.length === 0 && <p className="px-3 text-xs text-muted">{t('documents.sidebarEmpty')}</p>}
      <ul className="min-h-0 flex-1 space-y-px overflow-y-auto">
        {documents.data?.slice(0, SIDEBAR_DOCS).map((doc) => (
          <li key={doc.id}>
            <NavLink
              to={`/documents/${doc.id}`}
              onClick={onNavigate}
              title={doc.name}
              className={({ isActive }) =>
                cn(
                  'pressable flex h-8 items-center gap-2 rounded-[10px] px-3 text-sm pointer-coarse:h-11',
                  isActive ? 'bg-accent-tint text-fg' : 'text-muted hover:bg-hover hover:text-fg',
                )
              }
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[doc.status])} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{doc.name}</span>
              <span className="sr-only">{t(`status.${doc.status}`)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConnectionLine({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  const { status } = useBackendHealth();
  const label = t(`system.${status}`);
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted" title={label}>
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-full', {
          online: 'bg-success',
          offline: 'bg-danger',
          checking: 'bg-muted pulse-dot',
        }[status])}
      />
      <span className={compact ? 'sr-only' : 'truncate'}>{label}</span>
    </span>
  );
}

export function Sidebar({ collapsed, drawer = false, canToggle, onToggle, onClose, onOpenSearch }: Props) {
  const { t } = useTranslation();
  const { openPicker } = useUpload();
  const capabilities = useCapabilities();
  const isMac = /mac/i.test(navigator.platform);

  return (
    <aside
      aria-label={t('nav.sidebar')}
      className={cn(
        'theme-ink flex h-full shrink-0 flex-col overflow-hidden border-r border-line bg-sidebar p-3 transition-[width] duration-200 ease-[var(--ease-in-out)]',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className={cn('mb-4 flex h-8 items-center', collapsed ? 'justify-center' : 'justify-between pl-2')}>
        {!collapsed && (
          <Link to="/" onClick={onClose} aria-label={t('nav.home')} className="rounded-md">
            <Logo />
          </Link>
        )}
        {drawer ? (
          <IconButton label={t('nav.closeMenu')} icon={<X size={16} aria-hidden />} onClick={onClose} />
        ) : collapsed && !canToggle ? (
          <Link to="/" aria-label={t('nav.home')} className="rounded-md">
            <Logo compact />
          </Link>
        ) : (
          <IconButton
            label={collapsed ? t('nav.expand') : t('nav.collapse')}
            aria-expanded={!collapsed}
            icon={collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
            onClick={onToggle}
          />
        )}
      </div>

      <div className={cn('flex gap-2', collapsed && 'flex-col items-center')}>
        {collapsed ? (
          <>
            <IconButton label={t('nav.upload')} icon={<Upload size={16} className="text-accent" aria-hidden />} onClick={openPicker} className="border border-line" />
            <IconButton label={t('nav.search')} icon={<Search size={16} aria-hidden />} onClick={onOpenSearch} className="border border-line" />
          </>
        ) : (
          <>
            <Button className="min-w-0 flex-1" icon={<Upload size={16} className="text-accent" aria-hidden />} onClick={openPicker}>
              <span className="truncate">{t('nav.upload')}</span>
            </Button>
            <IconButton
              label={`${t('nav.search')} (${isMac ? '⌘' : 'Ctrl+'}K)`}
              icon={<Search size={16} aria-hidden />}
              onClick={onOpenSearch}
              className="size-9 border border-line"
            />
          </>
        )}
      </div>

      <nav aria-label={t('nav.main')} className="mt-4 space-y-px">
        {NAV.filter(({ to }) => to !== '/compare' || capabilities.data?.comparison).map(({ to, key, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onClose}
            title={collapsed ? t(key) : undefined}
            aria-label={collapsed ? t(key) : undefined}
            className={({ isActive }) =>
              cn(
                'pressable relative flex h-9 items-center gap-3 rounded-[10px] text-sm font-medium pointer-coarse:h-11',
                collapsed ? 'justify-center' : 'px-3',
                isActive ? 'bg-accent-tint text-fg' : 'text-muted hover:bg-hover hover:text-fg',
              )
            }
          >
            <Icon size={16} className="shrink-0" aria-hidden />
            {!collapsed && <span className="truncate">{t(key)}</span>}
          </NavLink>
        ))}
      </nav>

      {collapsed ? <div className="flex-1" /> : <SidebarDocuments onNavigate={onClose} />}

      <div className={cn('mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3', collapsed ? 'flex-col justify-center' : 'justify-between pl-2')}>
        <span className={collapsed ? undefined : 'min-w-0 basis-full'}><ConnectionLine compact={collapsed} /></span>
        <ThemeToggle />
        {!collapsed && <LanguageSwitch />}
      </div>
    </aside>
  );
}
