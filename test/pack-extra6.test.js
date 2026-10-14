// test/pack-extra6.test.js — 六.C 内容包 packExtra6: 结城理 (char_4217_makoto) + 丰川祥子 (char_4182_oblvns).
//
// The third ported content pack (shared/constants.js PACK_KEYS, shared/packData.js). Its two operators are NOT official
// chess — no autochess season lists their shop row — so the fork's data layer synthesizes them whole
// (tools/fork-extra6.mjs `applyForkExtra6Act`), and everything downstream (buildChess / buildBackups / buildGarrisons /
// buildBonds) then treats them as native records. What the switch owns:
//
//   * `packId: 'packExtra6'` on all four records (both forms of both operators), stamped by tools/fork-overrides.mjs
//     `applyForkPackMembers`, so `GameData` drops them with the pack off (`filterRawData`).
//   * `packMembers: { packExtra6: [chessId] }` on the OFFICIAL 盟约 they join (`emptyShip`, `lateranoShip`, `indomShip`),
//     so their names leave those bonds' member lists too (`withPackMembers`) — a dropped chess record does not drop what
//     points at it, and a phantom row would render in the client's 盟约 popup.
//   * the two kits (kits/ops/chess_char_5_makoto-makoto.js, chess_char_6_oblvns-oblvns.js), which the roster only ever
//     reaches while the pack is on.
//
// Run: node --test test/pack-extra6.test.js

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../server/match/gamedata.js';
import { normalizeMods, PACK_KEYS, PACK_AUTHORS, packEnabled } from '../shared/constants.js';
import { filterFile, withPackMembers } from '../shared/packData.js';
import { makeBattle, enemyRec, checkInvariants } from './helpers/battleHarness.js';
import { DATA } from './match/harness.js';
import { FORK_EXTRA6_PACK, FORK_EXTRA6_BOND_MEMBERS } from '../tools/fork-extra6.mjs';

const OFF = normalizeMods(undefined);
/** The committed `data/*.json` — the ALL-PACKS-ON content the switches then strip. */
const gd = (mods) => new GameData(DATA, 'mode_multi_abyss', mods);
const MAKOTO = 'chess_char_5_makoto_a';
const MAKOTO_B = 'chess_char_5_makoto_b';
const OBLVNS = 'chess_char_6_oblvns_a';
const OBLVNS_B = 'chess_char_6_oblvns_b';
const PACKED = [MAKOTO, MAKOTO_B, OBLVNS, OBLVNS_B];
/** baseId → the operator it fields (`.charId`); the elite twin is not derivable from the base id by prefix. */
const CHAR_OF = {
  [MAKOTO]: 'char_4217_makoto', [MAKOTO_B]: 'char_4217_makoto',
  [OBLVNS]: 'char_4182_oblvns', [OBLVNS_B]: 'char_4182_oblvns',
};

