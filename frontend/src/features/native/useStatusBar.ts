import { useEffect } from 'react';
import { isNativeApp } from './platform';

/** Keeps the status bar's icons readable: dark icons on the light theme, light icons on the dark one. */
export function useStatusBar(): void {
  useEffect(() => {
    if (!isNativeApp()) return;
    let stop: (() => void) | null = null;
    void import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
      const apply = () => {
        const dark = document.documentElement.dataset.theme === 'dark';
        void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
      };
      apply();
      const observer = new MutationObserver(apply);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      stop = () => observer.disconnect();
    });
    return () => stop?.();
  }, []);
}
