import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface PageSize {
  width: number;
  height: number;
}

/** All page sizes at scale 1, loaded up front so scroll positions are exact. */
export function usePageSizes(pdf: PDFDocumentProxy): PageSize[] | null {
  const [loaded, setLoaded] = useState<{ pdf: PDFDocumentProxy; sizes: PageSize[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const numbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1);
    Promise.all(numbers.map((page) => pdf.getPage(page)))
      .then((pages) => {
        if (cancelled) return;
        setLoaded({
          pdf,
          sizes: pages.map((page) => {
            const viewport = page.getViewport({ scale: 1 });
            return { width: viewport.width, height: viewport.height };
          }),
        });
      })
      .catch((error: unknown) => {
        // A destroyed document rejects here when the user leaves mid-load. That is not an error.
        if (!cancelled) console.error('Could not read page sizes', error);
      });
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  return loaded?.pdf === pdf ? loaded.sizes : null;
}
