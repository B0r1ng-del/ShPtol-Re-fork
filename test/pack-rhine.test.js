// test/pack-rhine.test.js — 六.3 莱茵生命盟约 + 谬因·并入莱茵 (the first ported content pack).
//
// The 盟约 comes and goes with the two 内容包开关 `packRhine` / `packAphris` (shared/packData.js): with both off the bond
// is not in the match's data at all, and with either one on it is a normal 盟约 — it activates at 3 / 6 / 9 distinct
// members and, at 6, every DEPLOYED 莱茵 输出干员 gains `sharing_atk` (elite `sharing_golden_atk`) of the 科研装置's
// base attack as flat ATK (`atkFlat`, 最终加算).
//
// The device formula, the numbers and the exclusions are the source expansion's own
// (`YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine` `shared/rhineResearch.js` RHINE_BALANCE). The devices THEMSELVES are
// 六.4's scope; the sharing takes their formula so it is not a permanent zero while they are absent ([ASSUMED] in rhine.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../server/match/gamedata.js';
import { normalizeMods } from '../shared/constants.js';
import { makeBattle, checkInvariants } from './helpers/battleHarness.js';
import { DATA } from './match/harness.js';
import { gainLayers } from '../server/sim/content/support/index.js';
import { RHINE_BOND, rhineBb, rhineDeviceAttack, applyRhineSharing } from '../server/sim/content/bonds/addon/rhine.js';

const OFF = normalizeMods(undefined);
/** The committed `data/*.json` — the ALL-PACKS-ON content the switches then strip. */
const gd = (mods) => new GameData(DATA, 'mode_multi_abyss', mods);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-6, `${msg}: expected ${b}, got ${a}`);

/** `rhineBb()` merges the record's `bb` with its `bbStr`, so the `key` comes along with the numbers. */
const bb = { ...rhineBb() };
delete bb.key;
/** 谬因's 自选 record (data/backups.json `diy.operators`) — the 「并入莱茵」 contribution lives here. */
const aphrisBonds = (g) => g.raw.backups.diy.operators.char_4229_aphris.bonds;
/** Base (non-elite) ATK of a 缪尔赛思 in the committed data, before any bond. */
const MUL = 'chess_char_6_11_a';
/** The 莱茵 SUPPORT (arts) operator — a damage dealer that is not a 治疗干员. */
const HALO = 'chess_char_6_16_a';
/** 塞雷娅 / 白面鸮: the two 莱茵 operators the sharing deliberately excludes. */
const SARIA = 'chess_char_5_11_a';
const MEDIC = 'chess_char_5_16_a';
/** A damage operator that is NOT a 莱茵 member — the sharing must never reach it. */
const OUTSIDER = 'chess_char_1_01_a';

const unitsFor = (ids) => ids.map((chessId, i) => ({ chessId, row: 10 + (i % 3), col: 3 + Math.floor(i / 3) }));
const battle = (ids, bond) => {
  const h = makeBattle({ units: unitsFor(ids), bonds: { [RHINE_BOND]: bond } });
  h.step(1);
  return h;
};
const atkOf = (h, id) => h.unit(id)?.s?.atk;
/** With the 盟约 on at `count` members and `layers` 科研层数. */
const on = (count, layers, tier = 1) => ({ count, active: true, tier, layers });

