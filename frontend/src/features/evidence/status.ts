import type { LocatorKind } from '@/features/viewer/lib/locate';

export type ViewerAvailability = 'ready' | 'loading' | 'error' | 'unavailable';

export type EvidenceStatus =
  | LocatorKind
  | 'viewerLoading'
  | 'viewerError'
  | 'viewerUnavailable'
  | 'otherDocument';

/** The one honest sentence about what the user is looking at. Never claims a highlight that is not there. */
export function evidenceStatus(input: { kind: LocatorKind; viewer: ViewerAvailability; foreign: boolean }): EvidenceStatus {
  if (input.foreign) return 'otherDocument';
  if (input.kind === 'section' || input.kind === 'block') return input.kind;
  if (input.viewer === 'loading') return 'viewerLoading';
  if (input.viewer === 'error') return 'viewerError';
  if (input.viewer === 'unavailable') return 'viewerUnavailable';
  return input.kind;
}

/** Statuses where the page is on screen, so "show on page" does something. */
export const CAN_SHOW_ON_PAGE: ReadonlySet<EvidenceStatus> = new Set(['coordinates', 'text', 'page', 'unknown', 'block']);
