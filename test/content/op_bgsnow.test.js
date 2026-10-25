// test/content/op_bgsnow.test.js — 鸿雪 (char_4055_bgsnow, 6★ 重射手) and her summon “打字机”
// (token_10026_bgsnow_subbow), fielded the PRODUCTION way: she is a 乌萨斯 pack chess (`chess_char_4_99_a` normal /
// `_b` elite, packId packUrsus), the typewriter the placed hand piece of her player. Her kit is
// server/sim/content/kits/ops/chess_char_4_99-bgsnow.js (tier-4 预设棋 contract); the by-charId file
// server/sim/content/kits/ops/op-bgsnow.js is the retired 自选 twin and stays registered (KITTED_CHARS).
//
// ★ 2026-10-25: the 自选 four-form matrix this file used to assert is gone WITH THE DATA, not with the kit. The
// merge of upstream v0.3.2 regenerated data/backups.json: `buildBackups` builds a pack chess's forms from its own
// chess records only (`chess_char_4_99_a/_b` = E2 Lv1 rank 4 and E2 Lv60 rank 7 at module stage 1), and
// `buildDiyTokens(ctx, units, ownedPool)` builds a summon record only for `ownedPool` members — 鸿雪 left that pool
// on 2026-10-23 (she is a chess piece; the duplicate-operator fix). So neither `forms['2/60/7/3']` (tier-6 stage 3)
// nor `backups.tokens[token_10026_bgsnow_subbow]` exists any more. Numbers below come from data/backups.json (forms),
// data/tokens.json (the typewriter's per-chess variants) and the fidelity checklist of kits/README.md.
// Run: node --test test/content/op_bgsnow.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { shippedPool } from '../helpers/diyPoolSource.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const BACKUPS = load('backups');
const SNOW = 'char_4055_bgsnow';
const TOK = 'token_10026_bgsnow_subbow';
const FORMS = BACKUPS.units[SNOW].forms;
const TOKREC = load('tokens')[TOK];
const NORMAL = 'chess_char_4_99_a', ELITE = 'chess_char_4_99_b';
const Y = 'uniequip_002_bgsnow', X = 'uniequip_003_bgsnow';
const NONE = 'none';
const S1 = 'skchr_bgsnow_1', S2 = 'skchr_bgsnow_2', S3 = 'skchr_bgsnow_3';
const chessId = (elite) => (elite ? ELITE : NORMAL);
/** The data form a chess record fights at: normal = E2 Lv1 rank 4; elite = E2 Lv60 rank 7, module stage 1. */
const formOf = (elite) => FORMS[elite ? '2/60/7/1' : '2/1/4/0'];
const skillOf = (elite, id) => formOf(elite).skills.find((s) => s.skillId === id);
const modOf = (mod) => (mod && mod !== NONE ? formOf(true).modules.find((m) => m.uniEquipId === mod) : null);
/** The typewriter's variant of a chess form, with the pick's skill / module (simdata getToken). */
const tokOf = (elite, skill, mod) => {
  let v = TOKREC.variants[chessId(elite)];
  if (v.bySkill?.[skill]) v = { ...v, ...v.bySkill[skill] };
  if (mod && v.byModule?.[mod]) v = { ...v, ...v.byModule[mod] };
  return v;
};
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }) };
/** The two chess forms × the ARC-Y / ARC-X modules at their one reachable stage (1). */
const FORMS_ALL = [[false, NONE], [true, NONE], [true, Y], [true, X]];

/** 鸿雪 as uid 1 at (10, 5) facing RIGHT; `tok` = the typewriter piece's tile (uid 2) or null. */
function field({ elite = false, mod = NONE, skill = 0, tok = null, tokFirst = false, seed = 5, others = [] } = {}) {
  const op = { uid: 1, chessId: chessId(elite), skillIndex: skill, moduleId: mod, row: 10, col: 5 };
  const piece = tok ? [{ uid: 2, kind: 'token', tokenId: TOK, ownerUid: 1, row: tok[0], col: tok[1] }] : [];
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'death', 'deploy', 'attack', 'dodge'], captureNoisy: true,
    units: tokFirst ? [...piece, op, ...others] : [op, ...piece, ...others],
  });
  h.step();
  return { h, u: h.unit(1), t: h.b.allyUnits.find((a) => a.kind === 'token' && a.defId === TOK) ?? null };
}
const from = (h, src) => h.hooksOf('damaged').filter((c) => c.source === src);
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const label = ([elite, mod]) => `${elite ? 'elite' : 'normal'} ${mod === NONE ? 'none' : mod === Y ? 'ARC-Y' : 'ARC-X'}`;

