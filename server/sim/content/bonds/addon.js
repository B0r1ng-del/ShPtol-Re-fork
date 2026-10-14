// server/sim/content/bonds/addon.js — the add-on bonds (research 02 §3.9–§3.23) plus the ported 莱茵生命, loaded by
// content/bonds.js.
//
//   addon/battle.js  精准 迅捷 灵巧 奥术 坚守 助力 突袭 不屈 协防干员 独行 绝技 (battle effects)
//   addon/meta.js    助力 (prep-end layers) 远见 (layer funds, price discounts) 奇迹 (free refresh, layer funds)
//   addon/rhine.js   莱茵生命 rhineShip — the ported 盟约 (六.3). It reaches the battle only in a room whose 内容包开关
//                    turned it on: with both off the bond is not in the match's data at all, so nothing here matches.
// 投资人's ×2/×3 "获得时" repeat lives in the match dispatcher, 调和's +1 core count in server/match/bondsMeta.js and its
// "enjoys active core bonds" in support/index.js isMember().

import { install as installBattle } from './addon/battle.js';
import { registerMeta as registerAddonMeta } from './addon/meta.js';
import { install as installRhine } from './addon/rhine.js';

export function install(battle) { installBattle(battle); installRhine(battle); }
export function registerMeta(registry) { registerAddonMeta(registry); }
