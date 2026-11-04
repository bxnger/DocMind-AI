import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { prefersReducedMotion } from '@/lib/motionPreference';
import type { PageSize } from './usePageSizes';

export const PAGE_GAP = 16;
const PAD = 24;
/** Keeps a phone's narrow width for the page itself. Must match the scroller's px-2 sm:px-6. */
const PAD_NARROW = 8;
const NARROW_WIDTH = 640;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const RESIZE_SETTLE_MS = 120;
/** Pages rendered above and below the viewport. */
const OVERSCAN = 1;

export type Zoom = 'fit' | number;

/** Scroll position that puts a spot of a page, as a fraction of the page's height, in the upper third of the viewport. */
export function spotScrollTop(pageTop: number, pageHeight: number, fraction: number, viewportHeight: number): number {
  return Math.max(0, pageTop + pageHeight * fraction - viewportHeight / 3);
}

/** Scroll position that shows the top of a page. */
export function pageScrollTop(pageTop: number): number {
  return Math.max(0, pageTop - PAGE_GAP);
}

/** Scroll, zoom and windowing math for the continuous page view. */
export function usePdfScroller(containerRef: RefObject<HTMLDivElement | null>, sizes: PageSize[] | null) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [scrollTop, setScrollTop] = useState(0);
  const frame = useRef(0);
  // The scroll container only mounts once page sizes are known.
  const hasPages = sizes !== null;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let timer = 0;
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    // Settling avoids re-rendering every canvas on each pixel of a panel drag.
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, RESIZE_SETTLE_MS);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [containerRef, hasPages]);

  const widest = useMemo(() => Math.max(1, ...(sizes ?? []).map((size) => size.width)), [sizes]);
  const fitScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (box.width - (box.width < NARROW_WIDTH ? PAD_NARROW : PAD) * 2) / widest));
  const scale = zoom === 'fit' ? fitScale : zoom;

  const offsets = useMemo(() => {
    const tops: number[] = [];
    let top = PAD;
    for (const size of sizes ?? []) {
      tops.push(top);
      top += size.height * scale + PAGE_GAP;
    }
    return tops;
  }, [sizes, scale]);

  // Keeps the same content in view when the zoom changes.
  const previousScale = useRef(scale);
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (element && previousScale.current !== scale && previousScale.current > 0) {
      element.scrollTop *= scale / previousScale.current;
    }
    previousScale.current = scale;
  }, [containerRef, scale]);

  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (containerRef.current) setScrollTop(containerRef.current.scrollTop);
    });
  }, [containerRef]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const pageAt = useCallback(
    (y: number) => {
      let page = 1;
      for (let i = 0; i < offsets.length; i += 1) {
        const offset = offsets[i];
        if (offset !== undefined && offset <= y) page = i + 1;
        else break;
      }
      return page;
    },
    [offsets],
  );

  // The current page is the one crossing the upper third of the viewport.
  const currentPage = pageAt(scrollTop + box.height / 3);
  const first = Math.max(1, pageAt(scrollTop) - OVERSCAN);
  const last = Math.min(offsets.length, pageAt(scrollTop + box.height) + OVERSCAN);

  /** Smooth by default for jumps the user asked for; instant when the user prefers reduced motion. */
  const scrollTo = useCallback(
    (top: number, smooth: boolean) => {
      containerRef.current?.scrollTo({ top, behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' });
    },
    [containerRef],
  );

  const goToPage = useCallback(
    (page: number, smooth = false) => {
      const offset = offsets[page - 1];
      if (offset !== undefined) scrollTo(pageScrollTop(offset), smooth);
    },
    [offsets, scrollTo],
  );

  /** Puts a spot on a page, given as a fraction of its height, in the upper third of the viewport. */
  const goToSpot = useCallback(
    (page: number, fraction: number, smooth = false) => {
      const offset = offsets[page - 1];
      const size = sizes?.[page - 1];
      const container = containerRef.current;
      if (!container || offset === undefined || !size) return;
      scrollTo(spotScrollTop(offset, size.height * scale, fraction, container.clientHeight), smooth);
    },
    [containerRef, offsets, scale, scrollTo, sizes],
  );

  const zoomStep = useCallback(
    (direction: 1 | -1) => {
      const next =
        direction > 0
          ? (ZOOM_STEPS.find((step) => step > scale + 0.001) ?? MAX_SCALE)
          : ([...ZOOM_STEPS].reverse().find((step) => step < scale - 0.001) ?? ZOOM_STEPS[0] ?? MIN_SCALE);
      setZoom(next);
    },
    [scale],
  );

  return {
    scale,
    fit: zoom === 'fit',
    setFit: () => setZoom('fit'),
    zoomStep,
    onScroll,
    goToPage,
    goToSpot,
    scrollBy: (delta: number, smooth: boolean) => containerRef.current?.scrollBy({ top: delta, behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' }),
    currentPage,
    isRendered: (page: number) => page >= first && page <= last,
    ready: box.width > 0 && offsets.length > 0,
  };
}