test('鸿雪 in her every chess form: her kit, the form\'s stats + module attributes, 3-6, ranged physical, hits air, blocks 1, ground-targetable, the data triggers; the 自选 twin stays registered', () => {
  assert.equal(OPERATOR_KITS[SNOW], KITS[SNOW]);
  for (const f of FORMS_ALL) {
    const [elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ elite, mod, skill });
      const form = formOf(elite), m = modOf(mod);
      // the tier kit writes S1 / S2 under `skills` and S3 as the record's default `skill` — never the generic spec
      assert.deepEqual([u.def.charId, u.def.id, u.skill.id, !!u.kit.generic, u.kit.skillSource === 'generic'], [SNOW, chessId(elite), form.skills[skill].skillId, false, false], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.respawnTime],
        [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0), form.stats.respawnTime + (m?.attr.respawnTime ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.base.bat], [1, 'ranged', true, 'phys', 1.6], `${label(f)}: 重射手`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 3-6`);
      assert.equal(u.skill.rule, form.skills[skill].trigger.rule, `${label(f)}: the data's trigger`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: ground enemies target her`);
      done(h);
    }
  }
  assert.deepEqual(formOf(true).skills.map((s) => s.trigger.rule), ['DEFAULT', 'SKILL_RANGE', 'ACTIVE_RANGE']);
  assert.deepEqual([modOf(Y).attr, modOf(X).attr], [{ maxHp: 130, atk: 55 }, { atk: 80, def: 10, respawnTime: -25 }]);
  assert.equal(shippedPool.includes(SNOW), false, 'the shipped pool does not offer her (she is a chess piece)');
  assert.ok(KITTED_CHARS.includes(SNOW), 'her by-charId 自选 twin is still a registered kit');
});

test('S1 抑扬格 (AUTO, attack SP 29 / 25, data DEFAULT): after that many attacks ATK +35 % / +50 % until she leaves the field, every attack meanwhile 30 % to deal ×145 % / ×160 %', () => {
  for (const elite of [false, true]) {
    const sk = skillOf(elite, S1);
    assert.deepEqual([sk.spCost, sk.bb.atk, sk.bb.prob, sk.bb.atk_scale], elite ? [25, 0.5, 0.3, 1.6] : [29, 0.35, 0.3, 1.45], elite ? 'elite' : 'normal');
    const { h, u } = field({ elite, skill: 0, seed: 12 });
    assert.deepEqual([u.skill.kind, u.skill.rule, u.skill.spType], ['toggle', 'DEFAULT', 'attack'], elite ? 'elite' : 'normal');
    h.spawn('enemy_dummy', { pos: [11, 6] });
    assert.ok(h.runUntil(() => u.skill.active, 60), `${elite ? 'elite' : 'normal'}: cast`);
    const before = from(h, u);
    assert.equal(before.length, sk.spCost, `after ${sk.spCost} attacks`);
    assert.ok(before.every((c) => Math.abs(c.amount - u.base.atk) < 1e-6), 'plain before it');
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), 'ATK');
    h.run(500);
    assert.ok(u.skill.active, '持续时间无限');
    const after = from(h, u).slice(before.length);
    const atk = u.base.atk * (1 + sk.bb.atk);
    for (const c of after) assert.ok([atk, atk * sk.bb.atk_scale].some((v) => Math.abs(c.amount - v) < 1e-6), `${c.amount}`);
    const r = after.filter((c) => c.amount > atk + 1e-6).length / after.length;
    assert.ok(Math.abs(r - sk.bb.prob) < 0.06, `${r}`);
    h.b.retreat(u);
    assert.ok(!u.skill.active, 'ends when she leaves');
    done(h);
  }
});

