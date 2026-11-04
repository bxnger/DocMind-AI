export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placement {
  left: number;
  /** Set when the preview opens below the anchor. */
  top?: number;
  /** Set when it opens above, so the preview's real height does not matter. */
  bottom?: number;
}

export const PREVIEW_WIDTH = 320;
/** The tallest the preview gets: used only to decide whether it fits below. */
export const PREVIEW_MAX_HEIGHT = 190;

/** Opens below the anchor, flips above when there is no room, and stays inside the viewport horizontally. */
export function placePreview(
  anchor: Box,
  viewport: { width: number; height: number },
  size = { width: PREVIEW_WIDTH, height: PREVIEW_MAX_HEIGHT },
  gap = 8,
  margin = 8,
): Placement {
  const center = (anchor.left + anchor.right) / 2;
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const left = Math.min(Math.max(center - size.width / 2, margin), maxLeft);
  const fitsBelow = anchor.bottom + gap + size.height <= viewport.height - margin;
  const fitsAbove = anchor.top - gap - size.height >= margin;
  if (fitsBelow || !fitsAbove) return { left, top: anchor.bottom + gap };
  return { left, bottom: viewport.height - anchor.top + gap };
}
