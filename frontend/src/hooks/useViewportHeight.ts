import { useEffect } from 'react';

/**
 * iOS Safari keeps 100dvh when the on-screen keyboard opens, which would leave the composer under it.
 * The visible height from visualViewport drives the app's height instead.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      document.documentElement.style.setProperty('--app-height', `${viewport.height}px`);
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);
}