test('S2 点题 (MANUAL, 2 charges, data SKILL_RANGE on 3-1): an enemy 3 tiles ahead (3-1, not 3-6) casts it and is struck at once: atk_scale × ATK as a 普通伤害 attack, then twice as 持续伤害 (not dodgeable); her card range stays 3-6', () => {
  for (const elite of [false, true]) {
    const sk = skillOf(elite, S2);
    assert.deepEqual([sk.bb.atk_scale, sk.bb.respawn_time, sk.maxChargeTime, sk.spCost, sk.initSp], elite ? [2, 0.6, 2, 10, 6] : [1.8, 0.65, 2, 11, 3], elite ? 'elite' : 'normal');
    const { h, u } = field({ elite, skill: 1, seed: 3 });
    assert.deepEqual([u.skill.kind, u.skill.rule, u.skill.maxCharges], ['charges', 'SKILL_RANGE', 2], elite ? 'elite' : 'normal');
    u.skill.gainSp(999);
    h.run(1);
    assert.equal(u.skill.activations, 0, 'nobody in range');
    const e = h.spawn('enemy_dummy', { pos: [10, 8] });
    h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    assert.ok(h.runUntil(() => u.skill.activations === 1, 1), 'cast for the enemy on 3-1');
    const tc = h.b.time;
    assert.deepEqual(u.liveRangeGrid, formOf(elite).rangeGrid, 'the card keeps 3-6');
    h.run(0.5);
    const atk = h.hooksOf('attack').filter((c) => c.attacker === u);
    approx(atk[0].t, tc, '立即', 0.04);
    assert.equal(atk[0].isSkill, true);
    const dodged = h.hooksOf('dodge').filter((c) => c.source === u);
    const hits = from(h, u);
    assert.equal(dodged.length, 1, 'the 普通伤害 hit can be dodged (a dodge enemy)');
    assert.equal(hits.length, 2, 'the two 持续伤害 hits cannot');
    for (const c of hits) {
      approx(c.amount, u.s.atk * sk.bb.atk_scale, `×${sk.bb.atk_scale}`);
      assert.deepEqual([c.dmg.isAttack, c.dmg.canDodge, c.dmg.tags.includes('dot'), c.type], [false, false, true, 'phys']);
    }
    assert.equal(u.skill.charges, 1, 'one of two charges spent');
    h.b.removeBuff(e, 'test:dodge');
    const n0 = from(h, u).length;
    h.run(3.5);
    const second = from(h, u).slice(n0).filter((c) => c.dmg.isSkill);
    assert.deepEqual(second.map((c) => [c.dmg.isAttack, c.dmg.tags.includes('dot')]), [[true, false], [false, true], [false, true]], 'the second charge 3 s later: 普通 then 2 × 持续');
    done(h);
  }
});

test('S3 锐笔速写 (MANUAL, data ACTIVE_RANGE on 3-1): an enemy only on [0,3] casts it; range 3-1 (and back), interval 1.6 − 0.6 s, ×155 % / 170 % off her line, ×185 % / 215 % on the 正前方3格', () => {
  for (const elite of [false, true]) {
    const sk = skillOf(elite, S3);
    assert.deepEqual([sk.duration, sk.bb.base_attack_time, sk.bb.atk_scale, sk.bb['bgsnow_s_3[atk_up].atk_scale'], sk.rangeId], elite ? [27, -0.6, 1.7, 2.15, '3-1'] : [26, -0.6, 1.55, 1.85, '3-1'], elite ? 'elite' : 'normal');
    const { h, u } = field({ elite, skill: 2, seed: 7 });
    assert.deepEqual([u.skill.kind, u.skill.rule], ['duration', 'ACTIVE_RANGE']);
    u.skill.gainSp(999);
    const far = h.spawn('enemy_dummy', { pos: [10, 8] });
    assert.ok(h.runUntil(() => u.skill.active, 1), 'cast for [0,3] (outside 3-6)');
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, '3-1 while it runs');
    approx(u.s.interval, 1.0, 'interval');
    const side = h.spawn('enemy_dummy', { pos: [11, 7] });
    h.b.kill(far, null);
    const front = h.spawn('enemy_dummy', { pos: [10, 7] });
    h.run(8);
    const onFront = from(h, u).filter((c) => c.dmg.isAttack && c.target === front);
    h.b.kill(front, null);
    h.run(4);
    const onSide2 = from(h, u).filter((c) => c.dmg.isAttack && c.target === side);
    assert.ok(onFront.length > 3 && onSide2.length > 1, `both struck (${onFront.length} / ${onSide2.length})`);
    for (const c of onFront) approx(c.amount, u.base.atk * sk.bb['bgsnow_s_3[atk_up].atk_scale'], '正前方3格');
    for (const c of onSide2) approx(c.amount, u.base.atk * sk.bb.atk_scale, 'off the line');
    u.skill.extend(-999);
    h.step(2);
    assert.deepEqual(u.liveRangeGrid, formOf(elite).rangeGrid, 'back to 3-6');
    approx(u.s.interval, 1.6, 'interval back');
    done(h);
  }
});

