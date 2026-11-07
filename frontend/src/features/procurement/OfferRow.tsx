import { Check, ExternalLink, Globe } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import type { Offer, PriceList } from '@/types/procurement';
import { canCheckOnSite, checkReasonKey } from './sheetLines';

/** Where the price came from, in words a person can check against the file. */
export function useOfferOrigin() {
  const { t, i18n } = useTranslation();
  return (offer: Offer, lists: readonly PriceList[] | undefined) => {
    const file = offer.priceListFile ?? lists?.find((list) => list.id === offer.priceListId)?.fileName;
    const failed = offer.siteCheck?.status === 'failed' ? offer.siteCheck : null;
    return {
      stock: offer.stockStatus === 'available' && offer.stockQuantity !== null ? t('procurement.stock.count', { count: offer.stockQuantity }) : t(`procurement.stock.${offer.stockStatus}`),
      source: file ? t('procurement.fromFile', { file, row: offer.sourceRow }) : t('procurement.row', { row: offer.sourceRow }),
      date: !offer.demo && offer.checkedAt ? t(`procurement.checked.${offer.checkedAtOrigin}`, { date: formatDate(offer.checkedAt, i18n.language) }) : null,
      priceOrigin: t(`procurement.priceOrigin.${offer.priceOrigin}`),
      filePrice: offer.priceOrigin === 'site_checked' && offer.filePrice && offer.currency && offer.filePrice !== offer.price ? t('procurement.filePrice', { amount: formatMoney(offer.filePrice, offer.currency, i18n.language) }) : null,
      failedCheck: failed ? t('procurement.siteCheck.failed', { reason: t(`procurement.siteCheck.reason.${checkReasonKey(failed.reason)}` as never) }) : null,
    };
  };
}

export function ProductLink({ url }: { url: string }) {
  const { t } = useTranslation();
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" data-testid="offer-link" className="inline-flex min-h-6 items-center gap-1 underline pointer-coarse:min-h-10">
      {t('procurement.open')}
      <ExternalLink size={11} aria-hidden />
      <span className="sr-only"> ({t('home.opensInNewTab')})</span>
    </a>
  );
}

export function OfferRow({ offer, chosen, lists, onSelect, checkPrice }: { offer: Offer; chosen: boolean; lists: readonly PriceList[] | undefined; onSelect: (offerId: string | null) => void; checkPrice?: ((offerId: string) => Promise<void>) | undefined }) {
  const { t, i18n } = useTranslation();
  const origin = useOfferOrigin()(offer, lists);
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const check = useMutation({
    mutationFn: async () => checkPrice?.(offer.id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['procurement'] }),
  });
  return (
    <li data-testid="offer" data-match={offer.match} data-chosen={chosen || undefined} className={cn('rounded-control border p-2 text-sm', chosen ? 'border-accent-line bg-accent-tint' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {offer.demo && <span data-testid="demo-price" className="rounded bg-warning-tint px-1 text-[11px] font-semibold text-warning">{t('procurement.demoBadge')}</span>}
        <strong className="tabular font-semibold">{offer.price && offer.currency ? formatMoney(offer.price, offer.currency, i18n.language) : t('procurement.noPrice')}</strong>
        <span className="min-w-0 break-words [overflow-wrap:anywhere]"><span className="font-medium">{offer.partNumber}</span> · {offer.supplier}{offer.manufacturer && <span data-testid="offer-manufacturer"> · {offer.manufacturer}</span>}</span>
        <span className="ml-auto">
          {chosen
            ? <Button size="sm" variant="ghost" icon={<Check size={13} aria-hidden />} onClick={() => onSelect(null)} aria-label={t('procurement.clearOffer')}>{t('procurement.chosen')}</Button>
            : <Button size="sm" disabled={!offer.price} onClick={() => onSelect(offer.id)}>{t('procurement.chooseOffer')}</Button>}
        </span>
      </div>
      {offer.title && offer.title !== offer.partNumber && <p className="mt-0.5 text-xs break-words [overflow-wrap:anywhere]">{offer.title}</p>}
      <p data-testid="offer-origin" className="tabular mt-0.5 text-xs text-muted">
        {[origin.stock, origin.source, origin.date].filter(Boolean).join(' · ')}
      </p>
      <p data-testid="price-origin" data-origin={offer.priceOrigin} className={cn('mt-0.5 text-xs', offer.priceOrigin === 'site_checked' ? 'font-medium text-success' : 'text-muted')}>
        {[origin.priceOrigin, origin.filePrice].filter(Boolean).join(' · ')}
      </p>
      {origin.failedCheck && <p data-testid="check-failed" className="text-xs text-warning">{origin.failedCheck}</p>}
      {(offer.url || (checkPrice && canCheckOnSite(offer))) && (
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
          {offer.url && <ProductLink url={offer.url} />}
          {checkPrice && canCheckOnSite(offer) && (
            <Button size="sm" variant="ghost" data-testid="check-price" icon={<Globe size={13} aria-hidden />} loading={check.isPending} onClick={() => check.mutate()}>{t('procurement.siteCheck.button')}</Button>
          )}
        </div>
      )}
      {check.isError && <p role="alert" data-testid="check-error" className="text-xs text-danger">{errorMessage(check.error)}</p>}
    </li>
  );
}
