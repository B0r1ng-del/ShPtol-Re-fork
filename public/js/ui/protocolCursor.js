import {CURSOR_SHEET} from './protocolCursorSheet.js';
const installed = new WeakMap();
const BLOCKED = ':disabled,[aria-disabled="true"],.is-disabled,.is-taken,[data-sp-cursor="blocked"]';
const DRAGGABLE = '[draggable="true"],[data-sp-cursor="grab"],.assistant-editor__stage,.ewheel__viewport,.bdps,.steam__cards,.ff-piece.is-draggable,.testconsole__head,input[type="range"]';
const TEXT = 'textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="password"],input[type="number"],input[type="url"],input[type="tel"]';
export const CURSOR_POOL_SIZE = 8;

// R3's moving hardware-cursor PNG/SVG pipeline is deliberately unused. A single
// decoded sheet is drawn in the page. Input writes its local position directly;
// only sprite animation waits for rAF, so movement never queues behind a tick.
// Native cursor hiding is armed only after a visible decoded replacement exists.
export function installProtocolCursor({doc = globalThis.document, win = globalThis.window} = {}) {
  if (!doc?.documentElement || !doc.body || !win) return null;
  if (installed.has(doc)) return installed.get(doc);
  const root = doc.documentElement;
  const fine = win.matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const raf = win.requestAnimationFrame?.bind(win) || globalThis.requestAnimationFrame?.bind(globalThis);
  const caf = win.cancelAnimationFrame?.bind(win) || globalThis.cancelAnimationFrame?.bind(globalThis);
  const host = doc.createElement('div');
  host.className = 'sp-pointer-feedback';
  host.hidden = true;
  host.setAttribute('aria-hidden', 'true');
  const pointer = doc.createElement('div'), clip = doc.createElement('div'), image = doc.createElement('img'), cue = doc.createElement('i');
  pointer.className = 'sp-pointer-visual'; pointer.hidden = true;
  clip.className = 'sp-pointer-sprite'; image.alt = ''; image.draggable = false; image.decoding = 'async';
  image.width = CURSOR_SHEET.width; image.height = CURSOR_SHEET.height;
  cue.className = 'sp-pointer-cue'; clip.append(image); pointer.append(clip, cue); host.append(pointer);
  const nodes = Array.from({length:CURSOR_POOL_SIZE}, () => {
    const n = doc.createElement('span'), art = doc.createElement('i');
    n.hidden = true; n.className = 'sp-pointer-click'; n.append(art); host.append(n);
    return {n, art, animation:null};
  });
  const topLayer = typeof host.showPopover === 'function';
  if (topLayer) host.setAttribute('popover', 'manual');
  doc.body.append(host);
  const listeners = [];
  let ready = false, enabled = false, visible = false, destroyed = false, draggingNative = false;
  let point = null, target = null, down = false, frameRequest = 0, animation = null, animationStart = null;
  let frame = -1, mode = 'default', transform = '', index = 0, active = 0;
  let moves = 0, renders = 0, localStyleWrites = 0, rootTransitions = 0;
  let bounds = {width:win.innerWidth, height:win.innerHeight};
  const listen = (node, type, fn, options) => {
    if (!node?.addEventListener) return;
    node.addEventListener(type, fn, options); listeners.push(() => node.removeEventListener(type, fn, options));
  };
  const blocked = () => !!target?.closest?.(BLOCKED);
  const hide = () => {
    if (frameRequest) caf?.(frameRequest);
    frameRequest = 0; animation = null; animationStart = null;
    pointer.hidden = true;
    if (visible) {root.classList.remove('sp-pointer-rendered'); rootTransitions++;}
    visible = false;
    if (topLayer && host.matches(':popover-open')) host.hidePopover();
  };
  const clear = () => {
    point = null; target = null; down = false; hide();
    for (const item of nodes) {item.animation?.cancel(); item.animation = null; item.n.hidden = true;}
    active = 0;
  };
  // A popover outside a modal dialog remains in that dialog's inert subtree.
  // Keep the pointer in the focused modal scope as well as on top of the layer.
  let modalScope = null;
  const syncScope = () => {
    const focused = doc.activeElement?.closest?.('dialog:modal');
    modalScope = focused || [...doc.querySelectorAll('dialog:modal')].at(-1) || null;
    const parent = modalScope || doc.fullscreenElement || doc.body;
    if (host.parentNode !== parent) {
      if (topLayer && host.matches(':popover-open')) host.hidePopover();
      parent.append(host);
    }
  };
  const ensureHost = () => {
    try {
      if (!host.isConnected) syncScope();
      if (topLayer && !host.matches(':popover-open')) host.showPopover();
      else if (!topLayer && doc.fullscreenElement && host.parentNode !== doc.fullscreenElement) doc.fullscreenElement.append(host);
      return host.isConnected;
    } catch {return false;}
  };
  const setFrame = next => {
    if (frame === next) return;
    frame = next; image.style.transform = `translate3d(${-CURSOR_SHEET.size * frame}px,0,0)`; localStyleWrites++;
  };
  const now = () => win.performance?.now?.() ?? 0;
  const schedule = () => {if (!frameRequest && raf) frameRequest = raf(tick);};
  function tick(time) {
    frameRequest = 0;
    paint(time);
  }
  function paint(time) {
    if (destroyed || !enabled || !point || doc.hidden || draggingNative || doc.pointerLockElement ||
        point.x < 0 || point.y < 0 || point.x >= bounds.width || point.y >= bounds.height || !ensureHost()) {hide(); return;}
    renders++;
    const isBlocked = blocked();
    if (isBlocked) {down = false; animation = null; animationStart = null;}
    let nextFrame = down ? CURSOR_SHEET.pressed : CURSOR_SHEET.idle;
    if (animation) {
      const clip = CURSOR_SHEET.animations[animation];
      if (animationStart == null) animationStart = time;
      const p = Math.min(1, (time - animationStart) / clip.duration);
      if (p < 1) {nextFrame = clip.frames[Math.round(p * (clip.frames.length - 1))]; schedule();}
      else {animation = null; animationStart = null;}
    }
    setFrame(nextFrame);
    const nextMode = isBlocked ? 'blocked' : target?.isContentEditable || target?.closest?.(TEXT) ? 'text' : target?.closest?.(DRAGGABLE) ? (down ? 'grabbing' : 'grab') : 'default';
    if (nextMode !== mode) {mode = nextMode; pointer.dataset.mode = mode;}
    const nextTransform = `translate3d(${point.x - CURSOR_SHEET.hotspot[0]}px,${point.y - CURSOR_SHEET.hotspot[1]}px,0)`;
    if (nextTransform !== transform) {pointer.style.transform = nextTransform; transform = nextTransform; localStyleWrites++;}
    pointer.hidden = false;
    // This is the only cursor:none transition. Image decode and host visibility
    // are already established; loading/errors/blur/leave always restore native.
    if (!visible) {root.classList.add('sp-pointer-rendered'); rootTransitions++; visible = true;}
  }
  const updateBounds = () => {
    bounds = {width:root.clientWidth || win.innerWidth, height:root.clientHeight || win.innerHeight}; schedule();
  };
  const capability = () => {
    enabled = ready && !!fine.matches;
    root.classList.toggle('sp-pointer-enabled', enabled);
    if (!enabled) clear(); else {updateBounds(); schedule();}
  };
  const over = e => {
    if (e.pointerType === 'touch') {clear(); return;}
    moves++;
    point = {x:e.clientX, y:e.clientY}; target = e.target?.closest ? e.target : null;
    down = !!(e.buttons & 3);
    // Capture-phase input can arrive before other game handlers or an already
    // queued animation tick. Apply the latest position now, without waiting for
    // either. Painting is still browser/main-thread work, not a hardware cursor.
    if (enabled && !draggingNative) paint(now());
  };
  const animateCursor = key => {
    animation = reduced.matches ? null : key; animationStart = null; paint(now());
  };
  const press = e => {
    if (!enabled || e.pointerType === 'touch' || ![0,2].includes(e.button)) return;
    over(e); if (blocked()) {down=false; animation=null; animationStart=null; return;}
    down = true; animateCursor('down');
    const item = nodes[index++ % nodes.length];
    if (item.animation) {item.animation.cancel(); active = Math.max(0, active - 1);}
    item.n.hidden = false; item.art.classList.toggle('is-secondary', e.button === 2);
    item.n.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0)`;
    if (!item.art.animate) {item.n.hidden = true; return;}
    const frames = reduced.matches ? [{opacity:.75},{opacity:0}] : [{opacity:1,transform:'translate(-50%,-50%) rotate(45deg) scale(.35)'},{opacity:.7,offset:.25},{opacity:0,transform:'translate(-50%,-50%) rotate(45deg) scale(1.6)'}];
    active++;
    const a = item.art.animate(frames,{duration:reduced.matches?100:340,easing:'ease-out'}); item.animation = a;
    a.finished.then(() => {if (item.animation !== a) return; item.animation = null; item.n.hidden = true; active = Math.max(0,active-1);}, () => {});
  };
  const release = () => {const held = down; down = false; if (held) animateCursor('up'); else schedule();};
  const promote = e => {
    if (e.target === host) return;
    if (e.target?.tagName === 'DIALOG') {syncScope(); schedule();}
    if (!visible || e.newState !== 'open' || !topLayer) return;
    // A newly opened dialog/popover must not cover the already decoded pointer.
    try {if (host.matches(':popover-open')) host.hidePopover(); host.showPopover();} catch {clear();}
  };
  listen(doc,'pointerover',over,{passive:true,capture:true}); listen(doc,'pointermove',over,{passive:true,capture:true});
  listen(doc,'pointerdown',press,{passive:true,capture:true}); listen(win,'pointerup',release,{passive:true});
  listen(doc,'pointerout',e=>{if(e.relatedTarget==null)clear();},{passive:true});
  listen(win,'pointercancel',clear,{passive:true}); listen(win,'blur',clear);
  listen(win,'resize',updateBounds); listen(win.visualViewport,'resize',updateBounds); listen(win.visualViewport,'scroll',clear);
  listen(doc,'fullscreenchange',()=>{
    // Fullscreen events can arrive after the first new pointermove. Preserve
    // that last position while resetting press/feedback, then redraw once.
    const lastPoint=point,lastTarget=target;clear();point=lastPoint;target=lastTarget;
    if(!topLayer) (doc.fullscreenElement||doc.body).append(host);updateBounds();
  });
  listen(doc,'visibilitychange',()=>{if(doc.hidden)clear();}); listen(doc,'pointerlockchange',clear);
  listen(doc,'contextmenu',clear,{passive:true});
  listen(doc,'dragstart',()=>{draggingNative=true;clear();},{passive:true,capture:true});
  listen(doc,'dragend',()=>{draggingNative=false;clear();},{passive:true,capture:true});
  listen(doc,'toggle',promote,{capture:true});
  listen(doc,'close',e=>{if(e.target?.tagName==='DIALOG'){syncScope();schedule();}},{capture:true});
  // Preact removes its body-portalled dialog on close without calling close().
  // Observe only body child changes, never the game DOM subtree or pointer moves.
  const Observer = win.MutationObserver || globalThis.MutationObserver;
  const scopeObserver = Observer ? new Observer(()=>{
    if (modalScope && !modalScope.isConnected) {syncScope();schedule();}
  }) : null;
  scopeObserver?.observe(doc.body,{childList:true});
  syncScope();
  fine.addEventListener?.('change',capability); reduced.addEventListener?.('change',clear);
  const fail = () => {if(destroyed)return;ready=false;capability();};
  image.onerror = fail;
  image.onload = () => {
    const decoded = image.decode ? image.decode() : Promise.resolve();
    decoded.then(() => {
      if (destroyed) return;
      if (image.naturalWidth !== CURSOR_SHEET.width || image.naturalHeight !== CURSOR_SHEET.height) {fail();return;}
      // One startup check, never a pointer-event/layout read. Missing CSS must
      // leave the host hidden and the native cursor usable during partial loads.
      const readStyle = win.getComputedStyle?.bind(win) || globalThis.getComputedStyle?.bind(globalThis);
      const css = readStyle?.(host);
      if (!css || css.position !== 'fixed' || css.pointerEvents !== 'none') {fail();return;}
      host.hidden = false;
      ready = true; capability();
    },fail);
  };
  image.src = CURSOR_SHEET.url;
  capability();
  const api = {
    stats:()=>({ready,enabled,visible,active,poolSize:nodes.length,cursorAnimation:animation,mode,frame,moves,renders,localStyleWrites,rootTransitions,encodes:0,readbacks:0}),
    destroy() {
      if (destroyed) return; destroyed = true; clear();
      scopeObserver?.disconnect();
      for (const off of listeners) off(); fine.removeEventListener?.('change',capability); reduced.removeEventListener?.('change',clear);
      image.onload = image.onerror = null; host.remove(); root.classList.remove('sp-pointer-enabled','sp-pointer-rendered','sp-pointer-link','sp-pointer-down','sp-pointer-animating');
      for(const key of ['default','hover','pressed','frame','visible'])root.style.removeProperty('--sp-pointer-'+key);
      delete root.dataset.spPointerMode; installed.delete(doc);
    },
  };
  installed.set(doc,api); return api;
}