test('ARC-Y 打字机色带 trait: ×105 % and no dodge on her straight line ahead (stage 1) — 点题\'s 持续伤害 hits too; off the line it dodges; ARC-X / no module nothing', () => {
  for (const f of FORMS_ALL) {
    const [elite, mod] = f;
    const y = mod === Y;
    const { h, u } = field({ elite, mod, skill: 1, seed: 3 });
    u.skill.charges = 0; u.skill.sp = 0;
    h.b.addBuff(u, { key: 'test:noSp', flags: { noSp: true } });
    const front = h.spawn('enemy_dummy', { pos: [10, 7] });
    const side = h.spawn('enemy_dummy', { pos: [11, 7] });
    for (const e of [front, side]) h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    h.run(12);
    const onFront = from(h, u).filter((c) => c.target === front);
    if (y) {
      assert.ok(onFront.length > 4, `${label(f)}: the front enemy is hit`);
      for (const c of onFront) approx(c.amount, u.s.atk * 1.05, `${label(f)}: ×1.05`);
      // 点题 on the front enemy: all three hits ×1.05
      h.b.removeBuff(u, 'test:noSp');
      u.skill.addCharge(1);
      const n0 = from(h, u).length;
      h.run(0.5);
      const s2 = from(h, u).slice(n0).filter((c) => c.dmg.isSkill);
      assert.equal(s2.length, 3, `${label(f)}: 点题's three hits land`);
      for (const c of s2) approx(c.amount, u.s.atk * skillOf(elite, S2).bb.atk_scale * 1.05, `${label(f)}: 点题 ×1.05`);
      h.b.kill(front, null);
      h.run(6);
      assert.ok(h.hooksOf('dodge').filter((c) => c.source === u && c.target === side).length > 2, `${label(f)}: off the line it dodges`);
    } else {
      assert.equal(onFront.length, 0, `${label(f)}: every attack dodged`);
    }
    done(h);
  }
});

test('“打字机”: her placed piece runs its kit (not the generic one) — the variant\'s stats, untargetable, 3-2, blocks 0, hits air; deploys with the board, leaves after 25 s, back on its tile after 40 s (S2: ×65 % / ×60 %) for 5 DP, never while 鸿雪 is down', () => {
  for (const f of FORMS_ALL) {
    const [elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const v = tokOf(elite, skill, mod);
      const { h, t } = field({ elite, mod, skill, tok: [12, 3], tokFirst: skill === 1 });
      assert.ok(t && t.alive && t.deployed, `${label(f)} S${skill + 1}: deployed with the board`);
      assert.deepEqual([!!t.kit.generic, t.skill.id, t.base.atk, t.base.maxHp, t.base.respawnTime, t.base.cost], [false, v.skill.skillId, v.stats.atk, v.stats.maxHp, 40, 5], `${label(f)} S${skill + 1}`);
      assert.deepEqual([!!t.s.flags.untargetable, t.s.blockCnt, t.profile.canHitFly, t.profile.attack, t.liveRangeGrid], [true, 0, true, 'ranged', [[0, 0], [0, 1], [0, 2], [0, 3]]], `${label(f)} S${skill + 1}: 不会受到攻击`);
      done(h);
    }
  }
  // the ARC modules carry the typewriter's stats of the data (module stage 1: the same stats on both)
  assert.deepEqual([tokOf(false, 0, NONE).stats.atk, tokOf(true, 0, NONE).stats.atk, tokOf(true, 0, Y).stats.atk, tokOf(true, 0, X).stats.atk], [666, 799, 799, 799]);
  // life and redeploys (S1: 40 s; S2: ×respawn_time)
  for (const [elite, skill, mul] of [[false, 0, 1], [false, 1, 0.65], [true, 1, 0.6]]) {
    const { h, u, t } = field({ elite, skill, tok: [12, 3] });
    h.b.players[0].dp = 20;
    assert.ok(h.runUntil(() => !t.alive, 26));
    approx(h.b.time, 25, `${elite ? 'elite' : 'normal'} S${skill + 1}: 25 s`, 0.05);
    assert.equal(h.hooksOf('death').find((c) => c.unit === t).reason, 'expired');
    assert.ok(h.runUntil(() => t.alive, 60));
    approx(h.b.time, 25 + 40 * mul, `${elite ? 'elite' : 'normal'} S${skill + 1}: back after ${40 * mul} s`, 0.3);
    assert.deepEqual([t.tileR, t.tileC, h.b.players[0].dp], [12, 3, 15], `${elite ? 'elite' : 'normal'} S${skill + 1}: on its tile, 5 DP`);
    assert.ok(u.alive);
    done(h);
  }
  // 鸿雪 down: the typewriter waits for her
  const { h, u, t } = field({ elite: false, skill: 0, tok: [12, 3] });
  h.b.players[0].dp = 0;
  h.run(10);
  h.b.kill(u, null);
  h.run(60);
  assert.ok(!t.alive, 'not while 鸿雪 is down');
  h.b.players[0].dp = 25;
  assert.ok(h.runUntil(() => u.alive, 30), '鸿雪 back');
  assert.ok(h.runUntil(() => t.alive, 1), 'then the typewriter');
  done(h);
});

