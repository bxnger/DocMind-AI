import { isNativeApp } from '@/features/native/platform';
import { readStored, removeStored, writeStored } from '@/lib/storage';

const PREVIEW_KEY = 'docmind.mobilePreview';
/** A phone, not a tablet: touch, and a short side small enough in either orientation. */
const PHONE_SHORT_SIDE = 520;

export type InterfaceChoice = 'auto' | 'phone' | 'desktop';

function isPhoneBrowser(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) <= PHONE_SHORT_SIDE;
  } catch {
    return false;
  }
}

/** What the person chose, if anything. ?mobile=1 or ?mobile=0 in the address sets it too. */
export function interfaceChoice(): InterfaceChoice {
  try {
    const flag = new URLSearchParams(window.location.search).get('mobile');
    if (flag === '1' || flag === '0') writeStored('local', PREVIEW_KEY, flag === '1');
  } catch {
    // No URL to read: keep the stored choice.
  }
  const stored = readStored<unknown>('local', PREVIEW_KEY, null);
  return stored === true ? 'phone' : stored === false ? 'desktop' : 'auto';
}

/**
 * The phone interface: always inside the Android or iOS app, and in a phone's browser unless the person chose the full
 * site. Computers and tablets keep the website's interface. Decided once, when the page loads.
 */
export function isMobileApp(): boolean {
  if (isNativeApp()) return true;
  const choice = interfaceChoice();
  return choice === 'auto' ? isPhoneBrowser() : choice === 'phone';
}

/** Saves the choice and reloads, since the interface is chosen once at start. */
export function setInterfaceChoice(choice: InterfaceChoice): void {
  if (choice === 'auto') removeStored('local', PREVIEW_KEY);
  else writeStored('local', PREVIEW_KEY, choice === 'phone');
  const url = new URL(window.location.href);
  url.searchParams.delete('mobile');
  window.location.replace(url.toString());
}
