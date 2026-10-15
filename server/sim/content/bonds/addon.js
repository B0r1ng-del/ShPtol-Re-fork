// server/sim/content/bonds/addon.js — the add-on bonds (research 02 §3.9–§3.23), loaded by content/bonds.js.
//
//   addon/battle.js  精准 迅捷 灵巧 奥术 坚守 助力 突袭 不屈 协防干员 独行 绝技 (battle effects)
//   addon/meta.js    助力 (prep-end layers) 远见 (layer funds, price discounts) 奇迹 (free refresh, layer funds)
//
// 莱茵生命 (`rhineShip`) is NOT here. 六.3 first ported the 盟约 into `addon/rhine.js`, but its whole effect — the
// 6-member ATK sharing and the 科研装置 traits — is the source expansion's `content/rhine.js` (六.F), which owns the
// same sharing under `rhine:sharing` and reads the DEPLOYED devices. Keeping both would apply the share twice (once
// from the device formula, once from the real devices) under two buff keys. That file's own `[ASSUMED]` note named
// this handoff ("when 六.4 lands, this function should read that instead and this note goes away"), so it is gone.
// 投资人's ×2/×3 "获得时" repeat lives in the match dispatcher, 调和's +1 core count in server/match/bondsMeta.js and its
// "enjoys active core bonds" in support/index.js isMember().

import { install as installBattle } from './addon/battle.js';
import { registerMeta as registerAddonMeta } from './addon/meta.js';

export function install(battle) { installBattle(battle); }
export function registerMeta(registry) { registerAddonMeta(registry); }
