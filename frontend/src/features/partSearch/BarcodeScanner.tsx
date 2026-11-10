import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CameraOff, ImageUp, Keyboard, Loader2, RotateCcw, ScanLine } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { classifyScan, type ScanReading } from './codes';
import { getDecoder } from './decoder';

/** About four frames a second: enough to catch a code held still, little enough for an old phone. */
const FRAME_MS = 250;

type Mode = 'camera' | 'photo' | 'manual';
const MODES: ReadonlyArray<{ mode: Mode; Icon: typeof Camera }> = [{ mode: 'camera', Icon: Camera }, { mode: 'photo', Icon: ImageUp }, { mode: 'manual', Icon: Keyboard }];
const FORMATS = ['EAN-13', 'EAN-8', 'UPC-A', 'QR'] as const;

type CameraState = 'starting' | 'live' | 'paused' | 'unsupported' | 'denied' | 'noCamera' | 'busy' | 'decoderFailed';

function cameraError(error: unknown): CameraState {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'noCamera';
  return 'busy';
}

const canUseCamera = (): boolean => window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';

interface Props {
  open: boolean;
  onClose: () => void;
  /** A code read by the camera or from a photo. */
  onReading: (reading: ScanReading) => void;
  /** What the person typed instead. */
  onManual: (text: string) => void;
  /** Present when the server can read codes from photos: offered only after the phone could not. */
  onPhotoNotRead?: (file: File) => void;
}

/**
 * The camera runs only while this is open and the page is visible. Frames are decoded on the phone, one at a time, and
 * never sent or kept. A photo of a barcode is read the same way and dropped.
 */
export function BarcodeScanner({ open, onClose, onReading, onManual, onPhotoNotRead }: Props) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={t('partSearch.scanner.title')} className="max-h-[calc(88dvh-1rem)] max-w-lg overflow-y-auto overscroll-contain">
      {open && <ScannerBody onClose={onClose} onReading={onReading} onManual={onManual} {...(onPhotoNotRead ? { onPhotoNotRead } : {})} />}
    </Modal>
  );
}

