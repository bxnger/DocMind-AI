import { useRef, useState } from 'react';
import { FlaskConical, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { useErrorMessage } from '@/features/system/useErrorMessage';
import { DEMO_PRICE_LIST, VERIFIED_PRICE_LIST, fetchDemoFile } from '@/services/industryDemo';
import type { ProcurementAdapter } from '@/services/procurement/types';
import type { PriceList } from '@/types/procurement';

type PriceListApi = Pick<ProcurementAdapter, 'uploadPriceList' | 'deletePriceList' | 'isDemo'>;

interface Props {
  api: PriceListApi | null;
  lists: readonly PriceList[] | undefined;
  /** The prepared files, for the demonstration document only. */
  showExamples?: boolean;
}

export function PriceListsCard({ api, lists, showExamples = false }: Props) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [supplier, setSupplier] = useState('');
  const [checkedAt, setCheckedAt] = useState('');
  const [testFile, setTestFile] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const refresh = () => client.invalidateQueries({ queryKey: ['procurement'] });

  const upload = useMutation({
    mutationFn: async (values: { file: File; supplier: string; checkedAt: string; demo: boolean }) => {
      if (!api) throw new Error('Not ready');
      return api.uploadPriceList(values.file, values);
    },
    onSuccess: (list) => {
      setProblem(null);
      setSkipped(list.skipped.length);
      void refresh();
    },
    onError: (error: unknown) => setProblem(error instanceof Error && 'demoPriceListError' in error ? t('errors.codes.PRICE_LIST_INVALID') : errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!api) throw new Error('Not ready');
      await api.deletePriceList(id);
    },
    onSuccess: () => void refresh(),
    onError: (error: unknown) => setProblem(errorMessage(error)),
  });
  const addExample = async (example: { url: string; name: string }, demo: boolean) => {
    setProblem(null);
    try {
      const file = await fetchDemoFile(example.url, example.name, 'text/csv');
      upload.mutate({ file, supplier: demo ? t('procurement.prices.demoSupplier') : '', checkedAt: '', demo });
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };
  const has = (name: string) => lists?.some((list) => list.fileName === name) ?? false;

  return (
    <section data-testid="price-lists" aria-labelledby="prices-title" className="rounded-panel border border-line bg-card p-3">
      <h3 id="prices-title" className="font-semibold">{t('procurement.prices.title')}</h3>
      <p className="text-xs text-muted">{t('procurement.prices.fromFile')}</p>
      {Boolean(lists?.length) && (
        <ul className="mt-1 space-y-1">
          {lists?.map((item) => (
            <li key={item.id} data-testid="price-list" className="flex items-center gap-2 rounded-lg bg-sidebar px-2 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate" title={item.fileName}>{item.supplier || item.fileName}{item.demo ? ` · ${t('procurement.demoBadge')}` : ''}</span>
              <span className="tabular shrink-0 text-xs text-muted">{t('procurement.prices.rows', { count: item.rows })}</span>
              <IconButton dense label={t('procurement.prices.remove', { name: item.supplier || item.fileName })} icon={<Trash2 size={14} aria-hidden />} onClick={() => remove.mutate(item.id)} />
            </li>
          ))}
        </ul>
      )}
      {showExamples && (
        <div data-testid="price-examples" className="mt-2 rounded-control border border-line bg-sidebar p-2">
          <p className="text-xs font-medium">{t('procurement.prices.examplesTitle')}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="sm" data-testid="add-verified-prices" icon={<ShieldCheck size={14} aria-hidden />} disabled={upload.isPending || has(VERIFIED_PRICE_LIST.name)} onClick={() => void addExample(VERIFIED_PRICE_LIST, false)}>{t('procurement.prices.addVerified')}</Button>
            <Button size="sm" data-testid="add-demo-prices" icon={<FlaskConical size={14} aria-hidden />} disabled={upload.isPending || has(DEMO_PRICE_LIST.name)} onClick={() => void addExample(DEMO_PRICE_LIST, true)}>{t('procurement.prices.addDemo')}</Button>
          </div>
          <p className="mt-1 text-xs text-muted">{t('procurement.prices.examplesBody')}</p>
        </div>
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
        <Button icon={<Upload size={14} aria-hidden />} loading={upload.isPending} disabled={!api} onClick={() => input.current?.click()}>{t('procurement.prices.upload')}</Button>
        <input
          ref={input}
          type="file"
          hidden
          data-testid="price-file"
          accept={api?.isDemo ? '.csv' : '.csv,.xlsx'}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) upload.mutate({ file, supplier: supplier.trim(), checkedAt, demo: testFile });
          }}
        />
      </div>
      <label className="mt-1 inline-flex min-h-6 items-center gap-1.5 text-xs text-muted pointer-coarse:min-h-10">
        <input type="checkbox" checked={testFile} onChange={(event) => setTestFile(event.target.checked)} className="size-4 accent-[var(--color-accent)]" />
        {t('procurement.prices.test')}
      </label>
      <p className="mt-1 text-xs text-muted">{t('procurement.prices.file')}{api?.isDemo ? ` ${t('procurement.prices.demoFile')}` : ''}</p>
      {problem && <p role="alert" data-testid="price-error" className="mt-1 text-sm text-danger">{problem}</p>}
      {skipped > 0 && <p role="status" data-testid="price-skipped" className="mt-1 text-xs text-warning">{t('procurement.prices.skipped', { count: skipped })}</p>}
    </section>
  );
}
