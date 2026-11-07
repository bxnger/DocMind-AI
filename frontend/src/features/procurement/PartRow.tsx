import { useState } from 'react';
import { Check, ExternalLink, FileText, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import type { EvidenceSource } from '@/types/chat';
import type { Offer, Part, PartOffers, QuoteItem } from '@/types/procurement';
import type { SheetLine } from './useProcurement';

interface Props {
  part: Part;
  line: SheetLine | undefined;
  offers: PartOffers | undefined;
  quoteItem: QuoteItem | undefined;
  onChange: (change: Partial<SheetLine>) => void;
  onOpenSource: (source: EvidenceSource) => void;
}

function OfferRow({ offer, chosen, onSelect }: { offer: Offer; chosen: boolean; onSelect: (offerId: string | null) => void }) {
  const { t, i18n } = useTranslation();
  const stock = offer.stockStatus === 'available' && offer.stockQuantity !== null ? t('procurement.stock.count', { count: offer.stockQuantity }) : t(`procurement.stock.${offer.stockStatus}`);
  return (
    <li data-testid="offer" data-match={offer.match} data-chosen={chosen || undefined} className={cn('rounded-control border p-2 text-sm', chosen ? 'border-accent-line bg-accent-tint' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {offer.demo && <span data-testid="demo-price" className="rounded bg-warning-tint px-1 text-[11px] font-semibold text-warning">{t('procurement.demoBadge')}</span>}
        <strong className="tabular font-semibold">{offer.price && offer.currency ? formatMoney(offer.price, offer.currency, i18n.language) : t('procurement.noPrice')}</strong>
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{offer.supplier} · {offer.partNumber}</span>
        <span className="ml-auto">
          {chosen
            ? <Button size="sm" variant="ghost" icon={<Check size={13} aria-hidden />} onClick={() => onSelect(null)} aria-label={t('procurement.clearOffer')}>{t('procurement.chosen')}</Button>
            : <Button size="sm" disabled={!offer.price} onClick={() => onSelect(offer.id)}>{t('procurement.chooseOffer')}</Button>}
        </span>
      </div>
      <p data-testid="offer-origin" className="tabular mt-0.5 text-xs text-muted">
        {[
          t('procurement.row', { row: offer.sourceRow }),
          stock,
          !offer.demo && offer.checkedAt ? t(`procurement.checked.${offer.checkedAtOrigin}`, { date: formatDate(offer.checkedAt, i18n.language) }) : null,
        ].filter(Boolean).join(' · ')}
        {offer.url && <> · <a href={offer.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">{t('procurement.open')}<ExternalLink size={10} aria-hidden /></a></>}
      </p>
    </li>
  );
}

/** One editable line: the document's own part number and quote, the person's choices, and offers from price files. */
export function PartRow({ part, line, offers, quoteItem, onChange, onOpenSource }: Props) {
  const { t, i18n } = useTranslation();
  const [note, setNote] = useState(line?.note ?? '');
  const included = line?.included ?? true;
  const quantity = line?.quantity ?? part.quantity;
  const source = part.sources[0];
  const place = (item: EvidenceSource) => (item.page !== null ? t('sources.page', { page: item.page }) : (item.location ?? t('procurement.inText')));
  const select = (offerId: string | null) => onChange({ offerId });
  const identification = quoteItem?.identification.status;

  return (
    <li data-testid="part" data-part={part.id} className={cn('rounded-panel border border-line bg-card p-3', !included && 'opacity-60')}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <label className="mt-0.5 inline-flex size-6 items-center justify-center pointer-coarse:size-10">
          <input type="checkbox" checked={included} onChange={(event) => onChange({ included: event.target.checked })} aria-label={t('procurement.include', { code: part.partNumber })} className="size-4 accent-[var(--color-accent)]" />
        </label>
        <div className="min-w-0 flex-1 basis-48">
          <h4 className="font-semibold break-words [overflow-wrap:anywhere]">{part.partNumber}</h4>
          <p className="text-xs text-muted">{[part.name, part.manufacturer, part.location].filter(Boolean).join(' · ')}</p>
          {identification && identification !== 'document_only' && <p data-testid="identification" className={cn('mt-1 text-xs font-medium', identification === 'user_confirmed' ? 'text-success' : 'text-danger')}>{t(`procurement.identification.${identification}`)}</p>}
        </div>
        <label className="w-24 text-xs text-muted">
          {t('procurement.qty')}{part.unit ? `, ${part.unit}` : ''}
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            data-testid="part-qty"
            key={quantity ?? 'none'}
            defaultValue={quantity ?? ''}
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value > 0 && value !== quantity) onChange({ quantity: value });
            }}
            className="tabular mt-0.5 h-9 w-full rounded-control border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-accent"
          />
        </label>
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
          <span className="line-clamp-3 border-l-2 border-accent-2 pl-2 font-quote text-[14px] leading-[21px] break-words text-fg/90">{source.quote}</span>
        </button>
      ) : (
        <p data-testid="no-source" className="mt-2 text-xs text-muted">{t('procurement.noSource')}</p>
      )}

      <h5 className="micro-label mt-3 mb-1">{t('procurement.offers')}</h5>
      {offers?.offers.length ? (
        <ul className="space-y-1.5">{offers.offers.map((offer) => <OfferRow key={offer.id} offer={offer} chosen={offer.id === line?.offerId} onSelect={select} />)}</ul>
      ) : <p className="text-xs text-muted">{t('procurement.noOffers')}</p>}
      {Boolean(offers?.similar.length) && (
        <>
          <h5 data-testid="similar-title" className="mt-2 mb-1 text-xs font-medium text-warning">{t('procurement.similar')}</h5>
          <ul className="space-y-1.5">{offers?.similar.map((offer) => <OfferRow key={offer.id} offer={offer} chosen={offer.id === line?.offerId} onSelect={select} />)}</ul>
        </>
      )}
      {quoteItem?.status === 'offer_missing' && <p data-testid="offer-missing" className="mt-1 text-xs text-warning">{t('procurement.offerMissing')}</p>}
      {quoteItem?.matchWarning && <p data-testid="match-warning" className="mt-1 text-xs text-warning">{t('procurement.matchWarning')}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1 basis-44">
          <span className="sr-only">{t('procurement.note')}</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} onBlur={() => onChange({ note })} placeholder={t('procurement.notePlaceholder')} className="h-8 w-full rounded-control border border-line bg-bg px-2 text-sm outline-none placeholder:text-muted focus:border-accent" />
        </label>
        {quoteItem?.lineTotal && quoteItem.currency && <p data-testid="line-total" className="tabular text-sm"><span className="text-muted">{t('procurement.line')}:</span> <strong className="font-semibold">{formatMoney(quoteItem.lineTotal, quoteItem.currency, i18n.language)}</strong></p>}
      </div>
    </li>
  );
}
