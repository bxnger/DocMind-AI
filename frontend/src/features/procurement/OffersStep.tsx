import { useState } from 'react';
import { FilterX, Globe, ListChecks, Loader2, PackageSearch, Plus, Store, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { StateBlock } from '@/components/ui/StateBlock';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { readStored, writeStored } from '@/lib/storage';
import { looksLikeCode } from '@/features/partSearch/codes';
import { findParts, NO_FILTER, OFFER_SORTS, orderOffers, type OfferFilter, type OfferSort, type PartHit } from '@/features/partSearch/offerOrder';
import { PartSearch } from '@/features/partSearch/PartSearch';
import { collapseSameSeller } from '@/features/partSearch/sameSeller';
import { StoreSearchPanel } from '@/features/partSearch/StoreSearchPanel';
import { useStoreSearch } from '@/features/partSearch/useStoreSearch';
import type { ProcurementAdapter } from '@/services/procurement/types';
import type { Offer, Part, PartOffers, PriceList, QuoteItem } from '@/types/procurement';
import { OfferRow } from './OfferRow';
import { PriceListsCard } from './PriceListsCard';
import { QuantityInput } from './QuantityInput';
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
  query: string;
  onQuery: (query: string) => void;
  onOpenCamera: () => void;
  /** Offers are being fetched: "no offers" would be a guess. */
  offersLoading?: boolean;
  /** Offers could not be fetched: the error is shown above, and no card claims there are none. */
  offersFailed?: boolean;
  documentId: string;
  /** The server searches stores (`features.storeSearch`), live adapter only. */
  storeSearch?: boolean;
  /** The server reads codes from photos (`features.barcodes`). Text codes work whenever procurement is live. */
  serverBarcodes?: boolean;
  onChange: (partId: string, change: Partial<SheetLine>) => void;
  onChangeMany: (changes: Record<string, Partial<SheetLine>>) => void;
}

const VIEW_KEY = 'docmind.chat.procurement.offerView';

function useOfferView() {
  const [view, setView] = useState<{ sort: OfferSort; filter: OfferFilter }>(() => {
    const stored = readStored<{ sort?: unknown; filter?: Partial<OfferFilter> }>('session', VIEW_KEY, {});
    return { sort: OFFER_SORTS.find((sort) => sort === stored.sort) ?? 'exactFirst', filter: { exactOnly: stored.filter?.exactOnly === true, pricedOnly: stored.filter?.pricedOnly === true } };
  });
  const change = (next: Partial<{ sort: OfferSort; filter: OfferFilter }>) => {
    setView((current) => {
      const merged = { ...current, ...next };
      writeStored('session', VIEW_KEY, merged);
      return merged;
    });
  };
  return [view, change] as const;
}

function Toggle({ pressed, onClick, children, testId }: { pressed: boolean; onClick: () => void; children: string; testId: string }) {
  return (
    <button type="button" aria-pressed={pressed} data-testid={testId} onClick={onClick} className={cn('pressable inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium pointer-coarse:min-h-10', pressed ? 'border-accent-line bg-accent-tint text-accent-strong' : 'border-line text-muted hover:text-fg')}>
      {children}
    </button>
  );
}

