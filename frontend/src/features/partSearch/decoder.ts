import type { ScanFormat } from './codes';

/**
 * Reads barcodes on the device. Nothing here sends an image anywhere: frames and photos are decoded in the browser and
 * dropped. The browser's own BarcodeDetector is used where it reads all four formats (Chrome on Android). Elsewhere,
 * Safari on iPhone among them, the zxing-wasm reader is loaded on first use from this site, never from a CDN.
 */
export interface Decoder {
  engine: 'native' | 'zxing';
  read: (source: HTMLVideoElement | Blob) => Promise<{ format: ScanFormat; text: string } | null>;
}

const NATIVE: Record<string, ScanFormat> = { ean_13: 'ean_13', ean_8: 'ean_8', upc_a: 'upc_a', qr_code: 'qr_code' };
const ZXING: Record<string, ScanFormat> = { EAN13: 'ean_13', EAN8: 'ean_8', UPCA: 'upc_a', QRCode: 'qr_code' };

interface NativeDetector {
  detect(source: ImageBitmapSource): Promise<Array<{ format: string; rawValue: string }>>;
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}

async function nativeDecoder(): Promise<Decoder | null> {
  const Detector = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const supported = await Detector.getSupportedFormats();
    if (!Object.keys(NATIVE).every((format) => supported.includes(format))) return null;
    const detector = new Detector({ formats: Object.keys(NATIVE) });
    return {
      engine: 'native',
      read: async (source) => {
        const image = source instanceof Blob ? await createImageBitmap(source) : source;
        try {
          const found = (await detector.detect(image)).find((code) => NATIVE[code.format]);
          return found ? { format: NATIVE[found.format] as ScanFormat, text: found.rawValue } : null;
        } finally {
          if (image instanceof ImageBitmap) image.close();
        }
      },
    };
  } catch {
    return null;
  }
}

/** Frames are drawn small: a barcode needs a few hundred pixels, and a phone stays cool. */
const FRAME_WIDTH = 960;

async function zxingDecoder(): Promise<Decoder> {
  const [{ prepareZXingModule, readBarcodes }, { default: wasmUrl }] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
  const canvas = document.createElement('canvas');
  const options = { formats: ['EAN13', 'EAN8', 'UPCA', 'QRCode'] as const, tryHarder: true, maxNumberOfSymbols: 1 };
  const first = (results: Array<{ isValid: boolean; format: string; text: string }>) => {
    const found = results.find((result) => result.isValid && ZXING[result.format]);
    return found ? { format: ZXING[found.format] as ScanFormat, text: found.text } : null;
  };
  return {
    engine: 'zxing',
    read: async (source) => {
      if (source instanceof Blob) return first(await readBarcodes(source, { ...options, formats: [...options.formats] }));
      if (!source.videoWidth) return null;
      const scale = Math.min(1, FRAME_WIDTH / source.videoWidth);
      canvas.width = Math.round(source.videoWidth * scale);
      canvas.height = Math.round(source.videoHeight * scale);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      return first(await readBarcodes(context.getImageData(0, 0, canvas.width, canvas.height), { ...options, formats: [...options.formats] }));
    },
  };
}

let loading: Promise<Decoder> | null = null;

/** One decoder per page. A failed load is forgotten, so the next attempt tries again. */
export function getDecoder(): Promise<Decoder> {
  loading ??= (async () => (await nativeDecoder()) ?? zxingDecoder())().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}
