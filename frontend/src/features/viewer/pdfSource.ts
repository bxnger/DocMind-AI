export type PdfInput = { type: 'url'; url: string; authenticated?: boolean } | { type: 'blob'; blob: Blob };

/** What PDF.js is told to load. The token stays in a header, and the bundled sample gets none. */
export function pdfUrlSource(url: string, token: string | null): { url: string; httpHeaders?: Record<string, string> } {
  return token ? { url, httpHeaders: { Authorization: `Bearer ${token}` } } : { url };
}

export function isUnauthorized(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 401;
}
