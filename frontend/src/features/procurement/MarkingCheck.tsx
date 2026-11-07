import { useEffect, useRef, useState } from 'react';
import { Camera, CircleAlert, CircleCheck, CircleHelp, FileText, ImageUp, Lightbulb, Loader2, RotateCcw, Shapes, TriangleAlert } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { cn } from '@/lib/cn';
import { DEMO_PHOTOS, fetchDemoFile } from '@/services/industryDemo';
import type { ProcurementAdapter } from '@/services/procurement/types';
import type { EvidenceSource } from '@/types/chat';
import type { Confirmation, Decision, MatchStatus, Part, PhotoMatch } from '@/types/procurement';
import { sourcePlace } from './PartRow';

const LOOK: Record<MatchStatus, { Icon: typeof CircleCheck; tone: string }> = {
  matched: { Icon: CircleCheck, tone: 'bg-success-tint text-success' },
  needs_confirmation: { Icon: CircleHelp, tone: 'bg-warning-tint text-warning' },
  no_match: { Icon: TriangleAlert, tone: 'bg-danger-tint text-danger' },
  type_only: { Icon: Shapes, tone: 'bg-warning-tint text-warning' },
  unreadable: { Icon: CircleAlert, tone: 'bg-hover text-muted' },
};

const READABILITY = ['high', 'medium', 'low', 'unreadable'] as const;
const IMAGE_TYPES = 'image/jpeg,image/png,image/webp';

interface Props {
  adapter: ProcurementAdapter;
  parts: readonly Part[];
  maxImageBytes: number | null;
  /** Prepared photos, for the demonstration document only. */
  showExamples: boolean;
  onDecided: (confirmation: Confirmation) => void;
  onOpenSource: (source: EvidenceSource) => void;
}