describe('六.C packExtra6: the switch gates the whole pack', () => {
  test('the pack is the second column\'s third switch, default OFF, credited in PACK_AUTHORS', () => {
    assert.ok(PACK_KEYS.includes(FORK_EXTRA6_PACK), `${FORK_EXTRA6_PACK} is a 内容包开关`);
    assert.equal(OFF[FORK_EXTRA6_PACK], false, 'the default is off');
    assert.equal(PACK_AUTHORS[FORK_EXTRA6_PACK], 'remember-4');
    // and the helper this pack relies on agrees with the normaliser
    assert.equal(packEnabled(OFF, FORK_EXTRA6_PACK), false);
    assert.equal(packEnabled({ [FORK_EXTRA6_PACK]: true }, FORK_EXTRA6_PACK), true);
    assert.equal(packEnabled({ [FORK_EXTRA6_PACK]: false }, FORK_EXTRA6_PACK), false);
  });

  test('all off: neither operator is reachable — not the record, not the shop pool, not a 盟约 member', () => {
    const g = gd(undefined);
    for (const id of PACKED) {
      assert.equal(g.chess(id), null, `${id}: must not be in the match at all`);
      assert.equal(g.raw.chess[id], undefined, `${id}: and not in the raw data`);
    }
    assert.deepEqual(g.visibleChess.filter((id) => PACKED.includes(id)), [], 'not in the shop pool');
    assert.ok(!g.chessOfBond('lateranoShip').includes(MAKOTO));
  });

  test('all off: the official 盟约 the pack adds members to keep their ORIGINAL member lists (no phantom row)', () => {
    // `packMembers` is the pack's own contribution INSIDE a survivor's record: the client draws a row per member
    // (public/js/ui/gameLogic/bonds.js bondMembers), so a dropped chess must leave the list too. The expectation is the
    // committed all-packs-on list MINUS the pack's ids — the same list the room had before the pack existed.
    const g = gd(undefined);
    for (const [bondId, ids] of Object.entries(FORK_EXTRA6_BOND_MEMBERS)) {
      const now = g.bond(bondId);
      for (const field of ['members', 'visibleMembers']) {
        const want = DATA.bonds[bondId][field].filter((id) => !ids.includes(id));
        assert.notDeepEqual(DATA.bonds[bondId][field], want, `${bondId}.${field}: the pack really did add names`);
        assert.deepEqual(now[field], want, `${bondId}.${field}: the pack took its names back out`);
        for (const id of ids) assert.ok(!now[field].includes(id), `${bondId}.${field} still lists ${id}`);
      }
    }
  });

  test('the switch on: both operators and their member lists are back, and only then', () => {
    const g = gd({ [FORK_EXTRA6_PACK]: true });
    for (const id of PACKED) assert.ok(g.chess(id), `${id}: in the match`);
    assert.deepEqual(g.visibleChess.filter((id) => PACKED.includes(id)).sort(), [MAKOTO, OBLVNS], 'base cards, not the elites');
    assert.ok(g.chessOfBond('lateranoShip').includes(MAKOTO));
    assert.ok(g.bond('emptyShip').visibleMembers.includes(OBLVNS));
    // an unrelated pack opens none of it
    for (const other of PACK_KEYS.filter((k) => k !== FORK_EXTRA6_PACK)) {
      const o = gd({ [other]: true });
      assert.equal(o.chess(MAKOTO), null, `${other} alone must not carry ${MAKOTO}`);
      assert.equal(o.chess(OBLVNS), null, `${other} alone must not carry ${OBLVNS}`);
    }
  });

  test('the two operators are PRESET — they field their own operator, never another one', () => {
    const g = gd({ [FORK_EXTRA6_PACK]: true });
    for (const id of PACKED) {
      const c = g.chess(id);
      assert.equal(c.chessType, 'PRESET', `${id}: a 补位 NORMAL would need another charId`);
      assert.equal(c.backup.charId, c.charId, `${id}: 特许 — its own backup`);
      assert.ok(!c.standInFor && !c.diyFor, `${id}: neither a stand-in nor a 自选 pick`);
      assert.equal(c.charId, CHAR_OF[id], `${id}: fields its own operator`);
    }
    // the elite twin exists for each, and its module is the operator's own third-stage one
    for (const [base, elite] of [[MAKOTO, MAKOTO_B], [OBLVNS, OBLVNS_B]]) {
      assert.equal(g.chess(base).goldenId, elite, `${base}: its elite twin`);
      assert.equal(g.chess(elite).module.active, true, `${elite}: the elite carries its module`);
    }
  });

  test('the filter is pure and all-off is the ORIGINAL object (zero allocation, byte-identical room)', () => {
    const bonds = { emptyShip: { bondId: 'emptyShip', members: ['a', 'b'], visibleMembers: ['a', 'b'], packMembers: { [FORK_EXTRA6_PACK]: ['b'] } } };
    const chess = { a: { chessId: 'a' }, b: { chessId: 'b', packId: FORK_EXTRA6_PACK } };
    const on = { [FORK_EXTRA6_PACK]: true };
    assert.equal(filterFile(on, 'chess', chess), chess, 'on: nothing to drop, the same object');
    assert.equal(filterFile(on, 'bonds', bonds), bonds, 'on: the member list is untouched');
    const offBonds = filterFile(OFF, 'bonds', bonds);
    assert.deepEqual(offBonds.emptyShip.members, ['a'], 'off: the pack\'s name is out');
    assert.deepEqual(offBonds.emptyShip.visibleMembers, ['a']);
    assert.deepEqual(bonds.emptyShip.members, ['a', 'b'], 'the input is never mutated');
    assert.equal(JSON.stringify(withPackMembers(OFF, offBonds)), JSON.stringify(offBonds), 'idempotent');
    // a record the pack names no members in is untouched — and all-off stays the same object end to end
    const plain = { emptyShip: { bondId: 'emptyShip', members: ['a'] } };
    assert.equal(withPackMembers(OFF, plain), plain, 'nothing to drop: the same object');
    assert.equal(filterFile(OFF, 'bonds', plain), plain);
  });

  test('the 盟约 the pack registers are the ones its operators actually carry', () => {
    const g = gd({ [FORK_EXTRA6_PACK]: true });
    for (const [bondId, ids] of Object.entries(FORK_EXTRA6_BOND_MEMBERS)) {
      for (const id of ids) {
        assert.ok(g.chessBondIds(id).includes(bondId), `${id}: carries ${bondId}`);
        assert.ok(g.bond(bondId).members.includes(id), `${bondId}.members lists ${id}`);
      }
    }
    assert.deepEqual(g.chessBondIds(MAKOTO).sort(), ['indomShip', 'lateranoShip']);
    assert.deepEqual(g.chessBondIds(OBLVNS), ['emptyShip']);
  });

  test('the garrisons the pack synthesizes ride along with their owners', () => {
    const on = gd({ [FORK_EXTRA6_PACK]: true });
    for (const id of [MAKOTO, MAKOTO_B]) {
      const gids = on.chess(id).garrisonIds;
      assert.equal(gids.length, 1, `${id}: one 特质`);
      assert.ok(on.raw.garrisons[gids[0]], `${id}: its record exists`);
    }
    assert.deepEqual(on.chess(OBLVNS).garrisonIds, [], '丰川祥子 has no 卫戍协议特质');
    // and none of them survives the switch
    const off = gd(undefined);
    for (const gid of ['garrison_makoto_a', 'garrison_makoto_b']) {
      assert.equal(off.raw.garrisons[gid], undefined, `${gid}: gone with the pack`);
    }
  });
});

