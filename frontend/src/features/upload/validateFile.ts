/** Client-side checks exist for fast feedback only. The backend re-validates every upload. */
export type FileProblem =
  | { code: 'unsupported' }
  | { code: 'empty' }
  | { code: 'too-large'; limitBytes: number };

/** The backend's documented limit, used only until capabilities have loaded. */
export const FALLBACK_MAX_BYTES = 20 * 1024 * 1024;

export function validateFile(file: Pick<File, 'name' | 'size'>, maxBytes: number): FileProblem | null {
  if (!/\.(pdf|docx)$/i.test(file.name)) return { code: 'unsupported' };
  if (file.size === 0) return { code: 'empty' };
  if (file.size > maxBytes) return { code: 'too-large', limitBytes: maxBytes };
  return null;
}
