import { useState } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, FlaskConical, Hourglass, PackageSearch, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { useCodeMessage, useErrorMessage } from '@/features/system/useErrorMessage';
import { useCapabilities } from '@/features/system/useSystem';
import { formatMoney } from '@/lib/money';
import { readStored, writeStored } from '@/lib/storage';
import { isDemoDocument } from '@/services/industryDemo';
import type { DocumentText } from '@/services/chat/demo/textIndex';
import type { EvidenceSource } from '@/types/chat';
import type { DocumentModel } from '@/types/document';
import type { Part } from '@/types/procurement';
import { MarkingCheck } from './MarkingCheck';
import { OffersStep } from './OffersStep';
import { PartRow } from './PartRow';
import { SheetStep } from './SheetStep';
import { useProcurement, useProcurementAdapter, useSheetLines } from './useProcurement';
import { STEPS, WorkflowStepper, isProcurementStep, type ProcurementStep } from './WorkflowStepper';

interface Props {
  doc: DocumentModel;
  pdfText: DocumentText | undefined;
  initialStep?: ProcurementStep | undefined;
  onOpenSource: (source: EvidenceSource) => void;
  onOpenDocument: () => void;
}

function useStep(documentId: string, initial: ProcurementStep | undefined) {
  const key = `docmind.chat.procurement.step.${documentId}`;
  const [step, setStepState] = useState<ProcurementStep>(() => {
    if (initial) return initial;
    const stored = readStored<unknown>('session', key, 'parts');
    return isProcurementStep(stored) ? stored : 'parts';
  });
  const setStep = (next: ProcurementStep) => {
    setStepState(next);
    writeStored('session', key, next);
  };
  return [step, setStep] as const;
}

