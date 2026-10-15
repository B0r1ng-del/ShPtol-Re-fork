// 房主配置「对局选项」 (opts.enemyBuff; server/match/Match.js → GameData.enemyBuff) — the four enemy buffs the host turns
// up in the 准备房间, as the engine runs them. Each slider is an integer count of 10 % steps (HOST_ENEMY_KEYS,
// HOST_ENEMY_MAX_STEPS = 10 ⇒ +100 %), and 需求方 2026-10-15 asked for it in EVERY mode (「确保该功能在所有模式中均通用」).
//
// The point of the design is that ONE place decides: `GameData.enemyScale` folds HP / ATK into the official round table,
// so every consumer inherits them — ordinary spawns, 部位, bounty adds, a leader's mid-fight summons (flags.enemyScale)
// and the client's own spec. DEF / RES ride on `GameData.enemyBuffDefRes` → `waves.js roundMods`; a leader's HP is the
// shared pool, so `bossPoolHp` applies `enemyBuff.hp` there. This file plays those numbers; test/lobby-enemy-buff.test.js
// is the lobby half (protocol, host-only, kept across matches).
//
// Every case also pins the DEFAULT: with no buff nothing is allocated and no number moves, which is what keeps the
// golden scenarios and every other caller byte-identical (test/golden/*.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_ENEMY_MAX_STEPS } from '../../shared/constants.js';
import { GameData } from '../../server/match/gamedata.js';
import { buildNormalWave, buildBossWave } from '../../server/match/waves.js';
import { bossPoolHp } from '../../server/match/finalAssault.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA } from './harness.js';

/** Every spawn of a normal wave of round r, and of the round's boss wave. */
const normalSpawns = (gd, round = 5) => buildNormalWave(gd, createRng(7), gd.factions, round).spawns;
const bossSpawns = (gd, bossId) => {
  const round = gd.bossRound;
  return buildBossWave(gd, createRng(7), gd.factions, round, { bossId, solo: false }).spawns;
};
const maxed = { enemyHp: HOST_ENEMY_MAX_STEPS, enemyAtk: HOST_ENEMY_MAX_STEPS, enemyDef: HOST_ENEMY_MAX_STEPS, enemyRes: HOST_ENEMY_MAX_STEPS };
/** The first spawn carrying `key` (a mods field), or null. */
const withMod = (list, key) => list.find((s) => s.mods && s.mods[key] != null) || null;
const ratio = (a, b) => a / b;

test('no buff: GameData allocates nothing and no spawn carries a DEF / RES multiplier', () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  assert.equal(gd.enemyBuff, null, 'nothing to apply');
  assert.equal(gd.enemyBuffDefRes, null, 'and nothing for roundMods');
  // the official round table comes through untouched (mode_multi_hard R5: hp 1.728, atk 1.331)
  assert.deepEqual(gd.enemyScale(5), { hpMul: 1.728, atkMul: 1.331, speedMul: 1 });
  for (const s of normalSpawns(gd)) {
    assert.equal(s.mods.defMul, undefined, 'no defMul key at all');
    assert.equal(s.mods.resMul, undefined, 'no resMul key at all');
  }
  // an all-zero payload is the same as none
  const zero = new GameData(DATA, 'mode_multi_hard', undefined, { enemyHp: 0, enemyAtk: 0, enemyDef: 0, enemyRes: 0 });
  assert.equal(zero.enemyBuff, null);
  assert.deepEqual(zero.enemyScale(5), gd.enemyScale(5));
});

test('HP / ATK fold into enemyScale, so EVERY ordinary spawn of the round takes them', () => {
  const off = new GameData(DATA, 'mode_multi_hard');
  const on = new GameData(DATA, 'mode_multi_hard', undefined, { enemyHp: 5, enemyAtk: 2 });
  assert.ok(Math.abs(on.enemyScale(5).hpMul - off.enemyScale(5).hpMul * 1.5) < 1e-9, '+50 % HP');
  assert.ok(Math.abs(on.enemyScale(5).atkMul - off.enemyScale(5).atkMul * 1.2) < 1e-9, '+20 % ATK');
  assert.equal(on.enemyScale(5).speedMul, off.enemyScale(5).speedMul, 'speed is not one of the four');
  const a = normalSpawns(off);
  const b = normalSpawns(on);
  assert.equal(a.length, b.length, 'the same spawn list');
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs(ratio(b[i].mods.hpMul, a[i].mods.hpMul) - 1.5) < 1e-9, `spawn ${i}: HP ×1.5`);
    assert.ok(Math.abs(ratio(b[i].mods.atkMul, a[i].mods.atkMul) - 1.2) < 1e-9, `spawn ${i}: ATK ×1.2`);
  }
});

test('DEF / RES ride on roundMods: every ordinary spawn and 部位, but never the leader branch', () => {
  const on = new GameData(DATA, 'mode_multi_hard', undefined, { enemyDef: 3, enemyRes: 4 });
  assert.deepEqual(on.enemyBuffDefRes, { defMul: 1.3, resMul: 1.4 });
  const list = normalSpawns(on);
  assert.ok(list.length > 0);
  for (const s of list) {
    if (s.mods.defMul != null) assert.ok(Math.abs(s.mods.defMul - 1.3) < 1e-9, 'DEF ×1.3');
    if (s.mods.resMul != null) assert.ok(Math.abs(s.mods.resMul - 1.4) < 1e-9, 'RES ×1.4');
  }
  // at least the ordinary non-boss spawns carry them (a 部位 takes them too; the leader branch is the boss wave's)
  assert.ok(withMod(list, 'defMul'), 'some spawn carries defMul');
  assert.ok(withMod(list, 'resMul'), 'some spawn carries resMul');
  // HP / ATK were not asked for: they must not move
  const off = new GameData(DATA, 'mode_multi_hard');
  assert.deepEqual(on.enemyScale(5), off.enemyScale(5), 'DEF / RES do not touch the round table');
});

