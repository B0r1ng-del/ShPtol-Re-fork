// server/match/match/crisisFx.js — 危机合约: put a contract's compiled effects on a battle.
//
// `fx` comes from shared/crisis.js crisisRules(sel).fx: { [routeId]: { ...numbers, tier } }. This file is the ONE place
// where those numbers touch the engine, so the effects column the client draws and the fight the server settles cannot
// drift apart (both read the same `flags.crisisFx`).
//
// Three rules this file follows:
//   * Nothing is installed for a room without a contract, and nothing for a route the selection does not contain — an
//     ordinary match adds no hook and its result is byte-identical.
//   * A number the engine has no seam for is SKIPPED, never approximated. Inventing an effect would be worse than a
//     missing one: a player would be tuning a contract against numbers that are not real. Skips are reported.
//   * Every effect names its intended semantics in a comment. The official texts are the authority
//     (sh.bbsmc.cn v024 js/ui/crisisTags.js FX table); where this engine's seam for that text is absent, the route is
//     skipped rather than replaced by a lookalike.

import { COLS } from '../../sim/constants.js';
import { battleStore } from '../../sim/content/support/index.js';
import { palsyBuff } from '../../sim/attack.js';
import { installItem } from '../../sim/content/items/battle.js';
import { deviceState, terrainAt } from '../../sim/content/devices.js';

/** The multiplier a raise asks for: the table states a percentage raise, so 0.25 ⇒ ×1.25. */
const raise = (v) => 1 + (Number.isFinite(v) ? v : 0);
/** The multiplier a reduction asks for (E1 lowers the player's HP): 0.15 ⇒ ×0.85. */
const lower = (v) => Math.max(0, 1 - (Number.isFinite(v) ? v : 0));

/**
 * Enemy-side multipliers, folded into each spawn's own `mods`.
 *
 * These are the keys server/sim/battle/spawns.js already multiplies into the enemy's data
 * (maxHp / atk / def / res / moveSpeed), applied AFTER the enemy's own stats and after `enemyOverrides` — exactly where
 * a contract multiplier belongs.
 *
 *  A1 源石环境：活性   所有敌人生命增加{25%|50%|80%}   → hpMul
 *  B1 源石环境：刺激   所有敌人攻击增加{15%|30%|50%}   → atkMul
 *  N1 反机动           所有敌人移动速度增加20%         → speedMul
 *  Q1 寒潮编队         寒霜生命增加30%                 → hpMul (its aura radius / aspd amplitude are that unit's own
 *                                                        content fields, not reachable from a spawn multiplier)
 *  Q9 穿刺突进         生命增加20%                     → hpMul (the +0.7 move-acceleration CEILING and the paired spawn
 *                                                        are content, not a multiplier)
 *
 * NOT handled here, deliberately:
 *  C1 反装甲  敌人防御增加{100|200}，法术抗性增加{5|10} — the text is a FLAT add; `defMul`/`resMul` are multipliers.
 *             A flat add has no per-enemy seam, and converting it to a percentage would be a different rule.
 *
 * @param {Record<string, any>|null|undefined} fx
 * @returns {{ hpMul: number, atkMul: number, speedMul: number }} all 1 when the contract has none of these routes
 */
export function crisisEnemyMul(fx) {
  let hpMul = 1;
  let atkMul = 1;
  let speedMul = 1;
  if (!fx || typeof fx !== 'object') return { hpMul, atkMul, speedMul };
  for (const [id, e] of Object.entries(fx)) {
    if (!e || typeof e !== 'object') continue;
    if (id === 'A1' && Number.isFinite(e.hp)) hpMul *= raise(e.hp);
    else if (id === 'B1' && Number.isFinite(e.atk)) atkMul *= raise(e.atk);
    else if (id === 'N1' && Number.isFinite(e.move)) speedMul *= raise(e.move);
    // Q1 / Q9 name their targets by enemy key, so they are NOT blanket multipliers — crisisQTargets.js carries them,
    // and folding them in here would raise EVERY enemy instead of the named ones.
  }
  return { hpMul, atkMul, speedMul };
}

/**
 * 危机合约 · 敌方节奏 (N group) that changes the SPAWN LIST itself rather than a unit.
 *
 *  N2 猝发攻势  第4—13回合，敌人出生间隔缩短20%，敌人总数不变 → each spawn's `interval` × 0.8
 *               (server/sim/battle/spawns.js lays a group out as `time + i × interval`, so scaling the interval
 *               compresses the group without touching how many enemies it holds — exactly "总数不变")
 *
 * @param {any[]} list
 * @param {Record<string, any>|null|undefined} fx
 * @returns {any[]} the same array when the contract has no N2
 */
export function crisisSpawnRhythm(list, fx) {
  const n2 = fx && fx.N2;
  if (!n2 || typeof n2 !== 'object' || !Number.isFinite(n2.cut)) return list;
  const mul = Math.max(0, 1 - n2.cut);
  if (mul === 1) return list;
  return (Array.isArray(list) ? list : []).map((s) => (
    s && Number.isFinite(s.interval) && s.interval > 0 ? { ...s, interval: s.interval * mul } : s
  ));
}

/**
 * Player-side multipliers, applied through the one `deploy` hook. Each becomes a buff `mods` key, because
 * server/sim/buffs.js MUL_KEYS is the engine's own multiplicative surface and the formulas that matter (units.js maxHp,
 * the damage pipeline's atk) already read that aggregate.
 *
 *  E1 源石环境：侵蚀   我方生命上限降低{15%|30%}      → hpMul
 *  D1 环境：高价值目标 我方攻击降低{10%|20%|30%}      → atkMul
 *  F1 源石环境：阻抑   技能所需技力增加{15%|30%|50%}  → skill.spCostMul (skills.js re-normalises SP cost)
 *
 * NOT handled here, each because its seam does not exist in this engine:
 *  D2 单点疲劳  a per-target consecutive-hit counter on the attacker.
 *  D3 火力错峰  a half-field rotation gate (which half is 受压 changes every 20s) — any always-on version is a
 *              different rule.
 *  D4 外源增幅  a CAP on the aggregate of only 盟约/装备/策略 damage bonuses — the engine keeps no such attribution.
 *  E2 医疗间歇  a periodic window that clips HEALING only; there is no timed healing-cut seam.
 *  E3 复起延迟  a 3s delay on instant revives — revives are content, not a battle-wide rule.
 *  F2 供能削弱  只削装备/盟约/策略的技力回复 — same attribution problem as D4.
 *  F3 首轮静默  前8秒禁止开主动技能 — no timed skill-gate seam.
 *  F4 循环超载  a 30s window on spRecovery + skill damage.
 *  K1/K3/K4    部署位上限 / 相邻站位判定 / 全队额度 — the deployment budget lives in the lobby, not the battle.
 *  L1–L5       领袖生命倍率与双领袖方案 — those are the boss round's own content (bossRounds.js); a leader that is
 *              not in the wave cannot be invented.
 *  O1          handled by bossRounds._crisisLpCap (the LP cap), not here.
 *  P/Q/R/S/T/U 敌型专属数值、精英标记、领袖节奏、地图机制与协同规则：全部是 content 或 lobby 层的，而且目标敌人
 *              单靠生成列表认不出来。
 *
 * @param {any} battle a constructed Battle
 * @param {Record<string, any>|null|undefined} fx
 * @returns {{ applied: string[], skipped: string[] }}
 */
