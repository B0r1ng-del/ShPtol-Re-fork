// ui/gravityHud.js — 局内重力指示（危机合约 #4「滞空焦点」专用）。
//
// 战场上有两个重力按钮（stage rows 的 '<' = 左、'>' = 右），踩下哪个、这半边重力就朝哪边，最后踩的生效
// （data/stages-crisis.json special.gravity.desc）。规则全在 server/sim/content/devices.js 里跑，
// 这里只做一件事：把 b.snap.grav 的方向画出来，让玩家知道当前顺/逆重力。
//
// ★ 只在这个战场出现：b.snap.grav 只有装了 device 状态、且 stage 带 special.gravity 时才有值
//   （battle/events.js snapshot），别的图/别的赛季永远是 undefined，组件直接返回 null。
import { html, MicroLabel } from './components.js';
import { t } from '../../../shared/i18n.js';

const LABEL = { LEFT: '←', RIGHT: '→' };

/**
 * @param {{ grav?: { L: string|null, R: string|null } | null, class?: string }} props
 *   grav: m.field.snap.grav（左 / 右半场各自的重力方向，null = 还没人踩）
 */
export function GravityHud({ grav = null, class: cls }) {
  if (!grav) return null;
  const sides = [['L', grav.L], ['R', grav.R]].filter(([, d]) => d === 'LEFT' || d === 'RIGHT');
  if (!sides.length) return null;
  return html`<div class=${['gravhud', cls].filter(Boolean).join(' ')} data-testid="gravity-hud" role="status" aria-live="polite">
    <${MicroLabel} tone="gold">${t('重力')}</${MicroLabel}>
    ${sides.map(([side, d]) => html`<span key=${side} class="gravhud__side" data-side=${side} data-dir=${d}>
      <i class="gravhud__arrow num">${LABEL[d]}</i>
      <b class="gravhud__name">${side === 'L' ? t('左半场') : t('右半场')}</b>
    </span>`)}
  </div>`;
}
