// test/pack-rhine.test.js — 六.3 莱茵生命盟约 + 谬因·并入莱茵 (the first ported content pack), and the 六.F 科研装置
// that carry its headline effect.
//
// The 盟约 comes and goes with the 内容包开关 `packRhine` (shared/packData.js; 谬因·并入莱茵 merged into it 2026-10-23): off, the bond
// is not in the match's data at all, and with either one on it is a normal 盟约 — it activates at 3 / 6 / 9 distinct
// members and, at 6, every DEPLOYED 莱茵 输出干员 gains `sharing_atk` (elite `sharing_golden_atk`) of the highest
// DEPLOYED 科研装置's base attack as flat ATK (`atkFlat`, 最终加算).
//
// The sharing itself is the source expansion's `server/sim/content/rhine.js` (六.F), which reads the live devices; the
// numbers and the exclusions are its `shared/rhineResearch.js` RHINE_BALANCE. 六.3 first implemented the share in
// `bonds/addon/rhine.js` against the device FORMULA (no devices existed yet); that file is gone, and these tests follow
// the real path — a device on the board, its base attack recomputed from the 科研层数, and the share a fraction of it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../server/match/gamedata.js';
import { normalizeMods, MOD_KEYS } from '../shared/constants.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from './helpers/battleHarness.js';
import { DATA } from './match/harness.js';
import { gainLayers } from '../server/sim/content/support/index.js';
import { RHINE_BOND, RHINE_CHARACTERS as C, RHINE_BALANCE as B, rhineAttack } from '../shared/rhineResearch.js';
import { deviceBaseAttack } from '../server/sim/content/rhine.js';

const OFF = normalizeMods(undefined);
/** The committed `data/*.json` — the ALL-PACKS-ON content the switches then strip. */
const gd = (mods) => new GameData(DATA, 'mode_multi_abyss', mods);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-6, `${msg}: expected ${b}, got ${a}`);

/** 谬因's 自选 record (data/backups.json `diy.operators`) — the 「并入莱茵」 contribution lives here. */
const aphrisBonds = (g) => g.raw.backups.diy.operators.char_4229_aphris.bonds;
/** Base (non-elite) ATK of a 缪尔赛思 in the committed data, before any bond. */
const MUL = 'chess_char_6_11_a';

// ---------------------------------------------------------------------------------------------------------------------
// the 盟约 switch (六.3)

