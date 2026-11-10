import { useCallback, useState, type FormEvent } from 'react';
import { Camera, History, ScanBarcode, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { readStored, writeStored } from '@/lib/storage';
import { BarcodeScanner } from './BarcodeScanner';
import { codeKey, isStoreUrl, type ScanReading } from './codes';

/** Under the "docmind.chat." prefix, so starting over and a new guest session clear it with the rest. */
const RECENT_KEY = 'docmind.chat.partSearch.recent';
const RECENT_MAX = 6;
const FORMAT_NAMES = { ean_13: 'EAN-13', ean_8: 'EAN-8', upc_a: 'UPC-A' } as const;

function useRecent() {
  const [recent, setRecent] = useState<string[]>(() => readStored<string[]>('session', RECENT_KEY, []).filter((item) => typeof item === 'string'));
  const remember = useCallback((query: string) => {
    const value = query.trim();
    if (!value) return;
    setRecent((current) => {
      const next = [value, ...current.filter((item) => codeKey(item) !== codeKey(value) || !codeKey(value))].slice(0, RECENT_MAX);
      writeStored('session', RECENT_KEY, next);
      return next;
    });
  }, []);
  const clear = () => {
    setRecent([]);
    writeStored('session', RECENT_KEY, []);
  };
  return { recent, remember, clear };
}

interface Props {
  query: string;
  onQuery: (query: string) => void;
  /** Parts of this document that answer the query. */
  resultCount: number;
  canReadPhotos: boolean;
  onPhoto: () => void;
  /** Enter, a recent search or a scanned part number: the parent may also search the stores. */
  onSubmit?: (query: string) => void;
  /** When the server can look codes up, every code the phone read goes there as text, and only as text. */
  onServerCode?: (text: string) => void;
  /** A photo the phone could not read, sent only when the person presses the button. */
  onPhotoNotRead?: (file: File) => void;
}

/**
 * Search inside this document's parts and the offers from the uploaded price lists. The server has no catalogue search
 * or barcode lookup yet, so a code that is not here is reported as not found here, never as not existing.
 */
export function PartSearch({ query, onQuery, resultCount, canReadPhotos, onPhoto, onSubmit, onServerCode, onPhotoNotRead }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(query);
  // The sheet can ask for a part ("replace the offer"): the field follows a query set from outside.
  const [seen, setSeen] = useState(query);
  if (query !== seen) {
    setSeen(query);
    setDraft(query);
  }
  const [scanning, setScanning] = useState(false);
  const [reading, setReading] = useState<ScanReading | null>(null);
  const { recent, remember, clear } = useRecent();

  const run = useCallback((value: string, fromScan: ScanReading | null = null) => {
    setDraft(value);
    onQuery(value);
    setReading(fromScan);
    remember(value);
    if (value.trim()) onSubmit?.(value.trim());
  }, [onQuery, onSubmit, remember]);

  const onReading = useCallback((next: ScanReading) => {
    setScanning(false);
    // What goes to the server: a valid product code, a part number, or a link to a supported store. A misread code,
    // free text and links to other sites stay here, shown as they are, and nothing is opened.
    const send = onServerCode && (
      next.kind === 'product' || (next.kind === 'text' && next.codeLike) || (next.kind === 'url' && isStoreUrl(next.url))
    );
    if (!send) {
      if (next.kind === 'product') run(next.code, next);
      else if (next.kind === 'text' && next.codeLike) run(next.text, next);
      else setReading(next);
      return;
    }
    const text = next.kind === 'product' ? next.code : next.kind === 'url' ? next.url : next.text;
    if (next.kind !== 'url') {
      setDraft(text);
      onQuery(text);
      remember(text);
    }
    setReading(null);
    onServerCode(text);
  }, [onQuery, onServerCode, remember, run]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    run(draft.trim());
  };
  const type = (value: string) => {
    setDraft(value);
    setReading(null);
    onQuery(value);
  };

  return (
    <section data-testid="part-search" aria-labelledby="part-search-title" className="rounded-panel border border-line bg-card p-3">
      <h3 id="part-search-title" className="font-semibold">{t('partSearch.title')}</h3>
      <p className="text-xs text-muted">{t('partSearch.scope')}</p>
      <form role="search" onSubmit={submit} className="mt-2 flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t('partSearch.placeholder')}</span>
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="text"
            data-testid="part-search-input"
            value={draft}
            onChange={(event) => type(event.target.value)}
            onBlur={() => draft.trim() && remember(draft)}
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={t('partSearch.placeholder')}
            className="h-11 w-full rounded-control border border-line bg-bg pr-9 pl-9 text-base outline-none placeholder:text-muted focus:border-accent sm:text-sm"
          />
          {draft && (
            <button type="button" data-testid="part-search-clear" onClick={() => type('')} aria-label={t('partSearch.clear')} className="pressable absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:text-fg">
              <X size={15} aria-hidden />
            </button>
          )}
        </label>
        <Button data-testid="part-search-scan" className="h-11 px-3" icon={<ScanBarcode size={17} aria-hidden />} onClick={() => setScanning(true)} aria-label={t('partSearch.scan')}>
          <span className="hidden sm:inline">{t('partSearch.scan')}</span>
        </Button>
        {canReadPhotos && (
          <Button data-testid="part-search-photo" className="h-11 px-3" icon={<Camera size={17} aria-hidden />} onClick={onPhoto} aria-label={t('partSearch.photo')}>
            <span className="hidden sm:inline">{t('partSearch.photo')}</span>
          </Button>
        )}
      </form>

      {recent.length > 0 && !query && (
        <div data-testid="part-search-recent" className="mt-2 flex flex-wrap items-center gap-1.5">
          <History size={13} className="text-muted" aria-hidden />
          <span className="sr-only">{t('partSearch.recent')}</span>
          {recent.map((item) => (
            <button key={item} type="button" onClick={() => run(item)} className="pressable inline-flex min-h-8 max-w-[14rem] items-center truncate rounded-full border border-line px-2.5 text-xs hover:border-line-strong pointer-coarse:min-h-10">
              {item}
            </button>
          ))}
          <button type="button" onClick={clear} className="pressable min-h-8 px-1 text-xs text-muted underline hover:text-fg pointer-coarse:min-h-10">{t('partSearch.clearRecent')}</button>
        </div>
      )}

      {reading && <ScanNotice reading={reading} found={resultCount > 0} onSearchText={(text) => run(text, null)} />}
      <BarcodeScanner open={scanning} onClose={() => setScanning(false)} onReading={onReading} onManual={(text) => { setScanning(false); run(text); }} {...(onPhotoNotRead ? { onPhotoNotRead: (file: File) => { setScanning(false); onPhotoNotRead(file); } } : {})} />
    </section>
  );
}

function ScanNotice({ reading, found, onSearchText }: { reading: ScanReading; found: boolean; onSearchText: (text: string) => void }) {
  const { t } = useTranslation();
  const box = 'mt-2 rounded-control border p-2.5 text-sm break-words [overflow-wrap:anywhere]';
  if (reading.kind === 'badChecksum') {
    return <p role="alert" data-testid="scan-notice" data-kind="badChecksum" className={`${box} border-warning/40 bg-warning-tint text-warning`}>{t('partSearch.notice.badChecksum', { code: reading.code })}</p>;
  }
  if (reading.kind === 'url') {
    return <p data-testid="scan-notice" data-kind="url" className={`${box} border-line bg-sidebar`}>{t('partSearch.notice.url', { host: reading.host })}</p>;
  }
  if (reading.kind === 'text' && !reading.codeLike) {
    return (
      <div data-testid="scan-notice" data-kind="text" className={`${box} border-line bg-sidebar`}>
        <p>{t('partSearch.notice.text')}</p>
        <p className="mt-1 line-clamp-3 font-mono text-xs">{reading.text}</p>
        <Button size="sm" className="mt-2" onClick={() => onSearchText(reading.text.slice(0, 60))}>{t('partSearch.notice.searchText')}</Button>
      </div>
    );
  }
  const label = reading.kind === 'product' ? `${FORMAT_NAMES[reading.format]} ${reading.code}` : reading.text;
  return (
    <div data-testid="scan-notice" data-kind={reading.kind} className={`${box} ${found ? 'border-line bg-sidebar' : 'border-warning/40 bg-warning-tint'}`}>
      <p><span className="text-muted">{t(reading.kind === 'product' ? 'partSearch.notice.barcode' : 'partSearch.notice.fromQr')}</span> <strong className="tabular font-semibold">{label}</strong></p>
      {!found && <p data-testid="scan-not-found" className="mt-1 text-warning">{t(reading.kind === 'product' ? 'partSearch.notice.barcodeNotFound' : 'partSearch.notice.codeNotFound')}</p>}
    </div>
  );
}
