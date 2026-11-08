import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { prefersReducedMotion } from '@/lib/motionPreference';
import type { BearingScene } from './bearingScene';

const FALLBACK = '/3d/bearing.webp';

type Mode = 'static' | 'loading' | 'live';

/** Why the picture stays static: reduced motion, no WebGL, or a device that would struggle. */
function staticReason(): string | null {
  if (typeof window === 'undefined') return 'ssr';
  if (prefersReducedMotion()) return 'reduced-motion';
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return 'save-data';
  if ((nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2) return 'weak-device';
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
    if (!gl) return 'no-webgl';
    (gl.getExtension('WEBGL_lose_context') as { loseContext: () => void } | null)?.loseContext();
  } catch {
    return 'no-webgl';
  }
  return null;
}

function isPhone(): boolean {
  return window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) <= 520;
}

/**
 * The bearing on the home page: an assembled 3D model when the device can afford it, the same bearing as a
 * picture otherwise. Decorative, so hidden from screen readers. three.js and the model load only once the
 * hero scrolls into view, and drawing stops whenever it is off screen, the tab is hidden or the page changes.
 */
export function BearingHero({ className }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reason] = useState(staticReason);
  const [mode, setMode] = useState<Mode>(reason ? 'static' : 'loading');
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (reason) return;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let scene: BearingScene | null = null;
    let cancelled = false;
    let inView = false;
    const update = () => scene?.setActive(inView && document.visibilityState === 'visible');
    const onLost = (event: Event) => {
      event.preventDefault();
      scene?.dispose();
      scene = null;
      setFailure('context-lost');
      setMode('static');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    const start = () => {
      import('./bearingScene')
        .then(({ createBearingScene }) => {
          if (cancelled) return;
          scene = createBearingScene(canvas, {
            mobile: isPhone(),
            onReady: () => !cancelled && setMode('live'),
            onError: (error) => {
              if (cancelled) return;
              console.warn('3D hero falls back to the picture', error);
              scene?.dispose();
              scene = null;
              setFailure('load-error');
              setMode('static');
            },
          });
          update();
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          console.warn('3D hero falls back to the picture', error);
          setFailure('load-error');
          setMode('static');
        });
    };
    let started = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        inView = !!entry?.isIntersecting;
        if (inView && !started) {
          started = true;
          start();
        }
        update();
      },
      { rootMargin: '120px' },
    );
    io.observe(wrap);
    document.addEventListener('visibilitychange', update);
    return () => {
      cancelled = true;
      io.disconnect();
      document.removeEventListener('visibilitychange', update);
      canvas.removeEventListener('webglcontextlost', onLost);
      scene?.dispose();
    };
  }, [reason]);

  return (
    <div
      ref={wrapRef}
      aria-hidden
      data-testid="bearing-hero"
      data-mode={mode}
      data-static-reason={reason ?? failure ?? undefined}
      className={cn('pointer-events-none relative select-none', className)}
    >
      <img
        src={FALLBACK}
        alt=""
        width={720}
        height={720}
        decoding="async"
        data-testid="bearing-hero-image"
        className={cn('absolute inset-0 size-full object-contain transition-opacity duration-700 ease-out', mode !== 'static' && 'opacity-0')}
      />
      {mode !== 'static' && (
        <canvas
          ref={canvasRef}
          data-testid="bearing-hero-canvas"
          className={cn('absolute inset-0 size-full opacity-0 transition-opacity duration-700 ease-out', mode === 'live' && 'opacity-100')}
        />
      )}
    </div>
  );
}
