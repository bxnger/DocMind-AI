import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { backAction, isNativeApp } from './platform';

/** Open layers that Escape already closes: dialogs, the mobile menu and the evidence panel. */
const OVERLAYS = '[role="dialog"], [role="alertdialog"], [data-testid="evidence-inspector"]';

/** Android's Back button: close what is open, then go back in the app, and only then leave it. */
export function useNativeBackButton(): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isNativeApp()) return;
    let remove: (() => void) | null = null;
    let cancelled = false;
    void import('@capacitor/app').then(({ App }) =>
      App.addListener('backButton', ({ canGoBack }) => {
        const action = backAction({ overlayOpen: Boolean(document.querySelector(OVERLAYS)), canGoBack: canGoBack || window.history.length > 1 });
        if (action === 'close-overlay') {
          (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } else if (action === 'go-back') {
          void navigate(-1);
        } else {
          void App.minimizeApp();
        }
      }).then((handle) => {
        if (cancelled) void handle.remove();
        else remove = () => void handle.remove();
      }),
    );
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [navigate]);
}
