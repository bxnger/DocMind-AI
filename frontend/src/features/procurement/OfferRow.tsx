import { Check, CircleCheck, ExternalLink, FileSpreadsheet, FlaskConical, Globe, ShieldCheck, Store, TriangleAlert } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import type { Offer, PriceList } from '@/types/procurement';
import { offerSource, type OfferSourceKind } from './offerSource';
import { canCheckOnSite, checkReasonKey } from './sheetLines';

/** Where the price came from, in words a person can check against the file. */
export function useOfferOrigin() {
  const { t, i18n } = useTranslation();
  return (offer: Offer, lists: readonly PriceList[] | undefined) => {
    const file = offer.priceListFile ?? lists?.find((list) => list.id === offer.priceListId)?.fileName;
    const failed = offer.siteCheck?.status === 'failed' ? offer.siteCheck : null;
    return {
      stock: offer.stockStatus === 'available' && offer.stockQuantity !== null ? t('procurement.stock.count', { count: offer.stockQuantity }) : t(`procurement.stock.${offer.stockStatus}`),
      source: offer.store ? t('partSearch.store.source', { store: offer.store }) : file ? t('procurement.fromFile', { file, row: offer.sourceRow }) : t('procurement.row', { row: offer.sourceRow }),
      date: offer.store
        ? (offer.checkedAt ? t('procurement.checked.site', { date: formatDateTime(offer.checkedAt, i18n.language) }) : t('partSearch.store.notRead'))
        : !offer.demo && offer.checkedAt ? t(`procurement.checked.${offer.checkedAtOrigin}`, { date: formatDate(offer.checkedAt, i18n.language) }) : null,
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

const SOURCE_LOOK: Record<OfferSourceKind, { Icon: typeof Store; badge: string; edge: string; card: string }> = {
  store: { Icon: ShieldCheck, badge: 'bg-success-tint text-success', edge: 'border-l-success', card: '' },
  file: { Icon: FileSpreadsheet, badge: 'bg-sidebar text-muted border border-line', edge: 'border-l-line-strong', card: '' },
  test: { Icon: FlaskConical, badge: 'bg-warning-tint text-warning', edge: 'border-l-warning', card: 'bg-warning-tint/30' },
};

/** The source of a price in one chip: the supplier catalogue, a price list of the person's own, or test data. */
export function SourceBadge({ kind }: { kind: OfferSourceKind }) {
  const { t } = useTranslation();
  const { Icon, badge } = SOURCE_LOOK[kind];
  return (
    <span data-testid={kind === 'store' ? 'store-badge' : kind === 'test' ? 'demo-price' : 'file-badge'} data-source={kind} className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold', badge)}>
      <Icon size={11} aria-hidden />{t(`procurement.sourceKind.${kind}`)}
    </span>
  );
}

/** Exact or similar, said in words and in colour: a similar part number never looks like the one asked for. */
export function MatchBadge({ match }: { match: Offer['match'] }) {
  const { t } = useTranslation();
  return match === 'exact'
    ? <span data-testid="match-badge" className="inline-flex items-center gap-1 rounded bg-success-tint px-1.5 py-0.5 text-[11px] font-semibold text-success"><CircleCheck size={11} aria-hidden />{t('partSearch.match.exact')}</span>
    : <span data-testid="match-badge" className="inline-flex items-center gap-1 rounded bg-warning-tint px-1.5 py-0.5 text-[11px] font-semibold text-warning"><TriangleAlert size={11} aria-hidden />{t('partSearch.match.close')}</span>;
}

interface OfferRowProps {
  offer: Offer;
  chosen: boolean;
  lists: readonly PriceList[] | undefined;
  onSelect: (offerId: string | null) => void;
  checkPrice?: ((offerId: string) => Promise<void>) | undefined;
  /** The document's unit for this part, for "per piece". */
  unit?: string | null | undefined;
  /** False: shown to compare only, with no button (a search outside the document). */
  selectable?: boolean;
  /** Other sites of the same seller that list this part: one seller, one card. */
  alsoAt?: readonly string[];
}

export function OfferRow({ offer, chosen, lists, onSelect, checkPrice, unit, selectable = true, alsoAt = [] }: OfferRowProps) {
  const { t, i18n } = useTranslation();
  const origin = useOfferOrigin()(offer, lists);
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const check = useMutation({
    mutationFn: async () => checkPrice?.(offer.id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['procurement'] }),
  });
  const similar = offer.match !== 'exact';
  const kind = offerSource(offer);
  return (
    <li data-testid="offer" data-match={offer.match} data-source={kind} data-chosen={chosen || undefined} className={cn('rounded-control border border-l-[3px] p-2.5 text-sm', SOURCE_LOOK[kind].edge, chosen ? 'border-accent-line bg-accent-tint' : similar ? 'border-dashed border-warning/50' : 'border-line', !chosen && SOURCE_LOOK[kind].card)}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-44">
          <div className="flex flex-wrap items-center gap-1.5">
            <SourceBadge kind={kind} />
            <MatchBadge match={offer.match} />
          </div>
          <p className="mt-1 font-semibold break-words [overflow-wrap:anywhere]">{offer.partNumber}{offer.manufacturer && <span data-testid="offer-manufacturer" className="font-normal text-muted"> · {offer.manufacturer}</span>}</p>
          <p data-testid="offer-supplier" className="break-words [overflow-wrap:anywhere]"><Store size={12} className="mr-1 inline align-[-1px] text-muted" aria-hidden />{offer.supplier}</p>
          {(alsoAt.length > 0 || offer.sameSellerAs.length > 0) && <p data-testid="same-seller" className="text-xs text-muted">{alsoAt.length > 0 ? t('partSearch.store.alsoAt', { stores: alsoAt.join(', ') }) : t('partSearch.store.sameSellerNote', { stores: offer.sameSellerAs.join(', ') })}</p>}
          {offer.title && offer.title !== offer.partNumber && <p className="mt-0.5 text-xs text-muted break-words [overflow-wrap:anywhere]">{offer.title}</p>}
        </div>
        <div className="text-right">
          {offer.price && offer.currency
            ? <><strong data-testid="offer-price" className="tabular block font-display text-lg leading-6 font-semibold">{formatMoney(offer.price, offer.currency, i18n.language)}</strong><span className="text-xs text-muted">{t('partSearch.perUnit', { unit: unit || t('partSearch.unitFallback') })}</span></>
            : <strong data-testid="offer-price" data-unknown className="block text-sm font-medium text-muted">{t('procurement.noPrice')}</strong>}
        </div>
      </div>
      {similar && <p data-testid="offer-compat" className="mt-1.5 text-xs font-medium text-warning">{t('partSearch.compat')}</p>}
      <p data-testid="offer-origin" className="tabular mt-1 text-xs text-muted">
        {[origin.stock, origin.source, origin.date].filter(Boolean).join(' · ')}
      </p>
      <p data-testid="price-origin" data-origin={offer.priceOrigin} className={cn('mt-0.5 text-xs', offer.priceOrigin === 'site_checked' ? 'font-medium text-success' : 'text-muted')}>
        {[origin.priceOrigin, origin.filePrice].filter(Boolean).join(' · ')}
      </p>
      {origin.failedCheck && <p data-testid="check-failed" className="text-xs text-warning">{origin.failedCheck}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {offer.url && <ProductLink url={offer.url} />}
        {checkPrice && canCheckOnSite(offer) && (
          <Button size="sm" variant="ghost" data-testid="check-price" icon={<Globe size={13} aria-hidden />} loading={check.isPending} onClick={() => check.mutate()}>{t('procurement.siteCheck.button')}</Button>
        )}
        {selectable && <span className="ml-auto">
          {chosen
            ? <Button size="sm" variant="ghost" className="pointer-coarse:h-10" icon={<Check size={13} aria-hidden />} onClick={() => onSelect(null)} aria-label={t('procurement.clearOffer')}>{t('procurement.chosen')}</Button>
            : <Button size="sm" className="pointer-coarse:h-10" disabled={!offer.price} onClick={() => onSelect(offer.id)}>{t('procurement.chooseOffer')}</Button>}
        </span>}
      </div>
      {check.isError && <p role="alert" data-testid="check-error" className="text-xs text-danger">{errorMessage(check.error)}</p>}
    </li>
  );
}
