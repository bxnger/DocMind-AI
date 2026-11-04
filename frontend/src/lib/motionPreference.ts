/** True when the OS asks for reduced motion, or the app's own Motion setting is "Reduced". */
export function prefersReducedMotion(): boolean {
  if (document.documentElement.dataset.motion === 'reduced') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
