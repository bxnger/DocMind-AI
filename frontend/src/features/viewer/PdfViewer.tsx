import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import type { EvidenceRect } from '@/types/chat';
import { hasSearchableText, type DocumentText } from '@/services/chat';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePersistentState } from '@/hooks/usePersistentState';
import { locateEvidence } from './lib/locate';
import { findMatches, type MarkSpan, type TextMatch } from './lib/textMatch';
import { PdfPageView } from './PdfPageView';
import { ThumbnailRail } from './ThumbnailRail';
import { useDocumentSearch, type SearchHit } from './useDocumentSearch';
import { usePageSizes } from './usePageSizes';
import { PAGE_GAP, revealHeight, usePdfScroller } from './usePdfScroller';
import { ViewerSearchBar } from './ViewerSearchBar';
import { ViewerToolbar } from './ViewerToolbar';

export interface JumpRequest {
  page: number;
  quote: string | null;
  highlights?: EvidenceRect[];
  /** Lets the same source be opened twice in a row. */
  nonce: number;
}

/** Text to mark on a page, for example one side of a comparison. Marked only where it is really found. */
export interface Annotation {
  page: number;
  quote: string;
  className: string;
}

interface Props {
  pdf: PDFDocumentProxy;
  text: DocumentText | undefined;
  jump: JumpRequest | null;
  citedPages: ReadonlySet<number>;
  /** The inspector already says when a passage could not be located. Without it, the viewer says so itself. */
  quoteNotice?: boolean;
  annotations?: Annotation[];
  /** For a narrow pane: no thumbnail rail. */
  compact?: boolean;
}

function addMarks(target: Map<number, Map<number, MarkSpan[]>>, page: number, match: TextMatch, className: string) {
  const pageMarks = target.get(page) ?? new Map<number, MarkSpan[]>();
  for (const span of match) {
    const list = pageMarks.get(span.item) ?? [];
    list.push({ start: span.start, end: span.end, className });
    pageMarks.set(span.item, list);
  }
  target.set(page, pageMarks);
}

