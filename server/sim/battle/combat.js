// server/sim/battle/combat.js — Battle methods: damage, heal and HP loss (the guarded entry points of the attack.js
// pipeline), projectiles and forced attacks (ai.js performAttack).
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import * as attack from '../attack.js';
import { legacyDamage, legacyHeal, legacyHPLose } from '../attack/legacy.js';
import { effectiveProfile, performAttack, acquireTargets } from '../ai.js';
import { withKazdelCannonOrigin, kazdelCannonOwner } from '../kazdelOrigin.js';

// Mark immediate derivatives (split HP loss, reflection, death procs) with their cannon origin too.
// Delayed effects retain it through the existing `from` DamageInfo contract.
function cannonOrigin(battle, source, dmg, run) {
  const cannon = source?.kazdelCannon || dmg?.tags?.includes('kazdelCannon') || battle._kazdelCannonDamageDepth > 0;
  if (!cannon) return run(dmg);
  const tags = [...(dmg?.tags ?? [])];
  if (!tags.includes('kazdelCannon')) tags.push('kazdelCannon');
  const ownerId = kazdelCannonOwner(battle, source, dmg);
  const tagged = { ...dmg, tags, kazdelCannonOwnerId: ownerId };
  return withKazdelCannonOrigin(battle, () => run(tagged), ownerId);
}

export class BattleCombat {
  /** @overload
   * @param {import('../../../types/attack.js').DamageRequest} request
   * @returns {number}
   */
  /** Legacy positional signature; prefer dealDamage({source, target, amount, type, credit}).
   * @overload
   * @param {object|null} source
   * @param {object} target
   * @param {object} dmg
   * @param {object} [opts]
   * @returns {number}
   */
  dealDamage(source, target = undefined, dmg = undefined, opts = {}) {
    // ★ 八 卡兹戴尔：位置参数版也必须过 `cannonOrigin` —— 它负责在「来源确实是大炮」时把 kazdelCannon 标记写进这一帧
    // 的 dmg，并开一个深度窗口，好让 `damaged` 里触发的派生效果（投射物 onHit、buff onTick/onExpire、延迟死亡区）
    // 落地时仍认得出自己来自大炮。上游 v0.3.2 把这一层换成了裸 `legacyDamage`，`cannonOrigin` 于是成了没人调用的
    // 死代码 —— 派生伤害全部被当成普通伤害，打到亡魂、也打到别的玩家的友军。
    // 没有大炮参与的调用走 `run(dmg)` 原样分支，行为与从前逐字节相同。
    try {
      return arguments.length === 1
        ? attack.dealDamage(this, source)
        : cannonOrigin(this, source, dmg, (hit) => legacyDamage(this, source, target, hit, opts));
    } catch (e) { this._internalError('dealDamage', e); return 0; }
  }

  /** @overload
   * @param {import('../../../types/attack.js').HealRequest} request
   * @returns {number}
   */
  /** Legacy positional signature; prefer heal({source, target, amount, mode}).
   * @overload
   * @param {object|null} source
   * @param {object} target
   * @param {number} amount
   * @param {object} [opts]
   * @returns {number}
   */
  heal(source, target = undefined, amount = undefined, opts = {}) {
    try { return arguments.length === 1 ? attack.heal(this, source) : legacyHeal(this, source, target, amount, opts); } catch (e) { this._internalError('heal', e); return 0; }
  }

  /** @overload
   * @param {import('../../../types/attack.js').HPLossRequest} request
   * @returns {number}
   */
  /** Legacy positional signature; prefer dealHPLose({source, credit, target, amount, type}). The same path: `opts.type`
   * 'phys' / 'arts' takes the target's DEF / RES, 'true' (the default) is an amount the caller already mitigated.
   * @overload
   * @param {object} target
   * @param {number} amount
   * @param {object} [opts]
   * @returns {number}
   */
  dealHPLose(target, amount = undefined, opts = {}) {
    try { return arguments.length === 1 ? attack.dealHPLose(this, target) : legacyHPLose(this, target, amount, opts); } catch (e) { this._internalError('dealHPLose', e); return 0; }
  }

  /** @overload
   * @param {import('../../../types/attack.js').ElementHealRequest} request
   * @returns {number}
   */
  /** Legacy positional signature; prefer healElement({target, amount, element}).
   * @overload
   * @param {object} target
   * @param {number} amount
   * @param {string|null} [element]
   * @returns {number}
   */
  healElement(target, amount = undefined, element = null) {
    try { return attack.healElement(this, arguments.length === 1 ? target : { target, amount, element }); } catch (e) { this._internalError('healElement', e); return 0; }
  }

  /** @param {import('../../../types/attack.js').ElementDamageRequest} request */
  dealElementDamage(request) {
    try { return attack.dealElementDamage(this, request); } catch (e) { this._internalError('dealElementDamage', e); return 0; }
  }

  /** @deprecated Use dealHPLose. */
  loseHp(target, amount, opts = {}) { return this.dealHPLose(target, amount, opts); }
  /** @deprecated Use healElement. */
  reduceElement(target, amount, element = null) { return this.healElement(target, amount, element); }

  makeDamage(d) { return attack.makeDamageInfo(d); }

  addProjectile(p) { return this.projectiles.add(p); }

  // exposed for ai/content convenience
  effectiveProfile(u) { return effectiveProfile(u); }

  /**
   * Perform an immediate attack with a unit's current profile (content: "立即攻击", extra attacks, counters). It is an
   * attack in every respect (hooks, attack SP, a running ammo skill's bullet) — except with `noAmmo: true`: an extra
   * attack that spends no ammo (no `ammoUsed`, the skill never ends on it; 圣约送葬人 "不额外消耗弹药").
   * Returns true when an attack was made.
   */
  forceAttack(u, targets = null, { noAmmo = false } = {}) {
    if (!u || !u.alive || !u.profile) return false;
    const prof = effectiveProfile(u);
    const t = targets ?? acquireTargets(this, u, prof);
    if (!t || !t.length) return false;
    const n0 = u.stats.attacks;
    performAttack(this, u, prof, t, noAmmo ? { noAmmo: true } : null);
    return u.stats.attacks > n0;
  }
}