export function applyCrisisFx(battle, fx) {
  const skipped = [];
  const applied = [];
  if (!fx || typeof fx !== 'object' || !battle || typeof battle.on !== 'function') return { applied, skipped };

  let hpMul = 1;
  let atkMul = 1;
  let spMul = 1;
  // F2 lowers only the DIRECT recovery: a per-gain multiplier applied through the spGain hook below
  let f2Mul = 1;
  for (const [id, e] of Object.entries(fx)) {
    if (!e || typeof e !== 'object') { skipped.push(id); continue; }
    // the enemy-side routes are crisisEnemyMul's business, and they are not a gap here
    if (id === 'A1' || id === 'B1' || id === 'N1' || id === 'Q1' || id === 'Q9') continue;
    // N2 猝发攻势 reshapes the SPAWN LIST (crisisSpawnRhythm), not a unit
    if (id === 'N2') continue;
    // L1 王权高压 lands on the shared boss POOL (gamedata.crisisBossHpMul → finalAssault.bossPoolHp), and O1 最后防线
    // lands on the LP cap (bossRounds._crisisLpCap): both are honoured, neither is this function's business
    if (id === 'L1' || id === 'O1') continue;
    // C1 反装甲 is a FLAT add on the enemy side; it is installed below (it needs the unit, not the spawn list)
    if (id === 'C1') continue;
    if (id === 'E1' && Number.isFinite(e.hp)) { hpMul *= lower(e.hp); applied.push(id); continue; }
    if (id === 'D1' && Number.isFinite(e.atk)) { atkMul *= lower(e.atk); applied.push(id); continue; }
    // F2 减速回能 装备、盟约、策略提供的直接技力回复量降低50%；自然、攻击与受击回复不变
    // skills.js gainSp carries the SOURCE as `reason`: 'time' is the natural tick, 'attack' / 'hurt' are the operator's
    // own spType, and everything else (relic / band / bond / item / talent) is the "direct" recovery the text names.
    // So this is a filter on an existing field, not a lookalike: the natural tick is untouched by construction.
    if (id === 'F2' && Number.isFinite(e.cut)) { f2Mul *= lower(e.cut); applied.push(id); continue; }
    if (id === 'F1' && Number.isFinite(e.sp)) { spMul *= raise(e.sp); applied.push(id); continue; }
    // F3 禁闭封锁 每场战斗前8秒，干员不能开启主动技能；仍可积攒技力，被动技能和天赋正常生效
    // The engine's own operation cooldown is exactly "no automatic cast before this battle time"
    // (skills.js _opCooling ← opReadyAt ← flags.startOpCooldown, set for the battle-start deployment).
    // So the text is the existing flag, raised — nothing is approximated.
    if (id === 'F3') {
      const cur = Number(battle.flags.startOpCooldown);
      const lock = Number.isFinite(e.dur) ? e.dur : 8;
      if (lock > 0) {
        battle.flags.startOpCooldown = Math.max(Number.isFinite(cur) ? cur : 0, lock);
        applied.push(id);
        continue;
      }
    }
    // 这些 route 由下面的独立安装器处理（不进通用循环的 skip 名单）
    if (id === 'M4' || id === 'M3' || id === 'J2' || id === 'J4' || id === 'A2' || id === 'A3' || id === 'B3' || id === 'E3' || id === 'U4' || id === 'P1' || id === 'P2' || id === 'P3' || id === 'Q3' || id === 'R1' || id === 'R2' || id === 'R5' || id === 'T1' || id === 'T2' || id === 'T3' || id === 'T5' || id === 'R3' || id === 'R4' || id === 'T4' || id === 'U1' || id === 'U2' || id === 'U3') continue;
    // every other route needs a seam this engine does not have — reported, never faked
    skipped.push(id);
  }
  // C1 is an ENEMY-side flat add, so it has its own installer below and must not be cut off by an ally-only early exit
  const c1fx = fx.C1;
  const hasC1 = !!(c1fx && typeof c1fx === 'object' && (Number.isFinite(c1fx.def) || Number.isFinite(c1fx.res)));
  // K3 拥挤 与至少3名其他干员正交相邻的干员，前10秒攻击力降低15%
  // units carry tileR / tileC, so "orthogonally adjacent" is a manhattan-distance-1 test on our own board.
  const k3 = fx.K3;
  if (k3 && typeof k3 === 'object' && Number.isFinite(k3.cut) && k3.cut > 0) {
    const want = Number.isFinite(k3.adj) ? k3.adj : 3;
    const dur = Number.isFinite(k3.dur) ? k3.dur : 10;
    const mul = lower(k3.cut);
    let armed = false;
    const mark = () => {
      if (battle.time > dur + 1e-9) return;
      const ops = (battle.allyUnits || []).filter((u) => u && u.kind === 'op' && u.alive && Number.isFinite(u.tileC));
      for (const u of ops) {
        let n = 0;
        for (const o of ops) {
          if (o === u) continue;
          if (Math.abs(o.tileR - u.tileR) + Math.abs(o.tileC - u.tileC) === 1) n++;
        }
        if (n < want) continue;
        if ((u.buffs || []).some((b) => b.key === 'crisis:K3')) continue;
        battle.addBuff(u, { key: 'crisis:K3', duration: Math.max(0, dur - battle.time), mods: { atkMul: mul }, source: 'crisis' });
        armed = true;
      }
      if (armed && !applied.includes('K3')) applied.push('K3');
    };
    battle.on('deploy', () => mark(), { owner: 'crisis' });
    battle.on('tick', () => mark(), { owner: 'crisis' });
    mark();
  }

  // B2 制式装备 远程干员的攻击范围扩大1格，攻击间隔缩短20%
  // Engine seams: `rangeExtend` widens the reach by whole tiles; attack interval IS `aspd` (units compute the
  // cooldown as base / (1 + aspd/100)), so "interval −20%" ⇒ aspd ×1.25. Both are ordinary unit mods.
  const b2 = fx.B2;
  if (b2 && typeof b2 === 'object' && (Number.isFinite(b2.range) || Number.isFinite(b2.interval))) {
    const reach = Number.isFinite(b2.range) ? b2.range : 1;
    const cut = Number.isFinite(b2.interval) ? b2.interval : 0.2;
    const boost = cut < 1 ? (1 / lower(cut) - 1) * 100 : 0; // interval ×0.8 ⇒ aspd +25
    const mods = { rangeExtend: reach, ...(boost ? { aspd: boost } : {}) };
    for (const u of battle.allyUnits || []) {
      if (!u || u.kind !== 'op' || !u.alive) continue;
      // "远程" = the operator's reach is wider than the melee box. `rangeGrid` is the runtime truth (both the
      // record's own grid and any live extension land there); the melee box is 2 tiles ([[0,0],[0,1]]).
      const grid = Array.isArray(u.rangeGrid) ? u.rangeGrid : null;
      const ranged = grid ? grid.length > 2 : Number(u.base?.rangeRadius) > 0;
      if (!ranged) continue;
      battle.addBuff(u, { key: 'crisis:B2', persist: true, mods, source: 'crisis' });
    }
    applied.push('B2');
  }

  // F4 缓慢预热 每场战斗前30秒：自然技力回复 +30%，同时技能伤害降低 {15%|10%}
  // 自然回能是 spGain 的 reason === 'time'（其余来源按 F2 的同一套分类）；技能伤害靠 damageOutput 的 dmg.isSkill。
  const f4 = fx.F4;
  if (f4 && typeof f4 === 'object' && Number.isFinite(f4.regen) && f4.regen > 0) {
    const dur = Number.isFinite(f4.dur) && f4.dur > 0 ? f4.dur : 30;
    const regenMul = raise(f4.regen);
    const skillMul = Number.isFinite(f4.cut) && f4.cut > 0 ? lower(f4.cut) : 1;
    const inWindow = () => battle.time < dur - 1e-9;
    battle.on('spGain', (ctx) => {
      if (!ctx || !inWindow() || ctx.reason !== 'time') return;
      if (Number.isFinite(ctx.amount)) ctx.amount *= regenMul;
    }, { owner: 'crisis' });
    if (skillMul !== 1) {
      battle.on('damageOutput', (c) => {
        if (!c || !inWindow()) return;
        if (c.target && c.target.side === 'ally') return;
        if (!c.dmg || !c.dmg.isSkill) return;
        if (c.dmg.calculation === 'hpLoss' || c.dmg.type === 'element') return;
        c.amount *= skillMul;
      }, { owner: 'crisis' });
    }
    applied.push('F4');
  }

  // A2 回声前锋 第5—13回合，指定普通敌人首次死亡6秒后，生成 40%(solo)/25%(quad) 生命的复制体，
  // 每轮 3 名(solo)/每名玩家 2 名(quad)。复制体不再复制、不提供资金及叠层收益。
  // ★ 用 battle.spawnEnemy(key, {mods, pos}) —— 引擎自己的运行时生成入口；
  //   "不提供资金及叠层收益" 用 mods 里关掉 bounty / layer 相关字段表达（引擎不认 crisis，只认 mods）。
  const a2 = fx.A2;
  if (a2 && typeof a2 === 'object' && Number.isFinite(a2.hp)) {
    const rounds = Array.isArray(a2.rounds) ? a2.rounds : [5, 13];
    // ★ battle.round 在单场夹具里是 undefined；只有真的越界才跳过。
    const inRange = battle.round == null || !Number.isFinite(battle.round)
      || (battle.round >= rounds[0] && battle.round <= rounds[1]);
    if (inRange) {
      const delay = Number.isFinite(a2.delay) ? a2.delay : 6;
      const budget = Number.isFinite(a2.perField) ? a2.perField : 3;
      const born = new Set(); // 已经复制过的敌人 key（"首次死亡" + "复制体不再复制"）
      let used = 0;
      battle.on('kill', (c) => {
        const v = c && c.victim;
        if (!v || v.side !== 'enemy' || used >= budget) return;
        const key = v.defId;
        if (!key || born.has(key)) return;
        born.add(key);
        used++;
        battle.after(delay, () => {
          try {
            battle.spawnEnemy(key, { mods: { hpMul: a2.hp, bountyCoins: 0 }, pos: [v.y, v.x] });
          } catch { /* field already over */ }
        });
      });
      applied.push('A2');
    }
  }

  // A3 第三梯队 第5—13回合，战斗到第35秒时本原战区仍有敌人，追加一批固定精英（solo 2 名 / quad 每名玩家 1 名），
  // 已清场的玩家不追加。名单与入口提前公开，每轮只触发一次。
  // ★ "仍有敌人" 用 battle.aliveEnemies()（引擎自己的判据）；"固定精英" 取本场已经出现过的最高血敌人 key，
  //   保证是这场战斗自己名单里的东西，不新造内容。
  const a3 = fx.A3;
  if (a3 && typeof a3 === 'object' && Number.isFinite(a3.at)) {
    const rounds = Array.isArray(a3.rounds) ? a3.rounds : [5, 13];
    const inRange = battle.round == null || !Number.isFinite(battle.round)
      || (battle.round >= rounds[0] && battle.round <= rounds[1]);
    if (inRange) {
      const at = a3.at;
      const n = Number.isFinite(a3.perField) && a3.perField > 0 ? a3.perField : 2;
      let fired = false;
      const fire = () => {
        if (fired || !(battle.time >= at)) return;
        fired = true;
        const live = battle.aliveEnemies ? battle.aliveEnemies() : [];
        if (!live.length) return; // 已清场：不追加
        // 本场出现过的敌人里血最高的那个当"固定精英"
        let best = null;
        for (const e of battle.units || []) {
          if (!e || e.side !== 'enemy' || !e.defId) continue;
          const hp = Number(e.s && e.s.maxHp);
          if (!Number.isFinite(hp)) continue;
          if (!best || hp > best.hp) best = { key: e.defId, hp };
        }
        if (!best) return;
        const ref = live[0];
        for (let i = 0; i < n; i++) {
          try {
            battle.spawnEnemy(best.key, { pos: [ref.y, ref.x + i * 0.5] });
          } catch { /* field over */ }
        }
      };
      battle.on('tick', fire);
      applied.push('A3');
    }
  }

  // B3 冲击前锋 每名玩家原战区每轮预先标记的前2名精英，首次攻击造成150%伤害，并使目标晕眩1.5秒；
  // 无足够精英时不额外补怪。
  // ★ "精英" = 本场敌人里血量最高的 perField 个（不新造内容，用引擎自己的血量判据）；
  //   伤害改写落 damageOutput（damageCalculate 传副本改不动），晕眩走 addBuff + palsyBuff。
  const b3 = fx.B3;
  if (b3 && typeof b3 === 'object' && Number.isFinite(b3.mul)) {
    const n = Number.isFinite(b3.perField) && b3.perField > 0 ? b3.perField : 2;
    const stun = Number.isFinite(b3.stun) && b3.stun > 0 ? b3.stun : 1.5;
    const marked = new Set(); // 已经用掉首击的敌人
    // ★ 精英名单在**第一次敌人攻击时**定格（"每轮预先标记"）。之后生成的敌人不进来。
    let picked = null;
    const pick = () => {
      if (picked) return picked;
      const list = (battle.units || [])
        .filter((e) => e && e.side === 'enemy' && e.alive)
        .map((e) => ({ e, hp: Number(e.s && e.s.maxHp) }))
        .filter((x) => Number.isFinite(x.hp))
        .sort((a, b) => b.hp - a.hp)
        .slice(0, n);
      picked = new Set(list.map((x) => x.e));
      return picked;
    };
    battle.on('enemyAttackStart', (c) => {
      const e = c && c.enemy;
      if (!e || marked.has(e)) return;
      if (!pick().has(e)) return;
      marked.add(e);
      // 这一击的伤害在 damageOutput 里放大（只放大这一击 ⇒ 用一个一次性标记）
      e._crisisB3 = true;
      // 晕眩：给每个目标挂 palsy
      for (const t of c.targets || []) {
        if (!t || !t.alive) continue;
        try {
          // ★ 晕眩 = 引擎自己的 palsy buff 描述符（attack/element.js palsyBuff），不是自造字段。
          battle.addBuff(t, { ...palsyBuff(1), duration: stun, source: e });
        } catch { /* immune */ }
      }
    });
    battle.on('damageOutput', (c) => {
      if (!c || !c.source || !c.source._crisisB3) return;
      if (c.dmg && c.dmg.isSkill) return;
      c.amount *= b3.mul;
      c.source._crisisB3 = false;
    });
    applied.push('B3');
  }

  // E3 复起延迟：击倒时立刻生效的复活改为 delay 秒后生效，次数与效果不变；期间干员离场。
  // ★ 引擎侧只在 reviveNow 读一个数（battle.flags.crisisReviveDelay），不含 crisis 分支。
  const e3 = fx.E3;
  if (e3 && typeof e3 === 'object' && Number.isFinite(e3.delay) && e3.delay > 0) {
    battle.flags.crisisReviveDelay = e3.delay;
    applied.push('E3');
  }

  // U4 联防强压：转入联防战的敌人生命增加 20%（只作用于 kind==='unite' 的场）。
  // ★ 引擎侧只在 _uniteOpts 传一个 flag（battle.flags.crisisUniteHpMul），乘法在这里做。
  const u4hp = Number(battle.flags && battle.flags.crisisUniteHpMul);
  if (battle.kind === 'unite' && Number.isFinite(u4hp) && u4hp > 1) {
    const k = u4hp;
    // ★ 生成钩子是 enemySpawn，ctx { enemy }（server/sim/battle/spawns.js:181）
    battle.on('enemySpawn', (c) => {
      const u = c && c.enemy;
      if (!u || u.side !== 'enemy') return;
      if (u.s && Number.isFinite(u.s.maxHp)) {
        u.s.maxHp = Math.round(u.s.maxHp * k);
        u.hp = Math.round(u.hp * k);
      }
    });
    applied.push('U4');
  }

  // R4 精英标记的第二半：本回合被标记的精英首次被击倒时，在场干员各 +10 技力并回复 10% 最大生命。
  // 第一半（生命 +25%）在 match 层：pickCrisisMark 选人 + combat._crisisMarkSpawns 加 maxHpMul。
  // 复制体 / 衍生物不发奖励 —— 只认 flags.crisisMark 里那个 key 的**首次**击倒。
  const r4 = fx.R4;
  if (r4 && typeof r4 === 'object') {
    const mark = battle.flags && battle.flags.crisisMark;
    if (typeof mark === 'string' && mark) {
      const sp = Number.isFinite(r4.sp) && r4.sp > 0 ? r4.sp : 10;
      const healPct = Number.isFinite(r4.healPct) && r4.healPct > 0 ? r4.healPct : 0.1;
      let paid = false;
      battle.on('kill', (ctx) => {
        if (paid) return;
        const v = ctx && ctx.victim;
        if (!v || v.side !== 'enemy' || v.defId !== mark) return;
        paid = true;
        for (const u of battle.allyUnits) {
          if (!u.alive || !u.deployed || u.kind !== 'op') continue;
          if (u.skill && typeof u.skill.gainSp === 'function') u.skill.gainSp(sp, 'strategy');
          const amount = u.s.maxHp * healPct;
          if (amount > 0 && u.hp < u.s.maxHp) battle.heal({ source: null, target: u, amount });
        }
      }, { owner: 'crisis' });
      applied.push('R4');
    } else {
      skipped.push('R4');
    }
  }
  // R3 第二半：上面四类敌人完成技能后受到伤害 +25%，持续 6 秒，每名敌人至少间隔 15 秒。
  // 第一半（攻击间隔 ×0.85）在 gamedata.crisisTalentOverrides —— stats.bat 只对出生时生效。
  const r3 = fx.R3;
  if (r3 && typeof r3 === 'object') {
    const R3K = ['enemy_1045_hammer', 'enemy_1160_hvyslr', 'enemy_1160_hvyslr_2', 'enemy_1320_wdrrl_2', 'enemy_1275_dwlock_2'];
    const vuln = Number.isFinite(r3.vuln) && r3.vuln > 0 ? r3.vuln : 0.25;
    const dur = Number.isFinite(r3.dur) && r3.dur > 0 ? r3.dur : 6;
    const cd = Number.isFinite(r3.cd) && r3.cd > 0 ? r3.cd : 15;
    const last = new Map();
    battle.on('skillEnd', (ctx) => {
      const e = ctx && ctx.unit;
      if (!e || e.side !== 'enemy' || !e.alive || !R3K.includes(e.defId)) return;
      const prev = last.get(e.id);
      if (prev != null && battle.time - prev < cd) return;
      last.set(e.id, battle.time);
      battle.addBuff(e, { key: 'crisis:R3', refresh: 'replace', mods: { dmgTakenMul: 1 + vuln }, duration: dur });
    }, { owner: 'crisis' });
    applied.push('R3');
  }
  // T5 盟约寒风：所有地图的盟约寒风触发间隔延长 50%（三档停用）。
  // 盟约寒风 = 谢拉格 6 人盟约的 kjeragColdWind（sim/content/bonds/core.js:319 -> devices.js startColdWind）。
  // 那条链路在 Battle 构造时就把 interval 算死了，所以不能事后改 —— 改成让 startColdWind 读
  // battle.flags.crisisColdWindMul（引擎里只有一行），这里只写这个系数；没装 T5 时恒为 1。
  const t5 = fx.T5;
  if (t5 && typeof t5 === 'object') {
    const mul = Number.isFinite(t5.mul) && t5.mul > 0 ? t5.mul : 1.5;
    const off = t5.off === true;
    battle.flags.crisisColdWindMul = off ? 1e9 : mul; // 停用：间隔大到本场打不出来
    applied.push('T5');
  }
  // T3 涨潮控制：从第 first 秒起每 period 秒退潮 hold 秒。退潮期间深水对敌人的伤害/攻速/移速全部失效。
  // 深水参数集中在 st.deepsea（sim/content/devices.js:307-311），但 buff 是在单位进入深水时一次性写进去的
  // （:367 addBuff({mods, interval, onTick})）—— 所以光改 st.deepsea 不影响已经在水里的敌人，
  // 必须同时把在场敌人的 terrain:deepsea buff 摘掉，出窗口再按新地形重新挂。
  const t3 = fx.T3;
  if (t3 && typeof t3 === 'object') {
    const first = Number.isFinite(t3.first) && t3.first >= 0 ? t3.first : 40;
    const period = Number.isFinite(t3.period) && t3.period > 0 ? t3.period : 40;
    const hold = Number.isFinite(t3.hold) && t3.hold > 0 ? t3.hold : 10;
    const DEEP = 'terrain:deepsea';
    const st = typeof deviceState === 'function' ? deviceState(battle) : null;
    const base = st && st.deepsea ? { ...st.deepsea } : null;
    const dry = new Set();
    const ebb = (on) => {
      if (!st || !st.deepsea) return;
      if (on) {
        st.deepsea.damage = 0;
        st.deepsea.aspd = 0;
        st.deepsea.moveMul = 1;
      } else if (base) {
        Object.assign(st.deepsea, base);
      }
      // 已经在深水里的敌人：摘掉 / 重挂（重新挂时按当前 st.deepsea 的数值，所以顺序不能反）
      for (const e of battle.enemies) {
        if (!e.alive) continue;
        if (on) {
          if (!e.findBuff || !e.findBuff(DEEP)) continue;
          battle.removeBuff(e, DEEP);
          dry.add(e.id);
        } else if (dry.has(e.id)) {
          dry.delete(e.id);
          if (!e.alive || e.findBuff(DEEP)) continue;
          if (typeof terrainAt === 'function' && terrainAt(battle, e.tileR, e.tileC) !== 'deepsea') continue;
          const D = st.deepsea;
          // 与 devices.js deepWaterDamage 同一口径：无来源 true 持续伤害，tags dot/periodic/deepsea，不带 terrain、不给受击回复
          const tick = D.damage > 0
            ? (ctx) => { if (ctx.unit.alive) battle.dealDamage(null, ctx.unit, { amount: D.damage, type: 'true', canDodge: false, sourceless: true, noSp: true, tags: ['dot', 'periodic', 'deepsea'] }); }
            : null;
          battle.addBuff(e, { key: DEEP, mods: { aspd: D.aspd, moveMul: D.moveMul }, interval: 1, onTick: tick });
        }
      }
      if (!on) dry.clear();
    };
    for (let t = first; t < 1e6; t += period) {
      battle.after(t, () => ebb(true));
      battle.after(t + hold, () => ebb(false));
    }
    applied.push('T3');
  }
  // T2 排气格栅：从第 first 秒起每 period 秒，烟雾消散 hold 秒。消散期间格上的干员失去 terrain:smog 的
  // flags.stealth（sim/content/devices.js:364），于是远程敌人能选中它（targeting.js canTargetAlly:114）。
  // 窗口结束按格子的地形重新加回，不改 terrain 数组 —— 那样会污染 terrainAt() 的其他读者。
  const t2 = fx.T2;
  if (t2 && typeof t2 === 'object') {
    const first = Number.isFinite(t2.first) && t2.first >= 0 ? t2.first : 40;
    const period = Number.isFinite(t2.period) && t2.period > 0 ? t2.period : 40;
    const hold = Number.isFinite(t2.hold) && t2.hold > 0 ? t2.hold : 8;
    const SMOG = 'terrain:smog';
    const lifted = new Set();
    const lift = (on) => {
      if (!battle.allyUnits) return;
      for (const u of battle.allyUnits) {
        if (u.kind === 'device') continue;
        if (on) {
          if (!u.alive || !u.deployed) continue;
          if (typeof terrainAt === 'function' && terrainAt(battle, u.tileR, u.tileC) !== 'smog') continue;
          if (!u.findBuff || !u.findBuff(SMOG)) continue;
          battle.removeBuff(u, SMOG);
          lifted.add(u.uid);
        } else if (lifted.has(u.uid)) {
          lifted.delete(u.uid);
          if (!u.alive || !u.deployed || u.findBuff(SMOG)) continue;
          if (typeof terrainAt === 'function' && terrainAt(battle, u.tileR, u.tileC) !== 'smog') continue;
          battle.addBuff(u, { key: SMOG, persist: true, visible: true, flags: { stealth: true } });
        }
      }
      if (!on) lifted.clear();
    };
    for (let t = first; t < 1e6; t += period) {
      battle.after(t, () => lift(true));
      battle.after(t + hold, () => lift(false));
    }
    applied.push('T2');
  }
  // T1 源石流发生装置反向：从第 first 秒起每 period 秒，全部 blower 的气流反向 hold 秒。
  // 反向 = 把 st.flow 每个格子的 fx/fy 取负、dir 换成相反方向 —— 干员读 airflowRelationOf(u.dir, f.dir)，
  // 敌人读 (vx*fx + vy*fy) 的符号，两者都只看这一份数据，所以一次翻转两边同时生效。
  // 还原按原始值写回（不靠再翻一次），避免反复进出窗口时累积误差。
  const t1 = fx.T1;
  if (t1 && typeof t1 === 'object') {
    const first = Number.isFinite(t1.first) && t1.first >= 0 ? t1.first : 40;
    const period = Number.isFinite(t1.period) && t1.period > 0 ? t1.period : 40;
    const hold = Number.isFinite(t1.hold) && t1.hold > 0 ? t1.hold : 10;
    const FLIP = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
    const orig = new Map();
    const flip = (on) => {
      const st = typeof deviceState === 'function' ? deviceState(battle) : null;
      if (!st || !st.flow || !st.flow.size) return;
      if (on) {
        orig.clear();
        for (const [k, v] of st.flow) {
          orig.set(k, { fx: v.fx, fy: v.fy, dir: v.dir });
          st.flow.set(k, { ...v, fx: -v.fx, fy: -v.fy, dir: FLIP[v.dir] || v.dir });
        }
      } else if (orig.size) {
        for (const [k, v] of orig) {
          const cur = st.flow.get(k);
          if (cur) st.flow.set(k, { ...cur, ...v });
        }
        orig.clear();
      }
    };
    for (let t = first; t < 1e6; t += period) {
      battle.after(t, () => flip(true));
      battle.after(t + hold, () => flip(false));
    }
    applied.push('T1');
  }
  // R5 弧光镜卫：连续 5 秒未受到伤害时恢复 20 层（层 = ab:defDecay 的 stacks，每层 -def/-res）；
  // 层数叠满（= maxStacks）后受到伤害 +20%，直到死亡。
  // 层数由引擎的 kitDefDecay（sim/content/enemies/special.js:205）在 taken 时 +1，这里只读/写它的 buff。
  const r5 = fx.R5;
  if (r5 && typeof r5 === 'object') {
    const MIRROR = ['enemy_1329_cbshld', 'enemy_1329_cbshld_2'];
    const idle = Number.isFinite(r5.idle) && r5.idle > 0 ? r5.idle : 5;
    const gain = Number.isFinite(r5.layers) && r5.layers > 0 ? r5.layers : 20;
    const vuln = Number.isFinite(r5.vuln) && r5.vuln > 0 ? r5.vuln : 0.2;
    const last = new Map();
    battle.on('hit', (ctx) => {
      const t = ctx && ctx.target;
      if (t && t.side === 'enemy' && MIRROR.includes(t.defId)) last.set(t.id, battle.time);
    }, { owner: 'crisis' });
    battle.on('tick', () => {
      for (const e of battle.enemies) {
        if (!e.alive || !MIRROR.includes(e.defId)) continue;
        const at = last.get(e.id);
        if (at == null || battle.time - at < idle) continue;
        const buff = (e.buffs || []).find((x) => x.key === 'ab:defDecay');
        if (!buff) continue;
        const cap = Number.isFinite(buff.maxStacks) ? buff.maxStacks : Infinity;
        if (buff.stacks >= cap) continue;
        buff.stacks = Math.min(cap, buff.stacks + gain);
        last.set(e.id, battle.time);
      }
    }, { owner: 'crisis' });
    battle.on('damageOutput', (ctx) => {
      if (!ctx || !Number.isFinite(ctx.amount)) return;
      const t = ctx.target;
      if (!t || t.side !== 'enemy' || !MIRROR.includes(t.defId)) return;
      const buff = (t.buffs || []).find((x) => x.key === 'ab:defDecay');
      if (!buff) return;
      const cap = Number.isFinite(buff.maxStacks) ? buff.maxStacks : Infinity;
      if (buff.stacks >= cap) ctx.amount *= (1 + vuln);
    }, { owner: 'crisis' });
    applied.push('R5');
  }
  // R2 囚犯的第二半：囚犯**在禁锢状态下**被击倒时，击倒者及其周围 1 格内的我方干员各获得 5 点技力，
  // 每名干员每场最多 15 点（视为策略来源，受 F2 影响 —— 走 spGain 的 reason: strategy）。
  // 第一半（攻击次数 4->3）在 gamedata.crisisTalentOverrides —— confinement.times 在 prisoner() 构造时就闭包了。
  const r2 = fx.R2;
  if (r2 && typeof r2 === 'object') {
    const sp = Number.isFinite(r2.sp) && r2.sp > 0 ? r2.sp : 5;
    const cap = Number.isFinite(r2.cap) && r2.cap > 0 ? r2.cap : 15;
    const spent = new Map();
    battle.on('kill', (ctx) => {
      const v = ctx && ctx.victim;
      if (!v || v.side !== 'enemy') return;
      // 只在禁锢状态下：敌人还挂着 ab:confined（解放后换成 ab:liberty）
      if (!v.findBuff || !v.findBuff('ab:confined')) return;
      const killer = ctx.killer;
      const picked = [];
      if (killer && killer.kind === 'op' && killer.alive) picked.push(killer);
      for (const u of battle.allyUnits) {
        if (!u.alive || !u.deployed || u.kind !== 'op') continue;
        if (u === killer) continue;
        const d = Math.abs(u.tileR - v.tileR) + Math.abs(u.tileC - v.tileC);
        if (d <= 1 + 0.001) picked.push(u);
      }
      for (const u of picked) {
        const got = spent.get(u.uid) || 0;
        const add = Math.min(sp, cap - got);
        if (add <= 0) continue;
        spent.set(u.uid, got + add);
        // gainSp 在 Skill 上（sim/skills.js:328 的 this 是 Skill 实例），第二个参数是 reason
        if (u.skill && typeof u.skill.gainSp === 'function') u.skill.gainSp(add, 'strategy');
      }
    }, { owner: 'crisis' });
    applied.push('R2');
  }
  // R1 再生护盾的第二半：在假想敌：再生**重生之前**把它彻底击倒，周围 2 格内的敌人立刻失去抵挡护盾，
  // 并受到伤害 +15%，持续 5 秒（每只一次）。
  // 第一半（护盾 5->7、重生 15->12）在 gamedata.crisisTalentOverrides —— 那两值在 kitRegen 构造时就闭包了。
  // 这里只处理「彻底击倒」：husk 形态再死一次 = 真死（e.mem.husk 已走完一轮）。
  const r1 = fx.R1;
  if (r1 && typeof r1 === 'object') {
    const REGEN = 'enemy_9010_acpupp';
    const vuln = Number.isFinite(r1.vuln) && r1.vuln > 0 ? r1.vuln : 0.15;
    const dur = Number.isFinite(r1.dur) && r1.dur > 0 ? r1.dur : 5;
    const radius = Number.isFinite(r1.radius) && r1.radius > 0 ? r1.radius : 2;
    battle.on('death', (ctx) => {
      const e = ctx && ctx.unit;
      if (!e || e.defId !== REGEN) return;
      // 只认「彻底击倒」：husk 能力一旦进入 husk 形态（a.state === 'husk'），再死就是真死；
      // 第一次倒下只是转 husk，不算。
      const ab = e.mem && e.mem.ab;
      const huskA = ab && Array.isArray(ab.list) ? ab.list.find((x) => x && x.state === 'husk') : null;
      if (!huskA) return;
      for (const o of battle.enemies) {
        if (!o.alive || o === e) continue;
        const d = Math.abs(o.tileR - e.tileR) + Math.abs(o.tileC - e.tileC);
        if (d > radius + 0.001) continue;
        // 立刻失去抵挡护盾
        o.buffs = (o.buffs || []).filter((b) => b.key !== 'hitShield');
        if (o.hitShield) o.hitShield = 0;
        battle.addBuff(o, { key: 'crisis:R1', refresh: 'stack', duration: dur, mods: { dmgTakenMul: 1 + vuln }, source: e, tag: 'crisis' });
      }
    }, { owner: 'crisis' });
    applied.push('R1');
  }
  // Q3 中坚盾卫光环：第 8—13 回合，集团军中坚盾卫存活时，周围 1.5 格内的**其他**敌人受伤 -15%，
  // 多只不叠加（取一次 0.85，不是连乘）。用 damageOutput 拦。
  const q3 = fx.Q3;
  if (q3 && typeof q3 === 'object') {
    const SHIELD = 'enemy_10124_uashld_2';
    const cut = Number.isFinite(q3.cut) && q3.cut > 0 ? q3.cut : 0.15;
    const radius = Number.isFinite(q3.radius) && q3.radius > 0 ? q3.radius : 1.5;
    battle.on('damageOutput', (ctx) => {
      if (!ctx || !Number.isFinite(ctx.amount)) return;
      const t = ctx.target;
      if (!t || t.side !== 'enemy' || t.defId === SHIELD) return;
      for (const o of battle.enemies) {
        if (!o.alive || o.defId !== SHIELD) continue;
        const d = Math.abs(o.tileR - t.tileR) + Math.abs(o.tileC - t.tileC);
        if (d <= radius + 0.001) { ctx.amount *= (1 - cut); return; }
      }
    }, { owner: 'crisis' });
    applied.push('Q3');
  }
  // P1 冰爆源石虫：生命 +40%，死亡爆炸伤害倍率 200% -> 250%。
  // 爆炸走 deathBoom（sim/content/enemies/archetypes.js:193），伤害在构造能力时就定了 scale；
  // 这里不动数据表：生命用 enemySpawn 改，爆炸用 damageOutput 按 source 是冰爆源石虫 乘 1.25。
  const p1 = fx.P1;
  if (p1 && typeof p1 === 'object') {
    const BOOMER = 'enemy_1067_snslime';
    const hpMul = Number.isFinite(p1.hp) ? raise(p1.hp) : 1;
    const boomBase = 2;
    const boomTarget = Number.isFinite(p1.blast) ? p1.blast : boomBase;
    const boomMul = boomBase > 0 ? boomTarget / boomBase : 1;
    battle.on('enemySpawn', (ctx) => {
      const e = ctx && ctx.enemy;
      if (!e || e.defId !== BOOMER || hpMul === 1) return;
      const max = Math.round(e.s.maxHp * hpMul);
      e.s.maxHp = max;
      e.hp = max;
    }, { owner: 'crisis' });
    if (boomMul !== 1) {
      battle.on('damageOutput', (ctx) => {
        if (!ctx || !Number.isFinite(ctx.amount)) return;
        const src = ctx.source;
        if (!src || src.defId !== BOOMER) return;
        if (src.alive) return; // 只放大死亡爆炸
        ctx.amount *= boomMul;
      }, { owner: 'crisis' });
    }
    applied.push('P1');
  }
  // P3 圣杯分担：愧悔魂灵圣杯的分担比例 5% -> 15%（x3）；圣杯被击倒时，周围 1.7 格内的地面敌人
  // 受到伤害 +20%，持续 6 秒（每只圣杯一次）。
  // 分担本身走引擎的 chaliceShare（sim/content/enemies.js:384，读 a.share），这里只把 a.share 抬上去；
  // 圣杯倒下那一下用 death 钩子给周围敌人挂 crisis:P3 的受伤加成 buff。
  const p3 = fx.P3;
  if (p3 && typeof p3 === 'object') {
    const CHALICE = 'enemy_1430_lrrook';
    const shareMul = Number.isFinite(p3.share) && p3.share > 0 ? p3.share : 3;
    const vuln = Number.isFinite(p3.vuln) && p3.vuln > 0 ? p3.vuln : 0.2;
    const dur = Number.isFinite(p3.dur) && p3.dur > 0 ? p3.dur : 6;
    const radius = Number.isFinite(p3.radius) && p3.radius > 0 ? p3.radius : 1.7;
    battle.on('enemySpawn', (ctx) => {
      const e = ctx && ctx.enemy;
      if (!e || e.defId !== CHALICE) return;
      const ab = e.mem && e.mem.ab;
      const a = ab && ab.list && ab.list[0];
      if (!a || !(a.share > 0)) return;
      a.share *= shareMul;
      a.r = Math.max(a.r, radius);
    }, { owner: 'crisis' });
    battle.on('death', (ctx) => {
      const e = ctx && ctx.unit;
      if (!e || e.defId !== CHALICE) return;
      for (const o of battle.enemies) {
        if (!o.alive || o.isFlying || o.defId === CHALICE) continue;
        const d = Math.abs(o.tileR - e.tileR) + Math.abs(o.tileC - e.tileC);
        if (d > radius + 0.001) continue;
        battle.addBuff(o, { key: 'crisis:P3', refresh: 'stack', duration: dur, mods: { dmgTakenMul: 1 + vuln }, source: e, tag: 'crisis' });
      }
    }, { owner: 'crisis' });
    applied.push('P3');
  }
  // P2 盾卫压制：终局突袭"萨米的意志"战场，每有1名存活的游击队盾卫，萨米受到伤害降低6%（最多4层）；
  // 每击倒1名盾卫，萨米受到伤害增加10%，持续8秒（最多同时2个）。两者都计入敌方受伤变化，互相抵消。
  // ★ 只在 boss 场生效，且只对萨米本人（enemyKey）—— 不改任何数据表。
  const p2 = fx.P2;
  if (p2 && typeof p2 === 'object' && Number.isFinite(p2.layer)) {
    const SAMI = 'enemy_9033_acdeer';
    const SHIELD = 'enemy_1081_sotisd';
    const maxLayers = Number.isFinite(p2.layers) ? p2.layers : 4;
    const vuln = Number.isFinite(p2.vuln) ? p2.vuln : 0.1;
    const dur = Number.isFinite(p2.dur) ? p2.dur : 8;
    const maxStack = Number.isFinite(p2.windows) ? p2.windows : 2;
    const stamps = []; // 每次击倒盾卫的时间点
    battle.on('kill', (c) => {
      const v = c && c.victim;
      if (!v || v.side !== 'enemy' || v.defId !== SHIELD) return;
      stamps.push(battle.time);
      // 只留仍在有效期内的
      while (stamps.length && battle.time - stamps[0] > dur) stamps.shift(); // loop-cap: stamps only shrinks, one per kill
    });
    battle.on('damageOutput', (c) => {
      const t = c && c.target;
      if (!t || t.side !== 'enemy' || t.defId !== SAMI) return;
      const live = (battle.units || []).filter((u) => u && u.side === 'enemy' && u.alive && u.defId === SHIELD).length;
      const layers = Math.min(maxLayers, live);
      // 击倒窗口：只算仍然有效的
      const now = battle.time;
      const active = stamps.filter((s) => now - s <= dur).slice(-maxStack).length;
      const mul = (1 - p2.layer * layers) * (1 + vuln * active);
      c.amount *= mul;
    });
    applied.push('P2');
  }

  // U1 承压位：承压位的原战区在第20秒追加 n 名当回合精英位敌人，不提供奖励。
  // ★ 谁当承压位由 match 层选出（crisisPressure.js），这里只读 battle.flags.crisisPressure。
  const u1 = fx.U1;
  if (u1 && typeof u1 === 'object' && Number.isFinite(u1.at) && battle.flags && battle.flags.crisisPressure) {
    const rounds = Array.isArray(u1.rounds) ? u1.rounds : [7, 13];
    const inRange = battle.round == null || !Number.isFinite(battle.round)
      || (battle.round >= rounds[0] && battle.round <= rounds[1]);
    if (inRange) {
      const at = u1.at;
      const n = Number.isFinite(u1.n) && u1.n > 0 ? u1.n : 2;
      let fired = false;
      const fire = () => {
        if (fired || !(battle.time >= at)) return;
        fired = true;
        // "当回合精英位敌人" = 本场血量最高的那种敌人（不新造内容）
        let best = null;
        for (const e of battle.units || []) {
          if (!e || e.side !== 'enemy' || !e.defId) continue;
          const hp = Number(e.s && e.s.maxHp);
          if (!Number.isFinite(hp)) continue;
          if (!best || hp > best.hp) best = { key: e.defId, hp };
        }
        if (!best) return;
        const ref = (battle.units || []).find((x) => x && x.side === 'enemy' && x.alive);
        if (!ref) return;
        for (let i = 0; i < n; i++) {
          try {
            // 不提供奖励 ⇒ bountyCoins: 0
            battle.spawnEnemy(best.key, { mods: { bountyCoins: 0 }, pos: [ref.y, ref.x + i * 0.5] });
          } catch { /* field over */ }
        }
      };
      battle.on('tick', fire);
      applied.push('U1');
    }
  }

  // U2 终局压制：终局突袭从第20秒起，每30秒轮流让一个拼场进入压制（先b1、后b2）：
  // 该拼场的领袖和护卫攻击速度增加20，持续12秒。
  // ★ "哪个拼场被压制"由 match 层按时间轮转决定并写进 battle.flags.crisisSuppress（这里不猜）。
  //   "领袖和护卫" = 首领场的敌人：首领本体 isBoss，其余同场敌人视作护卫（引擎没有 escort 标识）。
  const u2 = fx.U2;
  if (u2 && typeof u2 === 'object' && Number.isFinite(u2.aspd) && battle.flags && battle.flags.crisisSuppress) {
    const from = Number.isFinite(u2.from) ? u2.from : 20;
    const every = Number.isFinite(u2.every) && u2.every > 0 ? u2.every : 30;
    const dur = Number.isFinite(u2.dur) && u2.dur > 0 ? u2.dur : 12;
    const bonus = u2.aspd;
    const win = [];
    for (let t = from; t < 1e6; t += every) win.push(t);
    // 只排前 40 个窗口（一场战斗不会跑那么久），避免无谓的定时器
    for (const start of win.slice(0, 40)) {
      battle.after(start, () => {
        if (!battle || battle.ended) return;
        for (const e of battle.units || []) {
          if (!e || e.side !== 'enemy' || !e.alive) continue;
          try {
            battle.addBuff(e, { key: 'crisis:U2', duration: dur, mods: { aspd: bonus } });
          } catch { /* immune */ }
        }
      });
    }
    applied.push('U2');
  }

  // U3 迟滞入场：联防战开始后，承接人的干员延迟 delay 秒入场，原有生命、技力、站位保留；被援护者的干员不受影响。
  // ★ "谁是承接人"由 match 层写进 battle.flags.crisisUniteHelpers（playerId 数组），这里只按 u.ownerId 筛。
  //   做法：开战时把他们的干员撤下（retreat 保留 hp/sp/tile），delay 秒后 redeploy 并回写 hp/sp。
  const u3 = fx.U3;
  const u3delay = u3 && typeof u3 === 'object' ? Number(u3.delay) : NaN;
  const u3helpers = battle.flags && battle.flags.crisisUniteHelpers;
  if (battle.kind === 'unite' && Number.isFinite(u3delay) && u3delay > 0 && Array.isArray(u3helpers)) {
    const held = [];
    for (const u of battle.allyUnits || []) {
      if (!u || u.kind !== 'op' || !u.alive || !u.deployed) continue;
      if (!u3helpers.includes(u.ownerId)) continue;
      held.push({ u, hp: u.hp, sp: u.s && Number.isFinite(u.s.sp) ? u.s.sp : 0, r: u.tileR, c: u.tileC });
    }
    if (held.length) {
      for (const h of held) {
        try { battle.retreat(h.u, { reason: 'crisis:U3' }); } catch { /* already off */ }
      }
      battle.after(u3delay, () => {
        if (!battle || battle.ended) return;
        for (const h of held) {
          const u = h.u;
          if (!u || u.removed) continue;
          try {
            if (!battle.redeploy(u, { free: true, keepSp: true })) continue;
            // 原有生命、技力保留（redeploy 会恢复满血）
            if (Number.isFinite(h.hp) && h.hp > 0) u.hp = Math.min(h.hp, u.s.maxHp);
            if (u.s && Number.isFinite(h.sp)) u.s.sp = h.sp;
          } catch { /* tile taken */ }
        }
      });
      applied.push('U3');
    } else {
      skipped.push('U3');
    }
  }

  // M4 轮值支援 允许同一玩家连续承接联防；连续第2轮及以后承接的玩家，下一场常规战斗前10秒造成伤害降低10%
  // （计入"我方造成伤害降低"，合计最多−60%），不叠加。
  // ★ "连续承接"由 match 层记录（crisisFx 只读 battle.flags.crisisStreakHelpers，不在引擎里写任何 crisis 分支）。
  const m4 = fx.M4;
  if (m4 && typeof m4 === 'object' && Number.isFinite(m4.cut)) {
    const dur = Number.isFinite(m4.dur) && m4.dur > 0 ? m4.dur : 10;
    const mul = Math.max(0, 1 - m4.cut);
    const streak = battle.flags && battle.flags.crisisStreakHelpers;
    if (streak && typeof streak === 'object') {
      // ★ buff 挂在**单位**上（addBuff(unit, b)），玩家级没有 buffs 字段。
      //   只给"连续承接者"名下的己方单位挂；前10秒内每秒补一次（后部署的干员也要吃到）。
      const mark = () => {
        if (!(battle.time < dur)) return;
        for (const u of battle.units || []) {
          if (!u || u.side !== 'ally' || !u.alive) continue;
          const owner = u.ownerId;
          if (!owner || !streak[owner]) continue;
          if ((u.buffs || []).some((x) => x && x.key === 'crisis:M4')) continue;
          battle.addBuff(u, { key: 'crisis:M4', duration: Math.max(0, dur - battle.time), mods: { dmgDealtMul: mul } });
        }
      };
      mark();
      battle.on('tick', mark);
      applied.push('M4');
    } else {
      // 只有真的没登记连续承接者时才跳过
      skipped.push('M4');
    }
  }

  // J2 高阶失效 第5回合起，每场装备等阶最高的两件装备前15秒失效（同阶由系统选取；仍计为"携带装备"）
  // ★ "失效" 用引擎自己的 grant.dispose() 精确实现 —— installItem 的 grant 就是「这件装备装上去的全部效果」，
  //   dispose 掉再重新 install 就是原样恢复，不需要在伤害公式里逐项扣减（那样漏掉防御/回能/回血等非伤害效果）。
  // ★ 只动 grants，不动 unit.items ⇒ "仍计为携带装备" 天然成立（盟约计数看 itemsOf，不看 grants）。
  const j2 = fx.J2;
  if (j2 && typeof j2 === 'object' && Number.isFinite(j2.dur) && j2.dur > 0) {
    const n = Number.isFinite(j2.n) && j2.n > 0 ? j2.n : 2;
    const dur = j2.dur;
    const tierOf = (id) => (battle.data && battle.data.tierOf ? battle.data.tierOf(id) : 0);
    // ★ 第三个参数省略（不是 null）：默认 init 只在 undefined 时生效，传 null 会炸 "init is not a function"。
    //   若这场战斗还没人装过装备，store 会是空对象 —— 下面的 instanceof 判断会把这种情况挡掉。
    const rt = battleStore(battle, 'items:rt');
    if (rt && rt.grants instanceof Map) {
      const off = []; // { unit, id, grant }
      for (const u of battle.allyUnits || []) {
        if (!u || u.kind !== 'op') continue;
        const gm = rt.grants.get(u);
        if (!gm || !gm.size) continue;
        // 等阶最高的 n 件；同阶按 gid 排序让"系统选取"是确定的
        const list = [...gm.values()].sort((a, b) => (tierOf(b.id) - tierOf(a.id)) || String(a.gid).localeCompare(String(b.gid)));
        for (const g of list.slice(0, n)) off.push({ unit: u, id: g.id, grant: g });
      }
      for (const o of off) {
        o.grant.dispose();
      }
      if (off.length) {
        // 15 秒后原样装回（重新 install 会重建同一份效果）
        battle.after(dur, () => {
          for (const o of off) {
            if (!o.unit || !o.unit.alive) continue;
            try { installItem(battle, o.unit, o.id); } catch { /* the unit left the field */ }
          }
        });
        applied.push('J2');
      }
    }
  }

  // D2 连续压制 同一单位连续普攻同一敌人，第6次起普攻伤害降低35%；切换目标或5秒未命中清除
  // Counted on the 'hit' hook (it carries source + target + dmg) and applied on 'damageOutput'.
  const d2 = fx.D2;
  if (d2 && typeof d2 === 'object' && Number.isFinite(d2.cut) && d2.cut > 0) {
    const from = Number.isFinite(d2.from) && d2.from > 0 ? d2.from : 6;
    const forget = Number.isFinite(d2.reset) && d2.reset > 0 ? d2.reset : 5;
    const mul = lower(d2.cut);
    // source uid -> { target, streak, lastAt }
    const streak = new Map();
    battle.on('hit', (c) => {
      if (!c || !c.source || !c.target) return;
      if (c.dmg && c.dmg.isSkill) return; // 只算普攻
      const k = c.source.uid ?? c.source;
      const cur = streak.get(k);
      if (cur && cur.target === c.target && battle.time - cur.lastAt <= forget + 1e-9) {
        cur.streak += 1;
        cur.lastAt = battle.time;
      } else {
        streak.set(k, { target: c.target, streak: 1, lastAt: battle.time });
      }
    }, { owner: 'crisis' });
    battle.on('damageOutput', (c) => {
      if (!c || !c.source || !c.target) return;
      if (c.target.side === 'ally') return;
      if (c.dmg && (c.dmg.calculation === 'hpLoss' || c.dmg.type === 'element')) return;
      if (c.dmg && c.dmg.isSkill) return;
      const cur = streak.get(c.source.uid ?? c.source);
      if (!cur || cur.target !== c.target) return;
      if (cur.streak < from) return;
      c.amount *= mul;
    }, { owner: 'crisis' });
    applied.push('D2');
  }

  // C2 抗性轮换 敌人每12秒在「物理伤害降低25%」与「法术伤害降低25%」之间切换
  // buffs.js has physTakenMul / artsTakenMul as ordinary mods, so each phase is a plain persistent buff on every
  // enemy — the enemy really does take less of that damage type, no lookalike.
  const c2 = fx.C2;
  if (c2 && typeof c2 === 'object' && Number.isFinite(c2.cut) && c2.cut > 0) {
    const period = Number.isFinite(c2.period) && c2.period > 0 ? c2.period : 12;
    const mul = lower(c2.cut);
    const KEY = 'crisis:C2';
    // phase 0: phys is reduced; each period flips to arts
    const physPhase = () => Math.floor(battle.time / period) % 2 === 0;
    // The phase the buffs are currently in. One number for the whole battle: every enemy shares the same phase,
    // so a single tracker is enough and no per-enemy key can go stale.
    let cur = null;
    const mark = (force = false) => {
      const phys = physPhase();
      if (!force && cur === phys) return;
      cur = phys;
      for (const e of battle.units || []) {
        if (!e || e.side !== 'enemy' || !e.alive) continue;
        battle.removeBuff?.(e, KEY);
        battle.addBuff(e, { key: KEY, persist: true,
          mods: phys ? { physTakenMul: mul } : { artsTakenMul: mul }, source: 'crisis' });
      }
      if (!applied.includes('C2')) applied.push('C2');
    };
    // re-mark on every tick: `mark` is a no-op unless the phase actually changed for that enemy
    battle.on('tick', () => mark(), { owner: 'crisis' });
    battle.on('enemySpawn', () => mark(), { owner: 'crisis' });
    mark();
    applied.push('C2');
  }

  // J5 装备贬值 —— 交给 core.js 读 battle.flags.crisisEquipAtk（见 installVictoria）
  const j5 = fx.J5;
  if (j5 && typeof j5 === 'object' && Number.isFinite(j5.normal) && Number.isFinite(j5.golden)) {
    battle.flags.crisisEquipAtk = { normal: j5.normal, golden: j5.golden };
    applied.push('J5');
  }

  // I2 盟约分心 第 {3} 回合结束前指定一个主核心盟约；其他核心盟约层数获取量变为 70%，附加盟约正常
  // ★ 只能约束到「战斗内层数获取」这一层：主核心是玩家在匹配层的登记（I3 才是登记通道），
  //   这里读 battle.flags.crisisMainBond —— 由匹配层写入；没有登记时整条不生效（不猜谁是主核心）。
  const i2 = fx.I2;
  if (i2 && typeof i2 === 'object' && Number.isFinite(i2.mul) && i2.mul > 0 && i2.mul < 1) {
    const mainBond = battle.flags.crisisMainBond ?? null;
    if (mainBond) {
      const mul = i2.mul;
      battle.on('layerGain', (ctx) => {
        if (!ctx || !Number.isFinite(ctx.n)) return;
        if (!ctx.bondId || ctx.bondId === mainBond) return; // 主核心不动
        ctx.n *= mul;
      }, { owner: 'crisis' });
      applied.push('I2');
    } else {
      skipped.push('I2');
    }
  }

  // I1 盟约折损 所有来源获得的盟约层数变为 {80%|65%|50%}，小数累计
  // economy.js addLayers emits layerGain with a MUTABLE ctx.n (line 37 reads it back), and layerGainRoom keeps the
  // fractional remainder — so multiplying here is exactly "小数累计", not a rounding approximation.
  const i1 = fx.I1;
  if (i1 && typeof i1 === 'object' && Number.isFinite(i1.mul) && i1.mul >= 0 && i1.mul < 1) {
    const mul = i1.mul;
    battle.on('layerGain', (ctx) => {
      if (!ctx || !Number.isFinite(ctx.n)) return;
      ctx.n *= mul;
    }, { owner: 'crisis' });
    applied.push('I1');
  }

  // D4 增幅衰减 盟约/装备/策略提供的【独立百分比伤害增幅】，超过100%的部分按 {75%|50%|25%} 保留；
  // 不直接修改攻击力或技能伤害倍率，也不影响敌方受到的伤害增加。
  // No seam carries "which buff produced which slice of dmgDealtMul", and the text explicitly excludes ATK and
  // skill multipliers — so this cannot be a stat mod without becoming a different rule. Result-affecting hooks are
  // observed only (hit.js spreads a COPY into damageCalculate); damageOutput is the one writable result hook.
  // The independent slice is identified by the buff keys the three named sources actually use.
  const d4 = fx.D4;
  if (d4 && typeof d4 === 'object' && Number.isFinite(d4.keep) && d4.keep < 1) {
    const KEEP = d4.keep;
    const SOURCES = ['bond:', 'item:', 'choice:'];
    const slice = (u) => {
      let m = 1;
      for (const b of u.buffs || []) {
        if (!b || !b.mods || !Number.isFinite(b.mods.dmgDealtMul)) continue;
        if (SOURCES.some((pre) => String(b.key || '').startsWith(pre))) m *= b.mods.dmgDealtMul;
      }
      return m;
    };
    battle.on('damageOutput', (c) => {
      if (!c || !c.source || !c.target || !(c.amount > 0)) return;
      if (c.target.side === 'ally') return;
      if (c.dmg && (c.dmg.calculation === 'hpLoss' || c.dmg.type === 'element')) return;
      const m = slice(c.source);
      // only the part ABOVE +100% is reduced: excess × keep is added back on top of the base 1.
      // m === 2 is exactly +100% (nothing exceeds it) ⇒ untouched; any m > 1 with excess is scaled.
      if (!(m > 2)) return;
      c.amount *= (1 + (m - 1) * KEEP) / m;
    }, { owner: 'crisis' });
    applied.push('D4');
  }

  // N3 领袖压制 领袖战的我方作战时限缩短10%（文本限定「领袖战」，普通关不动）
  // Battle.js marks a leader fight as kind 'boss'; timeLimit is the field's own clock, so the shortening is
  // the existing number reduced — not a parallel timer.
  const n3 = fx.N3;
  if (n3 && typeof n3 === 'object' && Number.isFinite(n3.cut) && n3.cut > 0
      && (battle.kind === 'boss' || battle.kind === 'hidden') && Number.isFinite(battle.timeLimit)) {
    battle.timeLimit *= lower(n3.cut);
    applied.push('N3');
  }

  // E2 无序干扰 战斗第25秒起，每30秒出现6秒干扰，受到的治疗量降低60%；护盾及非治疗类生命回复不变
  // units.js exposes healingTakenMul (attack/heal.js multiplies it into every heal), and a buff's `duration` is
  // engine-native, so the window is a scheduled buff — no approximation.
  const e2 = fx.E2;
  if (e2 && typeof e2 === 'object' && Number.isFinite(e2.cut) && e2.cut > 0) {
    const start = Number.isFinite(e2.start) ? e2.start : 25;
    const period = Number.isFinite(e2.period) && e2.period > 0 ? e2.period : 30;
    const dur = Number.isFinite(e2.dur) && e2.dur > 0 ? e2.dur : 6;
    const mul = lower(e2.cut);
    applied.push('E2');
    let nextAt = start;
    battle.on('tick', () => {
      const t = battle.time;
      if (!(t >= nextAt - 1e-9)) return;
      nextAt += period;
      for (const u of battle.allyUnits || []) {
        if (!u || !u.alive || u.kind !== 'op') continue;
        battle.addBuff(u, { key: 'crisis:E2', duration: dur, mods: { healingTakenMul: mul }, source: 'crisis' });
      }
      if (!applied.includes('E2')) applied.push('E2');
    }, { owner: 'crisis' });
  }

  // D3 半区轮换 我方棋盘分左右两个半区，每20秒轮换；受压半区内的单位造成伤害降低25%
  // tiles carry tileR / tileC (deploy.js), so "which half" is a column comparison; dmgDealtMul is the engine's
  // own outgoing-damage multiplier. The window flips on the battle clock, so no timer of our own is needed.
  const d3 = fx.D3;
  if (d3 && typeof d3 === 'object' && Number.isFinite(d3.cut) && d3.cut > 0) {
    const period = Number.isFinite(d3.period) && d3.period > 0 ? d3.period : 20;
    const mul = lower(d3.cut);
    const mid = Math.ceil(COLS / 2);
    applied.push('D3');
    // phase 0: the LEFT half is the pressed one; each period flips it
    const pressed = () => (Math.floor(battle.time / period) % 2 === 0 ? 'left' : 'right');
    const mark = () => {
      const side = pressed();
      for (const u of battle.allyUnits || []) {
        if (!u || !u.alive || u.kind !== 'op') continue;
        const col = Number.isFinite(u.tileC) ? u.tileC : u.homeC;
        if (!Number.isFinite(col)) continue;
        const inPressed = side === 'left' ? col < mid : col >= mid;
        const has = (u.buffs || []).some((b) => b && b.key === 'crisis:D3');
        if (inPressed && !has) battle.addBuff(u, { key: 'crisis:D3', persist: true, mods: { dmgDealtMul: mul }, source: 'crisis' });
        else if (!inPressed && has) battle.removeBuff?.(u, 'crisis:D3');
      }
      // first mark counts as the route landing; later flips are the same rule continuing, not a re-apply
      if (!applied.includes('D3')) applied.push('D3');
    };
    let nextFlip = period;
    battle.on('tick', () => {
      if (battle.time + 1e-9 < nextFlip) return;
      nextFlip += period;
      mark();
    }, { owner: 'crisis' });
    battle.on('deploy', () => mark(), { owner: 'crisis' });
    mark();
  }

  // F2 sits on the spGain hook and needs no unit, so it is installed before the ally-only early exit
  if (f2Mul !== 1) {
    const DIRECT = new Set(['relic', 'band', 'bond', 'item', 'talent']);
    battle.on('spGain', (ctx) => {
      if (!ctx || !DIRECT.has(ctx.reason)) return;
      ctx.amount = (Number.isFinite(ctx.amount) ? ctx.amount : 0) * f2Mul;
    }, { owner: 'crisis' });
  }
  // A route that landed on a battle-level flag or a tick rule (F3 / F2 / E2 / D3) is already in `applied` and needs no
  // unit, so this early exit must return the list as it stands — not an empty one.
  if (hpMul === 1 && atkMul === 1 && spMul === 1 && f2Mul === 1 && !hasC1) return { applied: applied.slice(), skipped };

  const touch = (unit) => {
    if (!unit || unit.kind !== 'op' || unit.side !== 'ally') return;
    // the key makes this idempotent: a redeploy must not stack the same contract twice. `mods` is FLAT
    // (server/sim/buffs.js aggregateMods): a key ending in `Mul` multiplies into the aggregate's `mul` table, which is
    // exactly what units.js _recalc reads. Nesting it (`{ mul: { hpMul } }`) would be silently ignored.
    const mods = {};
    if (hpMul !== 1) mods.hpMul = hpMul;
    if (atkMul !== 1) mods.atkMul = atkMul;
    if (Object.keys(mods).length && !(unit.buffs || []).some((b) => b && b.key === 'crisis:stats')) {
      battle.addBuff(unit, { key: 'crisis:stats', persist: true, mods });
    }
    if (spMul !== 1 && unit.skill && unit.skill._crisisSp !== spMul) {
      unit.skill._crisisSp = spMul;
      unit.skill.spCostMul = unit.skill.spCostMul * spMul;
    }
  };
  battle.on('deploy', ({ unit } = {}) => touch(unit), { owner: 'crisis' });
  for (const u of battle.allyUnits || []) if (u && u.alive) touch(u);

  // Enemy-side FLAT adds need the unit instance, so they ride the enemySpawn hook rather than the spawn list.
  // C1 反装甲: 敌人防御增加{100|200}，法术抗性增加{5|10}. units.js computes def as (base + defFlat) × … and res as
  // (base + resFlat) × …, so a flat add is exactly defFlat / resFlat — no approximation involved.
  const c1 = fx.C1;
  if (c1 && typeof c1 === 'object' && (Number.isFinite(c1.def) || Number.isFinite(c1.res))) {
    const flatMods = {};
    if (Number.isFinite(c1.def) && c1.def !== 0) flatMods.defFlat = c1.def;
    if (Number.isFinite(c1.res) && c1.res !== 0) flatMods.resFlat = c1.res;
    if (Object.keys(flatMods).length) {
      const harden = (unit) => {
        if (!unit || unit.kind !== 'enemy' || unit.side !== 'enemy') return;
        if ((unit.buffs || []).some((b) => b && b.key === 'crisis:enemyFlat')) return;
        battle.addBuff(unit, { key: 'crisis:enemyFlat', persist: true, mods: flatMods });
      };
      battle.on('enemySpawn', ({ unit } = {}) => harden(unit), { owner: 'crisis' });
      for (const u of battle.enemyUnits || []) if (u && u.alive) harden(u);
      applied.push('C1');
    }
  }
  return { applied, skipped };
}
