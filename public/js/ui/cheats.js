// 作弊菜单 (the floating cheat ball) — a device-local development aid that floats over the in-match screen.
//
// WHAT THIS IS
// A draggable ball in a corner of the battle screen. Tapping it opens the three cheats the owner asked for:
//
//   无限金币       a switch  — while on the player cannot run out of funds; turning it off restores the funds they had
//                              when they turned it on
//   免费刷新 +5    a button  — one press adds 5 free shop refreshes
//   怪物血量降为1血 a switch  — every enemy of the player's OWN battles drops to 1 HP
//
// WHO IT IS FOR
// This is a LOCAL aid, not a room rule. The ball only ever shows when this device turned it on in 设置
// (`sp.pref.cheats` — `PREF_CHEATS`), which defaults OFF, so a normal player never sees it and the official game is
// untouched. Each cheat is also PER PLAYER on the server (`PlayerState.cheats`): the state lives on the player, the
// enemy-HP switch is read only while building that player's own normal field, and 联防 / boss fields never read it.
// Two players in one room can therefore have different cheats on without touching each other — the owner's
// 「所有作弊功能只对开启的玩家生效」.
//
// WHEN IT WORKS
// PREP only: the server refuses `g.cheat` outside `PHASE.PREP` and once the player is ready (`Match.cheat`), and this
// panel disables its controls to match, so the UI never offers an action the server would reject.

import { useState, useRef, useEffect } from '../../vendor/hooks.module.js';
import { loadPref, savePref, createStore, useStore } from '../store.js';
import { CHEAT_KEYS, CHEAT_DEFAULTS } from '../../../shared/constants.js';
import { html } from './components.js';
import { t, N_ } from '../../../shared/i18n.js';

/** localStorage key (under the app's `sp.pref.` prefix) for the "show the cheat ball at all" preference. */
export const PREF_CHEATS = 'cheatBall';

/** Is the cheat ball enabled on this device? Default false — the ball is invisible until the player asks for it. */
export function cheatBallOn() {
  return loadPref(PREF_CHEATS, false) === true;
}

/**
 * The "show the ball" preference as a tiny store, so the 设置 switch re-renders every screen that shows the ball.
 * `createStore` keeps an OBJECT and merges patches into it (store.js), so the flag lives under `on` rather than being
 * the state itself — `createStore(false)` would spread to `{}`, which is truthy and would show the ball to everyone.
 * @type {ReturnType<typeof createStore>}
 */
export const cheatBallStore = createStore({ on: cheatBallOn() });

/** Turn the ball on or off for this device. */
export function setCheatBall(on) {
  savePref(PREF_CHEATS, on === true);
  cheatBallStore.set({ on: on === true });
}

/** Hook: is the ball enabled on this device (re-renders on `setCheatBall`). */
export function useCheatBall() {
  return useStore((s) => s.on === true, Object.is, cheatBallStore);
}

/** Where the ball sits, as a fraction of the viewport, so it keeps its corner across screen sizes (and phone rotation). */
export const CHEAT_BALL_POS = 'cheatBallPos';