export function PdfViewer({ pdf, text, jump, citedPages, quoteNotice = true, annotations, compact = false }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const sizes = usePageSizes(pdf);
  const scroller = usePdfScroller(containerRef, sizes);
  const { goToPage, goToSpot, scrollBy, ready: scrollerReady } = scroller;
  const roomy = useMediaQuery('(min-width: 1180px)');
  const [railPreference, setRailPreference] = usePersistentState('docmind.viewer.rail', true);
  const railOpen = railPreference && roomy && !compact;

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const hits = useDocumentSearch(searchOpen ? text : undefined, query);
  // Tied to its result set, so a new search starts from the first hit without extra state resets.
  const [activePosition, setActivePosition] = useState<{ hits: SearchHit[]; index: number } | null>(null);
  const activeHit = activePosition?.hits === hits ? activePosition.index : 0;

  // Rectangles from the backend win. The text layer is the fallback, and it only ever marks text that is really there.
  const located = useMemo(() => (jump ? locateEvidence(jump, text) : null), [jump, text]);
  const quote = useMemo(() => (jump && located?.match ? { page: jump.page, match: located.match } : null), [jump, located]);
  const [dismissedNotice, setDismissedNotice] = useState<number | null>(null);
  const notice = quoteNotice && located?.kind === 'page' && Boolean(jump?.quote) && dismissedNotice !== jump?.nonce;
  /** The next text layer to finish on this page scrolls its highlight into view. */
  const pendingReveal = useRef<number | null>(null);

  const reveal = useCallback((element: HTMLElement) => {
    const container = containerRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    scrollBy(element.getBoundingClientRect().top - box.top - revealHeight(container) / 3, true);
  }, [scrollBy]);

  const onTextReady = useCallback(
    (page: number, element: HTMLElement | null) => {
      if (pendingReveal.current !== page) return;
      const mark = element?.querySelector<HTMLElement>('mark.hl-active, mark.hl-quote');
      if (mark) {
        pendingReveal.current = null;
        reveal(mark);
      }
    },
    [reveal],
  );

  // Open a cited source: go to the page, then highlight the quote where the text layer allows it.
  useEffect(() => {
    if (!jump || !scrollerReady) return;
    const firstRect = jump.highlights?.[0];
    if (firstRect) {
      goToSpot(jump.page, firstRect.y, true);
      pendingReveal.current = null;
    } else {
      goToPage(jump.page, true);
      pendingReveal.current = jump.quote ? jump.page : null;
    }
    // Only a new jump, or the viewer becoming visible, should move the document.
  }, [jump, scrollerReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const stepHit = useCallback(
    (delta: 1 | -1) => {
      if (hits.length === 0) return;
      const index = (activeHit + delta + hits.length) % hits.length;
      setActivePosition({ hits, index });
      const hit = hits[index];
      if (hit) {
        goToPage(hit.page);
        pendingReveal.current = hit.page;
      }
    },
    [activeHit, goToPage, hits],
  );

  // A new result set brings its first hit into view.
  useEffect(() => {
    const hit = hits[0];
    if (hit) {
      goToPage(hit.page);
      pendingReveal.current = hit.page;
    }
  }, [hits]); // eslint-disable-line react-hooks/exhaustive-deps

  const annotatedMatches = useMemo(
    () =>
      (annotations ?? []).flatMap((annotation) => {
        const pageText = text?.[annotation.page - 1];
        const [match] = pageText ? findMatches(pageText.items, annotation.quote, { limit: 1 }) : [];
        return match ? [{ page: annotation.page, match, className: annotation.className }] : [];
      }),
    [annotations, text],
  );

  const marksByPage = useMemo(() => {
    const result = new Map<number, Map<number, MarkSpan[]>>();
    if (quote) addMarks(result, quote.page, quote.match, 'hl-quote');
    for (const annotation of annotatedMatches) addMarks(result, annotation.page, annotation.match, annotation.className);
    hits.forEach((hit, index) => addMarks(result, hit.page, hit.match, index === activeHit ? 'hl-active' : 'hl-search'));
    return result;
  }, [quote, annotatedMatches, hits, activeHit]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
  };

  if (!sizes) {
    return (
      <div className="flex h-full flex-col items-center gap-4 p-6" role="status" aria-label={t('viewer.loading')}>
        <Skeleton className="h-[60%] w-full max-w-xl" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        page={scroller.currentPage}
        pageCount={pdf.numPages}
        scale={scroller.scale}
        fit={scroller.fit}
        railOpen={railOpen}
        hideRailToggle={compact}
        searchOpen={searchOpen}
        onPage={goToPage}
        onZoomStep={scroller.zoomStep}
        onFit={scroller.setFit}
        onToggleRail={() => setRailPreference(!railPreference)}
        onToggleSearch={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
      />
      {searchOpen && (
        <ViewerSearchBar
          query={query}
          onQuery={setQuery}
          count={hits.length}
          active={activeHit}
          textState={!text ? 'loading' : hasSearchableText(text) ? 'ready' : 'empty'}
          onStep={stepHit}
          onClose={closeSearch}
        />
      )}
      {notice && (
        <div role="status" className="flex items-center gap-2 border-b border-line bg-warning-tint py-1 pr-2 pl-3 text-sm text-warning">
          <Info size={14} className="shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{t('viewer.quoteNotLocated')}</span>
          <IconButton dense label={t('common.dismiss')} icon={<X size={14} aria-hidden />} onClick={() => setDismissedNotice(jump?.nonce ?? null)} />
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {railOpen && (
          <ThumbnailRail pdf={pdf} sizes={sizes} currentPage={scroller.currentPage} citedPages={citedPages} onSelect={goToPage} />
        )}
        <div
          ref={containerRef}
          onScroll={scroller.onScroll}
          tabIndex={0}
          role="region"
          aria-label={t('viewer.document')}
          data-testid="pdf-scroller"
          className="min-w-0 flex-1 overflow-auto bg-bg px-2 py-6 outline-offset-[-2px] sm:px-6"
        >
          <div className="flex w-max min-w-full flex-col" style={{ gap: PAGE_GAP }}>
            {sizes.map((size, index) => (
              <PdfPageView
                key={index + 1}
                pdf={pdf}
                page={index + 1}
                scale={scroller.scale}
                width={size.width * scroller.scale}
                height={size.height * scroller.scale}
                rendered={scroller.isRendered(index + 1)}
                marks={marksByPage.get(index + 1)}
                rects={jump?.page === index + 1 ? jump.highlights : undefined}
                rectsKey={jump?.nonce ?? 0}
                onTextReady={onTextReady}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
