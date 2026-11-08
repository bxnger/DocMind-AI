import { ListChecks, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { StateBlock } from '@/components/ui/StateBlock';
import { formatMoney } from '@/lib/money';
import type { ProcurementAdapter } from '@/services/procurement/types';
import type { Part, PartOffers, PriceList, QuoteItem } from '@/types/procurement';
import { OfferRow } from './OfferRow';
import { PriceListsCard } from './PriceListsCard';
import { chooseExactOffers, onlyOutOfStock, type SheetLine } from './sheetLines';

interface Props {
  adapter: ProcurementAdapter;
  parts: readonly Part[];
  lines: Record<string, SheetLine>;
  lists: readonly PriceList[] | undefined;
  offers: readonly PartOffers[] | undefined;
  quoteItems: readonly QuoteItem[] | undefined;
  showExamples: boolean;
  /** Phones: parts without any offer go into one folded group, below the ones to decide on. */
  collapseEmpty?: boolean;
  onChange: (partId: string, change: Partial<SheetLine>) => void;
  onChangeMany: (changes: Record<string, Partial<SheetLine>>) => void;
}

export function OffersStep({ adapter, parts, lines, lists, offers, quoteItems, showExamples, onChange, onChangeMany, collapseEmpty = false }: Props) {
  const { t, i18n } = useTranslation();
  const included = parts.filter((part) => lines[part.id]?.included ?? true);
  const exact = offers ? chooseExactOffers(offers, lines) : {};
  const canPick = Object.keys(exact).length;
  const hasNoOffers = (partId: string) => {
    const item = offers?.find((candidate) => candidate.partId === partId);
    return Boolean(item) && item?.offers.length === 0 && item.similar.length === 0;
  };
  const withChoices = included.filter((part) => !hasNoOffers(part.id));
  const empty = included.filter((part) => hasNoOffers(part.id));
  const withOffers = offers?.filter((item) => item.offers.length > 0 || item.similar.length > 0).length ?? 0;

  return (
    <div className="space-y-3">
      <PriceListsCard api={adapter} lists={lists} showExamples={showExamples} />
      <div className="flex flex-wrap items-center gap-2">
        <p data-testid="offers-coverage" className="min-w-0 flex-1 basis-48 text-sm text-muted">{t('procurement.offersCoverage', { found: withOffers, total: parts.length })}</p>
        <Button size="sm" data-testid="choose-exact" icon={<ListChecks size={14} aria-hidden />} disabled={canPick === 0} onClick={() => onChangeMany(Object.fromEntries(Object.entries(exact).map(([partId, offerId]) => [partId, { offerId }])))}>
          {t('procurement.chooseExact', { count: canPick })}
        </Button>
      </div>
      {!lists?.length && <StateBlock icon={<Store size={18} aria-hidden />} title={t('procurement.noListsTitle')} description={t('procurement.noListsBody')} />}
      <ul className="space-y-2">
        {(collapseEmpty ? withChoices : included).map((part) => {
          const item = offers?.find((candidate) => candidate.partId === part.id);
          const line = lines[part.id];
          const quote = quoteItems?.find((candidate) => candidate.partId === part.id);
          const select = (offerId: string | null) => onChange(part.id, { offerId });
          return (
            <li key={part.id} data-testid="part-offers" data-part={part.id} className="rounded-panel border border-line bg-card p-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h4 className="font-semibold break-words [overflow-wrap:anywhere]">{part.partNumber}</h4>
                <span className="min-w-0 flex-1 basis-32 text-xs text-muted">{part.name}{(line?.quantity ?? part.quantity) !== null ? ` · ${t('procurement.qty').toLowerCase()}: ${line?.quantity ?? part.quantity}${part.unit ? ` ${part.unit}` : ''}` : ''}</span>
                {quote?.lineTotal && quote.currency && <p data-testid="line-total" className="tabular text-sm"><span className="text-muted">{t('procurement.line')}:</span> <strong className="font-semibold">{formatMoney(quote.lineTotal, quote.currency, i18n.language)}</strong></p>}
              </div>
              {item?.offers.length ? (
                <ul className="mt-1.5 space-y-1.5">{item.offers.map((offer) => <OfferRow key={offer.id} offer={offer} chosen={offer.id === line?.offerId} lists={lists} onSelect={select} checkPrice={adapter.checkPrice} />)}</ul>
              ) : <p className="mt-1 text-xs text-muted">{t('procurement.noOffers')}</p>}
              {Boolean(item?.similar.length) && (
                <>
                  <h5 data-testid="similar-title" className="mt-2 mb-1 text-xs font-medium text-warning">{t('procurement.similar')}</h5>
                  <ul className="space-y-1.5">{item?.similar.map((offer) => <OfferRow key={offer.id} offer={offer} chosen={offer.id === line?.offerId} lists={lists} onSelect={select} checkPrice={adapter.checkPrice} />)}</ul>
                </>
              )}
              {!line?.offerId && onlyOutOfStock(item) && <p data-testid="out-of-stock-note" className="mt-1 text-xs text-warning">{t('procurement.outOfStockNote')}</p>}
              {quote?.status === 'offer_missing' && <p data-testid="offer-missing" className="mt-1 text-xs text-warning">{t('procurement.offerMissing')}</p>}
              {quote?.matchWarning && <p data-testid="match-warning" className="mt-1 text-xs text-warning">{t('procurement.matchWarning')}</p>}
            </li>
          );
        })}
      </ul>
      {collapseEmpty && empty.length > 0 && (
        <details data-testid="offers-empty" className="rounded-panel border border-line bg-card p-3">
          <summary className="min-h-11 cursor-pointer content-center font-medium">{t('mobile.summary.noOffersGroup', { count: empty.length })}</summary>
          <ul className="mt-1 space-y-1 text-sm">
            {empty.map((part) => <li key={part.id} className="flex justify-between gap-2"><span className="font-medium break-words">{part.partNumber}</span><span className="text-muted">{part.name}</span></li>)}
          </ul>
          <p className="mt-2 text-xs text-muted">{t('mobile.summary.noOffersHint')}</p>
        </details>
      )}
    </div>
  );
}
