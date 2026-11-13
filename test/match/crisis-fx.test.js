// 危机合约 · 效果落地: every route this engine CAN honour, each asserted on a REAL battle.
//
// 这一层钉的是「说生效就真的生效」：不是「函数被调用了」，而是敌方 / 干员的实际数值变了。
// 同时钉住另一面：没有合约时一个数都不许动，没有落点的组必须如实报缺口。
//
// The authority for what a route MEANS is the official FX table (sh.bbsmc.cn v024 js/ui/crisisTags.js); a route whose
// text needs a seam this engine does not have is asserted as SKIPPED here, so the gap can never silently pass as done.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { applyCrisisFx, crisisEnemyMul, crisisSpawnRhythm } from '../../server/match/match/crisisFx.js';
import { crisisNamedEnemyMul } from '../../server/match/match/crisisQTargets.js';
import { crisisRules } from '../../shared/crisis.js';
import { canTargetAlly } from '../../server/sim/targeting.js';
import { startColdWind } from '../../server/sim/content/devices.js';
import { GameData } from '../../server/match/gamedata.js';
import { pickCrisisMark } from '../../server/match/match/crisisMark.js';
import { planCrisisM5, M5_ADD } from '../../server/match/match/crisisM5.js';
import { crisisSpecialSpawns } from '../../server/match/match/crisisSpecial.js';
import { crisisSquadSpawns, crisisPairSpawns, crisisTogetherSpawns, Q4_KEYS, Q9_KEYS, Q4_WINDOW, Q9_WINDOW, Q8_GUARD_KEYS, Q8_BLADE_KEYS, Q8_WINDOW } from '../../server/match/match/crisisSpawnShape.js';
import { buildNormalWave } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA } from './harness.js';
import { bondBb } from '../../server/sim/content/bonds/core.js';
import { makeMatch } from './harness.js';
import { pickCrisisBannedTiles, applyCrisisBannedTiles } from '../../server/match/match/crisisTiles.js';
import { buildDeployMap } from '../../server/match/board.js';
import { battleStore } from '../../server/sim/content/support/index.js';
import { helperOrder } from '../../server/match/unite.js';
import { reviveNow } from '../../server/sim/content/items/battle.js';
import { pickCrisisPressure } from '../../server/match/match/crisisPressure.js';

const fx = (...tags) => crisisRules({ mode: 'solo', tags }).fx;
const NO_ENEMY = { hpMul: 1, atkMul: 1, speedMul: 1 };

function opBattle(extra = {}) {
  return makeBattle({ content: 'none', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 },
      skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
    units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], ...extra });
}

// ── 乘算口径：表里写的是「提高 X」⇒ ×(1+X)；「降低」⇒ ×(1−X)
test('A1 源石环境：活性 — 敌方血量提高，三档分别 ×1.25 / ×1.5 / ×1.8', () => {
  assert.equal(crisisEnemyMul(fx('A1-1')).hpMul, 1.25);
  assert.equal(crisisEnemyMul(fx('A1-2')).hpMul, 1.5);
  assert.equal(crisisEnemyMul(fx('A1-3')).hpMul, 1.8);
});

test('B1 源石环境：刺激 — 敌方攻击提高，三档分别 ×1.15 / ×1.3 / ×1.5', () => {
  assert.equal(crisisEnemyMul(fx('B1-1')).atkMul, 1.15);
  assert.equal(crisisEnemyMul(fx('B1-2')).atkMul, 1.3);
  assert.equal(crisisEnemyMul(fx('B1-3')).atkMul, 1.5);
});

test('N1 反机动 — 所有敌人移动速度增加 20% ⇒ speedMul ×1.2', () => {
  const m = crisisEnemyMul(fx('N1-1'));
  assert.equal(m.speedMul, 1.2);
  assert.equal(m.hpMul, 1, '不碰血量');
  assert.equal(m.atkMul, 1, '不碰攻击');
});

test('Q1/Q9 是定点词条：只打官方点名的敌人，不是全局倍率', () => {
  // 全局乘算不碰它们 —— 否则会连所有敌人一起加血
  assert.equal(crisisEnemyMul(fx('Q1-1')).hpMul, 1, 'Q1 不进全局乘算');
  assert.equal(crisisEnemyMul(fx('Q9-2')).hpMul, 1, 'Q9 不进全局乘算');
  // 定点：按官方表的 enemyKey 命中
  assert.deepEqual(crisisNamedEnemyMul(fx('Q1-1'), 'enemy_1042_frostd'), { hpMul: 1.3 }, '寒霜 ×1.3');
  assert.deepEqual(crisisNamedEnemyMul(fx('Q1-1'), 'enemy_1072_dlancer'), {}, '不是寒霜就不动');
  // Q9 一档只有 move（移动加速上限是 content），二档才有 hp
  assert.deepEqual(crisisNamedEnemyMul(fx('Q9-1'), 'enemy_1072_dlancer'), {}, '一档不动血量');
  assert.deepEqual(crisisNamedEnemyMul(fx('Q9-2'), 'enemy_1072_dlancer'), { hpMul: 1.2 }, '二档：生命 +20%');
});

test('多档同时选：各自相乘', () => {
  const m = crisisEnemyMul(fx('A1-3', 'B1-3', 'N1-1'));
  assert.equal(m.hpMul, 1.8);
  assert.equal(m.atkMul, 1.5);
  assert.equal(m.speedMul, 1.2);
});

test('没有合约、或合约不含敌方侧：乘算恒为 1（普通战斗一个数都不动）', () => {
  assert.deepEqual(crisisEnemyMul(null), NO_ENEMY);
  assert.deepEqual(crisisEnemyMul(undefined), NO_ENEMY);
  assert.deepEqual(crisisEnemyMul({}), NO_ENEMY);
  assert.deepEqual(crisisEnemyMul(fx('E1-1', 'F1-1', 'O1-1')), NO_ENEMY);
});

// ── 我方侧：全部落在真实 battle 的数值上
test('E1 源石环境：侵蚀 — 我方干员血量真的降低（实测 10000 → 7000）', () => {
  const base = opBattle(); base.step();
  assert.equal(base.b.allyUnits.find((u) => u.kind === 'op').s.maxHp, 10000, '基准血量');

  const h = opBattle();
  const r = applyCrisisFx(h.b, fx('E1-2'));
  assert.deepEqual(r.applied, ['E1']);
  h.step();
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  assert.equal(op.s.maxHp, 7000, 'E1 二档：×0.7');
  assert.equal(op.buffs.filter((b) => b.key === 'crisis:stats').length, 1, 'buff 只挂一次');
});

test('D1 环境：高价值目标 — 我方攻击真的降低（实测 500 → 350 / 400 / 450）', () => {
  const expect = { 'D1-1': 450, 'D1-2': 400, 'D1-3': 350 };
  for (const [tag, want] of Object.entries(expect)) {
    const h = opBattle();
    const r = applyCrisisFx(h.b, fx(tag));
    assert.deepEqual(r.applied, ['D1'], tag);
    h.step();
    assert.equal(h.b.allyUnits.find((u) => u.kind === 'op').s.atk, want, tag);
  }
});

test('F1 源石环境：阻抑 — 我方技能消耗真的提高（实测 40 → 60）', () => {
  const base = opBattle(); base.step();
  assert.equal(base.b.allyUnits.find((u) => u.kind === 'op').skill.spCost, 40, '基准消耗');

  const h = opBattle();
  applyCrisisFx(h.b, fx('F1-3'));
  h.step();
  assert.equal(h.b.allyUnits.find((u) => u.kind === 'op').skill.spCost, 60, 'F1 三档：×1.5');
});

test('F3 禁闭封锁 — 开局操作冷却真的被抬到 8 秒，且仍能攒技力', () => {
  const h = opBattle();
  const before = h.b.flags.startOpCooldown;
  const r = applyCrisisFx(h.b, fx('F3-1'));
  assert.deepEqual(r.applied, ['F3']);
  assert.equal(h.b.flags.startOpCooldown, 8, 'F3：开局 8 秒不能开主动技能');
  assert.ok(before < 8, '基准冷却低于 8 秒（否则这条测不出东西）');
});

test('F3 — 没有合约时开局冷却一个数都不动', () => {
  const h = opBattle();
  const before = h.b.flags.startOpCooldown;
  applyCrisisFx(h.b, null);
  assert.equal(h.b.flags.startOpCooldown, before);
});

test('F2 减速回能 — 只降「直接」回复：装备/盟约/策略 −50%，自然与攻击受击不变', () => {
  const h = opBattle();
  const r = applyCrisisFx(h.b, fx('F2-1'));
  assert.deepEqual(r.applied, ['F2']);
  const gain = (reason) => { const ctx = { unit: null, amount: 10, reason, skill: null }; h.b.emit('spGain', ctx); return ctx.amount; };
  for (const direct of ['relic', 'item', 'bond', 'talent', 'band']) assert.equal(gain(direct), 5, `${direct} 属于直接回复 ⇒ 减半`);
  for (const own of ['time', 'attack', 'hurt']) assert.equal(gain(own), 10, `${own} 不在文本范围内 ⇒ 不动`);
});

test('F2 — 没有合约时 spGain 一个数都不改', () => {
  const h = opBattle();
  applyCrisisFx(h.b, null);
  const ctx = { unit: null, amount: 10, reason: 'relic', skill: null };
  h.b.emit('spGain', ctx);
  assert.equal(ctx.amount, 10);
});

test('E2 无序干扰 — 第25秒起每30秒一次、持续6秒，受到治疗 ×0.4', () => {
  const h = opBattle();
  const r = applyCrisisFx(h.b, fx('E2-1'));
  assert.deepEqual(r.applied, ['E2']);
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  const has = () => (op.buffs || []).some((b) => b.key === 'crisis:E2');
  h.run(24);
  assert.equal(has(), false, '第 24 秒还没开始');
  h.run(2);
  assert.equal(has(), true, '第 25 秒进入干扰');
  const b = op.buffs.find((x) => x.key === 'crisis:E2');
  assert.equal(b.duration, 6, '持续 6 秒');
  assert.equal(b.mods.healingTakenMul, 0.4, '受到治疗 ×0.4');
});

test('D3 半区轮换 — 每20秒换边，只有受压半区带上 ×0.75 的造成伤害降低', () => {
  const h = makeBattle({ content: 'none', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 },
      skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
    units: [{ uid: 1, chessId: 'probe', row: 10, col: 1 }, { uid: 2, chessId: 'probe', row: 10, col: 15 }] });
  const r = applyCrisisFx(h.b, fx('D3-1'));
  assert.deepEqual(r.applied, ['D3']);
  const pressed = () => h.b.allyUnits.filter((u) => u.kind === 'op' && (u.buffs || []).some((b) => b.key === 'crisis:D3'))
    .map((u) => u.tileC).sort((a, b) => a - b);
  h.run(1); // the install-time mark is cleared by the first step; the tick rule re-establishes it
  const left = pressed();
  assert.equal(left.length, 1, '同一时刻只有一半受压');
  const first = left[0];
  h.run(21);
  const second = pressed()[0];
  assert.notEqual(second, first, '20 秒后换到另一半');
  h.run(21);
  assert.equal(pressed()[0], first, '40 秒后换回来');
});

test('N3 领袖压制 — 领袖战时限 −10%，普通关不动', () => {
  const bossFx = fx('N3-1');
  const boss = makeBattle({ content: 'none', kind: 'boss', autoFinish: false, timeLimit: 200,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 } }) } },
    units: [] });
  const r = applyCrisisFx(boss.b, bossFx);
  assert.ok(r.applied.includes('N3'), '领袖战里 N3 必须报生效');
  assert.equal(boss.b.timeLimit, 180, '200 × 0.9');

  const norm = makeBattle({ content: 'none', autoFinish: false, timeLimit: 200,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 } }) } },
    units: [] });
  applyCrisisFx(norm.b, bossFx);
  assert.equal(norm.b.timeLimit, 200, '普通关不缩短');
});

test('K3 拥挤 — 正交相邻满3名干员时前10秒攻击力 ×0.85', () => {
  // a plus shape: the centre operator has three orthogonal neighbours
  const h = makeBattle({ content: 'none', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 },
      skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
    units: [
      { uid: 1, chessId: 'probe', row: 10, col: 10 },
      { uid: 2, chessId: 'probe', row: 9, col: 10 },
      { uid: 3, chessId: 'probe', row: 11, col: 10 },
      { uid: 4, chessId: 'probe', row: 10, col: 9 },
      { uid: 5, chessId: 'probe', row: 10, col: 11 },
    ] });
  h.run(0.2);
  const r = applyCrisisFx(h.b, fx('K3-1'));
  h.run(0.2);
  assert.ok(r.applied.includes('K3'), 'K3 必须报生效');
  const centre = h.b.allyUnits.find((u) => u.uid === 1);
  const corner = h.b.allyUnits.find((u) => u.uid === 4);
  assert.equal(centre.s.atk, 425, '中心被三名正交邻居包围 ⇒ 500 × 0.85');
  assert.equal(corner.s.atk, 500, '只与一名相邻的干员不受影响');
});

test('K3 — 没有合约时攻击力一个数都不动', () => {
  const h = makeBattle({ content: 'none', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 },
      skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
    units: [{ uid: 1, chessId: 'probe', row: 10, col: 10 }, { uid: 2, chessId: 'probe', row: 9, col: 10 }] });
  h.run(0.2);
  applyCrisisFx(h.b, null);
  h.run(0.2);
  for (const u of h.b.allyUnits.filter((x) => x.kind === 'op')) assert.equal(u.s.atk, 500);
});