test('“打字机”\'s skill is the copy of hers, free once per deployment: S1 ATK +35 % / +50 % for good with the 30 % proc, S2 three hits of ×180 % / ×200 % (普通 + 2 × 持续), S3 4-1 + interval −0.6 s + ×185 % / ×215 % for 16 / 17 s', () => {
  for (const elite of [false, true]) {
    for (const skill of [0, 1, 2]) {
      const v = tokOf(elite, skill, NONE);
      const tb = v.skill.bb;
      const { h, t } = field({ elite, skill, tok: [11, 5], seed: 4 });
      h.spawn('enemy_dummy', { pos: [11, 7] });
      assert.deepEqual([t.skill.rule, t.skill.spCost, t.skill.charges], ['DEFAULT', 0, 1], `${elite ? 'elite' : 'normal'} S${skill + 1}: free, ready`);
      assert.ok(h.runUntil(() => t.skill.activations === 1, 1), `${elite ? 'elite' : 'normal'} S${skill + 1}: cast at its first attack`);
      if (skill === 0) {
        approx(t.s.atk, t.base.atk * (1 + tb.atk), 'S1 copy ATK');
        h.run(20);
        assert.ok(t.skill.active, 'S1 copy stays');
        const hits = from(h, t);
        const atk = t.base.atk * (1 + tb.atk);
        assert.ok(hits.some((c) => Math.abs(c.amount - atk * tb.atk_scale) < 1e-6) && hits.some((c) => Math.abs(c.amount - atk) < 1e-6), `S1 copy procs ×${tb.atk_scale}`);
      } else if (skill === 1) {
        h.run(0.5);
        const s2 = from(h, t).filter((c) => c.dmg.isSkill);
        assert.deepEqual(s2.map((c) => [c.dmg.isAttack, c.dmg.tags.includes('dot')]), [[true, false], [false, true], [false, true]], 'S2 copy');
        for (const c of s2) approx(c.amount, t.base.atk * tb.atk_scale, `S2 copy ×${tb.atk_scale}`);
      } else {
        assert.deepEqual(t.liveRangeGrid, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], 'S3 copy 4-1');
        approx(t.s.interval, 1.0, 'S3 copy interval');
        approx(t.skill.timeLeft, v.skill.duration, `${v.skill.duration} s`, 0.05);
        h.run(3);
        for (const c of from(h, t).filter((x) => x.dmg.isSkill)) approx(c.amount, t.base.atk * tb['attack@atk_scale'], 'S3 copy scale');
      }
      h.run(24);
      assert.equal(t.skill.activations, 1, `${elite ? 'elite' : 'normal'} S${skill + 1}: once per deployment`);
      done(h);
    }
  }
});

test('弱点速记: every damage of the typewriter cuts the target\'s DEF 20 % for 5 s, 25 % on one of the 4 tiles next to 鸿雪 (not diagonal); 鸿雪 down ⇒ the base cut', () => {
  for (const f of FORMS_ALL) {
    const [elite, mod] = f;
    const tal = tokOf(elite, 2, mod).talents.find((x) => x && x.bb.duration);
    const c1 = -tal.bb['bgsnow_token[def_down]_1.def'], c2 = -tal.bb['bgsnow_token[def_down]_2.def'];
    assert.deepEqual([c1, c2, tal.bb.duration], [0.2, 0.25, 5], label(f));
    // 周围四格 (non-diagonal) — the 周围八格 upgrade is ARC-X stage 3, which her tier-4 chess never reaches
    for (const [tile, near] of [[[11, 5], true], [[11, 4], false], [[12, 3], false]]) {
      const { h, u, t } = field({ elite, mod, skill: 0, tok: tile, seed: 2 });
      h.spawn('enemy_dummy', { pos: [tile[0], tile[1] + 2] });
      h.run(4);
      const cuts = h.hooksOf('statusApplied').filter((c) => c.source === t && c.status === 'defDown');
      assert.ok(cuts.length >= 2, `${label(f)} ${tile}: cuts`);
      for (const c of cuts) assert.deepEqual([c.value, c.duration], [near ? c2 : c1, 5], `${label(f)} ${tile}: ${near ? 'near' : 'apart'}`);
      if (near) {
        h.b.kill(u, null);
        h.run(3);
        const after = h.hooksOf('statusApplied').filter((c) => c.source === t && c.status === 'defDown').slice(cuts.length);
        assert.ok(after.length && after.every((c) => c.value === c1), `${label(f)}: 鸿雪 down ⇒ ${c1}`);
      }
      done(h);
    }
  }
});