/** The ball's stored position `{ x, y }` as viewport fractions, or null to use the default corner. */
export function cheatBallPos() {
  const v = loadPref(CHEAT_BALL_POS, null);
  if (!v || typeof v !== 'object') return null;
  const { x, y } = v;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/** Remember where the player dragged the ball to (viewport fractions). */
export function setCheatBallPos(x, y) {
  savePref(CHEAT_BALL_POS, { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
}

/** The three cheats, in display order: `key` (`set` switch) or `action` (a one-shot), plus its label. */
export const CHEAT_ROWS = Object.freeze([
  { kind: 'switch', key: 'infiniteFunds', label: N_('无限金币') },
  { kind: 'action', action: 'freeRefresh', label: N_('免费刷新 +5') },
  { kind: 'switch', key: 'enemyOneHp', label: N_('怪物血量降为 1 血') },
]);

/**
 * The cheat ball and its panel.
 *
 * `cheats` is the server's view of THIS player's switches (m.private → `cheats`), `canUse` is whether the server would
 * accept a change right now (PREP and not ready), and `onSet` / `onFreeRefresh` send the intent. Everything is
 * controlled: the panel renders whatever the server says, so a refused change simply does not stick.
 * @param {{ cheats?: any, canUse?: boolean, onSet?: (key: string, on: boolean) => void, onFreeRefresh?: () => void }} props
 */
export function CheatBall({ cheats = null, canUse = false, onSet, onFreeRefresh }) {
  const enabled = useCheatBall();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(() => cheatBallPos());
  const drag = useRef(null);                   // the in-flight pointer drag (a ref: pointerup can arrive in the same tick)
  const posRef = useRef(pos);
  posRef.current = pos;
  const ballRef = useRef(null);
  const state = { ...CHEAT_DEFAULTS, ...(cheats && typeof cheats === 'object' ? cheats : {}) };

  // A drag follows the pointer anywhere on the page, and a plain tap toggles the panel. The listeners are attached ONCE
  // and consult the ref: attaching them from a `[drag]` effect loses the `pointerup` of a fast click (the effect has not
  // run yet), which is exactly how a tap regressed into doing nothing.
  useEffect(() => {
    const move = (e) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      if (!d.moved && Math.hypot(dx, dy) < 6) return;   // below the threshold this is still a tap
      d.moved = true;
      // keep the ball fully on screen: the fractions map the ball's CENTRE, so clamp with a margin
      const m = 0.02;
      setPos({
        x: Math.min(1 - m, Math.max(m, d.px + dx / Math.max(1, window.innerWidth))),
        y: Math.min(1 - m, Math.max(m, d.py + dy / Math.max(1, window.innerHeight))),
      });
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (d.moved) {
        const p = posRef.current;
        if (p) setCheatBallPos(p.x, p.y);   // a real drag remembers where it landed
      } else {
        setOpen((o) => !o);                 // a tap opens / closes the panel
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  if (!enabled) return null;

  const start = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    // anchor the drag to where the BALL actually is: with no stored position it sits in the CSS default corner
    // (bottom-right), so assuming a position here would make the first drag jump. The ref is on the button itself, never
    // on the wrapper — the wrapper also holds the open panel, which would drag the measured centre off the ball.
    const r = ballRef.current ? ballRef.current.getBoundingClientRect() : null;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const px = r ? (r.x + r.width / 2) / w : 1;
    const py = r ? (r.y + r.height / 2) / h : 0.5;
    drag.current = { x0: e.clientX, y0: e.clientY, px, py, moved: false };
  };

  // `right:auto` / `bottom:auto` are NOT optional: the stylesheet anchors the default corner with `right`/`bottom`, and
  // a `position: fixed` box that is given all four offsets is over-constrained — it stretches to fill the gap instead of
  // sitting at the point, and `translate(-50%,-50%)` then throws it off screen (measured: 40×40 at (1346,846) became
  // 1092×688 at (-252,-146)). Clearing the two the inline style replaces keeps the box exactly the ball.
  const style = pos
    ? `left:${(pos.x * 100).toFixed(2)}%; top:${(pos.y * 100).toFixed(2)}%; right:auto; bottom:auto; transform:translate(-50%,-50%)`
    : null;
  // Which way the panel opens. A position is stored as viewport FRACTIONS, so it settles this on its own; with no stored
  // position the ball sits in the CSS default corner (bottom-RIGHT, see game-panels.css), which is the `false` branch.
  const opensLeft = pos ? pos.x >= 0.5 : false;
  // and vertically: anchored to the ball's centre it can overflow, so a ball low on the screen opens the panel upward
  const opensUp = pos ? pos.y >= 0.5 : true;

  return html`<div class="cheatball" style=${style} data-testid="cheat-ball">
  <button type="button" class="cheatball__btn" ref=${ballRef} aria-label=${t('作弊菜单')} title=${t('作弊菜单')}
    aria-expanded=${open ? 'true' : 'false'} data-testid="cheat-ball-btn"
    onPointerDown=${start}>🎮</button>
  ${open ? html`<div class="cheatball__panel cheatball__panel--${opensLeft ? 'left' : 'right'} cheatball__panel--${opensUp ? 'up' : 'down'}" data-testid="cheat-panel">
    <div class="cheatball__head">${t('作弊菜单')}</div>
    ${CHEAT_ROWS.map((r) => (r.kind === 'switch'
      ? html`<div class="cheatball__row" key=${r.key}>
          <span class="cheatball__label">${t(r.label)}</span>
          <button type="button" class=${`sw${state[r.key] === true ? ' is-on' : ''}`} role="switch"
            aria-checked=${state[r.key] === true ? 'true' : 'false'} aria-label=${t(r.label)}
            disabled=${!canUse} data-testid=${`cheat-${r.key}`}
            onClick=${() => canUse && onSet && onSet(r.key, state[r.key] !== true)}>
            <span class="sw__knob" aria-hidden="true"></span>
          </button>
        </div>`
      : html`<div class="cheatball__row" key=${r.action}>
          <span class="cheatball__label">${t(r.label)}</span>
          <button type="button" class="btn btn--small" disabled=${!canUse}
            data-testid=${`cheat-${r.action}`}
            onClick=${() => canUse && onFreeRefresh && onFreeRefresh()}>+5</button>
        </div>`))}
    ${canUse ? null : html`<div class="cheatball__hint" data-testid="cheat-hint">${t('仅在备战阶段可用')}</div>`}
  </div>` : null}
</div>`;
}