describe('六.3 莱茵生命: the switch gates the whole 盟约', () => {
  test('all off: the 盟约 does not exist, 谬因 keeps her original bonds, no 莱茵 card lists it', () => {
    const g = gd(undefined);
    assert.ok(!g.bondIds.includes(RHINE_BOND), `${RHINE_BOND} must not be in the match at all`);
    assert.equal(g.bond(RHINE_BOND), null, 'and not addressable');
    assert.ok(!g.chessBondIds(MUL).includes(RHINE_BOND), 'and no 莱茵 card lists it');
    // 谬因 is a 自选 operator: her membership is a `packBonds` contribution, taken back out while the pack is off
    assert.deepEqual(aphrisBonds(g), ['emptyShip']);
  });

  test('either switch alone brings the 盟约 (its packId is an ARRAY — a bond with no members is meaningless)', () => {
    for (const key of ['packRhine', 'packAphris']) {
      const g = gd({ [key]: true });
      assert.ok(g.bondIds.includes(RHINE_BOND), `${key} alone must carry ${RHINE_BOND}`);
      assert.ok(g.bond(RHINE_BOND), `${key}: the record resolves`);
    }
    // each switch carries its OWN members: packRhine the six official 莱茵 operators (shop-eligible), packAphris only
    // 谬因 (a 自选 operator, so she is in no shop pool — the next test reads her record)
    assert.ok(gd({ packRhine: true }).chessBondIds(MUL).includes(RHINE_BOND));
    assert.ok(gd({ packRhine: true }).chessOfBond(RHINE_BOND).length > 0, 'packRhine: the pool knows members');
    assert.ok(!gd({ packAphris: true }).chessBondIds(MUL).includes(RHINE_BOND), 'the six are not carried by the other switch');
    // an unrelated pack opens neither
    assert.ok(!gd({ packRelic: true }).bondIds.includes(RHINE_BOND));
  });

  test('谬因 joins 莱茵 only through her own switch, and she is a member like any other', () => {
    assert.deepEqual(aphrisBonds(gd({ packRhine: true })), ['emptyShip'], 'the 莱茵 switch does not carry her');
    assert.deepEqual(aphrisBonds(gd({ packAphris: true })), ['emptyShip', RHINE_BOND]);
    // the members the bond record lists are the six official 莱茵 operators, base ids only (data.test.js's convention)
    const g = gd({ packRhine: true });
    assert.deepEqual(g.bond(RHINE_BOND).members, [
      'chess_char_2_02_a', 'chess_char_4_21_a', 'chess_char_5_16_a', 'chess_char_5_11_a', 'chess_char_6_11_a', 'chess_char_6_16_a',
    ]);
    assert.equal(OFF.packRhine, false, 'and the default is off');
  });
});