test('B2 制式装备 — 只给远程干员加射程与攻速，近战不动', () => {
  const mk2 = (range, uid) => ({ uid, chessId: 'probe', row: 10, col: 5 });
  const h = makeBattle({ content: 'none', autoFinish: false,
    defs: { chess: {
      melee: chessRec({ id: 'melee', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 } }),
      ranged: chessRec({ id: 'ranged', profession: 'SNIPER', position: 'RANGED',
        stats: { maxHp: 10000, atk: 500, def: 100, res: 10 }, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]] }),
    } },
    units: [{ uid: 1, chessId: 'melee', row: 12, col: 5 }, { uid: 2, chessId: 'ranged', row: 10, col: 5 }] });
  h.run(0.2);
  const ranged = h.b.allyUnits.find((u) => u.uid === 2);
  const melee = h.b.allyUnits.find((u) => u.uid === 1);
  const r = applyCrisisFx(h.b, fx('B2-1'));
  h.run(0.5);
  assert.ok(r.applied.includes('B2'));
  const buffed = (u) => (u.buffs || []).some((b) => b.key === 'crisis:B2');
  assert.equal(buffed(ranged), true, '远程干员拿到射程/攻速');
  assert.equal(buffed(melee), false, '近战干员不拿');
  assert.ok(ranged.s.rangeExtend >= 1, '射程扩大1格');
  assert.ok(ranged.s.aspd > 100, '攻速提高（攻击间隔缩短20% ⇒ aspd ×1.25）');
});

test('D4 增幅衰减 — 只削减超过+100%的那部分，1倍/恰好2倍不动', () => {
  const dmgWith = (tag, bondMul) => {
    const h = makeBattle({ content: 'none', autoFinish: false,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 },
        skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }],
      enemies: [{ key: 'enemy_1422_lrsldr' }] });
    h.run(0.3);
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    const en = h.b.units.find((u) => u.side === 'enemy');
    if (bondMul) h.b.addBuff(op, { key: 'bond:test', persist: true, mods: { dmgDealtMul: bondMul }, source: 't' });
    if (tag) applyCrisisFx(h.b, fx(tag));
    const before = en.hp;
    h.b.dealDamage({ source: op, target: en, amount: 1000, type: 'phys' });
    return before - en.hp;
  };
  const base3 = dmgWith(null, 3);
  const d43 = dmgWith('D4-1', 3);
  // ×3 的独立增幅 ⇒ 超过 +100% 的部分是 2，保留 75% ⇒ 有效 1+2×0.75=2.5，相对 3 是 0.833
  assert.equal(base3, 2700);
  assert.equal(d43, 2250);
  assert.ok(Math.abs(d43 / base3 - 0.833) < 0.002, '×3 ⇒ 约 0.833');
  // 恰好 +100%：没有任何部分"超过"100%，一个数都不动
  assert.equal(dmgWith('D4-1', 2), dmgWith(null, 2), '恰好 2 倍不动');
  // 1 倍（无增幅）：不动
  assert.equal(dmgWith('D4-1', 1), dmgWith(null, 1), '无增幅不动');
});

test('D4 — 没有合约时伤害一个数都不动', () => {
  const h = makeBattle({ content: 'none', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 },
      skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
    units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_1422_lrsldr' }] });
  h.run(0.3);
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  const en = h.b.units.find((u) => u.side === 'enemy');
  h.b.addBuff(op, { key: 'bond:test', persist: true, mods: { dmgDealtMul: 3 }, source: 't' });
  applyCrisisFx(h.b, null);
  const before = en.hp;
  h.b.dealDamage({ source: op, target: en, amount: 1000, type: 'phys' });
  assert.equal(before - en.hp, 2700);
});

test('I1 盟约折损 — 层数获取量 ×{0.8|0.65|0.5}，小数累计', () => {
  const layers = (tag, n = 20) => {
    const h = makeBattle({ content: 'none', kind: 'normal', autoFinish: false,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 },
        skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [] });
    h.run(0.2);
    if (tag) applyCrisisFx(h.b, fx(tag));
    let total = 0;
    for (let i = 0; i < n; i++) total += h.b.addLayers('p1', 'bond:test', 1, 'test');
    return total;
  };
  // 层数是小数累计的，浮点会有 1e-15 级误差 ⇒ 用容差比，不钉死字面量
  const near = (got, want, why) => assert.ok(Math.abs(got - want) < 1e-6, `${why}: got ${got}, want ${want}`);
  near(layers(null), 20, '基准：20 次各 1 层 ⇒ 20');
  near(layers('I1-1'), 16, '×0.8');
  near(layers('I1-2'), 13, '×0.65 ⇒ 13（小数累计后取整）');
  near(layers('I1-3'), 10, '×0.5');
});

test('I1 — 没有合约时层数一个数都不动', () => {
  const h = makeBattle({ content: 'none', kind: 'normal', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 },
      skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
    units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [] });
  h.run(0.2);
  applyCrisisFx(h.b, null);
  let total = 0;
  for (let i = 0; i < 20; i++) total += h.b.addLayers('p1', 'bond:test', 1, 'test');
  assert.equal(total, 20);
});

test('C2 抗性轮换 — 每12秒在物抗/法抗之间精确翻转', () => {
  const h = makeBattle({ content: 'none', kind: 'normal', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 },
      skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
    units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_1422_lrsldr' }] });
  h.run(0.3);
  const en = h.b.units.find((u) => u.side === 'enemy');
  applyCrisisFx(h.b, fx('C2-1'));
  // 直接设时间再触发 tick —— 走真实战斗会让敌人先被打死，测不到翻转
  const modsAt = (t) => {
    h.b.time = t;
    h.b.emit('tick');
    const b = (en.buffs || []).find((x) => x.key === 'crisis:C2');
    return b ? b.mods : null;
  };
  assert.deepEqual(modsAt(0), { physTakenMul: 0.75 }, 't=0 物抗');
  assert.deepEqual(modsAt(11.9), { physTakenMul: 0.75 }, 't=11.9 仍是物抗');
  assert.deepEqual(modsAt(12), { artsTakenMul: 0.75 }, 't=12 翻成法抗');
  assert.deepEqual(modsAt(23.9), { artsTakenMul: 0.75 }, 't=23.9 仍是法抗');
  assert.deepEqual(modsAt(24), { physTakenMul: 0.75 }, 't=24 翻回物抗');
  assert.deepEqual(modsAt(36), { artsTakenMul: 0.75 }, 't=36 再翻法抗');
});

test('C2 — 没有合约时不挂任何抗性 buff', () => {
  const h = makeBattle({ content: 'none', kind: 'normal', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 },
      skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
    units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_1422_lrsldr' }] });
  h.run(0.3);
  const en = h.b.units.find((u) => u.side === 'enemy');
  applyCrisisFx(h.b, null);
  h.b.time = 24;
  h.b.emit('tick');
  assert.equal((en.buffs || []).filter((x) => x.key === 'crisis:C2').length, 0);
});

test('D2 连续压制 — 同一目标第6次起普攻伤害 ×0.65', () => {
  const seq = (tag) => {
    const h = makeBattle({ content: 'none', kind: 'normal', autoFinish: false,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 0, res: 0 },
        skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }],
      enemies: [{ key: 'enemy_1422_lrsldr' }] });
    h.run(0.3);
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    const en = h.b.units.find((u) => u.side === 'enemy');
    if (tag) applyCrisisFx(h.b, fx(tag));
    const out = [];
    for (let i = 1; i <= 8; i++) {
      en.alive = true;
      en.hp = en.s.maxHp; // 每次打满血，否则第 6 次前敌人已被打死
      const before = en.hp;
      h.b.dealDamage({ source: op, target: en, amount: 1000, type: 'phys' });
      out.push(Math.round(before - en.hp));
    }
    return out;
  };
  assert.deepEqual(seq(null), [900, 900, 900, 900, 900, 900, 900, 900], '无合约：8 次全是 900');
  assert.deepEqual(seq('D2-1'), [900, 900, 900, 900, 900, 585, 585, 585], '第6次起 900×0.65=585');
});

test('D2 — 切换目标后计数清零', () => {
  const h = makeBattle({ content: 'none', kind: 'normal', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 0, res: 0 },
      skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
    units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_1422_lrsldr' }, { key: 'enemy_1422_lrsldr' }] });
  h.run(0.3);
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  const ens = h.b.units.filter((u) => u.side === 'enemy');
  assert.ok(ens.length >= 2, '需要两个敌人才能测切目标');
  applyCrisisFx(h.b, fx('D2-1'));
  const hitOne = (en) => {
    en.alive = true;
    en.hp = en.s.maxHp;
    const before = en.hp;
    h.b.dealDamage({ source: op, target: en, amount: 1000, type: 'phys' });
    return Math.round(before - en.hp);
  };
  for (let i = 0; i < 5; i++) hitOne(ens[0]);
  assert.equal(hitOne(ens[0]), 585, '第6次已衰减');
  // 换打另一个：新目标从第 1 次算起
  assert.equal(hitOne(ens[1]), 900, '切换目标后回到 900');
});

test('F4 缓慢预热 — 前30秒自然回能+30%、技能伤害−15%，30秒后恢复', () => {
  const probe = (tag) => {
    const h = makeBattle({ content: 'none', kind: 'normal', autoFinish: false,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 0, res: 0 },
        skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }],
      enemies: [{ key: 'enemy_1422_lrsldr' }] });
    h.run(0.3);
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    const en = h.b.units.find((u) => u.side === 'enemy');
    if (tag) applyCrisisFx(h.b, fx(tag));
    const regen = () => { const c = { unit: op, amount: 10, reason: 'time' }; h.b.emit('spGain', c); return c.amount; };
    const skill = () => {
      en.alive = true; en.hp = en.s.maxHp;
      const b = en.hp;
      h.b.dealDamage({ source: op, target: en, amount: 1000, type: 'phys', isSkill: true });
      return Math.round(b - en.hp);
    };
    return { t0: { regen: regen(), skill: skill() }, t40: (h.b.time = 40, { regen: regen(), skill: skill() }) };
  };
  const base = probe(null);
  assert.equal(base.t0.regen, 10);
  assert.equal(base.t0.skill, 900);
  const f4 = probe('F4-1');
  assert.equal(f4.t0.regen, 13, '前30秒自然回能 ×1.3');
  assert.equal(f4.t0.skill, 765, '前30秒技能伤害 ×0.85');
  assert.equal(f4.t40.regen, 10, '30秒后回能恢复');
  assert.equal(f4.t40.skill, 900, '30秒后技能伤害恢复');
});

test('F4 — 攻击/受击回能不受影响（只加自然回能）', () => {
  const h = makeBattle({ content: 'none', kind: 'normal', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 0, res: 0 },
      skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
    units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_1422_lrsldr' }] });
  h.run(0.3);
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  applyCrisisFx(h.b, fx('F4-1'));
  for (const reason of ['attack', 'hurt', 'relic']) {
    const c = { unit: op, amount: 10, reason };
    h.b.emit('spGain', c);
    assert.equal(c.amount, 10, reason + ' 回能不变');
  }
});

test('I2 盟约分心 — 非主核心盟约层数 ×0.7，主核心不动', () => {
  const run = (tag, mainBond) => {
    const h = makeBattle({ content: 'none', kind: 'normal', autoFinish: false,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 0, res: 0 },
        skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [] });
    h.run(0.2);
    if (mainBond) h.b.flags.crisisMainBond = mainBond;
    if (tag) applyCrisisFx(h.b, fx(tag));
    return {
      main: h.b.addLayers('p1', 'bond:MAIN', 10, 't'),
      other: h.b.addLayers('p1', 'bond:OTHER', 10, 't'),
    };
  };
  const base = run(null, 'bond:MAIN');
  assert.equal(base.main, 10);
  assert.equal(base.other, 10);
  const i2 = run('I2-1', 'bond:MAIN');
  assert.equal(i2.main, 10, '主核心不动');
  assert.equal(i2.other, 7, '其他核心 ×0.7');
});

test('I2 — 没登记主核心时整条不生效（不猜谁是主核心）', () => {
  const h = makeBattle({ content: 'none', kind: 'normal', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 0, res: 0 },
      skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
    units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [] });
  h.run(0.2);
  const r = applyCrisisFx(h.b, fx('I2-1'));
  assert.ok(r.skipped.includes('I2'), 'I2 记入 skipped');
  assert.equal(h.b.addLayers('p1', 'bond:OTHER', 10, 't'), 10, '层数不动');
});

test('J5 装备贬值 — 维多利亚六人档装备攻击加成 50%/80% → 25%/40%', () => {
  const h = makeBattle({ content: 'none', kind: 'normal', autoFinish: false, units: [], enemies: [] });
  h.run(0.1);
  const read = () => {
    const bb = bondBb('victoriaShip');
    const ov = h.b.flags.crisisEquipAtk;
    return {
      normal: ov && Number.isFinite(ov.normal) ? ov.normal : bb.atk_normal_equip,
      golden: ov && Number.isFinite(ov.golden) ? ov.golden : bb.atk_normal_equip + bb.atk_golden_equip,
    };
  };
  const base = read();
  assert.equal(base.normal, 0.5, '数据表原值 50%');
  assert.equal(base.golden, 0.8, '数据表原值 80%');
  applyCrisisFx(h.b, fx('J5-1'));
  const j5 = read();
  assert.equal(j5.normal, 0.25, '基础装备 25%');
  assert.equal(j5.golden, 0.4, '进阶装备 40%');
  // ★ 数据表本身没被改动（只是这场战斗读到的数被替换）
  const bb = bondBb('victoriaShip');
  assert.equal(bb.atk_normal_equip, 0.5, 'data 表未被污染');
  assert.equal(bb.atk_golden_equip, 0.3, 'data 表未被污染');
});