export function ProcurementPanel({ doc, pdfText, initialStep, onOpenSource, onOpenDocument }: Props) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const codeMessage = useCodeMessage();
  const capabilities = useCapabilities();
  const adapter = useProcurementAdapter(doc, pdfText);
  const { lines, update, updateMany } = useSheetLines(doc.id);
  const [step, setStep] = useStep(doc.id, initialStep);
  const { partList, parts, priceLists, offers, quote, items, withoutQuantity } = useProcurement(doc.id, adapter, lines, doc.status === 'ready');

  if (doc.status !== 'ready') {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <div data-testid="procurement-waiting">
          <StateBlock tone={doc.status === 'failed' ? 'danger' : 'neutral'} icon={doc.status === 'failed' ? <CircleAlert size={18} aria-hidden /> : <Hourglass size={18} aria-hidden />} title={t(doc.status === 'failed' ? 'procurement.docFailedTitle' : 'procurement.docWaitingTitle')} description={t(doc.status === 'failed' ? 'procurement.docFailedBody' : 'procurement.docWaitingBody')} />
        </div>
      </div>
    );
  }

  const list = partList.data;
  if (!adapter || partList.isPending || list?.status === 'processing') {
    const percent = list?.progress != null ? Math.round(list.progress * 100) : null;
    return (
      <div role="status" aria-label={t('procurement.loading')} data-testid="procurement-loading" className="mx-auto w-full max-w-3xl space-y-3 p-6">
        <p className="tabular text-sm text-muted">{t('procurement.loading')}{percent !== null ? ` ${percent}%` : ''}</p>
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (partList.isError || list?.status === 'failed') {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <StateBlock tone="danger" icon={<CircleAlert size={18} aria-hidden />} title={t('procurement.errorTitle')} description={partList.isError ? errorMessage(partList.error) : codeMessage(list?.errorCode)} actions={<Button icon={<RotateCcw size={14} aria-hidden />} onClick={() => void partList.refetch()}>{t('common.retry')}</Button>} />
      </div>
    );
  }

  const isDemoDoc = isDemoDocument(doc.name);
  const fixtures = adapter.isDemo && parts.length > 0 && parts.every((part) => part.sources.length === 0);
  const equipment = list?.equipment;
  const failure = quote.error ?? offers.error;
  const verified = parts.filter((part) => part.verified || part.sources.length === 0);
  const unverified = parts.filter((part) => !part.verified && part.sources.length > 0);
  const confirmations = Object.values(lines).filter((line) => line.decision === 'confirmed').length;
  const chosen = parts.filter((part) => lines[part.id]?.offerId).length;
  const totals = items.length ? (quote.data?.totals ?? []) : [];
  const notes: Record<ProcurementStep, string> = {
    parts: t('procurement.steps.partsNote', { count: parts.length }),
    camera: confirmations ? t('procurement.steps.cameraDone', { count: confirmations }) : t('procurement.steps.cameraNote'),
    offers: t('procurement.steps.offersNote', { chosen, total: parts.length }),
    sheet: totals.length ? totals.map((total) => formatMoney(total.amount, total.currency, i18n.language)).join(' · ') : t('procurement.steps.sheetNote'),
  };
  const done: Record<ProcurementStep, boolean> = { parts: parts.length > 0, camera: confirmations > 0, offers: chosen > 0, sheet: false };
  const index = STEPS.indexOf(step);
  const previous = STEPS[index - 1];
  const next = STEPS[index + 1];
  const row = (part: Part) => (
    <PartRow key={part.id} part={part} line={lines[part.id]} canCheckPhoto={adapter.canReadPhotos} onChange={(change) => update(part.id, change)} onOpenSource={onOpenSource} onCheckPhoto={() => setStep('camera')} />
  );
  const go = (target: ProcurementStep) => {
    setStep(target);
    document.querySelector('[data-testid="procurement-panel"]')?.scrollTo({ top: 0 });
  };

  return (
    <div data-testid="procurement-panel" className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] space-y-3 px-3 py-4 sm:px-6">
        <div>
          <h2 className="font-display text-lg font-semibold">{t('procurement.title')}</h2>
          {equipment && (equipment.name || equipment.model) && <p data-testid="equipment" className="text-sm"><span className="text-muted">{t('procurement.equipment')}:</span> {[equipment.name, equipment.model, equipment.manufacturer].filter(Boolean).join(' · ')}</p>}
        </div>
        {adapter.isDemo && (
          <p data-testid="procurement-demo" role="note" className="flex gap-2 rounded-control bg-warning-tint p-2.5 text-xs text-warning">
            <FlaskConical size={14} className="mt-px shrink-0" aria-hidden />
            <span><strong className="font-semibold">{t('procurement.demoTitle')}</strong> {t('procurement.demoBody')}{fixtures ? ` ${t('procurement.demoFixtures')}` : ''}</span>
          </p>
        )}
        {isDemoDoc && <p data-testid="demo-document-note" role="note" className="rounded-control border border-line bg-sidebar p-2.5 text-xs text-muted">{t('procurement.demoDocument')}</p>}
        <WorkflowStepper current={step} done={done} notes={notes} onSelect={go} onOpenDocument={onOpenDocument} />
        {failure && <p role="alert" data-testid="procurement-error" className="text-sm text-danger">{errorMessage(failure)}</p>}

        <div hidden={step !== 'parts'} data-testid="step-panel-parts" className="space-y-3">
          {parts.length === 0 ? (
            <StateBlock icon={<PackageSearch size={18} aria-hidden />} title={t('procurement.emptyTitle')} description={t('procurement.emptyBody')} />
          ) : (
            <>
              <p className="text-sm text-muted">{t('procurement.partsIntro')}</p>
              {verified.length > 0 && <ul className="space-y-2">{verified.map(row)}</ul>}
              {unverified.length > 0 && (
                <section data-testid="unverified-parts" aria-labelledby="unverified-title">
                  <h3 id="unverified-title" className="font-semibold text-warning">{t('procurement.needsCheck', { count: unverified.length })}</h3>
                  <p className="mb-2 text-xs text-muted">{t('procurement.needsCheckHint')}</p>
                  <ul className="space-y-2">{unverified.map(row)}</ul>
                </section>
              )}
            </>
          )}
        </div>
        <div hidden={step !== 'camera'} data-testid="step-panel-camera">
          <MarkingCheck adapter={adapter} parts={parts} maxImageBytes={capabilities.data?.limits.maxImageBytes ?? null} showExamples={isDemoDoc} onDecided={(confirmation) => update(confirmation.partId, { confirmationId: confirmation.id, decision: confirmation.decision })} onOpenSource={onOpenSource} />
        </div>
        <div hidden={step !== 'offers'} data-testid="step-panel-offers">
          <OffersStep adapter={adapter} parts={parts} lines={lines} lists={priceLists.data} offers={offers.data} quoteItems={items.length ? quote.data?.items : undefined} showExamples={isDemoDoc} onChange={update} onChangeMany={updateMany} />
        </div>
        <div hidden={step !== 'sheet'} data-testid="step-panel-sheet">
          <SheetStep adapter={adapter} documentName={doc.name} parts={parts} lines={lines} lists={priceLists.data} offers={offers.data} quote={quote.data} items={items} withoutQuantity={withoutQuantity} onChange={update} onOpenSource={onOpenSource} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          {previous ? <Button data-testid="step-previous" variant="ghost" icon={<ArrowLeft size={14} aria-hidden />} onClick={() => go(previous)}>{t(`procurement.steps.${previous}`)}</Button> : <span />}
          {next && <Button data-testid="step-next" variant="primary" onClick={() => go(next)}>{t(`procurement.steps.${next}`)}<ArrowRight size={14} aria-hidden /></Button>}
        </div>
      </div>
    </div>
  );
}
