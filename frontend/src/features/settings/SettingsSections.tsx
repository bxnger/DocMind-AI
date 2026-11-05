import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Minus, RotateCcw } from 'lucide-react';
import { API_BASE_URL } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useBackendHealth, useCapabilities } from '@/features/system/useSystem';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { clearLocalFiles } from '@/services/localFiles';
import { LanguageSwitch } from './LanguageSwitch';
import { setThemePreference, useThemePreference } from './theme';
import { setMotionPreference, useMotionPreference, type MotionPreference } from './preferences';

declare const __APP_VERSION__: string;

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line py-6 last:border-b-0 md:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <dt className="min-w-0 flex-1 text-sm break-words text-muted">{label}</dt>
      <dd className="tabular max-w-[60%] shrink-0 text-right text-sm break-words">{children}</dd>
    </div>
  );
}

function Available({ value }: { value: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={cn('inline-flex items-center gap-1', value ? 'text-success' : 'text-muted')}>
      {value ? <Check size={14} aria-hidden /> : <Minus size={14} aria-hidden />}
      {value ? t('settings.available') : t('settings.notAvailable')}
    </span>
  );
}

function Choice<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-[10px] border border-line bg-card p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'pressable h-8 rounded-lg px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50',
            value === option.value ? 'bg-accent-tint text-fg' : 'text-muted enabled:hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function LanguageSection() {
  const { t } = useTranslation();
  return (
    <Section title={t('settings.language')} description={t('settings.languageBody')}>
      <LanguageSwitch variant="full" />
    </Section>
  );
}

export function AppearanceSection() {
  const { t } = useTranslation();
  const motion = useMotionPreference();
  const theme = useThemePreference();
  return (
    <Section title={t('settings.appearance')} description={t('settings.appearanceBody')}>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm text-muted">{t('settings.theme')}</p>
          <Choice
            label={t('settings.theme')}
            value={theme}
            onChange={setThemePreference}
            options={[
              { value: 'light', label: t('settings.themeLight') },
              { value: 'dark', label: t('settings.themeDark') },
              { value: 'system', label: t('settings.themeSystem') },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-sm text-muted">{t('settings.motion')}</p>
          <Choice<MotionPreference>
            label={t('settings.motion')}
            value={motion}
            onChange={setMotionPreference}
            options={[
              { value: 'system', label: t('settings.motionSystem') },
              { value: 'reduced', label: t('settings.motionReduced') },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}

export function AccountSection() {
  const { t } = useTranslation();
  return (
    <Section title={t('settings.account')}>
      <p className="max-w-[60ch] text-sm text-muted">{t('settings.accountBody')}</p>
    </Section>
  );
}

export function LocalDataSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useQueryClient();
  const clear = useMutation({
    mutationFn: clearLocalFiles,
    onSuccess: () => {
      client.removeQueries({ queryKey: ['local-file'] });
      toast.show(t('settings.localCleared'));
    },
    onError: (error) => {
      console.error('Could not clear browser copies', error);
      toast.show(t('settings.localClearFailed'), 'error');
    },
  });
  return (
    <Section title={t('settings.localData')}>
      <p className="max-w-[60ch] text-sm text-muted">{t('settings.localDataBody')}</p>
      <Button className="mt-3" loading={clear.isPending} onClick={() => clear.mutate()}>
        {t('settings.localClear')}
      </Button>
    </Section>
  );
}

export function AboutSection() {
  const { t, i18n } = useTranslation();
  const health = useBackendHealth();
  const capabilities = useCapabilities();
  const data = capabilities.data;

  return (
    <Section title={t('settings.about')} description={t('settings.aboutBody')}>
      <dl>
        <Row label={t('settings.appVersion')}>{__APP_VERSION__}</Row>
        <Row label={t('settings.apiUrl')}>
          <code className="text-xs">{API_BASE_URL}</code>
        </Row>
        <Row label={t('settings.backendStatus')}>{t(`system.${health.status}`)}</Row>
      </dl>
      <h3 className="mt-6 mb-1 text-sm font-medium">{t('settings.reportedByBackend')}</h3>
      {capabilities.isPending ? (
        <div className="space-y-2 py-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : data ? (
        <dl>
          <Row label={t('settings.backendVersion')}>{data.version}</Row>
          <Row label={t('settings.maxFile')}>{formatBytes(data.limits.maxFileSizeBytes, i18n.language)}</Row>
          <Row label={t('settings.maxPages')}>{data.limits.maxPages}</Row>
          <Row label={t('settings.capOcr')}><Available value={data.ocr} /></Row>
          <Row label={t('settings.capDocx')}><Available value={data.docxPreview !== 'none'} /></Row>
          <Row label={t('settings.capComparison')}><Available value={data.comparison} /></Row>
          <Row label={t('settings.capHighlights')}><Available value={data.highlights} /></Row>
        </dl>
      ) : (
        <div className="py-2">
          <p className="text-sm text-muted">{t('settings.capabilitiesError')}</p>
          <Button size="sm" className="mt-2" icon={<RotateCcw size={14} aria-hidden />} onClick={() => void capabilities.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </Section>
  );
}
