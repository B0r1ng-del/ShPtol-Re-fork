import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { useSkins, selectedSkin } from './skinModel.js';
import { ensurePixi } from '../render/app/pixi.js';
import { createAssistantSpine, loadAssistantSpine } from './assistantSpine.js';

const BASE = '/css/battle-shop-ui/20261030-r1/resources/assets/';
let portraitIndex;
const unhashed = (url) => url?.replace(/\/~[a-f0-9]{8,64}\//, '/');

export function ShopPortrait({ m, chess, children }) {
  useSkins();
  const [index, setIndex] = useState(null);
  const [failed, setFailed] = useState(null);
  useEffect(() => {
    if (!portraitIndex) {
      portraitIndex = fetch(`${BASE}ui/shop-portraits-20261029/index.json`)
        .then((res) => res.ok ? res.json() : null)
        .then((doc) => doc?.version === 1 && doc.scope === 'shop-operator-portraits' ? doc.images : null)
        .catch(() => null);
    }
    let alive = true;
    portraitIndex.then((rows) => { if (alive) setIndex(rows); });
    return () => { alive = false; };
  }, []);
  const id = chess?.charId;
  const rec = m?.chars?.[id];
  // Local selected skins and custom appearances stay on the existing owner-aware portrait chain.
  const row = !selectedSkin(id) && rec && index && ['elite', 'base'].map((k) => index[`${id}|${k}`]).find((candidate) => {
    if (!candidate || !/^\/css\/battle-shop-ui\/20261030-r1\/resources\/assets\/ui\/shop-portraits-20261029\/[a-f0-9]{24}\.webp$/.test(candidate.url)) return false;
    return [rec.portraitE2, rec.illustE2, rec.portrait, rec.illust, rec.avatar].some((src) => {
      const hash = src?.match(/\/~([a-f0-9]{8,64})\//)?.[1];
      return src && unhashed(src) === unhashed(candidate.source) && (!hash || candidate.sourceSha256?.startsWith(hash));
    });
  });
  if (!row || row.url === failed) return children;
  return html`<img class="scard__art shop-operator-portrait" data-shop-portrait-mode=${row.mode} src=${row.url} alt="" draggable=${false} decoding="async" onError=${() => setFailed(row.url)} />`;
}

export function ProcurementAssistant() {
  const host = useRef(null);
  useEffect(() => {
    const el = host.current;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let alive = true, app, observer;
    const visibility = () => { if (app) { if (document.hidden || reduced.matches) app.stop(); else app.start(); } };
    const dispose = () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener('change', visibility);
      app?.destroy(true, { children: true, texture: false, baseTexture: false });
      app = null;
    };
    ensurePixi().then(async (P) => {
      if (!alive) return;
      const asset = await loadAssistantSpine(P, `${BASE}reference-ui/procurement/trap_1096_acshopup.json`, () => alive);
      if (!alive) return;
      const sp = createAssistantSpine(P, asset.spineData || asset);
      app = new P.Application({ width: 1, height: 1, backgroundAlpha: 0, resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
      el.appendChild(app.view);
      app.stage.addChild(sp);
      sp.autoUpdate = false;
      const idle = sp.spineData.animations.find((clip) => /^idle$/i.test(clip.name));
      if (idle) sp.state.setAnimation(0, idle.name, true);
      sp.update(0);
      const bounds = sp.getLocalBounds();
      const place = () => {
        const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
        app.renderer.resize(w, h);
        // Reflect within the same fitted bounds; the canvas clips animated parts that leave the window.
        const scale = Math.min(w * 0.96 / Math.max(1, bounds.width), h * 0.97 / Math.max(1, bounds.height));
        const left = (w - bounds.width * scale) * 0.38;
        sp.scale.set(-scale, -scale);
        sp.position.set(left + (bounds.x + bounds.width) * scale, h * 0.98 + bounds.y * scale);
        app.render();
      };
      app.ticker.maxFPS = 30;
      app.ticker.add(() => sp.update(Math.min(0.05, app.ticker.deltaMS / 1000)));
      observer = new ResizeObserver(place);
      observer.observe(el);
      document.addEventListener('visibilitychange', visibility);
      reduced.addEventListener('change', visibility);
      place();
      visibility();
      el.dataset.procurement = 'ready';
    }).catch((error) => {
      dispose();
      if (alive) { el.dataset.procurement = 'unavailable'; console.warn('[shop] procurement artwork', error); }
    });
    return () => { alive = false; dispose(); };
  }, []);
  return html`<span class="procurement-assistant" ref=${host} aria-hidden="true"></span>`;
}
