// Copies the PDF.js font and character-map data into public/ so the viewer can render
// PDFs with non-embedded fonts (Helvetica, CJK CMaps) without a CDN at demo time.
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
// react-pdf pins its own pdfjs-dist; the assets must come from that exact copy.
const reactPdfDir = dirname(require.resolve('react-pdf/package.json', { paths: [process.cwd()] }));
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json', { paths: [reactPdfDir] }));
const target = join(process.cwd(), 'public', 'pdfjs');

mkdirSync(target, { recursive: true });
for (const folder of ['standard_fonts', 'cmaps', 'wasm']) {
  cpSync(join(pdfjsDir, folder), join(target, folder), { recursive: true });
}
