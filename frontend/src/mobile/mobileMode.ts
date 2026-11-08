import { isNativeApp } from '@/features/native/platform';
import { readStored, writeStored } from '@/lib/storage';

const PREVIEW_KEY = 'docmind.mobilePreview';

/**
 * The phone interface runs inside the Android or iOS app. In a browser it can be previewed with ?mobile=1 (and turned
 * off with ?mobile=0), so it can be checked without a device. The website keeps its own interface otherwise.
 */
export function isMobileApp(): boolean {
  if (isNativeApp()) return true;
  try {
    const flag = new URLSearchParams(window.location.search).get('mobile');
    if (flag === '1' || flag === '0') writeStored('local', PREVIEW_KEY, flag === '1');
  } catch {
    // No URL to read: keep the stored choice.
  }
  return readStored<unknown>('local', PREVIEW_KEY, false) === true;
}
