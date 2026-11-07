import { useEffect, useRef, useState } from 'react';
import { Camera, CircleAlert, CircleCheck, CircleHelp, TriangleAlert } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { cn } from '@/lib/cn';
import type { ProcurementAdapter } from '@/services/procurement/types';
import type { Confirmation, Decision, MatchStatus, Part, PhotoMatch } from '@/types/procurement';

const LOOK: Record<MatchStatus, { Icon: typeof CircleCheck; tone: string }> = {
  matched: { Icon: CircleCheck, tone: 'bg-success-tint text-success' },
  needs_confirmation: { Icon: CircleHelp, tone: 'bg-warning-tint text-warning' },
  no_match: { Icon: TriangleAlert, tone: 'bg-danger-tint text-danger' },
  unreadable: { Icon: CircleAlert, tone: 'bg-hover text-muted' },
};

interface Props {
  adapter: ProcurementAdapter;
  parts: readonly Part[];
  maxImageBytes: number | null;
  onDecided: (confirmation: Confirmation) => void;
}

/** The server's match is automatic. "Confirmed" appears only after this person's own decision, even for an exact match. */
export function MarkingCheck({ adapter, parts, maxImageBytes, onDecided }: Props) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<PhotoMatch | null>(null);
  const [text, setText] = useState('');
  const [partId, setPartId] = useState('');
  const [decided, setDecided] = useState<Confirmation | null>(null);
  const [tooLarge, setTooLarge] = useState(false);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const show = (match: PhotoMatch) => {
    setResult(match);
    setText(match.recognized.partNumber ?? '');
    setPartId(match.matches[0]?.partId ?? '');
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
    mutationFn: (decision: Decision) => adapter.confirm(partId, { recognizedText: result?.recognized.text ?? text.trim(), recognizedPartNumber: text.trim(), decision }),
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

  if (!adapter.canReadPhotos) {
    return <p data-testid="photo-unavailable" className="rounded-panel border border-line bg-card p-3 text-sm text-muted">{t('procurement.marking.unavailable')}</p>;
  }

  const status = result?.matchStatus;
  const look = status ? LOOK[status] : null;
  const failure = upload.error ?? typed.error ?? decide.error;
  const choices = result?.matches.length ? result.matches.map((match) => ({ id: match.partId, label: match.partNumber, difference: match.difference })) : parts.map((part) => ({ id: part.id, label: part.partNumber, difference: null }));

  return (
    <section data-testid="marking-check" aria-labelledby="marking-title" className="rounded-panel border border-line bg-card p-3">
      <h3 id="marking-title" className="font-semibold">{t('procurement.marking.title')}</h3>
      <p className="mt-0.5 text-xs text-muted">{t('procurement.marking.hint')}</p>
      <input
        ref={input}
        type="file"
        hidden
        data-testid="marking-file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        aria-label={t('procurement.marking.photo')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          reset();
          if (maxImageBytes !== null && file.size > maxImageBytes) {
            setTooLarge(true);
            return;
          }
          setPreview(URL.createObjectURL(file));
          upload.mutate(file);
        }}
      />
      {!preview && <Button className="mt-2" icon={<Camera size={14} aria-hidden />} onClick={() => input.current?.click()}>{t('procurement.marking.add')}</Button>}
      {tooLarge && <p role="alert" className="mt-1 text-sm text-danger">{t('errors.codes.IMAGE_TOO_LARGE')}</p>}
      {preview && (
        <div className="mt-2 flex flex-wrap gap-3">
          <img src={preview} alt={t('procurement.marking.photo')} className="h-28 max-w-full rounded-control border border-line object-contain" />
          <div className="min-w-0 flex-1 basis-56 space-y-2">
            {upload.isPending && <p role="status" className="text-sm text-muted">{t('procurement.marking.reading')}</p>}
            {status && look && (
              <div data-testid="match-result" role="status">
                <span data-status={status} className={cn('inline-flex min-h-5 items-center gap-1 rounded-full px-2 text-xs font-medium', look.tone)}>
                  <look.Icon size={12} className="shrink-0" aria-hidden />
                  {t(`procurement.marking.status.${status}`)}
                </span>
                <p className="mt-1 text-xs text-muted">{t(`procurement.marking.explain.${status}`)}</p>
              </div>
            )}
            {result && !decided && (
              <>
                <label className="block text-xs text-muted">
                  {t('procurement.marking.field')}
                  <input value={text} onChange={(event) => setText(event.target.value)} data-testid="marking-text" className="mt-0.5 h-9 w-full rounded-control border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-accent" />
                </label>
                {adapter.identifyText && <Button size="sm" data-testid="marking-compare" loading={typed.isPending} disabled={!text.trim()} onClick={() => typed.mutate()}>{t('procurement.marking.compare')}</Button>}
                <fieldset>
                  <legend className="text-xs text-muted">{t('procurement.marking.which')}</legend>
                  <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                    {choices.map((choice) => (
                      <li key={choice.id}>
                        <label className="flex min-h-8 cursor-pointer items-start gap-2 rounded-lg px-1 py-1 text-sm hover:bg-hover pointer-coarse:min-h-10">
                          <input type="radio" name="marking-part" checked={partId === choice.id} onChange={() => setPartId(choice.id)} className="mt-1 size-4 accent-[var(--color-accent)]" />
                          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                            <strong className="font-semibold">{choice.label}</strong>
                            {choice.difference && <span data-testid="marking-difference" className="block text-xs text-warning">{choice.difference}</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" data-testid="marking-confirm" disabled={!partId || !text.trim()} loading={decide.isPending && decide.variables === 'confirmed'} onClick={() => decide.mutate('confirmed')}>{t('procurement.marking.confirm')}</Button>
                  <Button size="sm" data-testid="marking-reject" disabled={!partId || !text.trim()} loading={decide.isPending && decide.variables === 'rejected'} onClick={() => decide.mutate('rejected')}>{t('procurement.marking.reject')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>{t('procurement.marking.retake')}</Button>
                </div>
              </>
            )}
            {decided && (
              <div data-testid="marking-decided" role="status" className="space-y-1 text-sm">
                <p className={decided.decision === 'confirmed' ? 'font-medium text-success' : 'font-medium text-danger'}>{t(`procurement.identification.${decided.decision === 'confirmed' ? 'user_confirmed' : 'user_rejected'}`)}</p>
                <p className="break-words [overflow-wrap:anywhere]"><span className="text-muted">{t('procurement.marking.document')}:</span> <strong className="font-semibold">{decided.documentPartNumber}</strong></p>
                <p className="break-words [overflow-wrap:anywhere]"><span className="text-muted">{t('procurement.marking.found')}:</span> <strong className="font-semibold">{decided.recognizedPartNumber}</strong></p>
                <Button size="sm" onClick={() => { reset(); input.current?.click(); }}>{t('procurement.marking.another')}</Button>
              </div>
            )}
            {failure && <p role="alert" className="text-sm text-danger">{errorMessage(failure)}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
