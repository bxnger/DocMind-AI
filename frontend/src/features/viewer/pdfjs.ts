import { Page, pdfjs } from 'react-pdf';

// Must be set in the same module that re-exports react-pdf's components (see react-pdf README).
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export { Page, pdfjs };

export const PDF_OPTIONS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
};

export const MAX_RENDER_DPR = 2;
