import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Page } from './pdfjs';
import type { PageSize } from './usePageSizes';

const THUMB_WIDTH = 84;

interface ThumbProps {
  pdf: PDFDocumentProxy;
  page: number;
  size: PageSize;
  current: boolean;
  cited: boolean;
  onSelect: (page: number) => void;
}

function Thumb({ pdf, page, size, current, cited, onSelect }: ThumbProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onSelect(page)}
      aria-current={current ? 'page' : undefined}
      aria-label={cited ? t('viewer.goToPageCited', { page }) : t('viewer.goToPage', { page })}
      className="group flex w-full flex-col items-center gap-1 rounded-control p-1 outline-offset-0"
    >
      <span
        className={cn(
          'block overflow-hidden rounded-sm bg-white ring-1 transition-shadow duration-150',
          current ? 'ring-2 ring-accent' : 'ring-line group-hover:ring-line-strong',
        )}
        style={{ width: THUMB_WIDTH, height: (THUMB_WIDTH * size.height) / size.width }}
      >
        {seen && (
          <Page
            pdf={pdf}
            pageNumber={page}
            width={THUMB_WIDTH}
            suspense={false}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            loading={null}
            error={null}
          />
        )}
      </span>
      <span className={cn('tabular flex items-center gap-1 text-xs', current ? 'text-fg' : 'text-muted')}>
        {cited && <span className="size-1.5 rounded-full bg-accent-2" aria-hidden />}
        {page}
      </span>
    </button>
  );
}

interface RailProps {
  pdf: PDFDocumentProxy;
  sizes: PageSize[];
  currentPage: number;
  citedPages: ReadonlySet<number>;
  onSelect: (page: number) => void;
}

/** Pages cited in the conversation carry a marker, taken only from real answer sources. */
export function ThumbnailRail({ pdf, sizes, currentPage, citedPages, onSelect }: RailProps) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('viewer.pages')} className="w-[116px] shrink-0 space-y-1 overflow-y-auto border-r border-line bg-sidebar p-2 max-sm:hidden">
      {sizes.map((size, index) => (
        <Thumb
          key={index + 1}
          pdf={pdf}
          page={index + 1}
          size={size}
          current={currentPage === index + 1}
          cited={citedPages.has(index + 1)}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
