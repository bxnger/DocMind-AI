import { describe, expect, it } from 'vitest';
import { backAction, blobToBase64, isNativeApp, safeFileName } from './platform';

describe('the mobile app helpers', () => {
  it('Back closes what is open first, then goes back, and only then leaves', () => {
    expect(backAction({ overlayOpen: true, canGoBack: true })).toBe('close-overlay');
    expect(backAction({ overlayOpen: true, canGoBack: false })).toBe('close-overlay');
    expect(backAction({ overlayOpen: false, canGoBack: true })).toBe('go-back');
    expect(backAction({ overlayOpen: false, canGoBack: false })).toBe('leave-app');
  });
  it('makes file names the phone accepts, keeping the extension', () => {
    expect(safeFileName('tv320/manual: "draft"-procurement.xlsx')).toBe('tv320_manual_ _draft_-procurement.xlsx');
    expect(safeFileName('   ')).toBe('docmind-export');
    expect(safeFileName(`${'a'.repeat(300)}.csv`).endsWith('.csv')).toBe(true);
  });
  it('turns a binary export into base64 without changing a byte', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
    expect(Buffer.from(await blobToBase64(new Blob([bytes])), 'base64')).toEqual(Buffer.from(bytes));
  });
  it('the web build is not the app', () => {
    expect(isNativeApp()).toBe(false);
  });
});
