import { useCallback, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { portal } from './portalLite.js';
import { identity } from '../net.js';
import { t } from '../../../shared/i18n.js';

// A cold-title visual only. A page restored inside the game does not show it on a later return to title.
const restoredInside = identity.wasEntered();
let seenInDocument = false;
const motionQuery = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

export function useLoginArrival(surface, enabled = true) {
  const [active, setActive] = useState(() => {
    const play = enabled && !seenInDocument && !restoredInside && !document.hidden && !motionQuery()?.matches;
    seenInDocument = true;
    return play;
  });
  const playing = useRef(active), alive = useRef(true);
  const heldKey = useRef(null), teardown = useRef(() => {});
  const dismiss = useCallback(() => {
    if (!alive.current || !playing.current) return;
    playing.current = false;
    // A skip also ends the overlapping sheet reveal, without dispatching a synthetic input event.
    surface.current?.classList.remove('is-unfolding');
    surface.current?.classList.add('has-unfolded');
    setActive(false);
    if (!heldKey.current) teardown.current();
  }, [surface]);
  useLayoutEffect(() => {
    if (!playing.current) return () => { alive.current = false; };
    const reduced = motionQuery();
    let released = false;
    const skipArrivalKey = e => {
      if (heldKey.current && e.key === heldKey.current) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (!playing.current) return;
      if (e.key === 'Tab') { dismiss(); return; } // Preserve normal focus movement.
      // An already focused real control keeps its native behavior, including a single Enter submit.
      if (e.key !== 'Escape' && e.target?.closest?.('input,textarea,select,button,a[href]') && !e.target.closest('.login-arrival')) {
        dismiss(); return;
      }
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        heldKey.current = e.key;
        e.preventDefault(); e.stopImmediatePropagation(); dismiss();
      }
    };
    const releaseArrivalKey = e => { if (e.key === heldKey.current) heldKey.current = null; if (!playing.current) clear(); };
    const environmentExit = () => { heldKey.current = null; dismiss(); clear(); };
    const visibility = () => { if (document.hidden) environmentExit(); };
    const motion = () => { if (reduced?.matches) environmentExit(); };
    const clear = () => {
      if (released) return; released = true;
      document.removeEventListener('keydown', skipArrivalKey, true);
      document.removeEventListener('keyup', releaseArrivalKey, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', environmentExit);
      reduced?.removeEventListener('change', motion);
    };
    teardown.current = clear;
    document.addEventListener('keydown', skipArrivalKey, true);
    document.addEventListener('keyup', releaseArrivalKey, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', environmentExit);
    reduced?.addEventListener('change', motion);
    return () => {
      alive.current = false;
      heldKey.current = null;
      clear();
      teardown.current = () => {};
    };
  }, [dismiss]);
  return { active, dismiss };
}

export function LoginArrival({ onDismiss }) {
  const art = useRef(null), dismiss = useRef(onDismiss), fadeOut = useRef(() => {});
  dismiss.current = onDismiss;
  const [ready, setReady] = useState(false), [leaving, setLeaving] = useState(false);
  useLayoutEffect(() => {
    const image = art.current;
    if (!image) return;
    let disposed = false, decoding = false, exiting = false, firstPaint = 0, afterPaint = 0, visibleTimer = 0, exitFallback = 0;
    const finish = () => { if (!disposed) dismiss.current(); };
    // Loading never covers or blocks the usable login. A late/missing decorative asset is abandoned.
    const loadDeadline = setTimeout(finish, 1300);
    const beginFade = () => {
      if (disposed || exiting) return;
      exiting = true; clearTimeout(visibleTimer); clearTimeout(loadDeadline);
      setLeaving(true);
      // transitionend is the normal exit; this bounded fallback covers an interrupted CSS transition.
      exitFallback = setTimeout(finish, 360);
    };
    fadeOut.current = beginFade;
    const loaded = async () => {
      if (disposed || decoding) return;
      if (!image.naturalWidth) { finish(); return; }
      decoding = true;
      try { await image.decode(); } catch { finish(); return; }
      if (disposed) return;
      clearTimeout(loadDeadline);
      firstPaint = requestAnimationFrame(() => {
        if (disposed) return;
        if (document.hidden || !image.isConnected) { finish(); return; }
        setReady(true);
        // Let the decoded image reach a painted frame before starting the one-shot visible hold.
        afterPaint = requestAnimationFrame(() => {
          if (disposed) return;
          if (document.hidden) { finish(); return; }
          visibleTimer = setTimeout(beginFade, 2000);
        });
      });
    };
    image.addEventListener('load', loaded);
    image.addEventListener('error', finish);
    if (image.complete) void loaded();
    return () => {
      disposed = true;
      clearTimeout(loadDeadline); clearTimeout(visibleTimer); clearTimeout(exitFallback);
      fadeOut.current = () => {};
      cancelAnimationFrame(firstPaint); cancelAnimationFrame(afterPaint);
      image.removeEventListener('load', loaded); image.removeEventListener('error', finish);
    };
  }, []);
  const skip = e => { e.preventDefault(); e.stopPropagation(); if (ready) fadeOut.current(); else onDismiss(); };
  const faded = e => { if (leaving && e.target === e.currentTarget && e.propertyName === 'opacity') dismiss.current(); };
  return html`<${portal}><aside class="login-arrival" data-ready=${ready} data-leaving=${leaving} onTransitionEnd=${faded} aria-hidden=${ready ? undefined : 'true'} aria-label=${t('卫戍协议')} onClick=${skip}>
    <img ref=${art} class="login-arrival__art" src="/startup/login-rebuild-20261102/splash_arknights.png" alt="" decoding="async" fetchpriority="low"/>
    <span class="login-arrival__identity">${t('卫戍协议')} / ${t('盟约')}<small>${t('非官方同人作品')}</small></span>
    <button type="button" class="login-arrival__skip" onClick=${skip}>${t('跳过')} <span aria-hidden="true">››</span></button>
  </aside><//>`;
}
