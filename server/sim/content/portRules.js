// server/sim/content/portRules.js — 移植内容包与上游结算管线之间的**接缝**。
//
// 为什么单独一个文件（2026-10-25，上游 v0.3.2 同步）：
// 内容包把这些判据**加进了** `server/sim/damage.js` —— 那是上游给 0.3.1 留的第二套结算内核（"an independent
// oracle, imported by no production file"）。上游在 v0.3.2 的一次 triage 里把它整个删了（`fdbdf1c7`：
// "two kernels let tests pass against code no battle runs"），于是这里三个函数跟着一起没了，但它们的调用方
// （`battle/deploy.js`、`battle/queries.js`、`content/rhine.js`、`content/kits/rhine*.js`）全都还活着。
//
// 教训：**移植内容包不要往上游的结算内核里加函数**。上游随时会重写或删除那层文件，而内容包的生命周期比它长。
// 接缝放在 `content/` 下面 —— 上游的 `server/sim/attack/` 是它的地盘，`content/` 是本 fork 的地盘。
//
// 三个函数与它们的上游落点：
//   * `hasHp`               —— 上游已经有（`server/sim/attack/helpers.js`），这里不再重复，调用方直接改 import。
//   * `soulOrigin`          —— 八 卡兹戴尔 亡魂的归属链，纯内容包概念，只在这里。
//   * `canReceiveHeal`      —— 治疗资格：亡魂自成一治疗组 + `flags.noOperatorHeal` 的 owner 链。上游的
//                              `attack/heal.js heal()` 内联了两条基础判据，这两条是本 fork 加在上面的。
//   * `kazdelCannonImmune`  —— 众魂大炮的命中资格。
import { kazdelCannonOwner } from '../kazdelOrigin.js';

/**
 * 八 卡兹戴尔: the 亡魂 a unit belongs to, walking the owner chain (a soul's own summon answers with the soul). Null for
 * anything that is not part of a soul's chain — every other unit in the battle.
 */
export function soulOrigin(unit) {
  if (!unit?.kazdelSoul && !unit?.ownerUnit) return null;
  const seen = new Set();
  for (let u = unit; u && !seen.has(u); u = u.ownerUnit) {
    if (u.kazdelSoul) return u;
    seen.add(u);
  }
  return null;
}

/**
 * Shared recipient rule for healing selectors and the final pipeline (六.F 莱茵装置 / 梅尔's 机械水獭, plus 八's 亡魂).
 *
 * `flags.noOperatorHeal` (梅尔's otters, kits/rhineSupport.js): an OPERATOR's heal cannot reach the summon — the owner
 * chain is walked so a summon-of-a-summon is covered — while another summon's own heal still can. The flag is only ever
 * set by ported content, so with every 内容包开关 off the last line is exactly the two checks `attack/heal.js` inlines.
 *
 * 卡兹戴尔 亡魂 form their own healing group (`soulOrigin`): a living source cannot heal them and they cannot heal the
 * living — 锡人's S2 is the sole explicit exception, carrying the `kazdelSoulHeal` tag.
 */
export function canReceiveHeal(source, target, opts = {}) {
  if (!target) return false;
  const sourceSoul = soulOrigin(source), targetSoul = soulOrigin(target);
  if (targetSoul && !sourceSoul && !opts.tags?.includes('kazdelSoulHeal')) return false;
  if (targetSoul && opts.regen && !opts.self && !opts.tags?.includes('kazdelSoulHeal')) return false;
  if (sourceSoul && !targetSoul) return false;
  if (target.s.flags.noOperatorHeal && source !== target) {
    const seen = new Set();
    for (let origin = source; origin && !seen.has(origin); origin = origin.ownerUnit) {
      if (origin.kind === 'op') return false;
      seen.add(origin);
    }
  }
  const self = source === target || !!opts.self;
  const through = !!source?.profile?.healThrough?.(source, target);
  return self || !((target.s.flags.noHeal && !through) || target.profile?.noHeal);
}

/**
 * 卡兹戴尔 众魂大炮: whether this hit may reach `target` at all. A cannon never harms another player's ally, and never
 * a 亡魂; missing provenance means the hit is refused rather than turned into team-wide friendly fire.
 */
export function kazdelCannonImmune(battle, source, target, dmg) {
  const cannon = source?.kazdelCannon || dmg?.tags?.includes('kazdelCannon') || battle._kazdelCannonDamageDepth > 0;
  if (!cannon) return false;
  const ownerId = kazdelCannonOwner(battle, source, dmg);
  return !!target?.kazdelSoul || (target?.side === 'ally' && (ownerId == null || target.ownerId !== ownerId));
}
