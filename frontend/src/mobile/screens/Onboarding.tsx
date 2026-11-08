import { useState } from 'react';
import { Briefcase, Building2, FileSearch, HardHat, ScanLine, ShoppingCart, User } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LogoMark } from '@/components/ui/Logo';
import { LanguageSwitch } from '@/features/settings/LanguageSwitch';
import { setUserMode } from '@/features/userModes/useUserMode';
import { cn } from '@/lib/cn';
import { MAX_ORGANIZATION, modeFor, saveProfile, useProfile, USER_TYPES, type UserType } from '../profile';

const ICONS: Record<UserType, typeof Building2> = { company: Building2, engineer: HardHat, procurement: ShoppingCart, personal: User };

/** Two short screens: what the app does, then who is using it. Everything can be skipped and changed later. */
export function Onboarding() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const saved = useProfile();
  const [step, setStep] = useState<'welcome' | 'profile'>('welcome');
  const [userType, setUserType] = useState<UserType | null>(saved.userType);
  const [organization, setOrganization] = useState(saved.organization);
  const finish = (skip: boolean) => {
    const type = skip ? null : userType;
    saveProfile({ completed: true, userType: type, organization: skip ? '' : organization });
    setUserMode(modeFor(type));
    void navigate('/', { replace: true });
  };

  return (
    <div data-testid="onboarding" className="flex h-[100dvh] flex-col bg-bg pt-[var(--sa-top)] pr-[var(--sa-right)] pb-[var(--sa-bottom)] pl-[var(--sa-left)]">
      <div className="flex shrink-0 items-center justify-between px-4 pt-3">
        <LanguageSwitch />
        <button type="button" data-testid="onboarding-skip" onClick={() => finish(true)} className="pressable min-h-11 rounded-lg px-3 text-sm font-medium text-muted hover:text-fg">{t('mobile.onboarding.skip')}</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[480px] px-6 py-6">
          {step === 'welcome' ? (
            <>
              <LogoMark size={48} />
              <p className="micro-label mt-6" translate="no">DOCMIND INDUSTRY</p>
              <h1 className="mt-1 font-display text-[30px] leading-[36px] font-medium tracking-[-0.02em]">{t('mobile.onboarding.title')}</h1>
              <p className="mt-3 text-muted">{t('mobile.onboarding.body')}</p>
              <ul className="mt-6 space-y-3">
                {([['docs', FileSearch], ['scan', ScanLine], ['buy', Briefcase]] as const).map(([key, Icon]) => (
                  <li key={key} className="flex gap-3 rounded-panel border border-line bg-card p-3">
                    <Icon size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                    <span><span className="block font-semibold">{t(`mobile.onboarding.value.${key}.title`)}</span><span className="text-sm text-muted">{t(`mobile.onboarding.value.${key}.body`)}</span></span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <h1 className="font-display text-[26px] leading-[32px] font-medium">{t('mobile.onboarding.whoTitle')}</h1>
              <p className="mt-2 text-sm text-muted">{t('mobile.onboarding.whoBody')}</p>
              <fieldset className="mt-4 space-y-2">
                <legend className="sr-only">{t('mobile.onboarding.whoTitle')}</legend>
                {USER_TYPES.map((type) => {
                  const Icon = ICONS[type];
                  return (
                    <label key={type} data-testid={`user-type-${type}`} className={cn('pressable flex min-h-14 cursor-pointer items-center gap-3 rounded-panel border p-3', userType === type ? 'border-accent bg-accent-tint' : 'border-line bg-card')}>
                      <input type="radio" name="user-type" className="sr-only" checked={userType === type} onChange={() => setUserType(type)} />
                      <Icon size={20} className="shrink-0 text-accent" aria-hidden />
                      <span className="font-medium">{t(`mobile.userType.${type}`)}</span>
                    </label>
                  );
                })}
              </fieldset>
              <label className="mt-4 block text-sm text-muted">
                {t('mobile.onboarding.organization')}
                <input data-testid="organization" value={organization} maxLength={MAX_ORGANIZATION} autoComplete="organization" onChange={(event) => setOrganization(event.target.value)} placeholder={t('mobile.onboarding.organizationPlaceholder')} className="mt-1 h-12 w-full rounded-control border border-line bg-card px-3 text-[16px] text-fg outline-none placeholder:text-muted focus:border-accent" />
              </label>
              <p className="mt-3 text-xs text-muted">{t('mobile.onboarding.private')}</p>
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 px-6 pt-2 pb-4">
        <div className="mx-auto max-w-[480px]">
          {step === 'welcome'
            ? <Button variant="primary" size="lg" data-testid="onboarding-next" className="h-12 w-full" onClick={() => setStep('profile')}>{t('mobile.onboarding.next')}</Button>
            : <Button variant="primary" size="lg" data-testid="onboarding-start" className="h-12 w-full" onClick={() => finish(false)}>{t('mobile.onboarding.start')}</Button>}
        </div>
      </div>
    </div>
  );
}
