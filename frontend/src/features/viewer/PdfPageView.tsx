import { memo, useMemo } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useTranslation } from 'react-i18next';
import type { EvidenceRect } from '@/types/chat';
import { renderItemHtml, type MarkSpan } from './lib/textMatch';
import { MAX_RENDER_DPR, Page } from './pdfjs';

interface Props {
  pdf: PDFDocumentProxy;
  page: number;
  scale: number;
  width: number;
  height: number;
  rendered: boolean;
  marks: Map<number, MarkSpan[]> | undefined;
  /** Quote position from the backend, as fractions of the page. */
  rects: EvidenceRect[] | undefined;
  /** Changes on every jump, so the arrival accent plays again even for the same source. */
  rectsKey: number;
  onTextReady: (page: number, element: HTMLElement | null) => void;
}

/** One page slot. Slots outside the window keep their size but render nothing. */
export const PdfPageView = memo(function PdfPageView({ pdf, page, scale, width, height, rendered, marks, rects, rectsKey, onTextReady }: Props) {
  const { t } = useTranslation();
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR);
  const customTextRenderer = useMemo(
    () =>
      marks
        ? ({ str, itemIndex }: { str: string; itemIndex: number }) => renderItemHtml(str, marks.get(itemIndex))
        : undefined,
    [marks],
  );

  return (
    <div
      data-page={page}
      role="group"
      aria-label={t('viewer.pageLabel', { page })}
      style={{ width, height }}
      className="relative mx-auto bg-white shadow-[0_1px_2px_rgb(32_41_37/0.14),0_6px_20px_rgb(32_41_37/0.1)]"
    >
      {rects?.map((rect, index) => (
        <span
          key={`${rectsKey}-${index}`}
          data-testid="highlight-rect"
          className="hl-rect pointer-events-none absolute z-10"
          style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
        />
      ))}
      {rendered && (
        <Page
          pdf={pdf}
          pageNumber={page}
          scale={scale}
          devicePixelRatio={dpr}
          suspense={false}
          renderAnnotationLayer={false}
          customTextRenderer={customTextRenderer}
          loading={null}
          error={<p className="p-4 text-sm text-black/70">{t('viewer.pageError')}</p>}
          onRenderTextLayerSuccess={() => onTextReady(page, document.querySelector(`[data-page="${page}"]`))}
        />
      )}
    </div>
  );
});