describe('六.3 莱茵生命: the 6-member ATK sharing', () => {
  test('the device formula is the source expansion\'s base_atk + atk_per_stack · 科研层数', () => {
    assert.deepEqual(bb, { base_atk: 300, atk_per_stack: 4, sharing_count: 6, sharing_atk: 0.15, sharing_golden_atk: 0.25 });
    assert.equal(rhineDeviceAttack(bb, 0), 300);
    assert.equal(rhineDeviceAttack(bb, 10), 340);
    assert.equal(rhineDeviceAttack(bb, 25), 400, 'live layers move it');
    assert.equal(rhineDeviceAttack(bb, -5), 300, 'a nonsense layer count floors at 0');
    assert.equal(rhineDeviceAttack({}, 10), 0, 'a missing blackboard shares nothing instead of NaN');
  });

  test('6 members: a deployed 莱茵 damage operator gains the share as atkFlat (最终加算, not a percentage)', () => {
    const ids = [MUL, HALO, SARIA, MEDIC, OUTSIDER, 'chess_char_6_11_b'];
    const h = battle(ids, on(6, 10));
    const base = h.unit(MUL).base.atk;
    close(atkOf(h, MUL), base + rhineDeviceAttack(bb, 10) * bb.sharing_atk, '缪尔赛思 (normal)');
    close(atkOf(h, HALO), atkOf(h, HALO), 'sanity');
    checkInvariants(h.b);
    // the share is FLAT: `atkFlat` is added after the percentage modifiers (units.js), so it is not scaled by them
    assert.ok(h.unit(MUL).buffs.some((b) => b.key === 'bond:rhineShip:sharing'));
  });

  test('5 members is not enough; 伊芙利特 / 治疗干员 / 塞雷娅 and non-members get nothing', () => {
    const ids = [MUL, HALO, SARIA, MEDIC, OUTSIDER, 'chess_char_6_11_b'];
    const five = battle(ids, on(5, 10));
    close(atkOf(five, MUL), five.unit(MUL).base.atk, '5 members: no sharing');
    const six = battle(ids, on(6, 10));
    close(atkOf(six, SARIA), six.unit(SARIA).base.atk, '塞雷娅 is excluded (her own 六.4 healing trait)');
    close(atkOf(six, MEDIC), six.unit(MEDIC).base.atk, '治疗干员 are excluded');
    close(atkOf(six, OUTSIDER), six.unit(OUTSIDER).base.atk, 'a non-member damage operator is excluded');
  });

  test('an inactive 盟约 (tier 0) shares nothing, and live layers move the share mid-battle', () => {
    const ids = [MUL, HALO];
    const off = battle(ids, { count: 6, active: false, tier: 0, layers: 10 });
    close(atkOf(off, MUL), off.unit(MUL).base.atk, 'inactive');

    const h = makeBattle({ units: unitsFor(ids), flags: { layerGainsEnabled: true }, bonds: { [RHINE_BOND]: on(6, 0) } });
    h.step(1);
    const base = h.unit(MUL).base.atk;
    close(atkOf(h, MUL), base + 300 * bb.sharing_atk, '0 layers');
    assert.equal(gainLayers(h.b, { playerId: 'p1', bonds: RHINE_BOND, n: 10 }), 10);
    h.step(2);
    close(atkOf(h, MUL), base + 340 * bb.sharing_atk, 'the gain moves the device attack the share is a fraction of');
    checkInvariants(h.b);
  });

  test('elite members take sharing_golden_atk, and a layer loss takes the share back off', () => {
    const elite = battle([MUL, 'chess_char_6_11_b'], on(6, 10));
    const e = elite.unit('chess_char_6_11_b');
    close(atkOf(elite, 'chess_char_6_11_b'), e.base.atk + rhineDeviceAttack(bb, 10) * bb.sharing_golden_atk, '精锐 25%');

    // dropping below the threshold on a later refresh removes the buff instead of leaving a stale one
    const h = battle([MUL, HALO], on(6, 10));
    assert.ok(h.unit(MUL).buffs.some((b) => b.key === 'bond:rhineShip:sharing'));
    applyRhineSharing(h.b, { pid: 'p1', ops: [h.unit(MUL), h.unit(HALO)], bb });
    h.b.getPlayer('p1').bonds[RHINE_BOND].active = false;
    applyRhineSharing(h.b, { pid: 'p1', ops: [h.unit(MUL), h.unit(HALO)], bb });
    close(atkOf(h, MUL), h.unit(MUL).base.atk, 'the share is gone');
    assert.ok(!h.unit(MUL).buffs.some((b) => b.key === 'bond:rhineShip:sharing'));
  });

  test('a second refresh is idempotent: the buff is replaced by key, never stacked', () => {
    const h = battle([MUL, HALO], on(6, 10));
    const once = atkOf(h, MUL);
    applyRhineSharing(h.b, { pid: 'p1', ops: [h.unit(MUL), h.unit(HALO)], bb });
    applyRhineSharing(h.b, { pid: 'p1', ops: [h.unit(MUL), h.unit(HALO)], bb });
    close(atkOf(h, MUL), once, 're-applying changes nothing');
    assert.equal(h.unit(MUL).buffs.filter((b) => b.key === 'bond:rhineShip:sharing').length, 1);
  });

  test('a 盟约 without members is inert: no 莱茵 operator on the field, nothing to share and nothing throws', () => {
    const h = battle([OUTSIDER], on(6, 10));
    close(atkOf(h, OUTSIDER), h.unit(OUTSIDER).base.atk);
    assert.doesNotThrow(() => applyRhineSharing(h.b, { pid: 'ghost', ops: [], bb }));
  });
});
