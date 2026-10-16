// Mod 菜单 (fork) — the 内容包 switches' own dialog, opened from the 选择模拟协议 screen.
//
// WHY IT IS HERE AND NOT IN 房主配置
// 2026-10-16 (owner): the Mod submenu's two columns went to different places. The five game-rule switches (关闭盟约禁用 …
// 解除叠层上限) are room rules and moved into 房主配置 → 「对局选项」. The three 内容包 switches (莱茵生命 / 谬因·并入莱茵 /
// 收藏品玩法) decide what CONTENT a room contains, and a player wants to see that before making the room — so they get
// their own button next to 干员调配, and the dialog the owner asked for.
//
// WHAT IT EDITS
// The lobby has no room yet, so this edits the DEVICE preference (ui/mods.js `modsOn` / `rememberMods`, the same
// localStorage entry the old submenu wrote) and `room.create` carries it in — exactly the path the previous Move kept.
// A host who wants to change them once the room exists uses 房主配置, which writes the room itself (room.setMods); the
// two surfaces edit the same MOD_KEYS, so neither can disagree with the other about what a switch means.

import { html, Fragment, Modal, Button, SwitchRow } from '../ui/components.js';
import { useState } from '../../vendor/hooks.module.js';
import { t } from '../../../shared/i18n.js';
import { PACK_AUTHORS } from '../../../shared/constants.js';
import { MOD_PACK_ROWS, modsOn, rememberMods } from '../ui/mods.js';

/**
 * The 「Mod 菜单」 dialog: one switch per ported 内容包 (MOD_PACK_ROWS), each with its author in the ⓘ beside it.
 *
 * The switches are a device preference, so there is no disabled/read-only state — nothing here is another player's to
 * set. That is the one real difference from the same rows in 房主配置, where only the host may flip them.
 *
 * @param {{ open: boolean, onClose: () => void }} props
 */
export function ModMenuDialog({ open, onClose }) {
  // seeded from the stored preference; the dialog owns the draft and writes it through on every flip (so closing it
  // without a 保存 button still keeps the choice, like the submenu it replaces)
  const [mods, setMods] = useState(() => modsOn());
  const set = (key, on) => {
    const next = { ...mods, [key]: on };
    setMods(next);
    rememberMods(next);
  };
  return html`<${Modal} open=${open} onClose=${onClose} tone="mint" width="min(8.2rem, 96vw)" class="modmenu-modal"
      title=${t('Mod 菜单')} micro="MOD MENU"
      actions=${html`<${Button} variant="secondary" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="modmenu" data-testid="mod-menu">
      <p class="modmenu__note">${t('这些内容包默认全部关闭（原版内容）。开启后创建的房间会包含它们，房间内的玩家同样生效；房间创建后仍可在房主配置里修改。')}</p>
      <div class="modmenu__rows">
        ${MOD_PACK_ROWS.map((r) => html`<${SwitchRow} key=${r.key}
          label=${t(r.label)} tip=${`${t(r.tip)}\n${t('原作者：{author}', { author: PACK_AUTHORS[r.key] })}`}
          on=${mods[r.key] === true}
          testid=${`modmenu-${r.key}`} infoTestid=${`modmenu-info-${r.key}`}
          onChange=${(v) => set(r.key, v)} />`)}
      </div>
    </div>
  <//>`;
}

/** How many 内容包 switches are on (the lobby button's badge; 0 = no badge). */
export const modPackCount = (mods) => MOD_PACK_ROWS.reduce((k, r) => k + ((mods || modsOn())[r.key] === true ? 1 : 0), 0);

/**
 * The 选择模拟协议 screen's 「Mod 菜单」 button — 干员调配's own shape, sitting beside it in the top bar. The badge counts
 * the 内容包 switches that are on, so a player can see at a glance that the room they are about to make is not vanilla.
 *
 * ⚠️ The dialog is a **SIBLING** of the button, never a child. It shipped nested inside `<Button>`'s children, and a
 * `<button>` cannot contain another `<button>` (`Modal`'s own 完成 button and every switch): the HTML parser force-closes
 * the outer one, so the dialog was reparented, the close handler and the DOM structure disagreed, and 完成 re-opened the
 * dialog instead of dismissing it (需求方 2026-10-17: 「无法按完成退出，会反复弹出」). `ResumeMatchButton` (ui/resumeMatch.js)
 * is the same shape — button and `<Modal>` as siblings.
 *
 * @param {{ class?: string, variant?: string }} props
 */
export function ModMenuButton({ class: cls, variant = 'secondary' }) {
  const [open, setOpen] = useState(false);
  // re-read on open: another tab (or the room's own 房主配置) may have changed the preference since this button rendered
  const [n, setN] = useState(() => modPackCount());
  return html`<${Fragment}>
    <${Button} variant=${variant} size="md" icon="sliders" class=${cls} data-testid="mod-menu-open"
        onClick=${() => { setN(modPackCount()); setOpen(true); }}>
      <span class="btn__label">${t('Mod 菜单')}</span>
      ${n ? html`<span class="lo-entry__n num" aria-label=${t('{n} 项已开启', { n })}>${n}</span>` : null}
    <//>
    <${ModMenuDialog} open=${open} onClose=${() => setOpen(false)} />
  <//>`;
}
