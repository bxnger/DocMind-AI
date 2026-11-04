import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
  );
}

export const MOBILE_QUERY = '(max-width: 767px)';
/** Below this width the workspace shows one pane at a time. */
export const SPLIT_PANE_QUERY = '(min-width: 900px)';