test('H5 操作配额 — 每休整期主动操作次数到顶后拒绝', () => {
  const run = (fx) => {
    const h = makeMatch({ mode: 'coop', humans: 2, seed: 44, fake: true }).start();
    const m = h.m;
    const ps = [...m.players.values()][0];
    h.start();
    h.runToPhase('PREP');
    if (fx) m.gd.crisisFx = fx;
    const raw = m.gd.raw;
    const chessIds = Object.keys(raw.chess);
    let ok = 0, denied = 0, capMsg = 0;
    for (let i = 0; i < 6; i++) {
      // ★ 用 g.sell 而不是 g.buy：同一个商店槽位第二次买会 SOLD_OUT，那是夹具问题，与 H5 无关。
      ps.acquireChess(chessIds[i]);
      const piece = ps.hand.filter((x) => x && x.kind === 'chess').pop();
      const r = m.handle(ps.playerId, { t: 'g.sell', uid: piece.uid });
      if (r && r.error) {
        denied++;
        if (r.detail === 'crisis action cap reached') capMsg++;
      } else ok++;
    }
    return { ok, denied, capMsg, actions: ps.crisisActions };
  };
  // 无合约：不计数、不拦截
  const base = run(null);
  assert.equal(base.actions, 0, '无合约不计数');
  assert.equal(base.capMsg, 0, '无合约不报配额');
  // cap=2：恰好放行 2 次，第 3 次起报配额
  const capped = run({ H5: { cap: 2, tier: 1 } });
  assert.equal(capped.actions, 2, '恰好记 2 次');
  assert.ok(capped.capMsg >= 3, '第 3 次起全部拒绝，实际 ' + capped.capMsg);
  // cap=30：6 次全放行
  const roomy = run({ H5: { cap: 30, tier: 1 } });
  assert.equal(roomy.actions, 6, 'cap=30 时 6 次都记');
  assert.equal(roomy.capMsg, 0, 'cap=30 时不拒绝');
});

test('J6 装备配额 — 基础装备 1 份、进阶 2 份，共用上限', () => {
  const trial = (fx) => {
    const h = makeMatch({ mode: 'coop', humans: 2, seed: 44, fake: true }).start();
    const m = h.m;
    const ps = [...m.players.values()][0];
    h.drive(() => m.phase === 'PREP', { ready: false });
    const raw = m.gd.raw;
    const ids = Object.keys(raw.items).filter((k) => raw.items[k] && raw.items[k].itemType === 'EQUIP');
    if (fx) m.gd.crisisFx = fx;
    for (let i = 0; i < 6; i++) ps.acquireItem(ids[i]);
    ps.acquireChess(Object.keys(raw.chess)[0]);
    const all = [...(ps.hand || []), ...(ps.temp || [])].filter(Boolean);
    const items = all.filter((x) => x.kind === 'item');
    const chess = all.filter((x) => x.kind === 'chess');
    assert.ok(items.length >= 6 && chess.length >= 1, '夹具要给到 6 件装备 + 1 个干员');
    let ok = 0, quotaMsg = 0;
    for (const it of items) {
      const r = m.handle(ps.playerId, { t: 'g.equip', itemUid: it.uid, targetUid: chess[0].uid });
      if (r && r.detail === 'crisis equip quota reached') quotaMsg++;
      else if (!r || !r.error) ok++;
    }
    return { ok, quotaMsg, cost: ps.crisisEquipCost };
  };
  const base = trial(null);
  assert.equal(base.ok, 6, '无合约全放行');
  assert.equal(base.cost, 0, '无合约不计数');
  // ★ 夹具的 6 件是 _a/_b 交替：_a 计 1 份、_b 计 2 份 ⇒ 序列 1,2,1,2,1,2，累计 1,3,4,6,7,9。
  //   品质判定必须问 gamedata（piece 上没有 golden 字段，原来那版一直按 1 份算，等于没实现进阶 2 份）。
  const capped = trial({ J6: { cap: 2, tier: 1 } });
  assert.equal(capped.ok, 1, 'cap=2 只放行第 1 件（进阶即 2 份）');
  assert.equal(capped.cost, 2, '进阶记 2 份');
  assert.equal(capped.quotaMsg, 5, '其余 5 件被拒');
  const roomy = trial({ J6: { cap: 4, tier: 1 } });
  assert.equal(roomy.ok, 3, 'cap=4 放行 3 件（2 + 1 + 1）');
  assert.equal(roomy.cost, 4, '恰好用满 4 份');
  assert.equal(roomy.quotaMsg, 3, '其余 3 件被拒');
});

test('K2 封锁地带 — 由种子选 1 地面格 + 1 高台格，同种子同结果', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 44, fake: true });
  const m = h.m;
  const a = pickCrisisBannedTiles(m.stage, m.seed);
  assert.equal(a.tiles.length, 2, '恰好两格');
  // 一格来自 melee 池、一格来自 ranged 池
  assert.ok(a.melee.includes(a.tiles[0]), '第一格是地面格');
  assert.ok(a.ranged.includes(a.tiles[1]), '第二格是高台格');
  assert.ok(a.melee.length >= 10 && a.ranged.length >= 1, '格子池非空');
  // 同种子 ⇒ 同两格（"同一局所有玩家相同"）
  const again = pickCrisisBannedTiles(m.stage, m.seed);
  assert.deepEqual(again.tiles, a.tiles, '同种子完全一致');
  // 不同种子 ⇒ 结果会变（不是写死的）
  const other = pickCrisisBannedTiles(m.stage, 12345);
  assert.notDeepEqual(other.tiles, a.tiles, '换种子换格');
});

test('K2 — 封锁的格子真的从部署图消失，且所有玩家相同', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 44, fake: true });
  const m = h.m;
  const tiles = applyCrisisBannedTiles(m, m.stage, m.seed);
  assert.equal(tiles.length, 2);
  const psAll = [...m.players.values()];
  for (const ps of psAll) {
    for (const k of tiles) assert.equal(ps.tileOverrides[k], 'none', ps.playerId + ' 的 ' + k + ' 已封锁');
  }
  const before = buildDeployMap(m.stage, {});
  const after = buildDeployMap(m.stage, { tileOverrides: psAll[0].tileOverrides });
  assert.equal(before.size - after.size, 2, '部署图恰好少两格');
  for (const k of tiles) assert.ok(!after.has(k), k + ' 不在部署图里');
});

test('J2 高阶失效 — 等阶最高的装备前15秒失效，15秒后恢复', () => {
  const mk = (tag) => {
    const h = makeBattle({ kind: 'normal', autoFinish: false,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 },
        skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3, items: ['chess_item_1_01_e_a'] }], enemies: [] });
    h.run(0.2);
    if (tag) applyCrisisFx(h.b, fx(tag));
    return h;
  };
  const read = (h) => {
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    const rt = battleStore(h.b, 'items:rt');
    const n = rt.grants instanceof Map ? (rt.grants.get(op)?.size ?? 0) : 0;
    return { grants: n, atk: Math.round(op.s.atk) };
  };
  // 基准：装备真的加成了攻击
  const base = mk(null);
  assert.deepEqual(read(base), { grants: 1, atk: 575 }, '装备 +15% 攻击');
  // J2：开局即失效
  const h = mk('J2-1');
  assert.deepEqual(read(h), { grants: 0, atk: 500 }, '前15秒装备失效');
  h.run(14);
  assert.deepEqual(read(h), { grants: 0, atk: 500 }, 't=14.2 仍失效');
  h.run(2);
  assert.deepEqual(read(h), { grants: 1, atk: 575 }, 't=16.2 已恢复');
});

test('J4 制式限流 — 同名进阶装备每人1件、全队3件', () => {
  const boot = (fx) => {
    const h = makeMatch({ mode: 'coop', humans: 2, seed: 44, fake: true });
    h.start();
    h.runToPhase('PREP');
    h.m.gd.crisisFx = fx;
    return h;
  };
  const raw0 = makeMatch({ mode: 'coop', humans: 2, seed: 44, fake: true }).m.gd.raw;
  const chessIds = Object.keys(raw0.chess).slice(0, 4);
  const GOLD = 'chess_item_1_01_e_b'; // 进阶品质；同名 = baseIdOf 相同

  // each = 1：同一玩家第 2 件同名进阶被拒
  {
    const h = boot({ J4: { team: 3, each: 1, tier: 1 } });
    const m = h.m, ps = [...m.players.values()][0];
    for (const cid of chessIds) ps.acquireChess(cid);
    const cps = ps.hand.filter((x) => x && x.kind === 'chess');
    const equip = (i) => {
      ps.acquireItem(GOLD);
      const it = ps.hand.filter((x) => x && x.kind === 'item').pop();
      return m.handle(ps.playerId, { t: 'g.equip', itemUid: it.uid, targetUid: cps[i].uid });
    };
    assert.equal(equip(0).ok, true, '第1件放行');
    const r2 = equip(1);
    assert.ok(r2.error, '第2件被拒');
    assert.match(r2.detail, /per-player cap/, '拒绝原因是每人上限');
  }

  // team = 1：另一名玩家携带同名进阶后，本玩家被拒
  {
    const h = boot({ J4: { team: 1, each: 1, tier: 1 } });
    const m = h.m, pss = [...m.players.values()];
    for (const ps of pss) { ps.acquireChess(chessIds[0]); ps.acquireItem(GOLD); }
    const put = (ps) => {
      const c = ps.hand.find((x) => x && x.kind === 'chess');
      const it = ps.hand.find((x) => x && x.kind === 'item');
      return m.handle(ps.playerId, { t: 'g.equip', itemUid: it.uid, targetUid: c.uid });
    };
    assert.equal(put(pss[0]).ok, true, 'P1 放行');
    const r = put(pss[1]);
    assert.ok(r.error, 'P2 被拒');
    assert.match(r.detail, /team cap/, '拒绝原因是全队上限');
  }

  // 无合约时完全不受限
  {
    const h = boot(null);
    const m = h.m, ps = [...m.players.values()][0];
    for (const cid of chessIds) ps.acquireChess(cid);
    const cps = ps.hand.filter((x) => x && x.kind === 'chess');
    for (let i = 0; i < 2; i++) {
      ps.acquireItem(GOLD);
      const it = ps.hand.filter((x) => x && x.kind === 'item').pop();
      assert.equal(m.handle(ps.playerId, { t: 'g.equip', itemUid: it.uid, targetUid: cps[i].uid }).ok, true, '无合约不受限');
    }
  }
});

test('M3 援护限额 — 每轮联防最多 1 名成功玩家承接', () => {
  const h = makeMatch({ mode: 'coop', humans: 4, seed: 44, fake: true });
  const m = h.m;
  const pss = [...m.players.values()];
  assert.equal(pss.length, 4);
  const results = new Map(pss.map((ps) => [ps.playerId, { leaked: [], perfect: true }]));
  const pick = (fx) => {
    m.gd.crisisFx = fx;
    return helperOrder(m, pss, results).map((p) => p.playerId);
  };
  // 无合约：默认 maxHelpers = 2
  assert.equal(m.gd.unite.maxHelpers, 2, '默认上限是 2');
  assert.equal(m.gd.crisisUniteHelpers, null, '无合约时 getter 为 null');
  assert.deepEqual(pick(null), ['p_0', 'p_1'], '无合约选 2 人');
  // M3：只剩 1 人
  assert.deepEqual(pick(crisisRules({ mode: 'quad', tags: ['M3-1'] }).fx), ['p_0'], 'M3 只选 1 人');
  assert.equal(m.gd.crisisUniteHelpers, 1, 'getter 读到 1');
});

test('M4 轮值支援 — 连续承接者前10秒造成伤害−10%，10秒后恢复', () => {
  const mk = (streak) => {
    const h = makeBattle({ kind: 'normal', autoFinish: false,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 0, res: 0 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [] });
    h.run(0.1);
    if (streak) {
      h.b.flags.crisisStreakHelpers = streak;
      applyCrisisFx(h.b, { M4: { dur: 10, cut: 0.1, tier: 1 } });
    }
    return h;
  };
  const dmgAt = (h, t) => {
    const u = h.b.allyUnits.find((x) => x.kind === 'op');
    const en = h.b.units.find((x) => x.side === 'enemy') || h.spawn('originium_slug', { row: 10, col: 5 });
    en.alive = true; en.hp = en.s.maxHp = 999999;
    h.b.time = t;
    const d = h.b.dealDamage({ source: u, target: en, amount: 1000, type: 'phys' });
    return d && (d.amount ?? d);
  };
  // 基准
  assert.equal(dmgAt(mk(null), 1), 900, '无 M4 是 900');
  // 连续承接者：前10秒 −10%
  assert.equal(dmgAt(mk({ p1: true }), 1), 810, '承接者前10秒 810');
  // 非承接者不受影响
  assert.equal(dmgAt(mk({ p_other: true }), 1), 900, '非承接者仍是 900');
  // 10 秒后恢复（走真实推进，让 buff 自然过期）
  const h = mk({ p1: true });
  const u = h.b.allyUnits.find((x) => x.kind === 'op');
  const has = () => (u.buffs || []).some((x) => x.key === 'crisis:M4');
  assert.equal(has(), true, 't=0.1 有 buff');
  h.run(9);
  assert.equal(has(), true, 't=9.1 仍在');
  h.run(3);
  assert.equal(has(), false, 't=12.1 已过期');
});

