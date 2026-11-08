import { ChevronRight, GitCompareArrows, History, Network, RotateCcw, Settings, ShieldCheck, UserSearch, type LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PrivacyFacts } from '@/features/settings/PrivacyFacts';
import { AppearanceSection, LanguageSection } from '@/features/settings/SettingsSections';
import { ModeSelect } from '@/features/userModes/ModeSelector';
import { setUserMode } from '@/features/userModes/useUserMode';
import { cn } from '@/lib/cn';
import { SAMPLE_DOCUMENT_ID } from '@/services/sampleDocument';
import { MAX_ORGANIZATION, modeFor, saveProfile, useProfile, USER_TYPES } from '../profile';
import { MobileScreen } from '../MobileHeader';

const TOOLS: ReadonlyArray<{ to: string; key: string; Icon: LucideIcon; state?: unknown }> = [
  { to: '/compare', key: 'nav.compare', Icon: GitCompareArrows },
  { to: `/documents/${SAMPLE_DOCUMENT_ID}`, key: 'nav.map', Icon: Network, state: { view: 'map' } },
  { to: '/hr', key: 'nav.hr', Icon: UserSearch },
  { to: '/recent', key: 'nav.recent', Icon: History },
  { to: '/settings', key: 'mobile.profile.allSettings', Icon: Settings },
];

/** Who is using the app, the language and theme, and the tools that don't belong on the main path. */
export function MobileProfile() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useProfile();
  return (
    <MobileScreen title={t('mobile.tab.profile')}>
      <section aria-labelledby="profile-who" className="rounded-panel border border-line bg-card p-4">
        <h2 id="profile-who" className="font-semibold">{t('mobile.profile.who')}</h2>
        <div role="radiogroup" aria-label={t('mobile.profile.who')} className="mt-2 flex flex-wrap gap-2">
          {USER_TYPES.map((type) => (
            <button key={type} type="button" role="radio" aria-checked={profile.userType === type} data-testid={`profile-type-${type}`} onClick={() => { saveProfile({ ...profile, userType: type }); setUserMode(modeFor(type)); }} className={cn('pressable min-h-11 rounded-full border px-3 text-sm font-medium', profile.userType === type ? 'border-accent bg-accent-tint' : 'border-line')}>
              {t(`mobile.userType.${type}`)}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-sm text-muted">
          {t('mobile.onboarding.organization')}
          <input data-testid="profile-organization" defaultValue={profile.organization} maxLength={MAX_ORGANIZATION} onBlur={(event) => saveProfile({ ...profile, organization: event.target.value })} placeholder={t('mobile.onboarding.organizationPlaceholder')} className="mt-1 h-12 w-full rounded-control border border-line bg-bg px-3 text-[16px] text-fg outline-none focus:border-accent" />
        </label>
        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <span className="text-muted">{t('userModes.title')}</span>
          <ModeSelect />
        </div>
      </section>
      <div className="rounded-panel border border-line bg-card px-4 [&_section]:border-b-0"><LanguageSection /></div>
      <div className="rounded-panel border border-line bg-card px-4 [&_section]:border-b-0"><AppearanceSection /></div>
      <section aria-labelledby="profile-tools">
        <h2 id="profile-tools" className="mb-2 font-semibold">{t('nav.tools')}</h2>
        <ul className="overflow-hidden rounded-panel border border-line bg-card">
          {TOOLS.map(({ to, key, Icon, state }) => (
            <li key={to} className="border-b border-line last:border-b-0">
              <Link to={to} state={state} className="pressable flex min-h-14 items-center gap-3 px-4">
                <Icon size={18} className="shrink-0 text-accent" aria-hidden />
                <span className="min-w-0 flex-1">{t(key as never)}</span>
                <ChevronRight size={16} className="text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <PrivacyFacts />
      <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />{t('mobile.profile.privacy')}</p>
      <button type="button" data-testid="profile-restart" onClick={() => { saveProfile({ ...profile, completed: false }); void navigate('/welcome'); }} className="pressable flex min-h-11 items-center gap-2 text-sm text-muted">
        <RotateCcw size={14} aria-hidden />{t('mobile.profile.restart')}
      </button>
    </MobileScreen>
  );
}