/** The server's match is automatic. "Confirmed" appears only after this person's own decision, even for an exact match. */
export function MarkingCheck({ adapter, parts, maxImageBytes, showExamples, onDecided, onOpenSource }: Props) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<PhotoMatch | null>(null);
  const [text, setText] = useState('');
  const [partId, setPartId] = useState('');
  const [decided, setDecided] = useState<Confirmation | null>(null);
  const [tooLarge, setTooLarge] = useState(false);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  // On a phone the buttons fill the screen, so the photo and its result would appear out of sight.
  useEffect(() => {
    if (preview) previewRef.current?.scrollIntoView({ block: 'nearest' });
  }, [preview, result]);

  const show = (match: PhotoMatch) => {
    setResult(match);
    setText(match.recognized.partNumber ?? '');
    // One candidate can be suggested. Several, or a mere kind of part, are for the person to pick.
    const only = match.matches.length === 1 ? match.matches[0]?.partId : undefined;
    setPartId(match.matchStatus === 'type_only' ? '' : (only ?? ''));
  };
  const upload = useMutation({ mutationFn: (file: File) => adapter.identify(file), onSuccess: show });
  const typed = useMutation({
    mutationFn: async () => {
      if (!adapter.identifyText) throw new Error('Not available');
      return adapter.identifyText(text.trim());
    },
    onSuccess: show,
  });
  const decide = useMutation({
    mutationFn: (decision: Decision) => adapter.confirm(partId, { recognizedText: result?.recognized.text || text.trim(), recognizedPartNumber: text.trim() || null, decision }),
    onSuccess: (confirmation) => {
      setDecided(confirmation);
      onDecided(confirmation);
    },
  });
  const reset = () => {
    setResult(null);
    setPreview(null);
    setText('');
    setPartId('');
    setDecided(null);
    setTooLarge(false);
    upload.reset();
    typed.reset();
    decide.reset();
  };
  const send = (file: File) => {
    reset();
    if (maxImageBytes !== null && file.size > maxImageBytes) {
      setTooLarge(true);
      return;
    }
    setPreview(URL.createObjectURL(file));
    upload.mutate(file);
  };
  const picked = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (file) send(file);
  };
  const example = useMutation({
    mutationFn: ({ url, name }: { url: string; name: string }) => fetchDemoFile(url, name, 'image/png'),
    onSuccess: send,
  });

  if (!adapter.canReadPhotos) {
    return <p data-testid="photo-unavailable" className="rounded-panel border border-line bg-card p-3 text-sm text-muted">{t('procurement.marking.unavailable')}</p>;
  }

  const status = result?.matchStatus;
  const look = status ? LOOK[status] : null;
  const failure = upload.error ?? typed.error ?? decide.error ?? example.error;
  const recognized = result?.recognized;
  // With only the kind of part to go on there may be no number to record. Otherwise a decision needs one.
  const canDecide = Boolean(partId && (text.trim() || status === 'type_only'));
  const inscriptions = recognized?.visibleMarkings.length ? recognized.visibleMarkings : (recognized?.markings ?? []);
  const estimatedType = recognized?.partType && recognized.partType !== 'unknown' ? recognized.partType : null;
  const readability = READABILITY.find((level) => level === recognized?.readability) ?? null;
  const choices = result?.matches.length
    ? result.matches.map((match) => ({ id: match.partId, label: match.partNumber, name: match.name, kind: match.match, difference: match.difference, source: match.sources[0] }))
    : parts.map((part) => ({ id: part.id, label: part.partNumber, name: part.name, kind: null, difference: null, source: undefined }));

  return (
    <section data-testid="marking-check" aria-labelledby="marking-title" className="rounded-panel border border-line bg-card p-3">
      <h3 id="marking-title" className="font-semibold">{t('procurement.marking.title')}</h3>
      <p className="mt-0.5 text-xs text-muted">{t('procurement.marking.hint')}</p>
      <input ref={camera} type="file" hidden data-testid="marking-camera" accept={IMAGE_TYPES} capture="environment" aria-label={t('procurement.marking.takePhoto')} onChange={(event) => picked(event.target)} />
      <input ref={gallery} type="file" hidden data-testid="marking-file" accept={IMAGE_TYPES} aria-label={t('procurement.marking.uploadPhoto')} onChange={(event) => picked(event.target)} />
      <div className="mt-2 flex flex-wrap gap-2">
        {/* Only a phone or tablet has a camera to hand this to. On a computer the same input would just open a file dialog. */}
        <span className="hidden pointer-coarse:inline-flex">
          <Button variant="primary" data-testid="marking-take" icon={<Camera size={14} aria-hidden />} disabled={upload.isPending} onClick={() => camera.current?.click()}>{t('procurement.marking.takePhoto')}</Button>
        </span>
        <Button data-testid="marking-upload" icon={<ImageUp size={14} aria-hidden />} disabled={upload.isPending} onClick={() => gallery.current?.click()}>{t('procurement.marking.uploadPhoto')}</Button>
      </div>
      {showExamples && (
        <div data-testid="photo-examples" className="mt-2 rounded-control border border-line bg-sidebar p-2">
          <p className="text-xs font-medium">{t('procurement.marking.examplesTitle')}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {DEMO_PHOTOS.map((photo) => (
              <Button key={photo.key} size="sm" data-testid={`photo-example-${photo.key}`} disabled={upload.isPending || example.isPending} onClick={() => example.mutate(photo)}>{t(`procurement.marking.example.${photo.key}`)}</Button>
            ))}
          </div>
        </div>
      )}
      {tooLarge && <p role="alert" className="mt-1 text-sm text-danger">{t('errors.codes.IMAGE_TOO_LARGE')}</p>}
      {failure && <p role="alert" data-testid="marking-error" className="mt-2 text-sm text-danger">{errorMessage(failure)}</p>}
      {preview && (
        <div ref={previewRef} className="mt-3 flex flex-wrap gap-3 border-t border-line pt-3">
          <div className="relative shrink-0">
            <img src={preview} alt={t('procurement.marking.photo')} className="h-32 max-w-full rounded-control border border-line object-contain" />
            <p className="mt-1 max-w-52 text-[11px] text-muted">{t('procurement.marking.notStored')}</p>
          </div>
          <div className="min-w-0 flex-1 basis-56 space-y-2">
            {upload.isPending && <p role="status" data-testid="marking-reading" className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="spin" aria-hidden />{t('procurement.marking.reading')}</p>}
            {status && look && (
              <div data-testid="match-result" role="status">
                <span data-status={status} className={cn('inline-flex min-h-5 items-center gap-1 rounded-full px-2 text-xs font-medium', look.tone)}>
                  <look.Icon size={12} className="shrink-0" aria-hidden />
                  {t(`procurement.marking.status.${status}`)}
                </span>
                <p className="mt-1 text-xs text-muted">{t(`procurement.marking.explain.${status}`)}</p>
              </div>
            )}
            {recognized && (recognized.partNumber || recognized.manufacturer || inscriptions.length > 0 || estimatedType) && (
              <dl data-testid="marking-recognized" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 rounded-control bg-sidebar p-2 text-xs">
                <dt className="text-muted">{t('procurement.marking.found')}</dt><dd data-testid="marking-part-number" className="font-semibold break-words [overflow-wrap:anywhere]">{recognized.partNumber ?? t('procurement.marking.notRead')}</dd>
                {recognized.manufacturer && <><dt className="text-muted">{t('procurement.marking.manufacturer')}</dt><dd>{recognized.manufacturer}</dd></>}
                {inscriptions.length > 0 && <><dt className="text-muted">{t('procurement.marking.markings')}</dt><dd className="break-words [overflow-wrap:anywhere]">{inscriptions.join(', ')}</dd></>}
                {readability && <><dt className="text-muted">{t('procurement.marking.readabilityLabel')}</dt><dd>{t(`procurement.marking.readability.${readability}`)}</dd></>}
                {estimatedType && (
                  <>
                    <dt className="text-muted">{t('procurement.marking.partType')}</dt>
                    <dd data-testid="marking-part-type">{t(`procurement.category.${estimatedType}`)}{recognized.confidence ? `, ${t(`procurement.marking.confidence.${recognized.confidence}`)}` : ''} <span className="text-muted">({t('procurement.marking.estimate')})</span></dd>
                  </>
                )}
              </dl>
            )}
            {recognized && recognized.issues.length > 0 && <p data-testid="marking-issues" className="text-xs text-warning">{t('procurement.marking.issuesLabel')}: {recognized.issues.map((issue) => t(`procurement.marking.issue.${issue}`)).join(', ')}</p>}
            {Boolean(result?.tips.length) && (
              <ul data-testid="marking-tips" className="space-y-0.5 text-xs text-muted">
                {result?.tips.map((tip) => <li key={tip} className="flex items-start gap-1"><Lightbulb size={12} className="mt-0.5 shrink-0" aria-hidden />{tip}</li>)}
              </ul>
            )}
            {result && !decided && (
              <>
                <label className="block text-xs text-muted">
                  {t('procurement.marking.field')}
                  <input value={text} onChange={(event) => setText(event.target.value)} data-testid="marking-text" className="mt-0.5 h-9 w-full rounded-control border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-accent" />
                </label>
                {adapter.identifyText && <Button size="sm" data-testid="marking-compare" loading={typed.isPending} disabled={!text.trim()} onClick={() => typed.mutate()}>{t('procurement.marking.compare')}</Button>}
                <fieldset>
                  <legend className="text-xs text-muted">{t(result.matches.length ? 'procurement.marking.candidates' : 'procurement.marking.which')}</legend>
                  <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                    {choices.map((choice) => (
                      <li key={choice.id} data-testid="marking-choice" className="flex items-start gap-1 rounded-lg px-1 py-1 hover:bg-hover">
                        <label className="flex min-h-8 min-w-0 flex-1 cursor-pointer items-start gap-2 text-sm pointer-coarse:min-h-10">
                          <input type="radio" name="marking-part" checked={partId === choice.id} onChange={() => setPartId(choice.id)} className="mt-1 size-4 accent-[var(--color-accent)]" />
                          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                            <strong className="font-semibold">{choice.label}</strong>
                            {choice.name && <span className="text-muted"> · {choice.name}</span>}
                            {choice.kind && !(choice.kind === 'type' && choice.difference) && <span className="block text-xs text-muted">{t(`procurement.marking.kind.${choice.kind}`)}</span>}
                            {choice.difference && <span data-testid="marking-difference" className="block text-xs text-warning">{choice.difference}</span>}
                          </span>
                        </label>
                        {choice.source && (
                          <button type="button" data-testid="marking-source" aria-label={t('procurement.source', { place: sourcePlace(choice.source, t as never) })} onClick={() => choice.source && onOpenSource(choice.source)} className="pressable inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg px-1.5 text-xs text-muted hover:text-fg pointer-coarse:min-h-10">
                            <FileText size={12} aria-hidden />
                            {sourcePlace(choice.source, t as never)}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </fieldset>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" data-testid="marking-confirm" disabled={!canDecide} loading={decide.isPending && decide.variables === 'confirmed'} onClick={() => decide.mutate('confirmed')}>{t('procurement.marking.confirm')}</Button>
                  <Button size="sm" data-testid="marking-reject" disabled={!canDecide} loading={decide.isPending && decide.variables === 'rejected'} onClick={() => decide.mutate('rejected')}>{t('procurement.marking.reject')}</Button>
                  <Button size="sm" variant="ghost" data-testid="marking-retake" icon={<RotateCcw size={13} aria-hidden />} onClick={() => reset()}>{t('procurement.marking.retake')}</Button>
                </div>
              </>
            )}
            {decided && (
              <div data-testid="marking-decided" role="status" className="space-y-1 text-sm">
                <p className={decided.decision === 'confirmed' ? 'font-medium text-success' : 'font-medium text-danger'}>{t(`procurement.identification.${decided.decision === 'confirmed' ? 'user_confirmed' : 'user_rejected'}`)}</p>
                <p className="break-words [overflow-wrap:anywhere]"><span className="text-muted">{t('procurement.marking.document')}:</span> <strong className="font-semibold">{decided.documentPartNumber}</strong></p>
                <p className="break-words [overflow-wrap:anywhere]"><span className="text-muted">{t('procurement.marking.found')}:</span> <strong className="font-semibold">{decided.recognizedPartNumber ?? t('procurement.marking.notRead')}</strong></p>
                <Button size="sm" data-testid="marking-another" onClick={reset}>{t('procurement.marking.another')}</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