test('A2 回声前锋 — 首次死亡6秒后生成40%生命复制体，每轮限量、越界不触发', () => {
  const mk = (round, fx) => {
    const h = makeBattle({ kind: 'normal', autoFinish: false, round,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 100000, atk: 100000, def: 0, res: 0 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [{ key: 'originium_slug', row: 10, col: 5 }] });
    h.run(0.2);
    const applied = fx ? applyCrisisFx(h.b, fx) : null;
    return { h, applied };
  };
  const A2 = { A2: { rounds: [5, 13], delay: 6, hp: 0.4, perField: 3, tier: 1 } };
  const killOne = (h) => {
    const en = h.b.units.find((x) => x.side === 'enemy' && x.alive);
    if (en) h.b.dealDamage({ source: h.b.allyUnits.find((x) => x.kind === 'op'), target: en, amount: 1e9, type: 'phys' });
  };

  // 第1回合：范围外，不装
  {
    const { h, applied } = mk(1, A2);
    assert.deepEqual(applied.applied, [], '越界不 applied');
    killOne(h); h.run(8);
    assert.equal(h.b.units.filter((x) => x.side === 'enemy').length, 1, '越界不生成复制体');
  }

  // 第6回合：6 秒后生成 40% 生命
  {
    const { h, applied } = mk(6, A2);
    assert.deepEqual(applied.applied, ['A2'], '第6回合生效');
    const orig = h.b.units.find((x) => x.side === 'enemy').s.maxHp;
    killOne(h);
    h.run(3);
    assert.equal(h.b.units.filter((x) => x.side === 'enemy').length, 1, 't=3 还没生成');
    h.run(5);
    const live = h.b.units.filter((x) => x.side === 'enemy');
    assert.equal(live.length, 2, 't=8 已生成');
    assert.equal(live[1].s.maxHp, Math.round(orig * 0.4), '复制体是 40% 生命');
  }

  // 每轮限量：perField=1 时只复制 1 只
  {
    const one = { A2: { rounds: [5, 13], delay: 6, hp: 0.4, perField: 1, tier: 1 } };
    const { h } = mk(6, one);
    killOne(h); h.run(8);
    assert.equal(h.b.units.filter((x) => x.side === 'enemy').length, 2, 'perField=1 复制了 1 只');
  }
});

test('A3 第三梯队 — 第35秒仍有敌人时追加固定精英，只触发一次', () => {
  const A3 = { A3: { rounds: [5, 13], at: 35, perField: 2, tier: 1 } };
  const mk = (round, fx) => {
    const h = makeBattle({ kind: 'normal', autoFinish: false, round,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 1e6, atk: 1, def: 0, res: 0 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [{ key: 'originium_slug', row: 10, col: 5 }] });
    h.run(0.2);
    return { h, res: fx ? applyCrisisFx(h.b, fx) : null };
  };
  const count = (h) => h.b.units.filter((x) => x.side === 'enemy' && x.alive).length;

  // 越界不装
  {
    const { h, res } = mk(1, A3);
    assert.deepEqual(res.applied, [], '第1回合不装');
    h.b.time = 36; h.b.emit('tick');
    assert.equal(count(h), 1, '越界不追加');
  }

  // 第6回合：t=34 不触发，t=36 追加 2 名
  {
    const { h, res } = mk(6, A3);
    assert.deepEqual(res.applied, ['A3'], '第6回合生效');
    assert.equal(count(h), 1, '初始 1 只');
    h.b.time = 34; h.b.emit('tick');
    assert.equal(count(h), 1, 't=34 还没到');
    h.b.time = 36; h.b.emit('tick');
    assert.equal(count(h), 3, 't=36 追加 2 名');
    h.b.time = 50; h.b.emit('tick');
    assert.equal(count(h), 3, '只触发一次');
  }

  // 已清场不追加（用真实击杀，不是把 hp 置 0 —— 后者不会移出 aliveEnemies）
  {
    const { h } = mk(6, A3);
    const op = h.b.allyUnits.find((x) => x.kind === 'op');
    op.s.atk = 1e9;
    for (const e of h.b.units.filter((x) => x.side === 'enemy')) {
      h.b.dealDamage({ source: op, target: e, amount: 1e9, type: 'phys' });
    }
    assert.equal(count(h), 0, '已清场');
    h.b.time = 36; h.b.emit('tick');
    assert.equal(count(h), 0, '清场后不追加');
  }
});

test('B3 冲击前锋 — 前2名精英首次攻击150%伤害并晕眩1.5秒', () => {
  const mk = (fx) => {
    const h = makeBattle({ kind: 'normal', autoFinish: false,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 100000, atk: 100, def: 0, res: 0 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [{ key: 'originium_slug', row: 10, col: 5 }] });
    h.run(0.2);
    if (fx) applyCrisisFx(h.b, fx);
    return h;
  };
  const B3 = { B3: { perField: 2, mul: 1.5, stun: 1.5, tier: 1 } };

  // 无合约基准
  {
    const h = mk(null);
    const en = h.b.units.find((x) => x.side === 'enemy');
    const op = h.b.allyUnits.find((x) => x.kind === 'op');
    h.b.emit('enemyAttackStart', { enemy: en, targets: [op] });
    // ★ dealDamage 直接返回伤害数值（不是 {amount} 对象）
    const d = h.b.dealDamage({ source: en, target: op, amount: 1000, type: 'phys' });
    assert.equal(d, 1000, '无合约首击 1000');
    assert.ok(!(op.buffs || []).some((x) => x.key === 'palsy'), '无合约不晕眩');
  }

  // B3：首击 150%，第二击回到 100%
  {
    const h = mk(B3);
    const en = h.b.units.find((x) => x.side === 'enemy');
    const op = h.b.allyUnits.find((x) => x.kind === 'op');
    h.b.emit('enemyAttackStart', { enemy: en, targets: [op] });
    const d1 = h.b.dealDamage({ source: en, target: op, amount: 1000, type: 'phys' });
    assert.equal(d1, 1500, '首击 150%');
    const d2 = h.b.dealDamage({ source: en, target: op, amount: 1000, type: 'phys' });
    assert.equal(d2, 1000, '第二击回到 100%');
    // 晕眩
    const pal = (op.buffs || []).find((x) => x.key === 'palsy');
    assert.ok(pal, '目标被晕眩');
    assert.equal(pal.stacks, 1);
  }

  // 第 3 个精英不吃首击加成（perField=2）
  {
    const h = mk(B3);
    const en = h.b.units.find((x) => x.side === 'enemy');
    const op = h.b.allyUnits.find((x) => x.kind === 'op');
    // 先让真实精英攻一次，把"前2名精英"名单定格
    h.b.emit('enemyAttackStart', { enemy: en, targets: [op] });
    h.b.dealDamage({ source: en, target: op, amount: 1000, type: 'phys' });
    // 再造一只小血敌人：名单已定格，它不在里面
    const weak = h.spawn('originium_slug', { row: 10, col: 8 });
    weak.s.maxHp = 1; weak.hp = 1;
    h.b.emit('enemyAttackStart', { enemy: weak, targets: [op] });
    const d = h.b.dealDamage({ source: weak, target: op, amount: 1000, type: 'phys' });
    assert.equal(d, 1000, '非精英不享受首击加成');
  }
});

test('E3 复起延迟 — 立刻复活改为 3 秒后，期间离场', () => {
  const mk = (fx) => {
    const h = makeBattle({ kind: 'normal', autoFinish: false, content: 'full',
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 1000, atk: 100, def: 0, res: 0 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [{ key: 'originium_slug', row: 10, col: 5 }] });
    h.run(0.2);
    if (fx) applyCrisisFx(h.b, fx);
    return h;
  };
  const opOf = (h) => h.b.allyUnits.find((x) => x.kind === 'op');

  // 无合约：立刻复活
  {
    const h = mk(null);
    const op = opOf(h);
    op.alive = false;
    const c = { unit: op, reason: 'killed' };
    assert.equal(reviveNow(h.b, c, 'test'), true);
    assert.equal(op.alive, true, '无合约立刻复活');
  }

  // E3：3 秒后才复活
  {
    const h = mk({ E3: { delay: 3, tier: 1 } });
    const op = opOf(h);
    op.alive = false;
    const c = { unit: op, reason: 'killed' };
    assert.equal(reviveNow(h.b, c, 'test'), true);
    assert.equal(op.alive, false, '击倒当下不离场复活');
    assert.equal(c.revivedBy, 'test', 'revivedBy 立刻打上（同一次击倒不被第二个复活源重复消费）');
    h.run(2);
    assert.equal(op.alive, false, 't=2 仍离场');
    h.run(2);
    assert.equal(op.alive, true, 't=4 已复活');
  }

  // E3 未生效时 flags 不被写
  {
    const h = mk(null);
    assert.ok(!h.b.flags.crisisReviveDelay, '无 E3 不写 flag');
  }
});

test('U4 联防强压 — 转入联防战的敌人生命 +20%，常规场不动', () => {
  const mk = (kind, fx, mul) => {
    const h = makeBattle({ kind, autoFinish: false, content: 'full',
      flags: mul ? { crisisUniteHpMul: mul } : undefined,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 1000, atk: 100, def: 0, res: 0 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [{ key: 'originium_slug', row: 10, col: 5 }] });
    h.run(0.2);
    const res = fx ? applyCrisisFx(h.b, fx) : null;
    return { h, res };
  };
  const U4 = { U4: { hp: 0.2, sp: 10, cut: 0.1, dur: 10, tier: 1 } };

  // 无合约基准
  {
    const { h } = mk('unite', null, null);
    assert.equal(h.b.spawnEnemy('originium_slug', { pos: [8, 5] }).s.maxHp, 2000, '无合约 2000');
  }

  // unite 场：×1.2
  {
    const { h, res } = mk('unite', U4, 1.2);
    assert.deepEqual(res.applied, ['U4'], 'unite 场生效');
    assert.equal(h.b.spawnEnemy('originium_slug', { pos: [8, 5] }).s.maxHp, 2400, 'U4 生命 2000→2400');
  }

  // 常规场：不生效
  {
    const { h, res } = mk('normal', U4, 1.2);
    assert.deepEqual(res.applied, [], '常规场不装 U4');
    assert.equal(h.b.spawnEnemy('originium_slug', { pos: [8, 5] }).s.maxHp, 2000, '常规场仍 2000');
  }
});

