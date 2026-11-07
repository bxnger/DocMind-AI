import { useState } from 'react';
import { Camera, FileText, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { EvidenceSource } from '@/types/chat';
import type { Part } from '@/types/procurement';
import { QuantityInput } from './QuantityInput';
import { readableQuote, type SheetLine } from './sheetLines';

interface Props {
  part: Part;
  line: SheetLine | undefined;
  canCheckPhoto: boolean;
  onChange: (change: Partial<SheetLine>) => void;
  onOpenSource: (source: EvidenceSource) => void;
  onCheckPhoto: () => void;
}

export const sourcePlace = (source: EvidenceSource, t: (key: string, options?: Record<string, unknown>) => string): string =>
  source.page !== null ? t('sources.page', { page: source.page }) : (source.location ?? t('procurement.inText'));

/** What the document says about one part, in its own words, one click from the page. */
export function PartRow({ part, line, canCheckPhoto, onChange, onOpenSource, onCheckPhoto }: Props) {
  const { t } = useTranslation();
  const [note, setNote] = useState(line?.note ?? '');
  const included = line?.included ?? true;
  const quantity = line?.quantity ?? part.quantity;
  const source = part.sources[0];
  const place = (item: EvidenceSource) => sourcePlace(item, t as never);

  return (
    <li data-testid="part" data-part={part.id} className={cn('rounded-panel border border-line bg-card p-3', !included && 'opacity-60')}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <label className="mt-0.5 inline-flex size-6 items-center justify-center pointer-coarse:size-10">
          <input type="checkbox" checked={included} onChange={(event) => onChange({ included: event.target.checked })} aria-label={t('procurement.include', { code: part.partNumber })} className="size-4 accent-[var(--color-accent)]" />
        </label>
        <div className="min-w-0 flex-1 basis-48">
          <h4 className="font-semibold break-words [overflow-wrap:anywhere]">{part.partNumber}</h4>
          <p className="text-xs text-muted">{[part.category === 'other' ? null : t(`procurement.category.${part.category}`), part.name, part.manufacturer, part.location].filter(Boolean).join(' · ')}</p>
          {line?.decision && <p data-testid="identification" className={cn('mt-1 text-xs font-medium', line.decision === 'confirmed' ? 'text-success' : 'text-danger')}>{t(`procurement.identification.${line.decision === 'confirmed' ? 'user_confirmed' : 'user_rejected'}`)}</p>}
        </div>
        <QuantityInput part={part} line={line} onChange={onChange} />
      </div>
      {!part.verified && part.sources.length > 0 && <p data-testid="not-verified" className="mt-1 flex items-start gap-1 text-xs text-warning"><TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />{t('procurement.notVerified')}</p>}
      {quantity === null && <p data-testid="no-qty" className="mt-1 text-xs text-warning">{t('procurement.noQty')}</p>}
      {line?.quantity != null && line.quantity !== part.quantity && <p data-testid="user-qty" className="mt-1 text-xs text-muted">{t('procurement.userQty')}</p>}

      {part.specs.length > 0 && (
        <ul data-testid="specs" className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {part.specs.map((spec) => (
            <li key={spec.name}><span className="text-muted">{spec.name}:</span> {spec.value}{spec.unit ? ` ${spec.unit}` : ''}{spec.origin === 'standard' && <span className="text-muted"> ({t('procurement.byStandard')})</span>}</li>
          ))}
        </ul>
      )}

      {source ? (
        <button type="button" data-testid="part-source" onClick={() => onOpenSource(source)} aria-label={t('procurement.source', { place: place(source) })} className="pressable mt-2 w-full rounded-control border border-line bg-sidebar p-2 text-left hover:border-accent-2-line">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium"><FileText size={12} className="shrink-0 text-muted" aria-hidden /><span className="min-w-0 truncate">{place(source)}</span></span>
          <span className="line-clamp-3 border-l-2 border-accent-2 pl-2 font-quote text-[14px] leading-[21px] break-words text-fg/90">{readableQuote(source.quote, part.partNumber)}</span>
        </button>
      ) : (
        <p data-testid="no-source" className="mt-2 text-xs text-muted">{t('procurement.noSource')}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1 basis-44">
          <span className="sr-only">{t('procurement.note')}</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} onBlur={() => onChange({ note })} placeholder={t('procurement.notePlaceholder')} className="h-8 w-full rounded-control border border-line bg-bg px-2 text-sm outline-none placeholder:text-muted focus:border-accent pointer-coarse:h-10" />
        </label>
        {canCheckPhoto && (
          <button type="button" data-testid="part-photo" onClick={onCheckPhoto} className="pressable inline-flex min-h-8 items-center gap-1.5 rounded-[10px] px-2 text-sm text-muted hover:bg-hover hover:text-fg pointer-coarse:min-h-10">
            <Camera size={14} aria-hidden />
            {t('procurement.checkPhoto')}
          </button>
        )}
      </div>
    </li>
  );
}
