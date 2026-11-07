import { useState } from 'react';
import { Download, FileText, FlaskConical } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { formatMoney, fromMinor, toMinor } from '@/lib/money';
import type { ProcurementAdapter } from '@/services/procurement/types';
import type { EvidenceSource } from '@/types/chat';
import type { Part, PartOffers, PriceList, Quote, QuoteItem, QuoteRequestItem } from '@/types/procurement';
import { ProductLink, useOfferOrigin } from './OfferRow';
import { sourcePlace } from './PartRow';
import { QuantityInput } from './QuantityInput';
import { isSheetComplete, onlyOutOfStock, type SheetLine } from './sheetLines';

/** A table needs more room than the panel has on a phone or beside the chat on a small laptop. */
const CARDS_QUERY = '(max-width: 1179px)';

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

interface Props {
  adapter: ProcurementAdapter;
  documentName: string;
  parts: readonly Part[];
  lines: Record<string, SheetLine>;
  lists: readonly PriceList[] | undefined;
  offers: readonly PartOffers[] | undefined;
  quote: Quote | undefined;
  items: readonly QuoteRequestItem[];
  withoutQuantity: number;
  onChange: (partId: string, change: Partial<SheetLine>) => void;
  onOpenSource: (source: EvidenceSource) => void;
}

function useLineStatus() {
  const { t } = useTranslation();
  return (quantity: number | null, item: QuoteItem | undefined): string | null => {
    if (quantity === null) return t('procurement.lineStatus.noQuantity');
    if (item?.status === 'offer_missing') return t('procurement.lineStatus.offerMissing');
    if (!item || item.status === 'no_price') return t('procurement.lineStatus.noOffer');
    return null;
  };
}

function Totals({ quote, withoutQuantity, excluded, usesDemo, usesSimilar }: { quote: Quote | undefined; withoutQuantity: number; excluded: number; usesDemo: boolean; usesSimilar: boolean }) {
  const { t, i18n } = useTranslation();
  const [limit, setLimit] = useState('');
  const totals = quote?.totals ?? [];
  const complete = isSheetComplete(quote, withoutQuantity);
  const open = (quote?.unpriced ?? 0) + withoutQuantity;
  const priced = totals.reduce((sum, total) => sum + total.items, 0);
  const single = totals.length === 1 ? totals[0] : undefined;
  const limitMinor = toMinor(limit);
  const totalMinor = single ? toMinor(single.amount) : null;
  return (
    <section data-testid="budget" aria-labelledby="budget-title" className="rounded-panel border border-line bg-card p-3">
      <h3 id="budget-title" data-testid="total-title" data-complete={complete || undefined} className="font-semibold">{totals.length === 0 ? t('procurement.budget.title') : complete ? t('procurement.budget.fullTotal') : t('procurement.budget.partialTotal')}</h3>
      {totals.length === 0 ? <p className="mt-1 text-sm text-muted">{t('procurement.budget.none')}</p> : (
        <ul className="mt-1 space-y-0.5">
          {totals.map((total) => <li key={total.currency} data-testid="budget-total" className="tabular font-display text-2xl font-semibold">{formatMoney(total.amount, total.currency, i18n.language)}</li>)}
        </ul>
      )}
      {totals.length > 1 && <p className="text-xs text-muted">{t('procurement.budget.separate')}</p>}
      <ul className="mt-1 space-y-0.5 text-xs">
        {totals.length > 0 && <li data-testid="budget-priced" className="text-muted">{t('procurement.budget.priced', { count: priced })}</li>}
        {open > 0 && <li data-testid="budget-incomplete" className="text-warning">{t('procurement.budget.incomplete', { count: open })}</li>}
        {excluded > 0 && <li className="text-muted">{t('procurement.budget.excluded', { count: excluded })}</li>}
        {usesDemo && <li data-testid="budget-demo" className="flex items-center gap-1 text-warning"><FlaskConical size={12} className="shrink-0" aria-hidden />{t('procurement.budget.usesDemo')}</li>}
        {usesSimilar && <li data-testid="budget-similar" className="text-warning">{t('procurement.budget.usesSimilar')}</li>}
      </ul>
      <label className="mt-2 block max-w-52 text-xs text-muted">
        {t('procurement.budget.limit')}
        <input value={limit} inputMode="decimal" data-testid="budget-limit" onChange={(event) => setLimit(event.target.value)} className="tabular mt-0.5 h-9 w-full rounded-control border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-accent" />
      </label>
      {single && limitMinor !== null && totalMinor !== null && (
        <p data-testid="budget-compare" className={totalMinor > limitMinor ? 'mt-1 text-sm text-danger' : 'mt-1 text-sm text-success'}>
          {totalMinor > limitMinor
            ? t('procurement.budget.over', { amount: formatMoney(fromMinor(totalMinor - limitMinor), single.currency, i18n.language) })
            : t('procurement.budget.within', { amount: formatMoney(fromMinor(limitMinor - totalMinor), single.currency, i18n.language) })}
        </p>
      )}
      <p className="mt-2 text-xs text-muted">{t('procurement.budget.excludes')} {t('procurement.budget.noOrder')}</p>
      {quote?.calculatedAt && <p data-testid="budget-calculated" className="mt-0.5 text-xs text-muted">{t('procurement.budget.calculated', { date: formatDate(quote.calculatedAt, i18n.language) })}</p>}
    </section>
  );
}