// P1 冰爆源石虫：生命 +40%，死亡爆炸 200% -> 250%。
// 基准取自同一 battle 的同名敌人（无契约），所以比值就是文案里的倍数。
test('P1 冰爆源石虫 — 生命 +40%，死亡爆炸 200%→250%', () => {
  // 必须用默认 content（=full）：content:none 下敌人的 kit 不加载，就没有死亡爆炸。
  const mk = () => makeBattle({ autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 },
      skill: { spCost: 40, kind: 'manual', duration: 10 } }) } },
    units: [{ uid: 1, chessId: 'probe', row: 10, col: 6 }] });
  const probe = (fxObj) => {
    const h = mk();
    if (fxObj) applyCrisisFx(h.b, fxObj);
    h.run(1.0);
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    const e = h.spawn('enemy_1067_snslime', { pos: [10, 5] });
    const before = op.hp;
    h.b.dealDamage({ source: op, target: e, amount: 999999, type: 'true' });
    h.step(6);
    return { maxHp: e.s.maxHp, lost: Math.round(before - op.hp) };
  };
  const base = probe(null);
  const p1 = probe({ P1: { hp: 0.4, blast: 2.5, tier: 2 } });
  assert.equal(base.maxHp, 3250, '基准生命');
  assert.equal(p1.maxHp, 4550, 'P1 生命 ×1.4');
  assert.equal(base.lost, 500, '基准：爆炸 200%');
  assert.equal(p1.lost, 625, 'P1：爆炸 250%/200% = ×1.25');
});
// T1 源石流发生装置反向：窗口内 blower 的 dir/fx/fy 全部翻转，顺风干员 +30% -> -30%，窗口结束精确还原。
test('T1 源石流发生装置反向 — 窗口内翻转气流、窗口后还原', () => {
  const stg = JSON.parse(readFileSync(new URL('../../data/stages.json', import.meta.url), 'utf8'));
  const stage = stg['act2autochess_m01'];
  const run = (fxObj) => {
    const h = makeBattle({ autoFinish: false, stage, units: [{ uid: 1, chessId: 'probe', row: 12, col: 5 }],
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 100000, atk: 100 } }) } } });
    if (fxObj) applyCrisisFx(h.b, fxObj);
    h.run(1.0);
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    op.dir = 'DOWN'; // 与 blower 同向 => equal(+30%)
    const out = { t1: Math.round(op.s.atk) };
    h.run(40); out.inWindow = Math.round(op.s.atk);
    h.run(13); out.after = Math.round(op.s.atk);
    return out;
  };
  assert.deepEqual(run(null), { t1: 100, inWindow: 130, after: 130 }, '基准：始终顺风 +30%');
  assert.deepEqual(run({ T1: { first: 40, period: 40, hold: 10 } }), { t1: 100, inWindow: 70, after: 130 }, 'T1：窗口内逆风 -30%，窗口后还原');
});
// T2 排气格栅：消散窗口内烟雾格上的干员失去 flags.stealth，远程敌人能选中它；窗口结束恢复。
test('T2 排气格栅 — 消散期间失去 stealth、可被远程选中，窗口后恢复', () => {
  const stg = JSON.parse(readFileSync(new URL('../../data/stages.json', import.meta.url), 'utf8'));
  const stage = stg['act2autochess_m03'];
  const at = (fxObj, t) => {
    const h = makeBattle({ autoFinish: false, stage, units: [{ uid: 1, chessId: 'probe', row: 10, col: 6 }],
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 100000, atk: 1 } }) } } });
    if (fxObj) applyCrisisFx(h.b, fxObj);
    h.run(t);
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    const e = h.spawn('enemy_9010_acpupp', { pos: [10, 16] });
    return { smog: !!(op.findBuff && op.findBuff('terrain:smog')), can: canTargetAlly(e, op, true) };
  };
  const T2 = { T2: { first: 40, period: 40, hold: 8 } };
  // 基准：始终被烟雾遮住
  assert.deepEqual(at(null, 41), { smog: true, can: false }, '基准：烟雾始终遮挡');
  assert.deepEqual(at(null, 51), { smog: true, can: false });
  // T2：窗口内失去遮挡，窗口后恢复
  assert.deepEqual(at(T2, 1), { smog: true, can: false }, '未到窗口');
  assert.deepEqual(at(T2, 41), { smog: false, can: true }, '消散期间可被远程选中');
  assert.deepEqual(at(T2, 47), { smog: false, can: true }, '仍在窗口内');
  assert.deepEqual(at(T2, 51), { smog: true, can: false }, '窗口结束恢复遮挡');
});
// T3 涨潮控制：退潮窗口内深水对敌人的伤害/攻速/移速全部失效，涨潮后恢复。
test('T3 涨潮控制 — 退潮期间深水失效，涨潮后恢复', () => {
  const stg = JSON.parse(readFileSync(new URL('../../data/stages.json', import.meta.url), 'utf8'));
  const stage = stg['act2autochess_m04'];
  // 必须用不移动的敌人：走动型会在窗口前离开深水格，测到的就不是 T3 了（acdeer 静止）
  const run = (fxObj) => {
    const h = makeBattle({ autoFinish: false, stage, units: [{ uid: 1, chessId: 'probe', row: 5, col: 9 }],
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 100000, atk: 1 } }) } } });
    if (fxObj) applyCrisisFx(h.b, fxObj);
    h.run(1.0);
    const e = h.spawn('enemy_9033_acdeer', { pos: [10, 6] });
    const snap = () => ({ deep: !!(e.findBuff && e.findBuff('terrain:deepsea')), aspd: Math.round(e.s.aspd), hp: Math.round(e.hp) });
    const out = { t1: snap() };
    h.run(42); out.inWindow = snap(); // 已进入退潮窗口（t=42 > 40）
    h.run(3); out.stillDry = snap();  // 窗口内继续：血量不应再降
    h.run(7); out.after = snap();     // 已过窗口（t=52 > 50）
    return out;
  };
  const base = run(null);
  assert.equal(base.t1.deep, true, '基准：进水即挂深水');
  assert.equal(base.t1.aspd, 40, '基准：深水 -60 攻速（100 -> 40）');
  assert.equal(base.inWindow.deep, true, '基准：始终深水');
  assert.equal(base.inWindow.aspd, 40);
  assert.ok(base.after.hp < base.inWindow.hp, '基准：深水持续掉血');
  const t3 = run({ T3: { first: 40, period: 40, hold: 10 } });
  assert.equal(t3.inWindow.deep, false, '退潮：深水 buff 摘掉');
  assert.equal(t3.inWindow.aspd, 100, '退潮：攻速不再 -60');
  assert.equal(t3.stillDry.hp, t3.inWindow.hp, '退潮：窗口内血量不再下降（伤害失效）');
  assert.equal(t3.after.deep, true, '涨潮：恢复深水');
  assert.equal(t3.after.aspd, 40, '涨潮：攻速恢复 -60');
  assert.ok(t3.after.hp < t3.stillDry.hp, '涨潮：重新开始掉血');
});
// T5 盟约寒风：触发间隔延长 50%（三档停用）。首阵风时间不变，只有间隔变。
test('T5 盟约寒风 — 间隔延长 50%，三档停用', () => {
  const run = (fxObj) => {
    const h = makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: 'probe', row: 5, col: 9 }],
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 100000, atk: 1 } }) } } });
    const res = fxObj ? applyCrisisFx(h.b, fxObj) : { applied: [] };
    h.run(1.0);
    h.spawn('enemy_9033_acdeer', { pos: [5, 12] });
    const hd = startColdWind(h.b, { interval: 10, duration: 3, first: 10 });
    const marks = [];
    for (let t = 0; t < 70; t++) { h.run(1); if (hd.gusts > marks.length) marks.push(Math.round(h.b.time)); }
    return { applied: res.applied, marks };
  };
  assert.deepEqual(run(null).marks, [12, 22, 32, 42, 52], '基准：10 秒间隔');
  const up = run({ T5: { mul: 1.5 } });
  assert.deepEqual(up.applied, ['T5']);
  assert.deepEqual(up.marks, [12, 27, 42, 57], '延长 50%：间隔变 15 秒，首阵风仍 12 秒');
  const off = run({ T5: { off: true } });
  assert.deepEqual(off.marks, [12], '停用：只有首阵风');
});
// Q2/Q4/Q5/Q6/Q7/Q8 全部走 gamedata.crisisTalentOverrides —— 只改天赋黑板数值，不碰引擎。
test('Q2/Q4/Q5/Q6/Q7/Q8 天赋黑板覆盖 — 数值与官方文案逐条对齐', () => {
  const mk = (fxObj) => {
    const g = new GameData(DATA, 'coop');
    g.crisisFx = fxObj;
    return g.crisisTalentOverrides({});
  };
  // 一档：全是文案里的基础值
  const a = mk({ Q2: {}, Q4: {}, Q5: {}, Q6: {}, Q7: {}, Q8: {} });
  assert.equal(a.enemy_9007_acelem.talents.bb['1.damage_scale'], 1.45, 'Q2 宿主元素损伤 1.3 -> 1.45');
  assert.equal(a.enemy_9007_acelem.talents.bb['1.ep_damage_scale'], 1.45);
  assert.equal(a.enemy_1169_duphlx.talents.bb['auraDefup.def'], 250, 'Q4 方阵同伴防御 200 -> 250');
  assert.equal(a.enemy_1169_duphlx_2.talents.bb['auraDefup.def'], 250);
  for (const k of ['enemy_1288_duskls', 'enemy_1288_duskls_2', 'enemy_1292_duskld', 'enemy_1292_duskld_2']) {
    assert.equal(a[k].talents.bb['Revive[Trigger].interval'], 8, 'Q5 余烬重生 10 -> 8：' + k);
  }
  assert.equal(a.enemy_9006_actoxi.talents.bb['1.projectile_range'], 1.2, 'Q6 毒雾半径 0.8 -> 1.2');
  for (const k of ['enemy_1161_tidmag', 'enemy_1161_tidmag_2', 'enemy_1162_magmot_2']) {
    assert.equal(a[k].talents.bb['EpDamage.attack@ep_damage_ratio'], 1, 'Q7 侵蚀比例 0.8 -> 1.0：' + k);
  }
  assert.equal(a.enemy_1174_duholy.talents.bb['traitAbility.range_radius'], 1.5, 'Q8 力场半径 1.1 -> 1.5');
  assert.equal(a.enemy_1175_dushdo_2, undefined, 'Q8 一档不动影刃攻速（数据默认已是 -1.3）');
  // 二档
  const b = mk({ Q2: { atkScale: 0.4 }, Q5: { hits: 7, guardHits: 14 }, Q8: { radius: 1.5, cut: 1.6, together: true } });
  assert.equal(b.enemy_9007_acelem.talents.bb['1.atk_scale'], 0.4, 'Q2 Ⅱ 寄生伤害 0.3 -> 0.4');
  assert.equal(b.enemy_1288_duskls_2.talents.bb['Revive[Trigger].prop_max_hp'], 7, 'Q5 Ⅱ 精锐 5 -> 7');
  assert.equal(b.enemy_1292_duskld_2.talents.bb['Revive[Trigger].prop_max_hp'], 14, 'Q5 Ⅱ 护卫 10 -> 14');
  assert.equal(b.enemy_1175_dushdo_2.talents.bb['traitAbility.base_attack_time'], -1.6, 'Q8 Ⅱ 影刃 1.3 -> 1.6（负值，字段名是 cut）');
  // 没装契约时必须是恒等（普通房间逐字节不变）
  assert.deepEqual(mk(null), {}, '无 crisisFx 时恒等');
  assert.deepEqual(mk({}), {}, '空 fx 时恒等');
});
// R3 粉碎攻坚手：攻击间隔 ×0.85（stats.bat）+ 技能完成后受伤 +25% 持续 6 秒、每敌 15 秒冷却。
test('R3 粉碎攻坚手 — 攻击间隔 -15%，技能后易伤 +25%/6 秒/15 秒冷却', () => {
  // 第一半：stats.bat（spawns.js 消费 enemyOverrides[key].stats）
  const g = new GameData(DATA, 'coop');
  g.crisisFx = { R3: {} };
  const ov = g.crisisTalentOverrides({});
  assert.equal(ov.enemy_1045_hammer.stats.bat, 2.975, '3.5 × 0.85');
  assert.equal(ov.enemy_1320_wdrrl_2.stats.bat, 2.465, '2.9 × 0.85');
  assert.equal(ov.enemy_1275_dwlock_2.stats.bat, 3.4, '4 × 0.85');
  // 第二半：技能后易伤
  const h = makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: 'probe', row: 10, col: 9 }],
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 100000, atk: 10 } }) } } });
  assert.deepEqual(applyCrisisFx(h.b, { R3: {} }).applied, ['R3']);
  h.run(1.0);
  const e = h.spawn('enemy_1045_hammer', { pos: [10, 6] });
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  const dmg = () => { const hp0 = e.hp; h.b.dealDamage({ source: op, target: e, amount: 1000, type: 'true' }); return Math.round(hp0 - e.hp); };
  assert.equal(dmg(), 1000, '技能前无易伤');
  h.b.emit('skillEnd', { unit: e, skill: {}, reason: 'done' });
  assert.equal(dmg(), 1250, '技能后 ×1.25');
  h.run(7);
  assert.equal(dmg(), 1000, '6 秒后到期');
  h.b.emit('skillEnd', { unit: e, skill: {}, reason: 'done' });
  assert.equal(dmg(), 1000, '15 秒冷却内不再触发');
  h.run(9);
  h.b.emit('skillEnd', { unit: e, skill: {}, reason: 'done' });
  assert.equal(dmg(), 1250, '冷却过后重新生效');
});
// R4 精英标记：第 7—13 回合标记 1 名自然出现的精英，生命 +25%，首次击倒全场干员 +10 技力 / 回 10% 生命。
test('R4 精英标记 — 选人区间/只认 ELITE + 首次击倒发奖励', () => {
  // 第一半：pickCrisisMark
  const g = new GameData(DATA, 'coop');
  const mk = (round, spawns, fxObj) => ({ round, wave: { spawns }, gd: { crisisFx: fxObj, enemyAny: (k) => g.enemyAny(k) } });
  const fxR4 = { R4: { rounds: [7, 13], hpMul: 1.25 } };
  const spawns = [{ enemyKey: 'enemy_10034_cnvsax' }, { enemyKey: 'enemy_1005_yokai_3' }, { enemyKey: 'enemy_1006_shield' }];
  assert.equal(pickCrisisMark(mk(6, spawns, fxR4)), null, 'R6 区间外');
  assert.equal(pickCrisisMark(mk(14, spawns, fxR4)), null, 'R14 区间外');
  assert.equal(pickCrisisMark(mk(7, spawns, null)), null, '没装 R4 不选');
  assert.equal(pickCrisisMark(mk(7, [{ enemyKey: 'enemy_1006_shield' }], fxR4)), 'enemy_1006_shield', '只有一个精英时选它');
  const picked = pickCrisisMark(mk(7, spawns, fxR4));
  assert.ok(spawns.some((s) => s.enemyKey === picked), '选出的必须是波次里真实存在的 key');
  assert.equal(g.enemyAny(picked).rank, 'ELITE', '选出的必须是 ELITE');
  // 第二半：首次击倒发奖励
  const run = (fxObj, mark) => {
    const h = makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: 'probe', row: 10, col: 5 }],
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500 }, skill: { spCost: 999, kind: 'manual', duration: 10 } }) } } });
    if (mark) h.b.flags.crisisMark = mark;
    const res = fxObj ? applyCrisisFx(h.b, fxObj) : { applied: [], skipped: [] };
    h.run(1.0);
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    const e = h.spawn('enemy_10034_cnvsax', { pos: [10, 6] });
    const sp0 = op.skill.sp;
    h.b.dealDamage({ source: op, target: op, amount: 3000, type: 'true' });
    const hpLow = op.hp;
    h.b.dealDamage({ source: op, target: e, amount: 999999, type: 'true' });
    h.run(0.2);
    return { applied: res.applied, skipped: res.skipped, sp: Math.round(op.skill.sp - sp0), healed: Math.round(op.hp - hpLow) };
  };
  assert.deepEqual(run(null, null), { applied: [], skipped: [], sp: 0, healed: 0 }, '基准：无奖励');
  const noMark = run({ R4: {} }, null);
  assert.deepEqual(noMark.skipped, ['R4'], '有 R4 但没标记：如实报 skipped');
  assert.equal(noMark.sp, 0);
  const marked = run({ R4: {} }, 'enemy_10034_cnvsax');
  assert.deepEqual(marked.applied, ['R4']);
  assert.equal(marked.sp, 10, '+10 技力');
  assert.equal(marked.healed, 1000, '回 10% 最大生命（10000 -> +1000）');
});
// M5 强制拼场：第 6/10 回合即使没有漏怪也强制两两拼场，40 秒，每人追加 1 重甲精英 + 1 术师精英。
test('M5 强制拼场 — 区间/两两配对/奇数不参加/精英注入/40 秒', () => {
  const g = new GameData(DATA, 'coop');
  const mk = (round, n, fxObj, solo) => ({
    round, isSolo: !!solo,
    gd: { crisisFx: fxObj, enemy: (k) => g.enemy(k), enemyAny: (k) => g.enemyAny(k) },
    alivePlayers: () => Array.from({ length: n }, (_, i) => ({ playerId: 'p_' + i, seat: i })),
  });
  const fxM5 = { M5: { rounds: [6, 10], dur: 40 } };
  // 区间：只有 6 和 10
  for (const r of [5, 7, 8, 9, 11, 12, 13]) assert.equal(planCrisisM5(mk(r, 4, fxM5)), null, 'R' + r + ' 不该拼场');
  for (const r of [6, 10]) assert.ok(planCrisisM5(mk(r, 4, fxM5)), 'R' + r + ' 必须拼场');
  assert.equal(planCrisisM5(mk(6, 4, null)), null, '没装 M5 不拼场');
  assert.equal(planCrisisM5(mk(6, 1, fxM5, true)), null, '单人没有拼场');
  assert.equal(planCrisisM5(mk(6, 1, fxM5)), null, '只剩 1 人时不拼场');
  // 两两配对 + 奇数不参加
  const p4 = planCrisisM5(mk(6, 4, fxM5));
  assert.deepEqual(p4.helpers.map((x) => x.playerId), ['p_0', 'p_2'], '4 人：helpers 取每对第一位');
  assert.deepEqual(p4.leakers.map((x) => x.playerId), ['p_1', 'p_3'], '4 人：leakers 取每对第二位');
  assert.equal(p4.forced, true);
  const p3 = planCrisisM5(mk(6, 3, fxM5));
  assert.equal(p3.helpers.length, 1, '3 人（奇数）：只有 1 对');
  assert.ok(!p3.helpers.concat(p3.leakers).some((x) => x.playerId === 'p_2'), '3 人：多出的一名不参加');
  // 精英注入：每名参加者 2 名，且必须在主表里（拼场波次只认 gd.enemy）
  assert.equal(p4.leaked.length, 8, '4 人各 2 名 = 8');
  for (const k of M5_ADD) assert.ok(g.enemy(k), k + ' 必须在主表（否则 buildUniteWave 静默跳过）');
  for (const l of p4.leaked) assert.ok(M5_ADD.includes(l.enemyKey), '只注入 M5_ADD 里的两名精英');
  // 实跑：真进 UNITE，时长 40 秒，敌人真的出场
  const h = makeMatch({ mode: 'coop', humans: 4, seed: 777, difficulty: 'EASY' });
  h.m.gd.crisisFx = fxM5;
  h.start();
  h.drive(() => h.m.round === 6 && h.m.phase === 'PREP');
  h.drive(() => h.m.phase === 'UNITE' || h.m.phase === 'SETTLE');
  assert.equal(h.m.phase, 'UNITE', '第 6 回合必须进拼场');
  assert.equal(h.m.unitePlan.forced, true);
  const b = h.m.fields[0].battle;
  assert.equal(b.timeLimit, 40, '拼场时长固定 40 秒（不吃战场 timeLimit）');
  for (let i = 0; i < 400; i++) b.step();
  assert.ok(b.aliveEnemies().length > 0, '追加的精英必须真的出场');
  const seen = new Set();
  for (const e of b.enemies.values()) seen.add(e.defId);
  for (const k of M5_ADD) assert.ok(seen.has(k), k + ' 必须出现在拼场里');
});
// T4 特殊类敌人：第 10(Ⅱ:8)—13 回合，当回合 SPECIAL 类敌人最后 30%（向上取整）改为第 30 秒双入口出生，总数不变。
test('T4 特殊类敌人 — 区间/最后30%/双入口/总数不变/Ⅱ档追加精英', () => {
  const g = new GameData(DATA, 'coop');
  const all = { ...g.raw.enemies, ...g.raw['enemies-crisis'] };
  const specials = Object.values(all).filter((e) => e.acType === 'SPECIAL').map((e) => e.key);
  const elite = Object.values(all).find((e) => e.rank === 'ELITE' && g.enemy(e.key)).key;
  assert.ok(specials.length >= 3, '数据里必须有 SPECIAL 类敌人');
  const spawns = [
    { time: 2, key: specials[0], count: 2, interval: 3, routeIndex: 0 },
    { time: 8, key: specials[1], count: 3, interval: 3, routeIndex: 0 },
    { time: 12, key: specials[2], count: 5, interval: 1, routeIndex: 0 },
    { time: 15, key: elite, count: 1, interval: 0, routeIndex: 0 },
  ];
  const total = (l) => l.reduce((s, x) => s + (x.count || 1), 0);
  const base = total(spawns);
  const t4a = { rounds: [10, 13], share: 0.3, at: 30 };
  // 区间外 / 未装：原样返回同一个数组
  assert.equal(crisisSpecialSpawns(g, spawns, t4a, 9), spawns, 'R9 原样');
  assert.equal(crisisSpecialSpawns(g, spawns, t4a, 14), spawns, 'R14 原样');
  assert.equal(crisisSpecialSpawns(g, spawns, null, 10), spawns, '没装 T4 原样');
  // I 档：总数不变，最后 30% 搬到 t=30 且分两个入口
  const out = crisisSpecialSpawns(g, spawns, t4a, 10);
  assert.equal(total(out), base, '总数不变');
  const at30 = out.filter((s) => s.time === 30);
  assert.ok(at30.length >= 2, '必须有两个入口的 spawn');
  assert.deepEqual(at30.map((s) => s.routeIndex).sort(), [0, 1], '两个公开入口');
  const moved = at30.reduce((s, x) => s + (x.count || 1), 0);
  // 特殊类单位共 2+3+5=10，最后 30% 向上取整 = 3
  assert.equal(moved, 3, '最后 30%（10 个里取 3 个）');
  // 早的特殊类 spawn 保留（只搬尾巴）
  assert.ok(out.some((s) => s.time === 2 && (s.key || s.enemyKey) === specials[0]), '最早的特殊类 spawn 不受影响');
  // 非特殊类不受影响
  assert.ok(out.some((s) => s.time === 15 && (s.key || s.enemyKey) === elite), '精英 spawn 不被搬走');
  // Ⅱ 档：追加 extra 名精英，带 noReward
  const t4b = { rounds: [8, 13], share: 0.3, at: 30, extra: 1 };
  const out2 = crisisSpecialSpawns(g, spawns, t4b, 8);
  assert.equal(total(out2), base + 1, 'Ⅱ 档总数 +1');
  const extraSpawn = out2.find((s) => s.noReward === true);
  assert.ok(extraSpawn, 'Ⅱ 档追加的精英必须标 noReward（不发奖励）');
  assert.equal(extraSpawn.time, 30);
  assert.equal(crisisSpecialSpawns(g, spawns, t4b, 7), spawns, 'Ⅱ 档 R7 仍在区间外');
});
// T4 真实波次回归：用 mode_multi_normal 的 buildNormalWave 出真波次，确认总数不变、区间外不触发。
test('T4 特殊类敌人 — 真实波次上总数不变，区间外不触发', () => {
  const g = new GameData(DATA, 'mode_multi_normal');
  const tot = (l) => l.reduce((s, x) => s + (x.count || 1), 0);
  const t4 = { rounds: [10, 13], share: 0.3, at: 30 };
  let sawSpecial = false;
  for (const r of [9, 10, 11, 12, 13]) {
    const w = buildNormalWave(g, createRng(777), ['sargon4'], r);
    const sp = w.spawns || [];
    // 只统计「特殊类」单位数（按 count 累加）
    const specialUnits = sp.filter((s) => {
      const d = g.enemyAny(s.key || s.enemyKey);
      return d && (d.acType === 'SPECIAL' || (Array.isArray(d.acTypes) && d.acTypes.includes('SPECIAL')));
    }).reduce((a, x) => a + (x.count || 1), 0);
    const out = crisisSpecialSpawns(g, sp, t4, r);
    if (specialUnits > 0) sawSpecial = true;
    assert.equal(tot(out), tot(sp), 'R' + r + ' 总数必须不变');
    if (r < 10) {
      assert.equal(out, sp, 'R' + r + ' 在区间外原样返回同一个数组');
      continue;
    }
    if (specialUnits === 0) continue;
    // 搬走的数量 = 原波次与 T4 波次里「t=30 且是特殊类」的单位数之差（模板可能本来就有 t=30 条目）
    const at30Special = (l) => l.filter((s) => {
      if (s.time !== 30) return false;
      const d = g.enemyAny(s.key || s.enemyKey);
      return d && (d.acType === 'SPECIAL' || (Array.isArray(d.acTypes) && d.acTypes.includes('SPECIAL')));
    }).reduce((a, x) => a + (x.count || 1), 0);
    const added = at30Special(out) - at30Special(sp);
    assert.equal(added, Math.ceil(specialUnits * 0.3), 'R' + r + ' 新增到 t=30 的特殊单位 = ceil(' + specialUnits + ' × 30%)');
    // 两个公开入口：新增条目最多两个 routeIndex
    const routes = new Set(out.filter((s) => s.time === 30 && !sp.some((o) => o === s)).map((s) => s.routeIndex));
    assert.ok(routes.size >= 1 && routes.size <= 2, 'R' + r + ' 入口数 1..2');
  }
  assert.ok(sawSpecial, '真实波次里必须真的存在 SPECIAL 类敌人（否则这条测试是假绿）');
});
// ── 第二档（Ⅱ）补齐：Q4 方阵成队 / Q9 两名一组 / S5 登场条件覆盖 ──
test('Q4 Ⅱ 方阵成队 — 同出生点 interval ×0.5，总数不变，I 档与区间外原样', () => {
  const tot = (l) => l.reduce((s, x) => s + (x.count || 1), 0);
  const sp = [
    { time: 3, key: Q4_KEYS[0], count: 3, interval: 4, routeIndex: 0 },
    { time: 5, key: Q4_KEYS[1], count: 2, interval: 4, routeIndex: 0 },
    { time: 7, key: 'enemy_1000_gopro_2', count: 4, interval: 2, routeIndex: 0 },
  ];
  const out = crisisSquadSpawns(sp, { def: 250, squad: 0.5 }, Q4_KEYS, 6, Q4_WINDOW);
  assert.equal(tot(out), tot(sp), '总数不变');
  assert.deepEqual(out.map((s) => s.interval), [2, 2, 2], '方阵成员 interval 4→2，非目标不受影响');
  assert.equal(crisisSquadSpawns(sp, { def: 250 }, Q4_KEYS, 6, Q4_WINDOW), sp, 'I 档（无 squad）原样');
  assert.equal(crisisSquadSpawns(sp, { squad: 0.5 }, Q4_KEYS, 3, Q4_WINDOW), sp, 'R3 区间外原样');
  assert.equal(crisisSquadSpawns(sp, { squad: 0.5 }, Q4_KEYS, 14, Q4_WINDOW), sp, 'R14 区间外原样');
});

