import { useLayoutEffect } from '../../vendor/hooks.module.js';

/** Observe the existing safe/visual-viewport box, not device pixels. Never runs on an animation frame loop. */
export function useEntryViewport(surface) {
  useLayoutEffect(() => {
    const el = surface.current;
    if (!el) return;
    let disposed = false, compact = false;
    const sync = () => {
      if (disposed || !el.isConnected) return;
      const next = el.clientHeight < 300;
      el.toggleAttribute('data-short-input', next);
      if (compact && !next) {
        el.scrollTop = 0;
        const form = el.querySelector('[data-testid="login-form"]');
        if (form) form.scrollTop = 0;
      }
      compact = next;
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
    if (observer) observer.observe(el);
    else { window.addEventListener('resize', sync); window.visualViewport?.addEventListener('resize', sync); }
    sync();
    return () => {
      disposed = true; observer?.disconnect();
      window.removeEventListener('resize', sync); window.visualViewport?.removeEventListener('resize', sync);
    };
  }, []);
}
