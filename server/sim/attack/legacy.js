// Compatibility boundary for existing positional Battle calls. New code uses attack.js object requests.
import { makeDamageInfo } from './helpers.js';
import { resolveDamage } from './hit.js';
import { loseHp } from './health.js';
import { heal as applyHeal } from './heal.js';
// 注：这里的两个兼容入口**不**加 kazdelCannonImmune —— 实测加上后 kazdel 从 8 红变 10 红：legacyDamage /
// legacyHPLose 也承载大炮自身的正常结算（生成亡魂、充能层数），在那里判「大炮不准命中」会把这些一起拦掉。
// 命中资格只由 attack.js 的 dealDamage（对象版）与 battle/deploy.js 的 kill 两处判，这两条才是真正的伤害入口。

export function legacyDamage(battle, source, target, damage, opts = {}) {
  if (!target || !target.alive || target.removed || target.hidden || !target.deployed) return 0;
  const dmg = damage && damage._norm ? damage : makeDamageInfo(damage);
  if (source == null && opts.credit !== undefined) dmg.sourceless = true;
  const credit = opts.credit === undefined ? source : opts.credit;
  return resolveDamage(battle, { source: dmg.sourceless ? null : source, credit, target, dmg });
}

export function legacyHeal(battle, source, target, amount, opts = {}) {
  return applyHeal(battle, source, target, amount, opts);
}

/**
 * The positional HP loss: `type` as in the object request (attack.js dealHPLose) — 'true' by default, an amount the
 * caller already mitigated, which is never mitigated again; 'phys' / 'arts' take the target's DEF / RES (attack/health.js
 * loseHp, the one path of both forms).
 */
export function legacyHPLose(battle, target, amount, { source = null, silent = false, tags = [], from = null, sourceless = false, noHitLimit = false, type = 'true' } = {}) {
  if (!['phys', 'arts', 'true'].includes(type)) throw new TypeError('HP loss supports phys, arts or true');
  const dmg = { type, tags: [...new Set(['hpLoss', ...(from?.tags ?? []), ...(tags ?? [])])], noSp: true,
    silent, origin: from, sourceless: !!sourceless || !!from?.sourceless };
  // 注：这里**不**加 kazdelCannonImmune —— legacyHPLose 是所有 HP 流失的公共入口（含大炮自己生成亡魂这类
  // 合法路径），而真正的伤害路径已经由 attack.js 的 dealDamage 与 legacyDamage 两侧判过。加在这里会拦掉
  // 大炮自身的正常结算（实测 kazdel 反而从 8 红变 10 红）。
  return loseHp(battle, { source: dmg.sourceless ? null : source, credit: source, target, dmg }, amount, { noHitLimit });
}