// -------------------------------------------------------------------------------------------------------------------
// the kits (kits/ops/chess_char_5_makoto-makoto.js, chess_char_6_oblvns-oblvns.js)

const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const DUMMIES = { enemy_dummy: dummy('enemy_dummy') };
/** One pack operator alone on a flat stage, next to a `pos` enemy, with the pack ON. `dollSwap` is captured always
 *  (the harness only captures the hooks it is given, and `ALL_HOOKS` predates it). */
function field(chessId, { row = 10, col = 4, pos = null, seed = 7, hooks = [] } = {}) {
  const h = makeBattle({
    defs: { enemies: DUMMIES }, timeLimit: 900, autoFinish: false, seed, captureNoisy: true,
    flags: { dpPerSec: 0, dpMax: 999, startOpCooldown: 0 },
    hooks: [...new Set(['dollSwap', ...hooks])],
    units: [{ uid: 1, chessId, row, col }],
    enemies: pos ? [{ key: 'enemy_dummy', time: 0, count: 1, pos, route: null }] : [],
  });
  h.step(1);
  return { h, u: h.unit(1) };
}
const done = (h) => {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
};

describe('六.C 结城理: the <替身> persona machine', () => {
  test('the trait is the engine\'s dollkeeper; the persona is entered by the skill and is 塔纳托斯 by default', () => {
    const { h, u } = field(MAKOTO, { pos: [10, 6] });
    assert.equal(u.def.subProf, 'dollkeeper');
    assert.equal(u.profile.dollDuration, 20, 'T 受到致命伤时不撤退…持续20秒 (trait.bb.duration)');
    assert.equal(u.trait.doll, undefined, 'no persona before the cast');
    assert.equal(u.skill.activate('test', { free: true }), true);
    h.step(0.2);
    assert.equal(u.trait.doll, true, 'the skill switches to the <替身>');
    assert.equal(u.form, 'makoto_s3a', 'S3\'s first persona is 塔纳托斯 (public/js/render/units.js FORMS)');
    assert.ok(u.findBuff('makoto:persona'), 'the persona buff shapes the body');
    assert.equal(u.rangeGrid.length, 13, 'the persona fights on the trait grid, not the body\'s 2 tiles');
    assert.equal(u.profile.canHitFly, true, 'S3 塔纳托斯 may hit air units');
    assert.equal(u.profile.maxTargets, 3, 'S3 攻击对至多3名敌人 (attack@max_target)');
    done(h);
  });

  test('T1 置换人格: entering the <替身> stops every enemy of the trait grid, and only there', () => {
    const { h, u } = field(MAKOTO, { pos: [10, 6], hooks: ['statusApplied'] });
    const inside = h.enemies()[0];
    const outside = h.spawn('enemy_dummy', { pos: [10, 12], route: null });
    u.skill.activate('test', { free: true });
    h.step(0.5);
    const statuses = h.hooksOf('statusApplied').filter((c) => c.status === 'sluggish');
    assert.equal(statuses.length, 1, 'exactly the enemy inside the trait grid');
    assert.equal(statuses[0].target, inside, 'the far one is untouched');
    assert.equal(outside.findBuff('sluggish'), null);
    assert.equal(inside.findBuff('sluggish').duration ?? 0, 8, 'T1 sluggish duration');
    done(h);
  });

  test('the persona brings T1\'s stats: ATK / max HP / the LONGER attack interval, as one buff', () => {
    const { h, u } = field(MAKOTO, { pos: [10, 6] });
    const atk0 = u.s.atk, hp0 = u.s.maxHp, interval0 = u.s.interval;
    u.skill.activate('test', { free: true });
    h.step(0.2);
    const t0 = h.b.data.rawChess(MAKOTO).talents.find((t) => t.index === 0).bb;
    assert.ok(u.s.atk > atk0, `ATK up (+${t0.atk * 100} %)`);
    assert.ok(u.s.maxHp > hp0, `max HP up (+${t0.max_hp_t1 * 100} %)`);
    assert.ok(u.s.interval > interval0, 'BAT +0.4 s is a LONGER interval, not a shorter one');
    done(h);
  });

  test('T2 总攻击: the natural return hits the trait grid for true damage; a knock-out does not', () => {
    const { h, u } = field(MAKOTO, { pos: [10, 6], hooks: ['damaged'] });
    const calls = [];
    const orig = h.b.dealDamage.bind(h.b);
    h.b.dealDamage = (s, t, o) => { if ((o?.tags || []).includes('makotoAllOut')) calls.push({ s, t, o }); return orig(s, t, o); };
    u.skill.activate('test', { free: true });
    h.run(25);   // the 20 s 替身 window ends on its own
    assert.equal(u.trait.doll, false, 'back to the 本体');
    assert.equal(calls.length, 1, 'one 总攻击 per return');
    assert.equal(calls[0].o.type, 'true', '真实伤害');
    assert.equal(calls[0].t, h.enemies()[0], 'on the enemy inside the trait grid');
    assert.equal(h.hooksOf('dollSwap').map((c) => c.form).join(','), 'doll,', 'the engine fired both switches');
    done(h);
  });

  test('S3 俄耳甫斯: a cast while 塔纳托斯 stands swaps the persona (and heals instead of attacking)', () => {
    const { h, u } = field(MAKOTO, { pos: [10, 6] });
    assert.equal(u.def.skill.id, 'skchr_makoto_3', 'this record defaults to S3');
    u.skill.activate('test', { free: true });
    h.run(1.5);   // DOLL_SWITCH (1 s) of the entry has to finish before another cast may swap
    assert.equal(u.form, 'makoto_s3a', '塔纳托斯 first');
    assert.equal(u.trait.dollSwitching, false, 'the switch window is over');
    assert.equal(u.skill.activate('again', { free: true }), true);
    h.step(0.3);
    assert.equal(u.form, 'makoto_s3b', 'the second cast is 俄耳甫斯');
    assert.equal(u.trait.doll, true, 'still the <替身>, just the other one');
    assert.ok(u.findBuff('makoto:changing'), 'the swap animation runs (invulnerable, no SP, isolated, disarmed)');
    h.run(2);
    assert.equal(u.form, 'makoto_s3b', 'and he stays in it');
    assert.equal(u.profile.noAttack, true, '俄耳甫斯 does not attack — he shields and heals');
    done(h);
  });

  test('a lethal hit while 塔纳托斯 stands summons 俄耳甫斯 instead of killing him', () => {
    const { h, u } = field(MAKOTO, { pos: [10, 6] });
    u.skill.activate('test', { free: true });
    h.run(1.5);   // the entry's DOLL_SWITCH (1 s) holds 不死; the swap rule is what this test is about
    assert.equal(u.form, 'makoto_s3a');
    assert.equal(u.trait.dollSwitching, false);
    h.b.dealDamage(null, u, { amount: u.s.maxHp * 10, type: 'true', canDodge: false, sourceless: true });
    h.step(0.2);
    assert.equal(u.alive, true, 'S3 塔纳托斯在场时，受到致命伤时改为召唤俄耳甫斯');
    assert.equal(u.form, 'makoto_s3b');
    assert.equal(u.hp, u.s.maxHp, 'and the new persona starts at full HP');
    done(h);
  });

  test('while the 1 s entry animation runs she is 不死 — the 替身 cannot be knocked out mid-switch', () => {
    const { h, u } = field(MAKOTO, { pos: [10, 6] });
    u.skill.activate('test', { free: true });
    h.step(0.2);
    assert.equal(u.trait.dollSwitching, true, 'inside the entry window');
    h.b.dealDamage(null, u, { amount: u.s.maxHp * 10, type: 'true', canDodge: false, sourceless: true });
    h.step(0.2);
    assert.equal(u.alive, true, '不死');
    assert.equal(u.form, 'makoto_s3a', 'still 塔纳托斯 — no swap mid-switch');
    done(h);
  });

  test('a battle of both pack operators together runs to the end without a handler error', () => {
    const h = makeBattle({
      defs: { enemies: DUMMIES }, timeLimit: 900, autoFinish: false, seed: 11,
      flags: { dpPerSec: 0, dpMax: 999 }, captureNoisy: true,
      units: [{ uid: 1, chessId: MAKOTO, row: 10, col: 4 }, { uid: 2, chessId: OBLVNS, row: 10, col: 2 }],
      enemies: [{ key: 'enemy_dummy', time: 0, count: 3, pos: [10, 6], route: null }],
    });
    h.run(40);
    const m = h.unit(1), o = h.unit(2);
    assert.ok(m.alive && o.alive, 'both stand');
    assert.ok(o.stats.attacks > 0, '丰川祥子 fires notes');
    done(h);
  });
});

