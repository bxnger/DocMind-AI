import { blobToBase64, isNativeApp, safeFileName } from './platform';

/**
 * Saves an export. In a browser, an ordinary download. In the app, where a WebView cannot download, the file is
 * written to the app's cache and handed to the system share sheet, from which the person saves it to Files,
 * Drive or opens it in Excel. The plugins load only in the app.
 */
export async function saveFile(blob: Blob, name: string): Promise<void> {
  if (!isNativeApp()) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const path = safeFileName(name);
  const written = await Filesystem.writeFile({ path, data: await blobToBase64(blob), directory: Directory.Cache });
  await Share.share({ title: path, files: [written.uri] });
}