export function OffersStep({ adapter, parts, lines, lists, offers, quoteItems, showExamples, onChange, onChangeMany, collapseEmpty = false, query, onQuery, onOpenCamera, offersLoading = false, offersFailed = false, documentId, storeSearch = false, serverBarcodes = false }: Props) {
  const { t, i18n } = useTranslation();
  const [{ sort, filter }, setView] = useOfferView();
  const store = useStoreSearch();
  const [target, setTarget] = useState<string | null>(null);
  const live = !adapter.isDemo;
  const searchPart = (part: Part) => {
    setTarget(part.id);
    void store.search({ documentId, partId: part.id });
  };
  const submit = (value: string) => {
    if (!storeSearch || !live) return;
    const exactPart = findParts(parts, value).find((hit) => hit.match === 'exact');
    if (exactPart) return searchPart(exactPart.part);
    setTarget('free');
    void store.search({ query: value, kind: looksLikeCode(value) ? 'partNumber' : 'name' });
  };
  const serverCode = (text: string) => {
    setTarget('free');
    void store.barcode({ text });
  };
  const serverPhoto = (file: File) => {
    setTarget('free');
    void store.barcode({ image: file });
  };
  const searching = query.trim().length > 0;
  const hits = findParts(parts, query);
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
  const anyOffers = withOffers > 0;
  const filtered = filter.exactOnly || filter.pricedOnly;

  // With store search, a part without offers is exactly the one to search for: it is not folded away.
  const fold = collapseEmpty && !(storeSearch && live);
  const shown: PartHit[] = searching ? hits : (fold ? withChoices : included).map((part) => ({ part, match: 'exact' }));

  const renderOffers = (list: readonly Offer[], part: Part, line: SheetLine | undefined) => (
    <ul className="space-y-1.5">
      {collapseSameSeller(list).map(({ offer, alsoAt }) => <OfferRow key={offer.id} offer={offer} alsoAt={alsoAt} unit={part.unit} chosen={offer.id === line?.offerId} lists={lists} onSelect={(offerId) => onChange(part.id, { offerId, included: true })} checkPrice={adapter.checkPrice} />)}
    </ul>
  );

  return (
    <div className="space-y-3">
      <PartSearch query={query} onQuery={onQuery} resultCount={hits.length} canReadPhotos={adapter.canReadPhotos} onPhoto={onOpenCamera} onSubmit={submit} {...(live ? { onServerCode: serverCode } : {})} {...(live && serverBarcodes ? { onPhotoNotRead: serverPhoto } : {})} />
      {target === 'free' && <StoreSearchPanel state={store.state} onRetry={store.retry} showOffers />}
      <PriceListsCard api={adapter} lists={lists} showExamples={showExamples} />
      <div className="flex flex-wrap items-center gap-2">
        <p data-testid="offers-coverage" className="min-w-0 flex-1 basis-48 text-sm text-muted">{t('procurement.offersCoverage', { found: withOffers, total: parts.length })}</p>
        <Button size="sm" data-testid="choose-exact" icon={<ListChecks size={14} aria-hidden />} disabled={canPick === 0} onClick={() => onChangeMany(Object.fromEntries(Object.entries(exact).map(([partId, offerId]) => [partId, { offerId }])))}>
          {t('procurement.chooseExact', { count: canPick })}
        </Button>
      </div>
      {anyOffers && (
        <div data-testid="offer-controls" className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-muted">
            {t('partSearch.sort.label')}
            <select data-testid="offer-sort" value={sort} onChange={(event) => setView({ sort: OFFER_SORTS.find((value) => value === event.target.value) ?? 'exactFirst' })} className="h-8 rounded-control border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-accent pointer-coarse:h-10">
              {OFFER_SORTS.map((value) => <option key={value} value={value}>{t(`partSearch.sort.${value}`)}</option>)}
            </select>
          </label>
          <Toggle testId="filter-exact" pressed={filter.exactOnly} onClick={() => setView({ filter: { ...filter, exactOnly: !filter.exactOnly } })}>{t('partSearch.filter.exactOnly')}</Toggle>
          <Toggle testId="filter-priced" pressed={filter.pricedOnly} onClick={() => setView({ filter: { ...filter, pricedOnly: !filter.pricedOnly } })}>{t('partSearch.filter.pricedOnly')}</Toggle>
          {filtered && <Button size="sm" variant="ghost" icon={<FilterX size={13} aria-hidden />} onClick={() => setView({ filter: NO_FILTER })}>{t('partSearch.filter.reset')}</Button>}
        </div>
      )}
      {!lists?.length && <StateBlock icon={<Store size={18} aria-hidden />} title={t('procurement.noListsTitle')} description={t('procurement.noListsBody')} />}
      {searching && hits.length === 0 && (
        <div data-testid="search-empty">
          <StateBlock
            icon={<PackageSearch size={18} aria-hidden />}
            title={t('partSearch.empty.title', { query: query.trim() })}
            description={t('partSearch.empty.body')}
            actions={adapter.canReadPhotos && looksLikeCode(query) ? <Button size="sm" onClick={onOpenCamera}>{t('partSearch.photo')}</Button> : undefined}
          />
        </div>
      )}
      <ul className="space-y-2">
        {shown.map(({ part, match }) => {
          const item = offers?.find((candidate) => candidate.partId === part.id);
          const line = lines[part.id];
          const isIncluded = line?.included ?? true;
          const quote = quoteItems?.find((candidate) => candidate.partId === part.id);
          const ordered = orderOffers(item, sort, filter);
          const total = (item?.offers.length ?? 0) + (item?.similar.length ?? 0);
          const visible = ordered.exact.length + ordered.similar.length + ordered.merged.length;
          return (
            <li key={part.id} data-testid="part-offers" data-part={part.id} data-search-match={searching ? match : undefined} className={cn('rounded-panel border border-line bg-card p-3', !isIncluded && 'opacity-75')}>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-40">
                  {searching && <SearchMatch match={match} query={query} partNumber={part.partNumber} />}
                  <h4 className="font-semibold break-words [overflow-wrap:anywhere]">{part.partNumber}</h4>
                  <p className="text-xs text-muted break-words [overflow-wrap:anywhere]">{part.name}</p>
                </div>
                {isIncluded && <QuantityInput part={part} line={line} onChange={(change) => onChange(part.id, change)} />}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {isIncluded && quote?.lineTotal && quote.currency && <p data-testid="line-total" className="tabular text-sm"><span className="text-muted">{t('procurement.line')}:</span> <strong className="font-semibold">{formatMoney(quote.lineTotal, quote.currency, i18n.language)}</strong></p>}
                <span className="ml-auto">
                  {isIncluded
                    ? <Button size="sm" variant="ghost" data-testid="line-remove" className="pointer-coarse:h-10" icon={<Trash2 size={13} aria-hidden />} onClick={() => onChange(part.id, { included: false, offerId: null })}>{t('partSearch.remove')}</Button>
                    : <Button size="sm" data-testid="line-add" className="pointer-coarse:h-10" icon={<Plus size={13} aria-hidden />} onClick={() => onChange(part.id, { included: true })}>{t('partSearch.add')}</Button>}
                </span>
              </div>
              {!isIncluded && <p className="mt-1 text-xs text-muted">{t('partSearch.notInSheet')}</p>}
              {storeSearch && live && (
                <div className="mt-2 space-y-2">
                  <Button size="sm" data-testid="store-search-part" icon={<Globe size={13} aria-hidden />} loading={target === part.id && store.state.status === 'loading'} onClick={() => searchPart(part)}>{t('partSearch.store.searchPart')}</Button>
                  {target === part.id && <StoreSearchPanel state={store.state} onRetry={store.retry} showOffers={false} />}
                </div>
              )}
              <div className="mt-2 space-y-2">
                {!item && offersLoading && <p data-testid="offers-loading" role="status" className="inline-flex items-center gap-1.5 text-xs text-muted"><Loader2 size={12} className="animate-spin" aria-hidden />{t('partSearch.loadingOffers')}</p>}
                {!item && offersFailed && !offersLoading && <p data-testid="offers-failed" className="text-xs text-warning">{t('partSearch.offersFailed')}</p>}
                {total === 0 && (item || (!offersLoading && !offersFailed)) && <p className="text-xs text-muted">{t('procurement.noOffers')}</p>}
                {total > 0 && visible === 0 && <p data-testid="offers-filtered-out" className="text-xs text-muted">{t('partSearch.filter.none')}</p>}
                {ordered.exact.length > 0 && renderOffers(ordered.exact, part, line)}
                {ordered.similar.length > 0 && (
                  <div>
                    <h5 data-testid="similar-title" className="mb-1 text-xs font-medium text-warning">{t('procurement.similar')}</h5>
                    {renderOffers(ordered.similar, part, line)}
                  </div>
                )}
                {ordered.merged.length > 0 && renderOffers(ordered.merged, part, line)}
              </div>
              {!line?.offerId && onlyOutOfStock(item) && <p data-testid="out-of-stock-note" className="mt-1 text-xs text-warning">{t('procurement.outOfStockNote')}</p>}
              {quote?.status === 'offer_missing' && <p data-testid="offer-missing" className="mt-1 text-xs text-warning">{t('procurement.offerMissing')}</p>}
              {quote?.matchWarning && <p data-testid="match-warning" className="mt-1 text-xs text-warning">{t('procurement.matchWarning')}</p>}
            </li>
          );
        })}
      </ul>
      {!searching && fold && empty.length > 0 && (
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

/** Why this part is in the results. A near number says plainly that it is another designation. */
function SearchMatch({ match, query, partNumber }: { match: PartHit['match']; query: string; partNumber: string }) {
  const { t } = useTranslation();
  if (match === 'exact') return <p data-testid="search-match" className="mb-0.5 text-[11px] font-semibold text-success">{t('partSearch.hit.exact')}</p>;
  if (match === 'name') return <p data-testid="search-match" className="mb-0.5 text-[11px] font-medium text-muted">{t('partSearch.hit.name')}</p>;
  return <p data-testid="search-match" className="mb-0.5 text-[11px] font-semibold break-words text-warning">{t('partSearch.hit.close', { query: query.trim(), part: partNumber })}</p>;
}