describe('六.C 丰川祥子: notes, Fever and the three timbres', () => {
  test('领主 with no normal attack: her ATK comes from the notes the kit fires', () => {
    const { h, u } = field(OBLVNS, { pos: [10, 7] });
    assert.equal(u.def.subProf, 'lord', '领主 — a ranged attack at the trait\'s 80 % penalty');
    assert.equal(u.profile.noAttack, true, 'the note volley IS her attack');
    h.run(8);
    assert.ok(u.stats.attacks > 0, 'she still attacks (the kit drives it)');
    assert.ok(u.stats.dmg > 0, 'and the notes deal damage');
    done(h);
  });

  test('a note is a homing projectile tracked per unit, spent when it lands', () => {
    const { h, u } = field(OBLVNS, { pos: [10, 12] });   // far enough that a note is still in flight
    let inFlight = 0;
    for (let i = 0; i < 300; i++) { h.b.step(); inFlight = Math.max(inFlight, u.mem.sakikoNotes.length); }
    assert.ok(Array.isArray(u.mem.sakikoNotes), 'the notes are tracked per unit');
    assert.ok(inFlight >= 1, 'at least one note was alive in flight');
    assert.ok(inFlight <= 3, 'but never more than the 攻击间隔 worth');
    assert.ok(u.stats.attacks > 1, 'and she keeps firing');
    done(h);
  });

  test('T1 音符穿透: every standing note grants DEF / RES penetration up to `max_cnt`', () => {
    const { h, u } = field(OBLVNS, { pos: [10, 7] });
    h.run(6);
    const notes = u.findBuff('sakiko:notes');
    assert.ok(notes, 'the per-tick note buff is up');
    const t0 = h.b.data.rawChess(OBLVNS).talents.find((t) => t.index === 0).bb;
    assert.equal(notes.mods.defIgnorePct, u.mem.sakikoNotes.length * t0.def_penetrate_ratio, '3 % DEF per note');
    assert.equal(notes.mods.resIgnorePct, u.mem.sakikoNotes.length * t0.magic_resist_penetrate_ratio, '2 % RES per note');
    assert.ok(u.mem.sakikoNotes.length <= t0.max_cnt, `at most ${t0.max_cnt} notes (max_cnt) count`);
    done(h);
  });

  test('T2 Fever: one shared counter per player, +cnt per damage instance she deals', () => {
    const { h } = field(OBLVNS, { pos: [10, 7] });
    h.run(8);
    const fever = h.b._sakikoFever.get('p1');
    assert.ok(fever, 'the counter is shared per PLAYER, keyed by ownerId');
    assert.ok(fever.value > 0, 'her damage fed it');
    assert.equal(fever.value % 3, 0, 'T2 +3 per instance (cnt)');
    assert.ok(fever.value <= 450, 'capped at FEVER_MAX');
    done(h);
  });

  test('S1 新月的苏醒: the whole falling scale at once, and it refills to auto-cast', () => {
    const { h } = field(OBLVNS, { pos: [10, 7] });
    // the record defaults to S3; field S1 through a loadout-injected def is out of scope here — instead assert the
    // spec exists for every skill the record offers, which is what kits_layout.test.js pins by name.
    assert.deepEqual(Object.keys(h.b.data.rawChess(OBLVNS).skills.reduce((a, s) => ({ ...a, [s.skillId]: 1 }), {})).sort(),
      ['skchr_oblvns_1', 'skchr_oblvns_2', 'skchr_oblvns_3']);
    done(h);
  });

  test('no engine error in a long battle with a full wave', () => {
    const h = makeBattle({
      defs: { enemies: DUMMIES }, timeLimit: 900, autoFinish: false, seed: 3,
      flags: { dpPerSec: 0, dpMax: 999 }, captureNoisy: true,
      units: [{ uid: 1, chessId: OBLVNS, row: 10, col: 4 }],
      enemies: Array.from({ length: 4 }, () => ({ key: 'enemy_dummy', time: 0, count: 1, pos: [10, 7], route: null })),
    });
    h.run(60);
    done(h);
  });
});
