import { useRef, useState } from 'react';
import { CircleAlert, Download, FlaskConical, PackageSearch, RotateCcw, Upload } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { formatMoney, fromMinor, toMinor } from '@/lib/money';
import type { DocumentText } from '@/services/chat/demo/textIndex';
import type { EvidenceSource } from '@/types/chat';
import type { DocumentModel } from '@/types/document';
import type { Part, Sheet } from '@/types/procurement';
import { MarkingCheck } from './MarkingCheck';
import { PartRow } from './PartRow';
import { useProcurement, useProcurementAdapter } from './useProcurement';

interface Props {
  doc: DocumentModel;
  pdfText: DocumentText | undefined;
  onOpenSource: (source: EvidenceSource) => void;
}

export function partSource(part: Part, doc: DocumentModel): EvidenceSource {
  return {
    index: 1,
    documentId: doc.id,
    documentName: doc.name,
    page: part.page,
    location: part.location,
    quote: part.quote ?? '',
    ...(part.highlights.length ? { highlights: part.highlights } : {}),
    ...(part.paragraph === null ? {} : { paragraph: part.paragraph }),
  };
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function Budget({ sheet }: { sheet: Sheet | undefined }) {
  const { t, i18n } = useTranslation();
  const [limit, setLimit] = useState('');
  const totals = sheet?.totals ?? [];
  const single = totals.length === 1 ? totals[0] : undefined;
  const limitMinor = toMinor(limit);
  const totalMinor = single ? toMinor(single.amount) : null;
  return (
    <section data-testid="budget" aria-labelledby="budget-title" className="rounded-panel border border-line bg-card p-3">
      <h3 id="budget-title" className="font-semibold">{t('procurement.budget.title')}</h3>
      {totals.length === 0 ? <p className="mt-1 text-sm text-muted">{t('procurement.budget.none')}</p> : (
        <ul className="mt-1 space-y-0.5">
          {totals.map((total) => <li key={total.currency} data-testid="budget-total" className="tabular text-lg font-semibold">{formatMoney(total.amount, total.currency, i18n.language)}</li>)}
        </ul>
      )}
      {totals.length > 1 && <p className="text-xs text-muted">{t('procurement.budget.separate')}</p>}
      {sheet && (sheet.complete
        ? totals.length > 0 && <p className="mt-1 text-xs text-success">{t('procurement.budget.complete')}</p>
        : <p data-testid="budget-incomplete" className="mt-1 text-xs text-warning">{t('procurement.budget.incomplete', { count: sheet.unpricedParts })}</p>)}
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
      <p className="mt-2 text-xs text-muted">{t('procurement.budget.noOrder')}</p>
    </section>
  );
}

export function ProcurementPanel({ doc, pdfText, onOpenSource }: Props) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const adapter = useProcurementAdapter(doc, pdfText);
  const [priceListId, setPriceListId] = useState<string | null>(null);
  const [supplier, setSupplier] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const priceInput = useRef<HTMLInputElement>(null);
  const { parts, sheet, priceLists, updatePart, selectOffer, refresh } = useProcurement(doc.id, adapter, priceListId);

  const uploadPrices = useMutation({
    mutationFn: async (file: File) => {
      if (!adapter) throw new Error('Not ready');
      return adapter.uploadPriceList(file, supplier.trim());
    },
    onSuccess: (list) => {
      setPriceError(null);
      setSkipped(list.skippedRows.length);
      setPriceListId(list.id);
      void refresh();
    },
    onError: (error: unknown) => setPriceError(error instanceof Error && 'demoPriceListError' in error ? t('procurement.prices.invalid') : errorMessage(error)),
  });
  const exportFile = useMutation({
    mutationFn: async (format: 'csv' | 'xlsx') => {
      if (!adapter) throw new Error('Not ready');
      save(await adapter.exportSheet(priceListId, format), `${doc.name.replace(/\.[^.]+$/, '')}-procurement${adapter.isDemo ? '-DEMO' : ''}.${format}`);
    },
  });

  if (!adapter || parts.isPending) {
    return (
      <div role="status" aria-label={t('procurement.loading')} className="mx-auto w-full max-w-3xl space-y-3 p-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (parts.isError) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <StateBlock tone="danger" icon={<CircleAlert size={18} aria-hidden />} title={t('procurement.errorTitle')} description={errorMessage(parts.error)} actions={<Button icon={<RotateCcw size={14} aria-hidden />} onClick={() => void parts.refetch()}>{t('common.retry')}</Button>} />
      </div>
    );
  }

  const items = parts.data;
  const fixtures = adapter.isDemo && items.length > 0 && items.every((part) => part.quote === null);

  return (
    <div data-testid="procurement-panel" className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 font-display text-lg font-semibold">{t('procurement.title')}</h2>
          <Button size="sm" data-testid="export-csv" icon={<Download size={14} aria-hidden />} loading={exportFile.isPending && exportFile.variables === 'csv'} onClick={() => exportFile.mutate('csv')}>{t('procurement.export.csv')}</Button>
          {!adapter.isDemo && <Button size="sm" icon={<Download size={14} aria-hidden />} loading={exportFile.isPending && exportFile.variables === 'xlsx'} onClick={() => exportFile.mutate('xlsx')}>{t('procurement.export.xlsx')}</Button>}
        </div>
        {adapter.isDemo && (
          <p data-testid="procurement-demo" role="note" className="flex gap-2 rounded-control bg-warning-tint p-2.5 text-xs text-warning">
            <FlaskConical size={14} className="mt-px shrink-0" aria-hidden />
            <span><strong className="font-semibold">{t('procurement.demoTitle')}</strong> {t('procurement.demoBody')}{fixtures ? ` ${t('procurement.demoFixtures')}` : ''}</span>
          </p>
        )}
        {(exportFile.isError || updatePart.isError || selectOffer.isError) && <p role="alert" data-testid="procurement-error" className="text-sm text-danger">{errorMessage(exportFile.error ?? updatePart.error ?? selectOffer.error)}</p>}

        <MarkingCheck adapter={adapter} parts={items} onChecked={() => void refresh()} />

        <section data-testid="price-lists" aria-labelledby="prices-title" className="rounded-panel border border-line bg-card p-3">
          <h3 id="prices-title" className="font-semibold">{t('procurement.prices.title')}</h3>
          <div className="mt-1 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 basis-44 text-xs text-muted">
              {t('procurement.prices.select')}
              <select value={priceListId ?? ''} data-testid="price-select" onChange={(event) => setPriceListId(event.target.value || null)} className="mt-0.5 h-9 w-full rounded-control border border-line bg-bg px-2 text-sm text-fg">
                {adapter.isDemo && <option value="">{t('procurement.prices.builtIn')}</option>}
                {!adapter.isDemo && !priceListId && <option value="">—</option>}
                {priceLists.data?.map((list) => <option key={list.id} value={list.id}>{list.supplier || list.fileName}</option>)}
              </select>
            </label>
            <label className="min-w-0 flex-1 basis-36 text-xs text-muted">
              {t('procurement.prices.supplier')}
              <input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder={t('procurement.prices.supplierPlaceholder')} className="mt-0.5 h-9 w-full rounded-control border border-line bg-bg px-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent" />
            </label>
            <Button icon={<Upload size={14} aria-hidden />} loading={uploadPrices.isPending} disabled={!supplier.trim()} onClick={() => priceInput.current?.click()}>{t('procurement.prices.upload')}</Button>
            <input
              ref={priceInput}
              type="file"
              hidden
              data-testid="price-file"
              accept={adapter.isDemo ? '.csv' : '.csv,.xlsx'}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) uploadPrices.mutate(file);
              }}
            />
          </div>
          <p className="mt-1 text-xs text-muted">{t('procurement.prices.file', { columns: 'sku, price, currency, checked_at' })}{adapter.isDemo ? ` ${t('procurement.prices.demoFile')}` : ''}</p>
          {priceError && <p role="alert" data-testid="price-error" className="mt-1 text-sm text-danger">{priceError}</p>}
          {skipped > 0 && <p role="status" className="mt-1 text-xs text-warning">{t('procurement.prices.skipped', { count: skipped })}</p>}
        </section>

        <Budget sheet={sheet.data} />

        {items.length === 0 ? (
          <StateBlock icon={<PackageSearch size={18} aria-hidden />} title={t('procurement.emptyTitle')} description={t('procurement.emptyBody')} />
        ) : (
          <ul className="space-y-2">
            {items.map((part) => (
              <PartRow
                key={part.id}
                part={part}
                item={sheet.data?.items.find((item) => item.partId === part.id)}
                demo={adapter.isDemo && priceListId === null}
                onPatch={(patch) => updatePart.mutate({ id: part.id, patch })}
                onSelect={(offerId) => selectOffer.mutate({ partId: part.id, offerId })}
                onOpenSource={() => onOpenSource(partSource(part, doc))}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