test('Q9 Ⅱ 两名一组 — 生命 +20%，拆成 2+2+1，总数不变', () => {
  const tot = (l) => l.reduce((s, x) => s + (x.count || 1), 0);
  const sp = [{ time: 10, key: Q9_KEYS[0], count: 5, interval: 2, routeIndex: 0 }];
  const out = crisisPairSpawns(sp, { move: 0.7, hp: 0.2, pairs: true }, Q9_KEYS, 10, Q9_WINDOW);
  assert.equal(tot(out), 5, '总数不变');
  assert.deepEqual(out.map((s) => s.count), [2, 2, 1], '两名一组，末组 1 个');
  for (const s of out) assert.equal(s.mods.maxHpMul, 1.2, '每条都带 maxHpMul 1.2（生命 +20%）');
  assert.equal(crisisPairSpawns(sp, { move: 0.7 }, Q9_KEYS, 10, Q9_WINDOW), sp, 'I 档原样');
  assert.equal(crisisPairSpawns(sp, { hp: 0.2, pairs: true }, Q9_KEYS, 7, Q9_WINDOW), sp, 'R7 区间外原样');
});

test('S5 Ⅱ 第二名领袖登场条件 — 覆盖 L3 的 at/below，I 档与无 L3 不受影响', () => {
  const mk = (fxObj) => { const g = new GameData(DATA, 'mode_multi_normal'); g.crisisFx = fxObj; return g; };
  const L3 = { hp: 0.8, hp2: 0.55, at: 40, below: 0.5 };
  const base = mk({ L3 }).crisisDualLeader('boss_1', null);
  assert.equal(base.pools[1].at, 40);
  assert.equal(base.pools[1].below, 0.5);
  const t1 = mk({ L3, S5: {} }).crisisDualLeader('boss_1', null);
  assert.equal(t1.pools[1].at, 40, 'I 档 params 为空，登场条件不变');
  assert.equal(t1.pools[1].below, 0.5);
  const t2 = mk({ L3, S5: { below: 0.6, at: 30 } }).crisisDualLeader('boss_1', null);
  assert.equal(t2.pools[1].at, 30, 'II 档：战斗到 30 秒登场');
  assert.equal(t2.pools[1].below, 0.6, 'II 档：主领袖生命降至 60% 登场');
  assert.equal(mk({ S5: { below: 0.6, at: 30 } }).crisisDualLeader('boss_1', null), null, '没有 L3 就没有第二名领袖');
});
// ── Q8 Ⅱ 档：影刃攻击间隔缩减（cut）与同点同时出生（together）──
test('Q8 Ⅱ 影刃攻击间隔缩减 — 字段名是 cut，Ⅰ 档沿用数据默认 -1.3', () => {
  const mk = (fxObj) => { const g = new GameData(DATA, 'mode_multi_normal'); g.crisisFx = fxObj; return g; };
  const get = (ov, k) => ((ov[k] && ov[k].talents && ov[k].talents.bb) || null);
  assert.deepEqual(mk({}).crisisTalentOverrides({}), {}, '无 Q8 时原样');
  const o1 = mk({ Q8: { radius: 1.5 } }).crisisTalentOverrides({});
  assert.equal(get(o1, 'enemy_1174_duholy_2')['traitAbility.range_radius'], 1.5, 'Ⅰ 档：卫队力场半径 1.5');
  assert.equal(get(o1, 'enemy_1175_dushdo_2'), null, 'Ⅰ 档：影刃不覆盖（数据默认已是 -1.3）');
  const o2 = mk({ Q8: { radius: 1.5, cut: 1.6, together: true } }).crisisTalentOverrides({});
  assert.equal(get(o2, 'enemy_1175_dushdo_2')['traitAbility.base_attack_time'], -1.6, 'Ⅱ 档：影刃 -1.3 → -1.6');
});

