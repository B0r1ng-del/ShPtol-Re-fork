import { useLayoutEffect } from '../../vendor/hooks.module.js';

/** One compositor-only entrance per title mount. Input always remains immediately usable. */
export function useTitleEntrance(surface, enabled = true) {
  useLayoutEffect(() => {
    const el = surface.current;
    if (!el) return;
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    let timer = 0;
    const finish = () => {
      clearTimeout(timer);
      el.classList.remove('is-unfolding');
      el.classList.add('has-unfolded');
    };
    const visibility = () => {
      el.classList.toggle('is-motion-hidden', document.hidden);
      // A hidden entrance is completed rather than replayed when returning to the tab.
      if (document.hidden) finish();
    };
    const motion = () => { if (reduced?.matches) finish(); };
    if (enabled && !reduced?.matches && !document.hidden) {
      el.classList.add('is-unfolding');
      timer = setTimeout(finish, 1100);
    } else finish();
    el.addEventListener('pointerdown', finish, { passive: true });
    document.addEventListener('keydown', finish);
    document.addEventListener('visibilitychange', visibility);
    reduced?.addEventListener('change', motion);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('pointerdown', finish);
      document.removeEventListener('keydown', finish);
      document.removeEventListener('visibilitychange', visibility);
      reduced?.removeEventListener('change', motion);
    };
  }, []);
}
