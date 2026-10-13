// Mod 开关 — the lobby's per-device gameplay switches (模式界面, beside 干员调配).
//
// WHAT THIS IS
// The 模式界面 carries a 「Mod」 button with a submenu of gameplay switches, laid out beside 干员调配. The switches are a
// LOCAL preference: they live in localStorage (`sp.pref.mods`), they are set on the lobby page only, and the creator
// carries them into the room it makes (`room.create.mods` — shared/constants.js MOD_KEYS). The room keeps them across
// its matches and the match reads them when it starts (server/match/gamedata.js GameData.mods), so a joiner plays the
// host's rules — the same way the mode and the difficulty work.
//
// Each switch defaults OFF, so a player who never opens the submenu creates exactly the official room: the server's
// GameData treats an absent switch as its default, and every caller that passes nothing (the golden scenarios, the
// rehearsal tools, every test) is byte-identical to before.
//
// The store mirrors ui/emotes.js: the preference itself is localStorage (`savePref` notifies nothing), so the lobby
// would keep rendering stale switches until some unrelated frame arrived. The store is what re-renders it.

import { useState } from '../../vendor/hooks.module.js';
import { loadPref, savePref, createStore, useStore } from '../store.js';
import { MOD_KEYS, MOD_DEFAULTS, normalizeMods } from '../../../shared/constants.js';
import { html, Fragment, Icon, Button, Modal, SwitchRow } from './components.js';
import { t, N_ } from '../../../shared/i18n.js';

/** localStorage key under the app's `sp.pref.` prefix (store.js loadPref/savePref). */
export const PREF_MODS = 'mods';

/** Read the switches from this device, normalised to exactly MOD_KEYS booleans (a corrupt value is all-off). */
export function modsOn() {
  return normalizeMods(loadPref(PREF_MODS, MOD_DEFAULTS));
}

/**
 * The switches as a tiny store, so flipping one re-renders the lobby's submenu and its badge.
 * @type {ReturnType<typeof createStore>}
 */
export const modsStore = createStore(modsOn());

/** Set one switch: persist it for this device and notify every screen that shows it. Unknown keys are ignored. */
export function setMod(key, on) {
  if (!MOD_KEYS.includes(key)) return;
  savePref(PREF_MODS, { ...modsOn(), [key]: on === true });
  modsStore.set(modsOn());
}

/** How many switches are on (the Mod button's badge; 0 = the button shows no count). */
export function modsCount(mods = null) {
  const m = mods || modsOn();
  return MOD_KEYS.reduce((n, k) => n + (m[k] === true ? 1 : 0), 0);
}

/** Hook: the switches of this device (re-renders on `setMod`). */
export function useMods() {
  return useStore((s) => s, Object.is, modsStore);
}

/**
 * The submenu's rows, in display order: `key` (MOD_KEYS), `label` the switch's text and `tip` its one-line
 * explanation — both msgids (N_: the table is built once, before a language can change; the component calls t()
 * where they are shown). One row per switch the submenu offers.
 */
export const MOD_ROWS = Object.freeze([
  { key: 'noBondBan', label: N_('关闭盟约禁用'), tip: N_('所有模式都不再禁用盟约：既不会有随机禁用，也不会保留模式固有的禁用盟约') },
  { key: 'untimedSp', label: N_('机变不限时'), tip: N_('所有模式的机变阶段都不再有时间限制，全部选择完毕后结束') },
  { key: 'randomSpVote', label: N_('机变随机分配'), tip: N_('所有模式的机变阶段都可以投票「随机分配」：过半即由系统随机发放（悬赏决策除外）') },
  { key: 'extraRounds', label: N_('额外 4 回合'), tip: N_('所有模式的回合数由 14 回合变为 18 回合，新增的 4 回合都是普通回合，Boss 回合相应后移到第 18 回合') },
  { key: 'targetedPick', label: N_('定向甄选'), tip: N_('三个相同干员合为进阶干员时，奖励的高阶干员三选一改为从当前已激活最高层数的盟约旗下的干员中随机') },
]);

/**
 * The Mod submenu of the 模式界面: one switch row per MOD_ROWS entry, opened by <ModButton/>. It is a local
 * preference — the switches apply to the room this device creates, and a joiner plays the host's rules.
 *
 * Each row is the shared <SwitchRow/> (图二, 2026-10-13): the name on the left, a pill switch on the right, and the
 * one-line explanation behind the ⓘ after the name — on hover on a desktop, on a long press on a phone.
 */
function ModDialog({ open, onClose, mods, onToggle }) {
  return html`<${Modal} open=${open} onClose=${onClose} tone="mint" width="min(7.6rem, 96vw)"
      title=${t('Mod 开关')} micro="MOD SWITCHES"
      actions=${html`<${Button} variant="secondary" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="mods">
      <p class="mods__note">${t('这些开关只在本机保存，进入房间时随你创建的房间一起生效；加入他人的房间时以房主的设置为准。')}</p>
      <div class="mods__rows">
        ${MOD_ROWS.map((r) => html`<${SwitchRow} key=${r.key}
          label=${t(r.label)} tip=${t(r.tip)} on=${mods[r.key] === true}
          testid=${`mod-${r.key}`} infoTestid=${`mod-info-${r.key}`}
          onChange=${(v) => onToggle(r.key, v)} />`)}
      </div>
    </div>
  <//>`;
}

/**
 * The 模式界面's Mod button (the 干员调配 button's shape, laid out beside it): opens the submenu above and carries a
 * count of the switches that are on. Local to the lobby page — the submenu is not offered anywhere else.
 *
 * The dialog is a SIBLING of the button, never a child (Fragment, the same shape as 房主配置's button/dialog pair in
 * screens/room.js). Nesting it inside the `<button>` broke four things at once, all reproduced in a real browser:
 *   * `.btn:active` is `transform: translateY(1px)` on the ancestor, and ANY transform makes that element the
 *     containing block of a `position: fixed` descendant — so pressing anywhere in the dialog (a switch included)
 *     re-anchored the whole dialog to the button's ~76×36 box in the top-right corner (the reported 卡在右上角);
 *   * a tap needs pointerdown and pointerup on the SAME element: the press moved the dialog out from under the
 *     pointer, so the click never fired and a switch could not be flipped (功能无法启用);
 *   * a click inside the dialog bubbled to the button's own onClick, which ran `setOpen(true)` again (反复弹出);
 *   * the 完成 button's click did the same, so 完成 could not close it (Esc still worked — it never went through
 *     the button).
 * A `<button>` also may not contain interactive content, which is what made the nested switches invalid markup.
 */
export function ModButton({ class: cls }) {
  const mods = useMods();
  const [open, setOpen] = useState(false);
  const n = modsCount(mods);
  return html`<${Fragment}>
    <button type="button" class=${`btn btn--secondary btn--md mods-entry${cls ? ` ${cls}` : ''}`} data-testid="mod-open"
        onClick=${() => setOpen(true)} title=${t('Mod 开关 · 游戏性改动，只在本机保存')}>
      <${Icon} name="sliders" class="btn__icon" />
      <span class="btn__label">${t('Mod')}</span>
      ${n ? html`<span class="lo-entry__n num" aria-label=${t('{n} 项已开启', { n })}>${n}</span>` : null}
    </button>
    ${open ? html`<${ModDialog} open=${true} onClose=${() => setOpen(false)} mods=${mods} onToggle=${setMod} />` : null}
  <//>`;
}