export function SheetStep({ adapter, documentName, parts, lines, lists, offers, quote, items, withoutQuantity, onChange, onOpenSource }: Props) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const cards = useMediaQuery(CARDS_QUERY);
  const origin = useOfferOrigin();
  const status = useLineStatus();
  const included = parts.filter((part) => lines[part.id]?.included ?? true);
  const shown = items.length ? quote : undefined;
  const itemOf = (partId: string) => shown?.items.find((item) => item.partId === partId);
  const usesDemo = Boolean(shown?.items.some((item) => item.status === 'priced' && item.offer?.demo));
  const usesSimilar = Boolean(shown?.items.some((item) => item.matchWarning));

  const exportFile = useMutation({
    mutationFn: async (format: 'csv' | 'xlsx') => {
      save(await adapter.exportQuote([...items], format), `${documentName.replace(/\.[^.]+$/, '')}-procurement${adapter.isDemo ? '-DEMO' : ''}.${format}`);
    },
  });

  const money = (amount: string | null | undefined, item: QuoteItem | undefined) => (amount && item?.currency ? formatMoney(amount, item.currency, i18n.language) : '—');
  const origins = (item: QuoteItem | undefined) => {
    if (!item?.offer) return null;
    const text = origin(item.offer, lists);
    return (
      <div className="text-xs text-muted">
        <p className="text-sm text-fg break-words [overflow-wrap:anywhere]">{item.offer.supplier}{item.offer.demo && <span className="ml-1 rounded bg-warning-tint px-1 text-[11px] font-semibold text-warning">{t('procurement.demoBadge')}</span>}</p>
        <p className="break-words [overflow-wrap:anywhere]">{[text.stock, text.source, text.date].filter(Boolean).join(' · ')}</p>
        {item.offer.url && <ProductLink url={item.offer.url} />}
        {item.matchWarning && <p className="text-warning">{t('procurement.matchWarning')}</p>}
      </div>
    );
  };
  const partCell = (part: Part) => {
    const source = part.sources[0];
    const decision = lines[part.id]?.decision;
    return (
      <>
        <p className="font-semibold break-words [overflow-wrap:anywhere]">{part.partNumber}</p>
        {part.name && <p className="text-xs text-muted break-words [overflow-wrap:anywhere]">{part.name}</p>}
        {decision && <p className={cn('text-xs font-medium', decision === 'confirmed' ? 'text-success' : 'text-danger')}>{t(`procurement.identification.${decision === 'confirmed' ? 'user_confirmed' : 'user_rejected'}`)}</p>}
        {source && (
          <button type="button" data-testid="sheet-source" onClick={() => onOpenSource(source)} className="pressable mt-0.5 inline-flex min-h-6 items-center gap-1 text-xs text-muted underline hover:text-fg pointer-coarse:min-h-10">
            <FileText size={11} className="shrink-0" aria-hidden />
            {sourcePlace(source, t as never)}
          </button>
        )}
      </>
    );
  };

  return (
    <div data-testid="sheet" className="space-y-3">
      <Totals quote={shown} withoutQuantity={withoutQuantity} excluded={parts.length - included.length} usesDemo={usesDemo} usesSimilar={usesSimilar} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" data-testid="export-csv" icon={<Download size={14} aria-hidden />} disabled={items.length === 0} loading={exportFile.isPending && exportFile.variables === 'csv'} onClick={() => exportFile.mutate('csv')}>{t('procurement.export.csv')}</Button>
        {!adapter.isDemo && <Button size="sm" data-testid="export-xlsx" icon={<Download size={14} aria-hidden />} disabled={items.length === 0} loading={exportFile.isPending && exportFile.variables === 'xlsx'} onClick={() => exportFile.mutate('xlsx')}>{t('procurement.export.xlsx')}</Button>}
        {items.length === 0 && <p className="text-xs text-muted">{t('procurement.export.needLines')}</p>}
      </div>
      {exportFile.isError && <p role="alert" data-testid="export-error" className="text-sm text-danger">{errorMessage(exportFile.error)}</p>}
      {quote?.warnings.map((warning) => <p key={warning} data-testid="quote-warning" className="text-xs text-warning">{warning}</p>)}

      {cards ? (
        <ul className="space-y-2">
          {included.map((part) => {
            const item = itemOf(part.id);
            const quantity = lines[part.id]?.quantity ?? part.quantity;
            const lineStatus = quantity !== null && !item?.offer && item?.status !== 'offer_missing' && onlyOutOfStock(offers?.find((candidate) => candidate.partId === part.id)) ? t('procurement.lineStatus.outOfStock') : status(quantity, item);
            return (
              <li key={part.id} data-testid="sheet-row" data-part={part.id} data-status={item?.status ?? 'no_quantity'} className="rounded-panel border border-line bg-card p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">{partCell(part)}</div>
                  <QuantityInput part={part} line={lines[part.id]} onChange={(change) => onChange(part.id, change)} />
                </div>
                <dl className="tabular mt-2 grid grid-cols-2 gap-x-3 text-sm">
                  <div><dt className="text-xs text-muted">{t('procurement.sheet.unitPrice')}</dt><dd>{money(item?.unitPrice, item)}</dd></div>
                  <div><dt className="text-xs text-muted">{t('procurement.sheet.lineTotal')}</dt><dd data-testid="sheet-line-total" className="font-semibold">{money(item?.lineTotal, item)}</dd></div>
                </dl>
                {lineStatus && <p data-testid="sheet-line-status" className="mt-1 text-xs text-warning">{lineStatus}</p>}
                <div className="mt-1">{origins(item)}</div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-card">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <caption className="sr-only">{t('procurement.title')}</caption>
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="p-2 font-medium">{t('procurement.sheet.part')}</th>
                <th scope="col" className="p-2 font-medium">{t('procurement.qty')}</th>
                <th scope="col" className="p-2 text-right font-medium">{t('procurement.sheet.unitPrice')}</th>
                <th scope="col" className="p-2 text-right font-medium">{t('procurement.sheet.lineTotal')}</th>
                <th scope="col" className="p-2 font-medium">{t('procurement.sheet.supplier')}</th>
              </tr>
            </thead>
            <tbody>
              {included.map((part) => {
                const item = itemOf(part.id);
                const quantity = lines[part.id]?.quantity ?? part.quantity;
                const lineStatus = quantity !== null && !item?.offer && item?.status !== 'offer_missing' && onlyOutOfStock(offers?.find((candidate) => candidate.partId === part.id)) ? t('procurement.lineStatus.outOfStock') : status(quantity, item);
                return (
                  <tr key={part.id} data-testid="sheet-row" data-part={part.id} data-status={item?.status ?? 'no_quantity'} className="border-b border-line align-top last:border-b-0">
                    <td className="p-2">{partCell(part)}</td>
                    <td className="p-2"><QuantityInput part={part} line={lines[part.id]} showLabel={false} onChange={(change) => onChange(part.id, change)} /></td>
                    <td className="tabular p-2 text-right whitespace-nowrap">{money(item?.unitPrice, item)}</td>
                    <td data-testid="sheet-line-total" className="tabular p-2 text-right font-semibold whitespace-nowrap">{money(item?.lineTotal, item)}</td>
                    <td className="p-2">{lineStatus ? <p data-testid="sheet-line-status" className="text-xs text-warning">{lineStatus}</p> : origins(item)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
