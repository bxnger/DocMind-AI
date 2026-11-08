import { Capacitor } from '@capacitor/core';

/** True inside the Android or iOS app. The web build never loads a native plugin. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** What the system Back button should do, decided from the screen as it is. Kept pure so it can be tested. */
export type BackAction = 'close-overlay' | 'go-back' | 'leave-app';

export function backAction(screen: { overlayOpen: boolean; canGoBack: boolean }): BackAction {
  if (screen.overlayOpen) return 'close-overlay';
  return screen.canGoBack ? 'go-back' : 'leave-app';
}

/** A file name the Android and iOS file systems accept, keeping its extension. */
export function safeFileName(name: string): string {
  const visible = [...name].map((char) => (char.charCodeAt(0) < 32 ? '_' : char)).join('');
  const clean = visible.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  return clean.slice(-120) || 'docmind-export';
}

/** Filesystem.writeFile takes text or base64. Exports are binary (XLSX), so they go as base64. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