test('the boss wave: escorts and 部位 take all four, and the leader takes ATK / DEF / RES but not HP', () => {
  const BOSS = 'boss_1';
  const off = new GameData(DATA, 'mode_multi_abyss');
  const on = new GameData(DATA, 'mode_multi_abyss', undefined, maxed);
  const a = bossSpawns(off, BOSS);
  const b = bossSpawns(on, BOSS);
  assert.equal(a.length, b.length, 'the same spawn list');
  // the leader is the one spawn the boss branch wrote no hpMul for (its HP is the shared pool) — that is also how the
  // boss branch marks it, so finding it this way keeps the test honest about WHICH spawn it is
  const leaderIdx = a.findIndex((s) => s.mods.hpMul == null);
  assert.ok(leaderIdx >= 0, 'the leader has no hpMul of its own');
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs(ratio(b[i].mods.atkMul, a[i].mods.atkMul) - 2) < 1e-9, `spawn ${i}: ATK ×2`);
    if (i === leaderIdx) {
      assert.equal(a[i].mods.hpMul, undefined, 'the leader has no hpMul');
      assert.equal(b[i].mods.hpMul, undefined, 'and the buff does not add one — its HP is the pool');
    } else {
      assert.ok(Math.abs(ratio(b[i].mods.hpMul, a[i].mods.hpMul) - 2) < 1e-9, `spawn ${i}: HP ×2`);
    }
  }
  // DEF / RES reach the leader through the boss branch (its own defMul is written because it is no longer 1)
  const lb = b[leaderIdx];
  assert.ok(Math.abs(lb.mods.defMul - 2) < 1e-9, 'the leader takes DEF ×2');
  assert.ok(Math.abs(lb.mods.resMul - 2) < 1e-9, 'and RES ×2');
});

test('a leader\'s HP buff lands on the SHARED POOL: bossPoolHp ×(1 + steps/10), the two implementations agreeing', () => {
  const off = new GameData(DATA, 'mode_multi_abyss');
  for (const steps of [1, 5, HOST_ENEMY_MAX_STEPS]) {
    const on = new GameData(DATA, 'mode_multi_abyss', undefined, { enemyHp: steps });
    for (const id of [on.bossId, on.hiddenBossId]) {
      const a = off.bossPoolHp(id, 4);
      const b = on.bossPoolHp(id, 4);
      assert.equal(b, Math.max(1, Math.round(a * (1 + steps / 10))), `${id} +${steps * 10}%`);
      assert.equal(bossPoolHp(on, id, 4), b, `${id}: finalAssault.bossPoolHp agrees`);
    }
  }
});

test('the buff is mode-agnostic: every mode takes it, and each one\'s own numbers stay on top', () => {
  const modes = ['mode_single_normal', 'mode_single_abyss', 'mode_multi_normal', 'mode_multi_hard', 'mode_ultimate_abyss'];
  for (const modeId of modes) {
    const off = new GameData(DATA, modeId);
    const on = new GameData(DATA, modeId, undefined, { enemyHp: 10, enemyAtk: 10 });
    const r = 5;
    assert.ok(Math.abs(ratio(on.enemyScale(r).hpMul, off.enemyScale(r).hpMul) - 2) < 1e-9, `${modeId}: HP ×2`);
    assert.ok(Math.abs(ratio(on.enemyScale(r).atkMul, off.enemyScale(r).atkMul) - 2) < 1e-9, `${modeId}: ATK ×2`);
  }
  // 终极模拟's own 二.3 enemyAdjust still rides on top of the official table AND the buff (they multiply)
  const ultOff = new GameData(DATA, 'mode_ultimate_abyss');
  const ultOn = new GameData(DATA, 'mode_ultimate_abyss', undefined, { enemyHp: 5 });
  const r = ultOff.bossRound;
  assert.ok(Math.abs(ratio(ultOn.enemyExtras(r).normalHp, ultOff.enemyExtras(r).normalHp) - 1) < 1e-9, 'the mode extra is untouched');
  assert.ok(Math.abs(ultOn.bossPoolHp(ultOff.bossId, 4) / ultOff.bossPoolHp(ultOff.bossId, 4) - 1.5) < 1e-9, 'and the pool takes both');
});

test('a leader\'s mid-fight summons read flags.enemyScale, so they inherit the buff too', () => {
  // bosses.js summonMods reads the battle's flags.enemyScale (hpMul / atkMul) — the same object enemyScale returns, so
  // a buffed leader's summons are buffed without touching the sim.
  const off = new GameData(DATA, 'mode_multi_abyss');
  const on = new GameData(DATA, 'mode_multi_abyss', undefined, { enemyHp: 10, enemyAtk: 10 });
  const a = off.enemyScale(off.bossRound);
  const b = on.enemyScale(on.bossRound);
  assert.ok(Math.abs(ratio(b.hpMul, a.hpMul) - 2) < 1e-9, 'the flag a summon reads is the buffed one');
  assert.ok(Math.abs(ratio(b.atkMul, a.atkMul) - 2) < 1e-9);
});