function ScannerBody({ onClose, onReading, onManual, onPhotoNotRead }: Omit<Props, 'open'>) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const [camera, setState] = useState<CameraState>(() => (canUseCamera() ? 'starting' : 'unsupported'));
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  const [attempt, setAttempt] = useState(0);
  const [manual, setManual] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoFailed, setPhotoFailed] = useState<'none' | 'decoder' | null>(null);
  const [unread, setUnread] = useState<File | null>(null);
  // The camera runs only on its own tab: choosing a photo or typing stops it.
  const [mode, setMode] = useState<Mode>('camera');
  // The camera must not restart because the parent rendered again with a new callback.
  const report = useRef(onReading);
  useEffect(() => {
    report.current = onReading;
  }, [onReading]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!canUseCamera()) return;
    if (hidden || mode !== 'camera') return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    const element = video.current;
    const stop = () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (element) element.srcObject = null;
    };
    void (async () => {
      setState('starting');
      let decoder;
      try {
        decoder = await getDecoder();
      } catch {
        if (!stopped) setState('decoderFailed');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      } catch (error) {
        if (!stopped) setState(cameraError(error));
        return;
      }
      if (stopped || !element) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      element.srcObject = stream;
      try {
        await element.play();
      } catch {
        // Autoplay of a muted inline video is allowed. If it is not, frames still arrive once the person taps.
      }
      if (stopped) return;
      setState('live');
      const tick = async () => {
        if (stopped) return;
        const found = await decoder.read(element).catch(() => null);
        if (stopped) return;
        if (found) {
          stop();
          navigator.vibrate?.(40);
          report.current(classifyScan(found.format, found.text));
          return;
        }
        timer = window.setTimeout(() => void tick(), FRAME_MS);
      };
      void tick();
    })();
    return stop;
  }, [attempt, hidden, mode]);

  const readPhoto = async (file: File | undefined) => {
    if (!file) return;
    setMode('photo');
    setPhotoBusy(true);
    setPhotoFailed(null);
    setUnread(null);
    try {
      const decoder = await getDecoder().catch(() => null);
      if (!decoder) {
        setPhotoFailed('decoder');
        setUnread(file);
        return;
      }
      const found = await decoder.read(file).catch(() => null);
      if (found) onReading(classifyScan(found.format, found.text));
      else {
        setPhotoFailed('none');
        setUnread(file);
      }
    } finally {
      setPhotoBusy(false);
      if (photo.current) photo.current.value = '';
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (manual.trim()) onManual(manual.trim());
  };

  // In the background the stream is stopped, whatever it was doing.
  const state: CameraState = hidden && camera !== 'unsupported' ? 'paused' : camera;
  const problem = state !== 'starting' && state !== 'live' && state !== 'paused';

  const tab = (next: Mode) => {
    setMode(next);
    if (next === 'camera') setAttempt((value) => value + 1);
  };

  return (
    <div className="space-y-3 px-5 pt-1 pb-5" data-testid="barcode-scanner" data-state={mode === 'camera' ? state : 'off'} data-mode={mode}>
      <ul aria-label={t('partSearch.scanner.formatsLabel')} data-testid="scanner-formats" className="flex flex-wrap gap-1.5">
        {FORMATS.map((format) => <li key={format} className="rounded-full border border-line bg-sidebar px-2.5 py-0.5 font-mono text-[11px] font-medium">{format}</li>)}
      </ul>
      <div role="tablist" aria-label={t('partSearch.scanner.title')} className="grid grid-cols-3 gap-1 rounded-control border border-line bg-sidebar p-1">
        {MODES.map(({ mode: value, Icon }) => (
          <button key={value} type="button" role="tab" aria-selected={mode === value} data-testid={`scanner-tab-${value}`} onClick={() => tab(value)}
            className={cn('pressable inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[8px] px-1 text-xs font-medium sm:text-sm', mode === value ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg')}>
            <Icon size={15} className="shrink-0" aria-hidden /><span className="truncate">{t(`partSearch.scanner.tab.${value}`)}</span>
          </button>
        ))}
      </div>
      <input ref={photo} type="file" accept="image/*" hidden data-testid="scanner-photo-input" onChange={(event) => void readPhoto(event.target.files?.[0])} />

      {mode === 'camera' && (
        <div role="tabpanel" className="space-y-2">
          <div className="relative aspect-[4/3] overflow-hidden rounded-panel border border-line bg-[#0d1412]">
            <video ref={video} muted playsInline aria-hidden className={problem ? 'hidden' : 'size-full object-cover'} data-testid="scanner-video" />
            {!problem && (
              <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-[46%] w-[78%] rounded-control border-2 border-white/85 shadow-[0_0_0_999px_rgba(0,0,0,0.38)]">
                  {state === 'live' && <span className="absolute inset-x-3 top-1/2 h-px bg-accent motion-safe:animate-pulse" />}
                </div>
              </div>
            )}
            <div role="status" aria-live="polite" className={problem ? 'flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white' : 'absolute inset-x-0 bottom-0 p-2 text-center text-xs text-white/90'}>
              {state === 'starting' && <span className="inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" aria-hidden />{t('partSearch.scanner.starting')}</span>}
              {state === 'live' && <span className="inline-flex items-center gap-1.5"><ScanLine size={14} aria-hidden />{t('partSearch.scanner.aim')}</span>}
              {state === 'paused' && <span>{t('partSearch.scanner.paused')}</span>}
              {problem && (
                <>
                  <CameraOff size={22} aria-hidden />
                  <span data-testid="scanner-problem">{t(`partSearch.scanner.problem.${state}`)}</span>
                  <div className="flex flex-wrap justify-center gap-2">
                    {(state === 'busy' || state === 'decoderFailed' || state === 'noCamera') && <Button size="sm" icon={<RotateCcw size={13} aria-hidden />} onClick={() => setAttempt((value) => value + 1)}>{t('common.retry')}</Button>}
                    <Button size="sm" data-testid="scanner-to-photo" icon={<ImageUp size={13} aria-hidden />} onClick={() => setMode('photo')}>{t('partSearch.scanner.mode.photo')}</Button>
                    <Button size="sm" data-testid="scanner-to-manual" icon={<Keyboard size={13} aria-hidden />} onClick={() => setMode('manual')}>{t('partSearch.scanner.mode.manual')}</Button>
                  </div>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-muted"><span className="font-medium text-fg">{t('partSearch.scanner.mode.camera')}.</span> {t('partSearch.scanner.intro')}</p>
        </div>
      )}

      {mode === 'photo' && (
        <div role="tabpanel" className="space-y-2">
          <button type="button" data-testid="scanner-photo" disabled={photoBusy} onClick={() => photo.current?.click()} className="pressable flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-line-strong bg-sidebar p-4 text-center text-sm hover:border-accent disabled:opacity-60">
            {photoBusy ? <Loader2 size={22} className="animate-spin text-muted" aria-hidden /> : <ImageUp size={22} className="text-accent" aria-hidden />}
            <span className="font-medium">{t('partSearch.scanner.mode.photo')}</span>
            <span className="text-xs text-muted">{t('partSearch.scanner.photoHint')}</span>
          </button>
          {photoFailed && <p role="alert" data-testid="scanner-photo-failed" className="text-sm text-warning">{t(photoFailed === 'decoder' ? 'partSearch.scanner.problem.decoderFailed' : 'partSearch.scanner.photoNone')}</p>}
          {unread && onPhotoNotRead && (
            <div data-testid="scanner-server-photo" className="rounded-control border border-line bg-sidebar p-2.5 text-sm">
              <p className="text-muted">{t('partSearch.scanner.serverPhotoHint')}</p>
              <Button size="sm" className="mt-2" onClick={() => onPhotoNotRead(unread)}>{t('partSearch.scanner.serverPhoto')}</Button>
            </div>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <form role="tabpanel" onSubmit={submit} className="space-y-1">
          <label htmlFor="scanner-manual" className="text-sm font-medium">{t('partSearch.scanner.manual')}</label>
          <div className="flex gap-2">
            <input id="scanner-manual" data-testid="scanner-manual" autoFocus value={manual} onChange={(event) => setManual(event.target.value)} inputMode="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder={t('partSearch.scanner.manualPlaceholder')} className="h-11 min-w-0 flex-1 rounded-control border border-line bg-bg px-3 text-base outline-none placeholder:text-muted focus:border-accent" />
            <Button type="submit" variant="primary" className="h-11" disabled={!manual.trim()} data-testid="scanner-manual-submit">{t('partSearch.find')}</Button>
          </div>
        </form>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose} data-testid="scanner-close">{t('partSearch.scanner.close')}</Button>
      </div>
    </div>
  );
}
