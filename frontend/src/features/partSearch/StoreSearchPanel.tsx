import { useEffect, useState } from 'react';
import { CircleAlert, ExternalLink, Hourglass, Loader2, RotateCcw, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type { Offer, SearchSource, StoreSearchResult } from '@/types/procurement';
import { OfferRow } from '@/features/procurement/OfferRow';
import { BUILD_RETRIES, type SearchState } from './useStoreSearch';
import { collapseSameSeller } from './sameSeller';

const CODE_ERRORS = new Set(['BARCODE_NOT_FOUND', 'UNSUPPORTED_IMAGE', 'IMAGE_TOO_LARGE', 'BARCODES_UNAVAILABLE', 'PARTS_NOT_READY', 'PART_NOT_FOUND']);
const REASONS = new Set(['gtin_not_in_sources', 'checksum_failed', 'domain_not_allowed', 'not_a_product_code']);

function SourceLine({ source }: { source: SearchSource }) {
  const { t } = useTranslation();
  const name = source.store === 'price_lists' ? t('partSearch.store.priceLists') : source.store;
  let text: string;
  if (source.status === 'ok') text = t('partSearch.store.found', { count: source.candidates });
  else if (source.reason === 'same_seller') text = t('partSearch.store.sameSeller', { store: source.sameSellerAs ?? '' });
  else text = t(`partSearch.store.reason.${source.reason ?? 'other'}`, { defaultValue: t('partSearch.store.reason.other') });
  return (
    <li data-testid="search-source" data-store={source.store} data-status={source.status} className="flex flex-wrap gap-x-1.5">
      <span className="font-medium break-all">{name}</span>
      <span className={cn(source.status === 'unavailable' ? 'text-warning' : 'text-muted')}>{text}</span>
    </li>
  );
}

function Countdown({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <>{Math.max(0, Math.ceil((at - now) / 1000))}</>;
}

interface Props {
  state: SearchState;
  onRetry: () => void;
  /** Offers are listed here only for a search with no document part: they cannot join the sheet. */
  showOffers: boolean;
}

/** What the store search did: per store, why not, how old the prices are. A building catalogue or a limit is said, not hidden. */
export function StoreSearchPanel({ state, onRetry, showOffers }: Props) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  if (state.status === 'idle') return null;
  const box = 'rounded-control border p-2.5 text-sm';

  if (state.status === 'loading') {
    return <p role="status" data-testid="store-search" data-status="loading" className={cn(box, 'flex items-center gap-2 border-line bg-sidebar text-muted')}><Loader2 size={14} className="shrink-0 animate-spin" aria-hidden />{t(state.attempt > 0 ? 'partSearch.store.retrying' : 'partSearch.store.loading', { attempt: state.attempt, max: BUILD_RETRIES })}</p>;
  }
  if (state.status === 'limit') {
    return (
      <p role="alert" data-testid="store-search" data-status="limit" className={cn(box, 'border-warning/40 bg-warning-tint text-warning')}>
        {state.busy ? t('partSearch.store.busy', { seconds: state.retryAfter ?? 10 }) : state.retryAfter ? t('partSearch.store.limitWait', { seconds: state.retryAfter }) : t('partSearch.store.limit')}
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <div role="alert" data-testid="store-search" data-status="error" className={cn(box, 'border-danger/40 bg-danger-tint text-danger')}>
        <p className="flex items-start gap-1.5"><CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />{state.error instanceof AppError && CODE_ERRORS.has(state.error.code) ? t(`partSearch.store.error.${state.error.code}` as never) : errorMessage(state.error)}</p>
        <Button size="sm" className="mt-2" icon={<RotateCcw size={13} aria-hidden />} onClick={onRetry}>{t('common.retry')}</Button>
      </div>
    );
  }

  const result: StoreSearchResult = state.result;
  const codes = state.status === 'done' ? state.codes : undefined;
  return (
    <div data-testid="store-search" data-status={state.status} className={cn(box, 'space-y-2 border-line bg-sidebar')}>
      {state.status === 'building' && (
        <div data-testid="store-building" className="text-warning">
          <p className="flex items-start gap-1.5"><Hourglass size={14} className="mt-0.5 shrink-0" aria-hidden />{t('partSearch.store.building')}</p>
          {state.retryAt
            ? <p className="mt-1 text-xs">{t('partSearch.store.buildingNext', { attempt: state.attempt + 1, max: BUILD_RETRIES })} <Countdown at={state.retryAt} /> {t('partSearch.store.seconds')}</p>
            : <Button size="sm" className="mt-2" data-testid="store-retry" icon={<RotateCcw size={13} aria-hidden />} onClick={onRetry}>{t('common.retry')}</Button>}
        </div>
      )}
      {codes && codes.length > 0 && (
        <p data-testid="read-codes" className="break-words [overflow-wrap:anywhere]">
          <span className="text-muted">{t('partSearch.store.codes')}</span> {codes.map((code) => `${code.format === 'text' ? '' : `${code.format} `}${code.value}${code.valid === false ? ` (${t('partSearch.store.invalid')})` : ''}`).join(', ')}
        </p>
      )}
      {result.reason && REASONS.has(result.reason) && <p data-testid="search-reason" data-reason={result.reason} className="text-warning">{t(`partSearch.store.result.${result.reason}` as never)}</p>}
      {state.status === 'done' && !result.reason && result.offers.length + result.similar.length === 0 && result.unconfirmed.length === 0 && (
        <p data-testid="store-empty" className="text-muted">{t('partSearch.store.empty', { query: result.searchedAs ?? result.query })}</p>
      )}
      {showOffers && <StoreOffers offers={result.offers} similar={result.similar} />}
      {result.unconfirmed.length > 0 && (
        <details data-testid="unconfirmed" className="text-xs">
          <summary className="min-h-8 cursor-pointer content-center font-medium text-warning pointer-coarse:min-h-10">{t('partSearch.store.unconfirmed', { count: result.unconfirmed.length })}</summary>
          <p className="text-muted">{t('partSearch.store.unconfirmedHint')}</p>
          <ul className="mt-1 space-y-1">
            {result.unconfirmed.map((page, index) => (
              <li key={`${page.store}-${index}`} data-testid="unconfirmed-page" className="break-words [overflow-wrap:anywhere]">
                <span className="font-medium">{page.store}</span> · {page.title || page.partNumber}{page.reason ? ` · ${t(`partSearch.store.unconfirmedReason.${page.reason}`, { defaultValue: page.reason })}` : ''}
                {page.url && <> · <a href={page.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">{t('procurement.open')}<ExternalLink size={10} aria-hidden /></a></>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {result.sources.length > 0 && (
        <details data-testid="search-sources" className="text-xs" open={result.sources.some((source) => source.status === 'unavailable')}>
          <summary className="min-h-8 cursor-pointer content-center text-muted pointer-coarse:min-h-10"><Store size={12} className="mr-1 inline align-[-1px]" aria-hidden />{t('partSearch.store.sources')}{result.searchedAt ? ` · ${formatDateTime(result.searchedAt, i18n.language)}` : ''}</summary>
          <ul className="mt-1 space-y-0.5">{result.sources.map((source) => <SourceLine key={source.store} source={source} />)}</ul>
        </details>
      )}
    </div>
  );
}

/** A search outside the document: shown to compare, not to choose. The sheet holds the document's parts only. */
function StoreOffers({ offers, similar }: { offers: readonly Offer[]; similar: readonly Offer[] }) {
  const { t } = useTranslation();
  const exact = collapseSameSeller(offers);
  const near = collapseSameSeller(similar);
  if (exact.length + near.length === 0) return null;
  return (
    <div data-testid="store-offers" className="space-y-2">
      <p className="text-xs text-muted">{t('partSearch.store.notInDocument')}</p>
      {exact.length > 0 && <ul className="space-y-1.5">{exact.map(({ offer, alsoAt }) => <OfferRow key={offer.id} offer={offer} alsoAt={alsoAt} chosen={false} lists={undefined} onSelect={() => {}} selectable={false} />)}</ul>}
      {near.length > 0 && (
        <div>
          <h5 className="mb-1 text-xs font-medium text-warning">{t('procurement.similar')}</h5>
          <ul className="space-y-1.5">{near.map(({ offer, alsoAt }) => <OfferRow key={offer.id} offer={offer} alsoAt={alsoAt} chosen={false} lists={undefined} onSelect={() => {}} selectable={false} />)}</ul>
        </div>
      )}
    </div>
  );
}