test('Q8 Ⅱ 卫队与影刃同点同时出生 — 对齐最近的同入口卫队，总数不变', () => {
  const tot = (l) => l.reduce((s, x) => s + (x.count || 1), 0);
  const sp = [
    { time: 10, key: Q8_GUARD_KEYS[0], count: 1, interval: 0, routeIndex: 0 },
    { time: 10, key: Q8_BLADE_KEYS[0], count: 1, interval: 0, routeIndex: 0 },
    { time: 22, key: Q8_GUARD_KEYS[0], count: 1, interval: 0, routeIndex: 1 },
    { time: 14, key: Q8_BLADE_KEYS[0], count: 1, interval: 0, routeIndex: 0 },
    { time: 3, key: 'enemy_1000_gopro_2', count: 2, interval: 1, routeIndex: 0 },
  ];
  const out = crisisTogetherSpawns(sp, { radius: 1.5, cut: 1.6, together: true }, Q8_GUARD_KEYS, Q8_BLADE_KEYS, 10, Q8_WINDOW);
  assert.equal(tot(out), tot(sp), '总数不变');
  const blades = out.filter((s) => Q8_BLADE_KEYS.includes(s.key || s.enemyKey));
  assert.deepEqual(blades.map((s) => s.time), [10, 10], '两条影刃都对齐到 r0 的卫队 t=10');
  assert.ok(blades.every((s) => s.routeIndex === 0), '都在入口 0');
  assert.equal(out.find((s) => s.key === 'enemy_1000_gopro_2').time, 3, '非目标不受影响');
  assert.equal(crisisTogetherSpawns(sp, { radius: 1.5 }, Q8_GUARD_KEYS, Q8_BLADE_KEYS, 10, Q8_WINDOW), sp, 'Ⅰ 档（无 together）原样');
  assert.equal(crisisTogetherSpawns(sp, { together: true }, Q8_GUARD_KEYS, Q8_BLADE_KEYS, 7, Q8_WINDOW), sp, 'R7 区间外原样');
});
// ── 局内危机状态推到客户端（official CrisisShopLine）──
test('局内危机状态 — 承压位/悬赏精英/种子只在该合约真装上时才出现', () => {
  const h = makeMatch({ mode: 'coop', humans: 4, seed: 11, fake: true, difficulty: 'EASY' });
  h.start();
  const ps0 = h.ps('p_0');
  assert.equal(Object.prototype.hasOwnProperty.call(ps0.privateView(), 'crisis'), false, '无合约时 priv 不带 crisis 键');
  assert.equal(Object.prototype.hasOwnProperty.call(h.m.publicView(), 'crisisPressure'), false, '无合约时 public 不带 crisisPressure 键');
  h.m.gd.crisisFx = { U1: { rounds: [7, 13], each: 2 }, R4: { rounds: [7, 13], mul: 1.25, sp: 10, healPct: 0.1 } };
  h.m.crisisPressureThisRound = 'p_1';
  h.m.crisisMarkThisRound = 'enemy_1005_yokai_3';
  h.m.seed = 'ABCD-1234';
  const v0 = ps0.privateView(), v1 = h.ps('p_1').privateView();
  assert.deepEqual(v0.crisis.pressure, { playerId: 'p_1', me: false }, '别人看到的承压位 me=false');
  assert.deepEqual(v1.crisis.pressure, { playerId: 'p_1', me: true }, '承压位本人看到 me=true');
  assert.equal(v0.crisis.bounty.key, 'enemy_1005_yokai_3', '悬赏精英 key');
  assert.equal(v0.crisis.seed, 'ABCD-1234', '开局种子');
  const pub = h.m.publicView();
  assert.equal(pub.crisisPressure, 'p_1', 'public 也带承压位');
  assert.equal(pub.crisisMark, 'enemy_1005_yokai_3', 'public 也带悬赏精英');
});
// R5 弧光镜卫：闲置 5 秒恢复 20 层；层满后受伤 +20%。
test('R5 弧光镜卫 — 闲置 5 秒回 20 层，满层后受伤 +20%', () => {
  const mk = () => makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: 'probe', row: 10, col: 9 }],
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 0, res: 0 } }) } } });
  // 第一半：闲置回层
  const probe = (fxObj) => {
    const h = mk();
    if (fxObj) applyCrisisFx(h.b, fxObj);
    h.run(1.0);
    const e = h.spawn('enemy_1329_cbshld', { pos: [10, 5] });
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    h.b.dealDamage({ source: op, target: e, amount: 100, type: 'phys' });
    const s1 = (e.buffs || []).find((x) => x.key === 'ab:defDecay').stacks;
    h.run(6);
    const b = (e.buffs || []).find((x) => x.key === 'ab:defDecay');
    return { s1, s2: b.stacks };
  };
  assert.deepEqual(probe(null), { s1: 1, s2: 1 }, '基准：层数不动');
  const r5 = probe({ R5: { idle: 5, layers: 20, vuln: 0.2 } });
  assert.equal(r5.s1, 1);
  assert.equal(r5.s2, 21, 'R5：闲置 5 秒后 +20 层');
  // 第二半：满层 +20%
  const dmg = (fxObj, fill) => {
    const h = mk();
    if (fxObj) applyCrisisFx(h.b, fxObj);
    h.run(1.0);
    const e = h.spawn('enemy_1329_cbshld', { pos: [10, 5] });
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    h.b.dealDamage({ source: op, target: e, amount: 1, type: 'phys' });
    const b = (e.buffs || []).find((x) => x.key === 'ab:defDecay');
    if (fill) b.stacks = b.maxStacks;
    const hp0 = e.hp;
    h.b.dealDamage({ source: op, target: e, amount: 1000, type: 'true' });
    return Math.round(hp0 - e.hp);
  };
  assert.equal(dmg(null, true), 1000, '基准：满层也不加伤');
  assert.equal(dmg({ R5: { idle: 5, layers: 20, vuln: 0.2 } }, true), 1200, 'R5：满层 ×1.2');
  assert.equal(dmg({ R5: { idle: 5, layers: 20, vuln: 0.2 } }, false), 1000, 'R5：未满层不触发');
});
// R2 囚犯：禁锢中被击倒时击倒者 +5 技力，每名干员每场最多 15 点。
test('R2 囚犯 — 禁锢中击倒给 +5 技力，每场封顶 15', () => {
  const h = makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: 'probe', row: 10, col: 5 }],
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500 }, skill: { spCost: 999, kind: 'manual', duration: 10 } }) } } });
  applyCrisisFx(h.b, { R2: { hits: 3, sp: 5, cap: 15 } });
  h.run(1.0);
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  const s0 = op.sp;
  const gains = [];
  for (let i = 0; i < 4; i++) {
    const p = h.spawn('enemy_1116_liprr', { pos: [10, 6] });
    h.b.dealDamage({ source: op, target: p, amount: 999999, type: 'true' });
    h.run(0.05);
    gains.push(Math.round(op.sp - s0));
  }
  assert.deepEqual(gains, [5, 10, 15, 15], '每次 +5，每场封顶 15');
});
// R1 再生护盾：护盾 5->7、重生 15->12（天赋层），彻底击倒后周围 2 格敌人挂 crisis:R1。
test('R1 再生护盾 — 彻底击倒后周围敌人挂 crisis:R1', () => {
  const h = makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: 'probe', row: 10, col: 9 }],
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 0, res: 0 } }) } } });
  const r = applyCrisisFx(h.b, { R1: { shield: 7, reborn: 12, vuln: 0.15, dur: 5, radius: 2 } });
  assert.deepEqual(r.applied, ['R1']);
  h.run(1.0);
  const e = h.spawn('enemy_9010_acpupp', { pos: [10, 5] });
  const near = h.spawn('enemy_1002_nsabr', { pos: [10, 6] });
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  h.b.dealDamage({ source: op, target: e, amount: 999999, type: 'true' });
  h.run(1.2);
  const huskA = e.mem.ab.list.find((x) => x && x.state === 'husk');
  assert.ok(huskA, '第一次倒下转 husk 形态');
  for (let i = 0; i < 15; i++) h.b.dealDamage({ source: op, target: e, amount: 1, type: 'true' });
  assert.equal(e.alive, false, '打满 15 层 = 彻底击倒');
  const buff = (near.buffs || []).find((b) => b.key === 'crisis:R1');
  assert.ok(buff, '彻底击倒后周围敌人挂上 crisis:R1');
});
// Q3 中坚盾卫光环：1.5 格内的其他敌人受伤 -15%，不叠加，盾卫自己不吃。
test('Q3 中坚盾卫光环 — 1.5 格内其他敌人 -15%，远处与自身不受影响', () => {
  const probe = (fxObj) => {
    const h = makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: 'probe', row: 10, col: 9 }],
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 0, res: 0 } }) } } });
    if (fxObj) applyCrisisFx(h.b, fxObj);
    h.run(1.0);
    const s = h.spawn('enemy_10124_uashld_2', { pos: [10, 5] });
    const near = h.spawn('enemy_1002_nsabr', { pos: [10, 6] });
    const far = h.spawn('enemy_1002_nsabr', { pos: [10, 15] });
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    const nB = near.hp, fB = far.hp, sB = s.hp;
    h.b.dealDamage({ source: op, target: near, amount: 1000, type: 'true' });
    h.b.dealDamage({ source: op, target: far, amount: 1000, type: 'true' });
    h.b.dealDamage({ source: op, target: s, amount: 1000, type: 'true' });
    return { near: Math.round(nB - near.hp), far: Math.round(fB - far.hp), shield: Math.round(sB - s.hp) };
  };
  const base = probe(null);
  const q3 = probe({ Q3: { cut: 0.15, radius: 1.5 } });
  assert.equal(base.near, 1000, '基准：1000 全额');
  assert.equal(q3.near, 850, 'Q3：×0.85');
  assert.equal(q3.far, 1000, 'Q3：1.5 格外不受影响');
  assert.equal(q3.shield, 1000, 'Q3：盾卫自己不吃光环');
});
// P3 圣杯分担：分担比例 5% -> 15%（x3）；圣杯倒下时周围 1.7 格地面敌人受伤 +20% 持续 6 秒。
test('P3 圣杯分担 — 分担 5%→15%，倒下后周围地面敌人 +20%/6s', () => {
  const probe = (fxObj) => {
    const h = makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: 'probe', row: 10, col: 9 }],
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 500, def: 100, res: 10 } }) } } });
    if (fxObj) applyCrisisFx(h.b, fxObj);
    h.run(1.0);
    const c = h.spawn('enemy_1430_lrrook', { pos: [10, 5] });
    const t = h.spawn('enemy_1002_nsabr', { pos: [10, 6] });
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    const share = c.mem.ab.list[0].share;
    const tB = t.hp, cB = c.hp;
    h.b.dealDamage({ source: op, target: t, amount: 1000, type: 'phys' });
    const toChalice = Math.round(cB - c.hp);
    h.b.dealDamage({ source: op, target: c, amount: 9999999, type: 'true' });
    h.step(3);
    const buff = (t.buffs || []).find((b) => b.key === 'crisis:P3');
    return { share, toChalice, hasBuff: !!buff };
  };
  const base = probe(null);
  const p3 = probe({ P3: { share: 3, vuln: 0.2, dur: 6, radius: 1.7 } });
  assert.equal(base.share, 0.05, '基准分担 5%');
  assert.ok(Math.abs(p3.share - 0.15) < 1e-9, 'P3 分担 15%');
  assert.equal(base.toChalice, 50, '基准：1000 的 5% 到圣杯');
  assert.equal(p3.toChalice, 150, 'P3：1000 的 15% 到圣杯');
  assert.equal(base.hasBuff, false, '无契约时圣杯倒下不加伤');
  assert.equal(p3.hasBuff, true, 'P3：圣杯倒下，周围地面敌人挂上 crisis:P3');
});
test('P2 盾卫压制 — 存活盾卫给萨米减伤6%/层（封顶4层），击倒盾卫增伤10%', () => {
  const mk = (fx, shields) => {
    const enemies = [{ key: 'enemy_9033_acdeer', row: 10, col: 5 }];
    for (let i = 0; i < shields; i++) enemies.push({ key: 'enemy_1081_sotisd', row: 4 + i, col: 8 });
    const h = makeBattle({ kind: 'normal', autoFinish: false, content: 'full',
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 1e6, atk: 1, def: 0, res: 0 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies });
    h.run(0.2);
    if (fx) applyCrisisFx(h.b, fx);
    return h;
  };
  const dmgTo = (h) => {
    const sami = h.b.units.find((x) => x.side === 'enemy' && x.defId === 'enemy_9033_acdeer');
    const op = h.b.allyUnits.find((x) => x.kind === 'op');
    sami.alive = true; sami.hp = sami.s.maxHp;
    return h.b.dealDamage({ source: op, target: sami, amount: 1000, type: 'phys' });
  };
  const P2 = { P2: { layer: 0.06, layers: 4, vuln: 0.1, dur: 8, windows: 2, tier: 1 } };

  // 无合约：盾卫数量不影响
  {
    const h0 = mk(null, 0); const h4 = mk(null, 4);
    assert.equal(dmgTo(h0), dmgTo(h4), '无合约时盾卫数量不影响萨米受伤');
  }

  const base = dmgTo(mk(P2, 0));
  // 层数：6%/层，封顶 4 层
  assert.equal(dmgTo(mk(P2, 2)), Math.round(base * 0.88), '2 盾 ×0.88');
  assert.equal(dmgTo(mk(P2, 4)), Math.round(base * 0.76), '4 盾 ×0.76');
  assert.equal(dmgTo(mk(P2, 6)), Math.round(base * 0.76), '6 盾封顶 4 层');

  // 击倒盾卫：+10%
  {
    const h = mk(P2, 1);
    const op = h.b.allyUnits.find((x) => x.kind === 'op');
    const sh = h.b.units.find((x) => x.side === 'enemy' && x.defId === 'enemy_1081_sotisd');
    h.b.dealDamage({ source: op, target: sh, amount: 1e9, type: 'phys' });
    assert.equal(sh.alive, false, '盾卫被击倒');
    assert.equal(dmgTo(h), Math.round(base * 1.1), '击倒盾卫后 +10%');
  }
});