describe('六.3 莱茵生命: the switch gates the whole 盟约', () => {
  test('all off: the 盟约 does not exist, 谬因 keeps her original bonds, no 莱茵 card lists it', () => {
    const g = gd(undefined);
    assert.ok(!g.bondIds.includes(RHINE_BOND), `${RHINE_BOND} must not be in the match at all`);
    assert.equal(g.bond(RHINE_BOND), null, 'and not addressable');
    assert.ok(!g.chessBondIds(MUL).includes(RHINE_BOND), 'and no 莱茵 card lists it');
    // 谬因 is a 自选 operator: her membership is a `packBonds` contribution, taken back out while the pack is off
    assert.deepEqual(aphrisBonds(g), ['emptyShip']);
  });

  test('the ONE Rhine switch carries the whole 盟约 (谬因·并入莱茵 merged into it, 2026-10-23)', () => {
    // 需求方 2026-10-23：谬因·并入莱茵不再是独立开关，随 莱茵生命 一起进 —— 盟约的 packId 因此是一个字符串，
    // 不再是 ['packRhine','packAphris'] 那个数组。
    const g = gd({ packRhine: true });
    assert.ok(g.bondIds.includes(RHINE_BOND), `packRhine must carry ${RHINE_BOND}`);
    assert.ok(g.bond(RHINE_BOND), 'the record resolves');
    assert.ok(g.chessBondIds(MUL).includes(RHINE_BOND), 'packRhine: the pool knows members');
    assert.ok(g.chessOfBond(RHINE_BOND).length > 0, 'packRhine: members exist');
    assert.ok(!gd({ packRelic: true }).bondIds.includes(RHINE_BOND), 'an unrelated pack opens nothing');
    assert.ok(!MOD_KEYS.includes('packAphris'), 'packAphris is no longer a switch at all');
  });

  test('谬因 is a 莱茵 member through the SAME switch, and she is a member like any other', () => {
    // 从前她是「自己那个开关」带进来的（packAphris）；现在她跟着 莱茵生命 一起进。
    assert.deepEqual(aphrisBonds(gd({ packRhine: true })), ['emptyShip', RHINE_BOND], 'packRhine carries her now');
    assert.deepEqual(aphrisBonds(gd({})), ['emptyShip'], 'with the pack off she keeps her official 盟约');
    // The members are the six official 莱茵 operators plus the four ported ones (梅尔 / 伊芙利特 / 溯光星源 / 多萝西),
    // base ids only (data.test.js's convention). 白面鸮's II-cost form is HIDDEN, so `visibleMembers` is one shorter —
    // the 9 the 盟约's own thresholds need (`tools/rhine-data.mjs` recomputes both lists from the chess that name it).
    // 多萝西 → 麦哲伦：Rhine 2026-10-14 起莱茵生命把多萝西换成了麦哲伦。
    const g = gd({ packRhine: true });
    assert.deepEqual(g.bond(RHINE_BOND).members, [
      'chess_char_2_02_a', 'chess_char_4_21_a', 'chess_char_5_11_a', 'chess_char_5_16_a', 'chess_char_6_11_a', 'chess_char_6_16_a',
      'chess_rhine_astgenne_a', 'chess_rhine_ifrit_a', 'chess_rhine_magallan_a', 'chess_rhine_mayer_a',
    ]);
    assert.equal(g.bond(RHINE_BOND).visibleMembers.length, 9, 'the 盟约 starts at 3 and caps at 9');
    assert.equal(OFF.packRhine, false, 'and the default is off');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// the 6-member ATK sharing (六.F: reads the DEPLOYED devices)

/** A minimal battle: `ops` = [uid, charId, row, col, extra], plus one 科研装置 per `devices` entry. */
function rhineBattle(ops, { devices = [{ key: 'energy' }], count = 6, layers = 10, active = true } = {}) {
  const units = ops.map(([uid, charId, row, col, extra = {}]) => ({
    uid, chessId: `${uid}_a`, charId, row, col, bonds: [RHINE_BOND], ...extra,
  }));
  const research = devices.map((d) => {
    const uid = d.uid ?? d.key;
    units.push({ uid, kind: 'token', tokenId: `token_rhine_${d.key}`, key: d.key, row: d.row ?? 12, col: d.col ?? 8, stage: d.stage ?? 0 });
    return { uid, kind: 'token', tokenId: `token_rhine_${d.key}`, key: d.key, row: d.row ?? 12, col: d.col ?? 8, stage: d.stage ?? 0, onBoard: true };
  });
  const chess = {};
  for (const u of units) {
    if (u.kind === 'token') continue;
    chess[u.chessId] = chessRec({ id: u.chessId, charId: u.charId, golden: u.elite, bonds: u.bonds,
      profession: u.profession, dmgType: u.dmgType, stats: { atk: 100, maxHp: 2000, blockCnt: 0 }, skill: null });
    // the 六.F traits are read off the chess's own garrison list (`rhine.js researchTrait`)
    chess[u.chessId].garrisonIds = u.garrisonIds ?? [];
  }
  const tokens = Object.fromEntries(['medical', 'energy', 'laser'].map((k) => [`token_rhine_${k}`, { name: k, stats: { maxHp: 100, atk: 1, blockCnt: 5 }, rangeGrid: [[0, 0]] }]));
  const players = [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units,
    bonds: { [RHINE_BOND]: { count, layers, active } }, research: { active, unlocked: true, devices: research } }];
  const h = makeBattle({ players, defs: { chess, tokens, enemies: { dummy: enemyRec({ key: 'dummy', hp: 100000, speed: 0 }) } }, kits: {} });
  h.step();
  return h;
}

/** Six 莱茵 members: 5 damage operators + 梅尔, so the sharing threshold is met. */
const SIX = [['a', C.silence, 10, 4], ['b', C.muelsyse, 9, 4], ['c', C.halo2, 11, 4],
  ['d', C.astgenne, 12, 4], ['e', C.dorothy, 9, 6], ['m', C.mayer, 12, 6]];
const atkOf = (h, uid) => h.unit(uid)?.s?.atk;
const shareOf = (h, uid) => h.unit(uid)?.findBuff('rhine:sharing')?.mods?.atkFlat ?? 0;

describe('六.F 莱茵生命: the 6-member ATK sharing reads the deployed 科研装置', () => {
  test('the device formula is the source expansion\'s base_atk + atk_per_stack · 科研层数', () => {
    assert.equal(rhineAttack(0), 300);
    assert.equal(rhineAttack(10), 340, 'live layers move it');
    assert.equal(rhineAttack(25), 400);
    // `rhineAttack` is the device's base attack at `layers`; the bond's own blackboard is the same two numbers
    const bb = gd({ packRhine: true }).bond(RHINE_BOND).bb;
    assert.deepEqual(bb, { base_atk: B.baseAttack, atk_per_stack: B.attackPerLayer, sharing_count: B.sharingCount,
      sharing_atk: B.researchSharing[0], sharing_golden_atk: B.researchSharing[1] });
    assert.equal(rhineAttack(10), bb.base_atk + bb.atk_per_stack * 10);
  });

  test('6 members: a deployed 莱茵 damage operator gains the share as atkFlat (最终加算, not a percentage)', () => {
    const h = rhineBattle(SIX);
    close(deviceBaseAttack(h.b, h.unit('energy')), 340, 'the device at 10 layers');
    close(shareOf(h, 'a'), 340 * B.researchSharing[0], '赫默');
    close(shareOf(h, 'b'), 340 * B.researchSharing[0], '缪尔赛思');
    close(atkOf(h, 'a'), h.unit('a').base.atk + 340 * B.researchSharing[0], 'the share is FLAT');
    assert.equal(h.b.errors.length, 0);
    checkInvariants(h.b);
  });

  test('5 members is not enough; 伊芙利特 / 治疗干员 / 塞雷娅 and non-members get nothing', () => {
    const five = rhineBattle(SIX, { count: 5 });
    close(shareOf(five, 'a'), 0, '5 members: no sharing');

    // 塞雷娅 has her own 六.F healing trait instead of a share, and a 治疗干员 is not a damage operator
    const h = rhineBattle([...SIX, ['s', C.saria, 9, 2, { garrisonIds: ['garrison_rhine_saria_a'] }],
      ['h', 'test_medic', 10, 2, { profession: 'MEDIC', dmgType: 'arts' }]]);
    close(shareOf(h, 's'), 0, '塞雷娅 is excluded');
    close(shareOf(h, 'h'), 0, '治疗干员 are excluded');
    // 伊芙利特 reads the device as 继承 (`rhine:ifrit`) instead — never both
    const ifrit = rhineBattle([...SIX, ['i', C.ifrit, 9, 2, { garrisonIds: ['garrison_rhine_ifrit_a'] }]]);
    close(shareOf(ifrit, 'i'), 0, '伊芙利特 takes 继承, not the share');
    assert.ok(ifrit.unit('i').findBuff('rhine:ifrit'), 'and it IS there');
  });

  test('an inactive 盟约 (tier 0) shares nothing, and live layers move the share mid-battle', () => {
    const off = rhineBattle(SIX, { active: false });
    close(shareOf(off, 'a'), 0, 'inactive');

    const h = rhineBattle(SIX, { layers: 0 });
    close(shareOf(h, 'a'), 300 * B.researchSharing[0], '0 layers');
    assert.equal(gainLayers(h.b, { playerId: 'p1', bonds: RHINE_BOND, n: 10 }), 10);
    h.step(1);
    close(shareOf(h, 'a'), 340 * B.researchSharing[0], 'the gain moves the device attack the share is a fraction of');
    checkInvariants(h.b);
  });

  test('elite members take sharing_golden_atk', () => {
    const h = rhineBattle([...SIX, ['g', C.dorothy, 10, 8, { elite: true }]]);
    close(shareOf(h, 'g'), 340 * B.researchSharing[1], '精锐 25%');
    close(shareOf(h, 'a'), 340 * B.researchSharing[0], 'and a normal member still takes 15%');
  });

  test('a 盟约 without a deployed device is inert: nothing to share and nothing throws', () => {
    const h = rhineBattle(SIX, { devices: [] });
    close(shareOf(h, 'a'), 0, 'no device on the board');
    assert.equal(h.b.errors.length, 0);
    checkInvariants(h.b);
  });
});
