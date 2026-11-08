import { ChevronRight, FileText, MessageSquareText, Play, ScanLine, Upload } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useDocuments } from '@/features/documents/useDocuments';
import { BearingHero } from '@/features/industry/hero3d/BearingHero';
import { useOpenWorkflow, useWorkflowStart } from '@/features/industry/useWorkflowStart';
import { isDemoDocument } from '@/services/industryDemo';
import { useProfile } from '../profile';
import { MobileScreen } from '../MobileHeader';

const RECENT = 3;

/** The work area: the two things people come for, the demonstration, and what they were doing last. */
export function MobileHome() {
  const { t } = useTranslation();
  const profile = useProfile();
  const documents = useDocuments();
  const open = useOpenWorkflow();
  const { analyze, demo, demoBusy, demoFailed } = useWorkflowStart();
  const recent = (documents.data ?? []).filter((doc) => doc.status !== 'failed').slice(0, RECENT);
  const greeting = profile.organization || (profile.userType ? t(`mobile.userType.${profile.userType}`) : t('mobile.home.guest'));

  return (
    <MobileScreen title={t('mobile.tab.home')}>
      <section aria-labelledby="home-hello" className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">{t('mobile.home.hello')}</p>
          <h2 id="home-hello" data-testid="home-greeting" className="font-display text-2xl font-medium break-words">{greeting}</h2>
        </div>
        <BearingHero className="size-[112px] shrink-0" />
      </section>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <button type="button" data-testid="home-analyze" onClick={analyze} className="pressable flex min-h-20 items-center gap-3 rounded-panel bg-accent p-4 text-left text-on-accent">
          <Upload size={24} className="shrink-0" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block text-md font-semibold">{t('home.analyze')}</span><span className="block text-sm opacity-90">{t('mobile.home.analyzeBody')}</span></span>
        </button>
        <Link to="/scanner" data-testid="home-scan" className="pressable flex min-h-20 items-center gap-3 rounded-panel border border-line bg-card p-4">
          <ScanLine size={24} className="shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block text-md font-semibold">{t('mobile.home.scan')}</span><span className="block text-sm text-muted">{t('mobile.home.scanBody')}</span></span>
          <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
        </Link>
      </div>
      <section aria-labelledby="home-recent">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="home-recent" className="font-semibold">{t('mobile.home.recent')}</h2>
          {recent.length > 0 && <Link to="/documents" className="inline-flex min-h-11 items-center px-1 text-sm text-muted">{t('home.viewAll')}</Link>}
        </div>
        {documents.isPending ? <Skeleton className="h-20" /> : recent.length === 0 ? (
          <div data-testid="home-first-steps" className="rounded-panel border border-line bg-card p-4">
            <p className="font-medium">{t('mobile.home.firstTitle')}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>{t('mobile.home.first1')}</li>
              <li>{t('mobile.home.first2')}</li>
              <li>{t('mobile.home.first3')}</li>
            </ol>
            <Button className="mt-3 w-full" size="lg" data-testid="home-demo" icon={<Play size={16} aria-hidden />} loading={demoBusy} onClick={() => void demo()}>{t('home.demo')}</Button>
            {demoFailed && <p role="alert" className="mt-2 text-sm text-danger">{t('home.demoFailed')}</p>}
          </div>
        ) : (
          <ul className="space-y-2">
            {recent.map((doc) => (
              <li key={doc.id} className="flex items-stretch gap-2">
                <button type="button" data-testid="home-recent-doc" onClick={() => open(doc.id)} className="pressable flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-panel border border-line bg-card p-3 text-left">
                  <FileText size={20} className="shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{doc.name}</span><span className="block text-xs text-muted">{isDemoDocument(doc.name) ? t('industry.demoDocumentTag') : t(`status.${doc.status}`)}</span></span>
                </button>
                <Link to={`/documents/${encodeURIComponent(doc.id)}`} aria-label={t('mobile.home.askAbout', { name: doc.name })} className="pressable flex w-14 shrink-0 items-center justify-center rounded-panel border border-line bg-card text-muted">
                  <MessageSquareText size={20} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {recent.length > 0 && <Button variant="ghost" className="mt-2 w-full" icon={<Play size={16} aria-hidden />} loading={demoBusy} onClick={() => void demo()}>{t('home.demo')}</Button>}
      </section>
    </MobileScreen>
  );
}