test('U1 承压位 — 不连续两回合、每人最多2次；第20秒追加2名且不发奖励', () => {
  const U1 = { U1: { rounds: [7, 13], at: 20, n: 2, each: 2, tier: 1 } };
  const fakeM = (round) => ({
    round, gd: { crisisFx: U1 }, crisisPressure: undefined,
    alivePlayers: () => [{ playerId: 'p0', seat: 0 }, { playerId: 'p1', seat: 1 },
      { playerId: 'p2', seat: 2 }, { playerId: 'p3', seat: 3 }],
  });

  // 区间外不选
  assert.equal(pickCrisisPressure(fakeM(6)), null, '第6回合不选承压位');
  assert.equal(pickCrisisPressure(fakeM(14)), null, '第14回合不选承压位');

  // 7..13 的选人规则
  {
    const m = fakeM(7);
    const seq = [];
    for (let r = 7; r <= 13; r++) { m.round = r; seq.push(pickCrisisPressure(m)); }
    for (let i = 1; i < seq.length; i++) {
      assert.notEqual(seq[i], seq[i - 1], '不连续两回合（第 ' + (i + 7) + ' 回合）');
    }
    for (const [id, n] of Object.entries(m.crisisPressure.count)) {
      assert.ok(n <= 2, id + ' 最多 2 次，实际 ' + n);
    }
  }

  // 战斗：只有承压位追加
  const mk = (flag) => {
    const h = makeBattle({ kind: 'normal', autoFinish: false, round: 8, content: 'full',
      flags: flag ? { crisisPressure: true } : undefined,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 1e6, atk: 1, def: 0, res: 0 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [{ key: 'originium_slug', row: 10, col: 5 }] });
    h.run(0.2);
    applyCrisisFx(h.b, U1);
    return h;
  };
  const cnt = (h) => h.b.units.filter((x) => x.side === 'enemy' && x.alive).length;

  {
    const h = mk(false);
    h.b.time = 25; h.b.emit('tick');
    assert.equal(cnt(h), 1, '非承压位不追加');
  }
  {
    const h = mk(true);
    assert.equal(cnt(h), 1, '初始 1 只');
    h.b.time = 19; h.b.emit('tick');
    assert.equal(cnt(h), 1, 't=19 还没到');
    h.b.time = 21; h.b.emit('tick');
    assert.equal(cnt(h), 3, 't=21 追加 2 名');
    h.b.time = 40; h.b.emit('tick');
    assert.equal(cnt(h), 3, '只触发一次');
  }
});

test('U2 终局压制 — 第20秒起每30秒给该拼场敌人 +20 aspd 持续12秒', () => {
  const U2 = { U2: { from: 20, every: 30, dur: 12, aspd: 20, tier: 1 } };
  // 敌人用高血量首领：20 秒内打不死，才能观察到 buff
  const mk = (flag) => {
    const h = makeBattle({ kind: 'boss', autoFinish: false, content: 'full',
      flags: flag ? { crisisSuppress: true } : undefined,
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 1e9, atk: 1, def: 0, res: 0 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [{ key: 'enemy_9033_acdeer', row: 10, col: 5 }] });
    h.run(0.2);
    return h;
  };
  const enOf = (h) => h.b.units.find((x) => x.side === 'enemy');

  // 无压制 flag：不装
  {
    const h = mk(false);
    assert.deepEqual(applyCrisisFx(h.b, U2).applied, [], '没有 crisisSuppress 不装 U2');
  }

  // 有 flag：t=20 起 +20 aspd，12 秒后回落到原值
  {
    const h = mk(true);
    assert.deepEqual(applyCrisisFx(h.b, U2).applied, ['U2'], 'boss 场装 U2');
    assert.equal(enOf(h).s.aspd, 100, '初始 aspd 100');
    h.run(19 - h.b.time);
    assert.equal(enOf(h).s.aspd, 100, 't=19 还没到');
    h.run(21 - h.b.time);
    assert.equal(enOf(h).s.aspd, 120, 't=21 aspd 120');
    assert.ok((enOf(h).buffs || []).some((x) => x.key === 'crisis:U2'), 'buff 在场');
    h.run(34 - h.b.time);
    assert.equal(enOf(h).s.aspd, 100, 't=34 已回落（12秒窗口结束）');
  }
});

test('U3 迟滞入场 — 承接人干员延迟4秒入场，生命/站位保留；被援护者不受影响', () => {
  const U3 = { U3: { delay: 4, tier: 1 } };
  const mk = (helpers) => {
    const h = makeBattle({ kind: 'unite', autoFinish: false, content: 'full',
      flags: { crisisUniteHelpers: helpers },
      defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 1000, atk: 100, def: 0, res: 0 } }) } },
      units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }], enemies: [{ key: 'originium_slug', row: 10, col: 5 }] });
    h.run(0.2);
    const op = h.b.allyUnits.find((x) => x.kind === 'op');
    op.hp = 600;
    const res = applyCrisisFx(h.b, U3);
    return { h, op, res };
  };

  // 承接人：延迟 4 秒，生命与站位保留
  {
    const { h, op, res } = mk(['p1']);
    assert.deepEqual(res.applied, ['U3'], '承接人场装 U3');
    assert.equal(op.alive, false, '开战即离场');
    h.run(2);
    assert.equal(op.alive, false, 't=2 仍离场');
    h.run(3);
    assert.equal(op.alive, true, 't=5 已入场');
    assert.equal(op.hp, 600, '原有生命保留');
    assert.equal(op.tileR, 10, '站位 r 保留');
    assert.equal(op.tileC, 3, '站位 c 保留');
  }

  // 非承接人：不受影响
  {
    const { h, op, res } = mk(['other']);
    assert.deepEqual(res.applied, [], '非承接人场不装');
    assert.equal(op.alive, true, '全程在场');
    h.run(5);
    assert.equal(op.alive, true, 't=5 仍在场');
    assert.equal(op.hp, 600, '血量未被改动');
  }
});

test('E1 + D1 + F1 同选：血量、攻击、消耗各自生效', () => {
  const h = opBattle();
  applyCrisisFx(h.b, fx('E1-1', 'D1-1', 'F1-1'));
  h.step();
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  assert.equal(op.s.maxHp, 8500, 'E1 一档：×0.85');
  assert.equal(op.s.atk, 450, 'D1 一档：×0.9');
  assert.equal(op.skill.spCost, 46, 'F1 一档：×1.15 ⇒ floor(40×1.15)');
});

test('没有合约时 applyCrisisFx 什么都不做（不挂钩子、不加 buff）', () => {
  const h = opBattle();
  const r = applyCrisisFx(h.b, null);
  assert.deepEqual(r, { applied: [], skipped: [] });
  h.step();
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  assert.equal(op.s.maxHp, 10000, '血量不动');
  assert.equal(op.s.atk, 500, '攻击不动');
  assert.equal(op.skill.spCost, 40, '消耗不动');
  assert.equal(op.buffs.filter((b) => b.key === 'crisis:stats').length, 0, '没有合约 buff');
});

test('敌方侧的路由不算我方缺口（A1/B1/N1/Q1/Q9 由 crisisEnemyMul 负责）', () => {
  const h = opBattle();
  const r = applyCrisisFx(h.b, fx('E1-1', 'A1-1', 'B1-1', 'N1-1', 'Q1-1', 'Q9-1'));
  assert.deepEqual(r.applied, ['E1']);
  assert.deepEqual(r.skipped, [], '一条敌方路由都不该进 skipped');
});

test('引擎确实没有落点的组被如实列为 skipped，绝不假装生效', () => {
  const h = opBattle();
  // 主表 89 条现已全部实装；这条回归靠一个**表里不存在**的 route id 验证「没落点就如实 skipped」。
  const r = applyCrisisFx(h.b, { G1: {}, L2: {}, ZZ9: {} }); // 表里不存在的 ZZ9 用来验证 skipped
  assert.deepEqual(r.applied, []);
  assert.deepEqual(r.skipped.sort(), ['G1', 'L2', 'ZZ9']);
});

test('C1 反装甲 — 敌人防御/法抗是 FLAT 平加（引擎 units.js 的 defFlat / resFlat 通道）', () => {
  // 敌人侧平加需要单位实例，这里钉住 fx 形状 + 报缺口口径：C1 不算 skipped，但也不该污染我方 buff
  const h = opBattle();
  const r = applyCrisisFx(h.b, fx('C1-2'));
  assert.ok(!r.skipped.includes('C1'), 'C1 有落点，不该进 skipped');
  h.step();
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  assert.equal(op.s.maxHp, 10000, 'C1 是敌方侧，我方血量不动');
  assert.equal(op.s.atk, 500, 'C1 是敌方侧，我方攻击不动');
  // 平加数值来自官方表：二档 def +200 / res +10
  assert.equal(fx('C1-2').C1.def, 200);
  assert.equal(fx('C1-2').C1.res, 10);
});

test('L1 王权高压 — 领袖血池倍率（gamedata.crisisBossHpMul，一档 ×1.25 / 二档 ×1.4）', () => {
  // L1 的落点是共享血池（finalAssault.bossPoolHp ← gamedata.crisisBossHpMul），不是本文件；这里钉住两件事：
  // 一、它不该被当成缺口；二、倍率读的就是官方表里的 fx.L1.hp。
  const h = opBattle();
  const r = applyCrisisFx(h.b, fx('L1-1'));
  assert.ok(!r.skipped.includes('L1'), 'L1 有落点（血池），不该进 skipped');
  assert.equal(fx('L1-1').L1.hp, 0.25, '一档 +25%');
  assert.equal(fx('L1-2').L1.hp, 0.4, '二档 +40%');
  // 不含 L1 时没有该键
  assert.equal(fx('A1-1').L1, undefined);
});

test('Q1 定点实测：寒霜 6500 → 8450（×1.3），同场的穿刺手 6000 不动', () => {
  const mods = crisisNamedEnemyMul(fx('Q1-1'), 'enemy_1042_frostd');
  assert.deepEqual(mods, { hpMul: 1.3 });
  const h = makeBattle({ content: 'none', autoFinish: false,
    enemies: [{ key: 'enemy_1042_frostd', mods }, { key: 'enemy_1072_dlancer' }] });
  h.step();
  const byKey = (k) => h.b.units.find((u) => u.side === 'enemy' && u.def.key === k);
  assert.equal(byKey('enemy_1042_frostd').s.maxHp, 8450, '寒霜：6500×1.3');
  assert.equal(byKey('enemy_1072_dlancer').s.maxHp, 6000, '穿刺手不受 Q1 影响');
});

test('N2 猝发攻势 — 出生间隔缩短 20%，敌人总数不变（只压 interval，不删任何一条）', () => {
  const list = [
    { enemyKey: 'a', interval: 10, count: 3 },
    { enemyKey: 'b', interval: 0, count: 1 },
    { enemyKey: 'c', count: 2 },
  ];
  const out = crisisSpawnRhythm(list, fx('N2-1'));
  assert.equal(out.length, 3, '一条都不许少：总数不变');
  assert.equal(out[0].interval, 8, '10 × 0.8');
  assert.equal(out[0].count, 3, 'count 不动');
  assert.equal(out[1].interval, 0, '0 间隔保持不变');
  assert.equal(out[2].interval, undefined, '没有 interval 的条目原样保留');
  // 没有 N2 时返回同一个数组（不分配、不改动）
  assert.equal(crisisSpawnRhythm(list, fx('A1-1')), list);
  assert.equal(crisisSpawnRhythm(list, null), list);
});

test('O1 最后防线：cap 只对合约房生效（fx 形状）', () => {
  assert.equal(fx('O1-1').O1.cap, 10);
  assert.equal(fx('A1-1').O1, undefined, '不含 O1 时没有该键');
});