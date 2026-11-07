import { useRef, useState } from 'react';
import { CircleAlert, Download, FlaskConical, PackageSearch, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateBlock } from '@/components/ui/StateBlock';
import { useCodeMessage, useErrorMessage } from '@/features/system/useErrorMessage';
import { useCapabilities } from '@/features/system/useSystem';
import { formatMoney, fromMinor, toMinor } from '@/lib/money';
import type { DocumentText } from '@/services/chat/demo/textIndex';
import type { EvidenceSource } from '@/types/chat';
import type { DocumentModel } from '@/types/document';
import type { Quote } from '@/types/procurement';
import { MarkingCheck } from './MarkingCheck';
import { PartRow } from './PartRow';
import { useProcurement, useProcurementAdapter, useSheetLines } from './useProcurement';

interface Props {
  doc: DocumentModel;
  pdfText: DocumentText | undefined;
  onOpenSource: (source: EvidenceSource) => void;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function Budget({ quote, withoutQuantity }: { quote: Quote | undefined; withoutQuantity: number }) {
  const { t, i18n } = useTranslation();
  const [limit, setLimit] = useState('');
  const totals = quote?.totals ?? [];
  const single = totals.length === 1 ? totals[0] : undefined;
  const limitMinor = toMinor(limit);
  const totalMinor = single ? toMinor(single.amount) : null;
  const open = (quote?.unpriced ?? 0) + withoutQuantity;
  return (
    <section data-testid="budget" aria-labelledby="budget-title" className="rounded-panel border border-line bg-card p-3">
      <h3 id="budget-title" className="font-semibold">{t('procurement.budget.title')}</h3>
      {totals.length === 0 ? <p className="mt-1 text-sm text-muted">{t('procurement.budget.none')}</p> : (
        <ul className="mt-1 space-y-0.5">
          {totals.map((total) => <li key={total.currency} data-testid="budget-total" className="tabular text-lg font-semibold">{formatMoney(total.amount, total.currency, i18n.language)}</li>)}
        </ul>
      )}
      {totals.length > 1 && <p className="text-xs text-muted">{t('procurement.budget.separate')}</p>}
      {open > 0
        ? <p data-testid="budget-incomplete" className="mt-1 text-xs text-warning">{t('procurement.budget.incomplete', { count: open })}</p>
        : totals.length > 0 && <p className="mt-1 text-xs text-success">{t('procurement.budget.complete')}</p>}
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
  const codeMessage = useCodeMessage();
  const client = useQueryClient();
  const capabilities = useCapabilities();
  const adapter = useProcurementAdapter(doc, pdfText);
  const { lines, update } = useSheetLines(doc.id);
  const [supplier, setSupplier] = useState('');
  const [checkedAt, setCheckedAt] = useState('');
  const [testFile, setTestFile] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const priceInput = useRef<HTMLInputElement>(null);
  const { partList, parts, priceLists, offers, quote, items, withoutQuantity } = useProcurement(doc.id, adapter, lines);
  const refresh = () => client.invalidateQueries({ queryKey: ['procurement', doc.id] });

  const uploadPrices = useMutation({
    mutationFn: async (file: File) => {
      if (!adapter) throw new Error('Not ready');
      return adapter.uploadPriceList(file, { supplier: supplier.trim(), checkedAt, demo: testFile });
    },
    onSuccess: (list) => {
      setPriceError(null);
      setSkipped(list.skipped.length);
      void refresh();
    },
    onError: (error: unknown) => setPriceError(error instanceof Error && 'demoPriceListError' in error ? t('errors.codes.PRICE_LIST_INVALID') : errorMessage(error)),
  });
  const removePrices = useMutation({
    mutationFn: async (id: string) => {
      if (!adapter) throw new Error('Not ready');
      await adapter.deletePriceList(id);
    },
    onSuccess: () => void refresh(),
  });
  const exportFile = useMutation({
    mutationFn: async (format: 'csv' | 'xlsx') => {
      if (!adapter) throw new Error('Not ready');
      save(await adapter.exportQuote(items, format), `${doc.name.replace(/\.[^.]+$/, '')}-procurement${adapter.isDemo ? '-DEMO' : ''}.${format}`);
    },
  });

  const list = partList.data;
  if (!adapter || partList.isPending || list?.status === 'processing') {
    return (
      <div role="status" aria-label={t('procurement.loading')} className="mx-auto w-full max-w-3xl space-y-3 p-6">
        <p className="text-sm text-muted">{t('procurement.loading')}</p>
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (partList.isError || list?.status === 'failed') {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <StateBlock tone="danger" icon={<CircleAlert size={18} aria-hidden />} title={t('procurement.errorTitle')} description={partList.isError ? errorMessage(partList.error) : codeMessage(list?.errorCode)} actions={<Button icon={<RotateCcw size={14} aria-hidden />} onClick={() => void partList.refetch()}>{t('common.retry')}</Button>} />
      </div>
    );
  }

  const fixtures = adapter.isDemo && parts.length > 0 && parts.every((part) => part.sources.length === 0);
  const equipment = list?.equipment;
  const failure = exportFile.error ?? quote.error ?? offers.error ?? removePrices.error;

  return (
    <div data-testid="procurement-panel" className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 font-display text-lg font-semibold">{t('procurement.title')}</h2>
          <Button size="sm" data-testid="export-csv" icon={<Download size={14} aria-hidden />} disabled={items.length === 0} loading={exportFile.isPending && exportFile.variables === 'csv'} onClick={() => exportFile.mutate('csv')}>{t('procurement.export.csv')}</Button>
          {!adapter.isDemo && <Button size="sm" icon={<Download size={14} aria-hidden />} disabled={items.length === 0} loading={exportFile.isPending && exportFile.variables === 'xlsx'} onClick={() => exportFile.mutate('xlsx')}>{t('procurement.export.xlsx')}</Button>}
        </div>
        {adapter.isDemo && (
          <p data-testid="procurement-demo" role="note" className="flex gap-2 rounded-control bg-warning-tint p-2.5 text-xs text-warning">
            <FlaskConical size={14} className="mt-px shrink-0" aria-hidden />
            <span><strong className="font-semibold">{t('procurement.demoTitle')}</strong> {t('procurement.demoBody')}{fixtures ? ` ${t('procurement.demoFixtures')}` : ''}</span>
          </p>
        )}
        {equipment && (equipment.name || equipment.model) && <p data-testid="equipment" className="text-sm"><span className="text-muted">{t('procurement.equipment')}:</span> {[equipment.name, equipment.model, equipment.manufacturer].filter(Boolean).join(' · ')}</p>}
        {failure && <p role="alert" data-testid="procurement-error" className="text-sm text-danger">{errorMessage(failure)}</p>}

        <MarkingCheck adapter={adapter} parts={parts} maxImageBytes={capabilities.data?.limits.maxImageBytes ?? null} onDecided={(confirmation) => update(confirmation.partId, { confirmationId: confirmation.id })} />

        <section data-testid="price-lists" aria-labelledby="prices-title" className="rounded-panel border border-line bg-card p-3">
          <h3 id="prices-title" className="font-semibold">{t('procurement.prices.title')}</h3>
          <p className="text-xs text-muted">{t('procurement.prices.fromFile')}</p>
          {Boolean(priceLists.data?.length) && (
            <ul className="mt-1 space-y-1">
              {priceLists.data?.map((item) => (
                <li key={item.id} data-testid="price-list" className="flex items-center gap-2 rounded-lg bg-sidebar px-2 py-1 text-sm">
                  <span className="min-w-0 flex-1 truncate" title={item.fileName}>{item.supplier || item.fileName}{item.demo ? ` · ${t('procurement.demoBadge')}` : ''}</span>
                  <span className="tabular shrink-0 text-xs text-muted">{t('procurement.prices.rows', { count: item.rows })}</span>
                  <IconButton dense label={t('procurement.prices.remove', { name: item.supplier || item.fileName })} icon={<Trash2 size={14} aria-hidden />} onClick={() => removePrices.mutate(item.id)} />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 basis-40 text-xs text-muted">
              {t('procurement.prices.supplier')}
              <input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder={t('procurement.prices.supplierPlaceholder')} className="mt-0.5 h-9 w-full rounded-control border border-line bg-bg px-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent" />
            </label>
            <label className="w-40 text-xs text-muted">
              {t('procurement.prices.date')}
              <input type="date" value={checkedAt} onChange={(event) => setCheckedAt(event.target.value)} className="mt-0.5 h-9 w-full rounded-control border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-accent" />
            </label>
            <Button icon={<Upload size={14} aria-hidden />} loading={uploadPrices.isPending} onClick={() => priceInput.current?.click()}>{t('procurement.prices.upload')}</Button>
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
          <label className="mt-1 inline-flex min-h-6 items-center gap-1.5 text-xs text-muted pointer-coarse:min-h-10">
            <input type="checkbox" checked={testFile} onChange={(event) => setTestFile(event.target.checked)} className="size-4 accent-[var(--color-accent)]" />
            {t('procurement.prices.test')}
          </label>
          <p className="mt-1 text-xs text-muted">{t('procurement.prices.file')}{adapter.isDemo ? ` ${t('procurement.prices.demoFile')}` : ''}</p>
          {priceError && <p role="alert" data-testid="price-error" className="mt-1 text-sm text-danger">{priceError}</p>}
          {skipped > 0 && <p role="status" data-testid="price-skipped" className="mt-1 text-xs text-warning">{t('procurement.prices.skipped', { count: skipped })}</p>}
        </section>

        <Budget quote={items.length ? quote.data : undefined} withoutQuantity={withoutQuantity} />
        {quote.data?.warnings.map((warning) => <p key={warning} data-testid="quote-warning" className="text-xs text-warning">{warning}</p>)}

        {parts.length === 0 ? (
          <StateBlock icon={<PackageSearch size={18} aria-hidden />} title={t('procurement.emptyTitle')} description={t('procurement.emptyBody')} />
        ) : (
          <ul className="space-y-2">
            {parts.map((part) => (
              <PartRow
                key={part.id}
                part={part}
                line={lines[part.id]}
                offers={offers.data?.find((item) => item.partId === part.id)}
                quoteItem={items.some((item) => item.partId === part.id) ? quote.data?.items.find((item) => item.partId === part.id) : undefined}
                onChange={(change) => update(part.id, change)}
                onOpenSource={onOpenSource}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
