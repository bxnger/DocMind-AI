import { useEffect, useRef, useState } from 'react';
import { Camera, CircleAlert, CircleCheck, CircleHelp, TriangleAlert } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { cn } from '@/lib/cn';
import type { ProcurementAdapter } from '@/services/procurement/types';
import type { Marking, MarkingStatus, Part } from '@/types/procurement';

export const STATUS_LOOK: Record<MarkingStatus, { Icon: typeof CircleCheck; tone: string }> = {
  exact: { Icon: CircleCheck, tone: 'bg-success-tint text-success' },
  possible: { Icon: CircleHelp, tone: 'bg-warning-tint text-warning' },
  conflict: { Icon: TriangleAlert, tone: 'bg-danger-tint text-danger' },
  insufficient: { Icon: CircleAlert, tone: 'bg-hover text-muted' },
};

export function MarkingBadge({ status }: { status: MarkingStatus }) {
  const { t } = useTranslation();
  const { Icon, tone } = STATUS_LOOK[status];
  return (
    <span data-status={status} className={cn('inline-flex min-h-5 items-center gap-1 rounded-full px-2 text-xs font-medium', tone)}>
      <Icon size={12} className="shrink-0" aria-hidden />
      {t(`procurement.marking.status.${status}`)}
    </span>
  );
}

interface Props {
  adapter: ProcurementAdapter;
  parts: readonly Part[];
  onChecked: () => void;
}

/** The model may propose text. The status comes only from what a person has confirmed against the photo. */
export function MarkingCheck({ adapter, parts, onChecked }: Props) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [marking, setMarking] = useState<Marking | null>(null);
  const [text, setText] = useState('');

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const upload = useMutation({
    mutationFn: (file: File) => adapter.uploadMarking(file),
    onSuccess: (created) => {
      setMarking(created);
      setText(created.readText ?? '');
    },
  });
  const confirm = useMutation({
    mutationFn: () => {
      if (!marking) throw new Error('No marking');
      return adapter.confirmMarking(marking.id, text.trim());
    },
    onSuccess: (done) => {
      setMarking(done);
      onChecked();
    },
  });
  const reset = () => {
    setMarking(null);
    setPreview(null);
    setText('');
    upload.reset();
    confirm.reset();
  };

  const matched = parts.find((part) => part.id === marking?.matchedPartId);
  const differences = marking?.candidates.find((candidate) => candidate.partId === marking.matchedPartId)?.differences ?? [];

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
          setPreview(URL.createObjectURL(file));
          upload.mutate(file);
        }}
      />
      {!preview && <Button className="mt-2" icon={<Camera size={14} aria-hidden />} onClick={() => input.current?.click()}>{t('procurement.marking.add')}</Button>}
      {preview && (
        <div className="mt-2 flex flex-wrap gap-3">
          <img src={preview} alt={t('procurement.marking.photo')} className="h-28 max-w-full rounded-control border border-line object-contain" />
          <div className="min-w-0 flex-1 basis-52">
            {marking && !marking.confirmed && <p role="status" className="mb-1 text-xs text-muted">{t(marking.readText ? 'procurement.marking.read' : 'procurement.marking.notRead')}</p>}
            {marking && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (text.trim()) confirm.mutate();
                }}
              >
                <label className="min-w-0 flex-1 basis-40 text-xs text-muted">
                  {t('procurement.marking.field')}
                  <input value={text} onChange={(event) => setText(event.target.value)} data-testid="marking-text" className="mt-0.5 h-9 w-full rounded-control border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-accent" />
                </label>
                <Button type="submit" variant="primary" loading={confirm.isPending} disabled={!text.trim()}>{t('procurement.marking.confirm')}</Button>
              </form>
            )}
            {marking?.confirmed && marking.status && (
              <div data-testid="marking-result" className="mt-2 space-y-1 text-sm" role="status">
                <MarkingBadge status={marking.status} />
                <p className="text-muted">{t(`procurement.marking.explain.${marking.status}`)}</p>
                {matched && <p className="break-words [overflow-wrap:anywhere]"><span className="text-muted">{t('procurement.marking.document')}:</span> <strong className="font-semibold">{matched.rawCode}</strong></p>}
                {marking.confirmedText && <p className="break-words [overflow-wrap:anywhere]"><span className="text-muted">{t('procurement.marking.found')}:</span> <strong className="font-semibold">{marking.confirmedText}</strong></p>}
                {differences.map((difference) => <p key={`${difference.document}-${difference.marking}`} data-testid="marking-difference" className="tabular text-danger">{difference.document} ≠ {difference.marking}</p>)}
                <Button size="sm" onClick={reset}>{t('procurement.marking.another')}</Button>
              </div>
            )}
            {(upload.isError || confirm.isError) && <p role="alert" className="mt-1 text-sm text-danger">{errorMessage(upload.error ?? confirm.error)}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
