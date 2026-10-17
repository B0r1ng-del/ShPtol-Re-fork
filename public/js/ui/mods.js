// Mod 开关 — the fork's gameplay switches (房主配置).
//
// WHAT THIS IS
// The switches used to be a per-device preference behind the 模式界面's 「Mod」 button: they lived in localStorage
// (`sp.pref.mods`), and the creator carried them into the room it made (`room.create.mods`, shared/constants.js
// MOD_KEYS). 2026-10-16 (owner): the whole left column moved into 房主配置 — the lobby's Mod button is gone, and every
// switch is now a ROOM option the host sets in the room (room.setMods), like the rest of 房主配置 (二.7). The panel is
// that dialog (screens/room.js), which already owns the SwitchRow layout this submenu used.
//
// WHY THE CATALOGUE LIVES HERE AND NOT IN room.js
// The rows carry `col` ('rule' / 'pack') and the pack rows are credited to their authors; test/fork-mod-rounds-and-pick
// and test/pack-switches read MOD_ROWS as the fork's record of what the switches ARE, independent of which panel draws
// them. room.js imports it.
//
// The per-device preference survives for one purpose: `room.create` carries the creator's last switches in, so a host
// does not start from all-off every time. `modsOn()` / `rememberMods()` are that path; the room's own state is what the
// panel reads and writes.

import { MOD_KEYS, MOD_DEFAULTS, normalizeMods } from '../../../shared/constants.js';
import { loadPref, savePref } from '../store.js';
import { N_ } from '../../../shared/i18n.js';

/** localStorage key under the app's `sp.pref.` prefix (store.js loadPref/savePref): the last switches this device used. */
export const PREF_MODS = 'mods';

/** Read the switches from this device, normalised to exactly MOD_KEYS booleans (a corrupt value is all-off). */
export function modsOn() {
  return normalizeMods(loadPref(PREF_MODS, MOD_DEFAULTS));
}

/** Remember the switches the host just set, so the next `room.create` on this device starts from them. */
export function rememberMods(mods) {
  savePref(PREF_MODS, normalizeMods(mods));
}

/** How many switches are on (the 房主配置 button's badge; 0 = the button shows no count). */
export function modsCount(mods) {
  const m = mods || modsOn();
  return MOD_KEYS.reduce((n, k) => n + (m[k] === true ? 1 : 0), 0);
}

/**
 * The panel's rows, in display order: `key` (MOD_KEYS), `label` the switch's text and `tip` its one-line explanation —
 * both msgids (N_: the table is built once, before a language can change; the panel calls t() where they are shown).
 *
 * 图三 (2026-10-14): TWO columns. The first is the game-rule switches (关闭盟约禁用 … 解除叠层上限) and the second the
 * ported 内容包 switches — one per pack, each credited to its author in the ⓘ beside it. The split is data
 * (`MOD_ROWS[].col`), so the layout never has to know a key by name.
 *
 * 2026-10-16 (owner): the two columns now go to DIFFERENT panels, so the split is also WHERE each row is shown:
 *   col 'rule' — the five game-rule switches live in 房主配置 → 「对局选项」, beside the enemy-buff sliders
 *                (screens/room.js `MatchOptionSection`).
 *   col 'pack' — the three 内容包 switches have their own 「Mod 菜单」 dialog, opened from a button next to 干员调配 on
 *                the 选择模拟协议 screen (screens/mods.js `ModMenuDialog`).
 * `MOD_COLS` and the per-col filter still decide the layout; only WHERE the columns are rendered changed.
 */
export const MOD_ROWS = Object.freeze([
  { col: 'rule', key: 'noBondBan', label: N_('关闭盟约禁用'), tip: N_('所有模式都不再禁用盟约：既不会有随机禁用，也不会保留模式固有的禁用盟约') },
  { col: 'rule', key: 'untimedSp', label: N_('机变不限时间'), tip: N_('所有模式的机变阶段都不再有时间限制，全部选择完毕后结束') },
  { col: 'rule', key: 'randomSpVote', label: N_('机变随机分配'), tip: N_('所有模式的机变阶段都可以投票「随机分配」：过半即由系统随机发放（悬赏决策除外）') },
  { col: 'rule', key: 'extraRounds', label: N_('额外 4 回合'), tip: N_('所有模式的回合数由 14 回合变为 18 回合，新增的 4 回合都是普通回合，Boss 回合相应后移到第 18 回合') },
  { col: 'rule', key: 'targetedPick', label: N_('定向甄选'), tip: N_('三个相同干员合为进阶干员时，奖励的高阶干员三选一改为从当前已激活最高层数的盟约旗下的干员中随机') },
  { col: 'rule', key: 'uncapLayers', label: N_('解除叠层上限'), tip: N_('盟约叠层上限由 999 层解除，可以叠到 999 层以上；只解除上限，其他盟约规则不变') },
  { col: 'pack', key: 'packRhine', label: N_('莱茵生命'), tip: N_('开启后游戏内可使用移植内容：莱茵生命盟约与科研装置、联合科研干员。关闭（默认）时完全不加载，回到原版内容。') },
  { col: 'pack', key: 'packAphris', label: N_('谬因·并入莱茵'), tip: N_('开启后莱茵生命盟约解锁，干员谬因加入其中，并可获得其层数加成。关闭（默认）时谬因保持原版盟约。') },
  { col: 'pack', key: 'packRelic', label: N_('收藏品玩法'), tip: N_('开启后游戏内可使用移植内容：收藏品玩法（每回合三选一、护盾与图鉴）。关闭（默认）时不加载任何收藏品。') },
  { col: 'pack', key: 'packKazdel', label: N_('卡兹戴尔'), tip: N_('开启后游戏内可使用移植内容：卡兹戴尔盟约、众魂亡魂与众魂大炮、十名成员与两件装备。关闭（默认）时完全不加载，回到原版内容。') },
]);

/** The two columns of MOD_ROWS (图三): the game-rule switches, and the ported 内容包 switches. */
export const MOD_COLS = Object.freeze(['rule', 'pack']);

/** 对局选项 side of MOD_ROWS: the game-rule switches, shown in the 房主配置 dialog (room.js `MatchOptionSection`). */
export const MOD_RULE_ROWS = Object.freeze(MOD_ROWS.filter((r) => r.col === 'rule'));
/** 内容包 side of MOD_ROWS: the ported packs, shown in their own 「Mod 菜单」 dialog (screens/mods.js). */
export const MOD_PACK_ROWS = Object.freeze(MOD_ROWS.filter((r) => r.col === 'pack'));
