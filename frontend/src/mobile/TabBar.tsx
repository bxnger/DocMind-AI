import { ClipboardList, FolderOpen, Home, ScanLine, UserRound, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

const TABS: ReadonlyArray<{ to: string; key: 'home' | 'documents' | 'scanner' | 'procurement' | 'profile'; Icon: LucideIcon; end: boolean }> = [
  { to: '/', key: 'home', Icon: Home, end: true },
  { to: '/documents', key: 'documents', Icon: FolderOpen, end: false },
  { to: '/scanner', key: 'scanner', Icon: ScanLine, end: false },
  { to: '/procurement', key: 'procurement', Icon: ClipboardList, end: false },
  { to: '/profile', key: 'profile', Icon: UserRound, end: false },
];

export function TabBar() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('mobile.tabs')} data-testid="tab-bar" className="shrink-0 border-t border-line bg-sidebar pb-[var(--sa-bottom)]">
      <ul className="mx-auto flex max-w-[640px]">
        {TABS.map(({ to, key, Icon, end }) => (
          <li key={to} className="min-w-0 flex-1">
            <NavLink
              to={to}
              end={end}
              data-testid={`tab-${key}`}
              className={({ isActive }) => cn('pressable flex h-16 flex-col items-center justify-center gap-1 px-0.5 text-[11px] font-medium', isActive ? 'text-accent-strong' : 'text-muted')}
            >
              {({ isActive }) => (
                <>
                  <span className={cn('inline-flex h-7 w-12 items-center justify-center rounded-full', isActive && 'bg-accent-tint')}>
                    <Icon size={20} aria-hidden />
                  </span>
                  <span className="max-w-full truncate">{t(`mobile.tab.${key}`)}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
