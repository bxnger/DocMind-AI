import { useState } from 'react';
import { Check, ExternalLink, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import type { Offer, Part, PartPatch, SheetItem } from '@/types/procurement';
import { MarkingBadge } from './MarkingCheck';

interface Props {
  part: Part;
  item: SheetItem | undefined;
  demo: boolean;
  onPatch: (patch: PartPatch) => void;
  onSelect: (offerId: string | null) => void;
  onOpenSource: () => void;
}

function OfferRow({ offer, chosen, demo, onSelect }: { offer: Offer; chosen: boolean; demo: boolean; onSelect: (offerId: string | null) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <li data-testid="offer" data-match={offer.match} data-chosen={chosen || undefined} className={cn('rounded-control border p-2 text-sm', chosen ? 'border-accent-line bg-accent-tint' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {demo && <span data-testid="demo-price" className="rounded bg-warning-tint px-1 text-[11px] font-semibold text-warning">{t('procurement.demoBadge')}</span>}
        <strong className="tabular font-semibold">{formatMoney(offer.unitPrice, offer.currency, i18n.language)}</strong>
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{offer.supplier} · {offer.sku}</span>
        <span className="ml-auto">
          {chosen
            ? <Button size="sm" variant="ghost" icon={<Check size={13} aria-hidden />} onClick={() => onSelect(null)} aria-label={t('procurement.clearOffer')}>{t('procurement.chosen')}</Button>
            : <Button size="sm" onClick={() => onSelect(offer.id)}>{t('procurement.chooseOffer')}</Button>}
        </span>
      </div>
      <p className="tabular mt-0.5 text-xs text-muted">
        {[t('procurement.row', { row: offer.sourceRow }), demo ? null : t('procurement.checked', { date: formatDate(offer.checkedAt, i18n.language) }), offer.stock === null ? null : t('procurement.stock', { count: offer.stock })].filter(Boolean).join(' · ')}
        {offer.url && <> · <a href={offer.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">{t('procurement.open')}<ExternalLink size={10} aria-hidden /></a></>}
      </p>
      <p className={cn('mt-0.5 text-xs', offer.match === 'exact' ? 'text-success' : 'text-warning')}>{t(offer.match === 'exact' ? 'procurement.exact' : 'procurement.needsReview')}</p>
    </li>
  );
}

/** One editable line: the document's own part number and quote, the person's changes, and offers to choose from. */
export function PartRow({ part, item, demo, onPatch, onSelect, onOpenSource }: Props) {
  const { t, i18n } = useTranslation();
  const [note, setNote] = useState(part.note);
  const place = part.page !== null ? t('sources.page', { page: part.page }) : (part.location ?? t('procurement.inText'));
  const canOpen = part.quote !== null && (part.page !== null || part.paragraph !== null);
  const choice = item?.offers.find((offer) => offer.id === item.selectedOfferId);

  return (
    <li data-testid="part" data-part={part.id} className={cn('rounded-panel border border-line bg-card p-3', !part.included && 'opacity-60')}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <label className="mt-0.5 inline-flex size-6 items-center justify-center pointer-coarse:size-10">
          <input type="checkbox" checked={part.included} onChange={(event) => onPatch({ included: event.target.checked })} aria-label={t('procurement.include', { code: part.rawCode })} className="size-4 accent-[var(--color-accent)]" />
        </label>
        <div className="min-w-0 flex-1 basis-48">
          <h4 className="font-semibold break-words [overflow-wrap:anywhere]">{part.rawCode}</h4>
          {part.description && <p className="text-xs text-muted">{part.description}</p>}
          {item?.markingStatus && <div className="mt-1"><MarkingBadge status={item.markingStatus} /></div>}
        </div>
        <label className="w-24 text-xs text-muted">
          {t('procurement.qty')}{part.unit ? `, ${part.unit}` : ''}
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            data-testid="part-qty"
            defaultValue={part.quantity ?? ''}
            key={part.quantity ?? 'none'}
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value > 0 && value !== part.quantity) onPatch({ quantity: value });
            }}
            className="tabular mt-0.5 h-9 w-full rounded-control border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-accent"
          />
        </label>
      </div>
      {part.quantity === null && <p data-testid="no-qty" className="mt-1 text-xs text-warning">{t('procurement.noQty')}</p>}
      {part.quantitySource === 'user' && <p className="mt-1 text-xs text-muted">{t('procurement.userQty')}</p>}

      {canOpen ? (
        <button type="button" data-testid="part-source" onClick={onOpenSource} aria-label={t('procurement.source', { place })} className="pressable mt-2 w-full rounded-control border border-line bg-sidebar p-2 text-left hover:border-accent-2-line">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium"><FileText size={12} className="shrink-0 text-muted" aria-hidden /><span className="min-w-0 truncate">{place}</span></span>
          <span className="line-clamp-3 border-l-2 border-accent-2 pl-2 font-quote text-[14px] leading-[21px] break-words text-fg/90">{part.quote}</span>
        </button>
      ) : (
        <p data-testid="no-source" className="mt-2 text-xs text-muted">{t('procurement.noSource')}</p>
      )}

      <h5 className="micro-label mt-3 mb-1">{t('procurement.offers')}</h5>
      {item?.offers.length ? (
        <ul className="space-y-1.5">
          {item.offers.map((offer) => <OfferRow key={offer.id} offer={offer} chosen={offer.id === item.selectedOfferId} demo={demo} onSelect={onSelect} />)}
        </ul>
      ) : <p className="text-xs text-muted">{t('procurement.noOffers')}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1 basis-44">
          <span className="sr-only">{t('procurement.note')}</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} onBlur={() => { if (note !== part.note) onPatch({ note }); }} placeholder={t('procurement.notePlaceholder')} className="h-8 w-full rounded-control border border-line bg-bg px-2 text-sm outline-none placeholder:text-muted focus:border-accent" />
        </label>
        {item?.lineTotal && choice && <p data-testid="line-total" className="tabular text-sm"><span className="text-muted">{t('procurement.line')}:</span> <strong className="font-semibold">{formatMoney(item.lineTotal, choice.currency, i18n.language)}</strong></p>}
      </div>
    </li>
  );
}
