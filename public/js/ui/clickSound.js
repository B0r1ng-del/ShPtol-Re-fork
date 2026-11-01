// ui/clickSound.js — 点击音效（需求方 2026-11-01：「找到原版点击音效，应用在所有点击行为后」）。
//
// 音效素材与通道**本来就有**：js/audio.js 的 sfx(name) 读 manifest.audio.sfx.ui[name]，
// data/assets.json 里 click 已指向 /assets/audio/sfx/general/g_ui/g_ui_btn_h.mp3（官方 UI 按钮音）。
// 缺的只是一次全局接管 —— 此前全项目只有 7 处手写 audio.sfx('click')，大厅、干员调配、设置都没音。
//
// 判据（需求方选择「只接管明确的按钮」）：只认 <button>、[role=button]、.tapx 三类，
// 不接管任意可点元素 —— 否则拖动结束、右键菜单、canvas 里的选格都会跟着响。
// disabled / aria-disabled 的按钮不响（它本来也点不动）。

import { audio } from '../audio.js';

/** @type {string[]} */
const TARGETS = ['button', '[role="button"]', '.tapx'];
const SELECTOR = TARGETS.join(',');

/**
 * Mount the global click cue once. Safe to call twice — the second call is ignored.
 * @returns {() => void} uninstall
 */
export function installClickSound() {
  if (globalThis.__spClickSound) return globalThis.__spClickSound;
  /** @param {MouseEvent} e */
  const onPointerUp = (e) => {
    // 只认左键/触摸/笔；右键与中键保持安静
    if (e.button !== undefined && e.button !== 0) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    const el = t.closest(SELECTOR);
    if (!el) return;
    // 点不动的元素不发声
    if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') return;
    try { audio.sfx('click', { volume: 0.35 }); } catch { /* 静音或未解锁：忽略 */ }
  };
  // pointerup 而不是 click：键盘 Enter 也会触发 click，但 pointerup 只对应真实点击，
  // 键盘操作另有自己的确认音（settings 里的 testSound），不会重复。
  document.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });
  const off = () => document.removeEventListener('pointerup', onPointerUp, { capture: true });
  globalThis.__spClickSound = off;
  return off;
}
