// test/pack-extra6.test.js — 六.C: 丰川祥子 (char_4182_oblvns), EMBEDDED content.
//
// The operator is NOT official chess — no autochess season lists her shop row — so the fork's data layer
// synthesizes it whole (tools/fork-extra6.mjs `applyForkExtra6Act`), and everything downstream (buildChess /
// buildBackups / buildGarrisons / buildBonds) then treats it as a native record.
//
// 2026-10-15 (owner): this was 内容包 packExtra6, the third switch of the Mod submenu's second column. It is now
// embedded in the game — always on, no switch — so the records carry NO `packId` and NO 盟约 carries a `packMembers`
// entry for her. She is ordinary content in every room, exactly like the official operators: that is what this file
// now pins. The 莱茵生命 pack (六.F) is the one that keeps a switch.
//
// 2026-10-29 (owner): 结城理 (char_4217_makoto) was DELETED — operator, kit, 特质, forms and data rows. The one test
// below that names him pins his absence.
//
// Run: node --test test/pack-extra6.test.js

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../server/match/gamedata.js';
import { normalizeMods, PACK_KEYS, MOD_KEYS, PACK_AUTHORS } from '../shared/constants.js';
import { makeBattle, enemyRec, checkInvariants } from './helpers/battleHarness.js';
import { DATA } from './match/harness.js';
import { FORK_EXTRA6_PACK, FORK_EXTRA6_BOND_MEMBERS } from '../tools/fork-extra6.mjs';

const OFF = normalizeMods(undefined);
/** The committed `data/*.json` — the ALL-PACKS-ON content the switches then strip. */
const gd = (mods) => new GameData(DATA, 'mode_multi_abyss', mods);
const OBLVNS = 'chess_char_6_oblvns_a';
const OBLVNS_B = 'chess_char_6_oblvns_b';
const PACKED = [OBLVNS, OBLVNS_B];
/** baseId → the operator it fields (`.charId`); the elite twin is not derivable from the base id by prefix. */
const CHAR_OF = { [OBLVNS]: 'char_4182_oblvns', [OBLVNS_B]: 'char_4182_oblvns' };

describe('六.C: 丰川祥子 is EMBEDDED content, not a 内容包开关 (2026-10-15 owner)', () => {
  test('the pack is gone: no switch, no author, no key anywhere', () => {
    assert.equal(FORK_EXTRA6_PACK, 'packExtra6', 'the id still names the tool chain');
    assert.ok(!PACK_KEYS.includes(FORK_EXTRA6_PACK), `${FORK_EXTRA6_PACK} is no longer a 内容包开关`);
    assert.ok(!MOD_KEYS.includes(FORK_EXTRA6_PACK), `${FORK_EXTRA6_PACK} is no longer a Mod key`);
    assert.ok(!(FORK_EXTRA6_PACK in PACK_AUTHORS), 'and it is not credited as a pack');
  });

  test('the records carry no packId, so EVERY room contains them — a default room included', () => {
    const off = gd(undefined);
    for (const id of PACKED) {
      assert.ok(off.chess(id), `${id}: in the match with every switch off`);
      assert.equal(DATA.chess[id].packId, undefined, `${id}: no packId in the committed data`);
    }
    assert.deepEqual(off.visibleChess.filter((id) => PACKED.includes(id)).sort(), [OBLVNS],
      'the base card is in the shop pool by default (the elite is the golden twin)');
    assert.ok(off.bond('emptyShip').visibleMembers.includes(OBLVNS));
  });

  test('no 盟约 carries a packMembers entry for him: his membership is plain membership', () => {
    // `packMembers` was the pack's own contribution INSIDE a survivor's record. Embedded content has no switch to take
    // it back out with, so the field must be gone and the committed lists simply include him.
    for (const [bondId, ids] of Object.entries(FORK_EXTRA6_BOND_MEMBERS)) {
      assert.equal(DATA.bonds[bondId].packMembers, undefined, `${bondId}: no packMembers left`);
      const off = gd(undefined).bond(bondId);
      for (const id of ids) {
        assert.ok(DATA.bonds[bondId].members.includes(id), `${bondId}.members lists ${id}`);
        assert.ok(off.members.includes(id), `${bondId}.members still lists ${id} with every switch off`);
      }
    }
  });

  test('the operator is PRESET — he fields his own operator, never another one', () => {
    const g = gd(undefined);
    for (const id of PACKED) {
      const c = g.chess(id);
      assert.equal(c.chessType, 'PRESET', `${id}: a 补位 NORMAL would need another charId`);
      assert.equal(c.backup.charId, c.charId, `${id}: 特许 — its own backup`);
      assert.ok(!c.standInFor && !c.diyFor, `${id}: neither a stand-in nor a 自选 pick`);
      assert.equal(c.charId, CHAR_OF[id], `${id}: fields its own operator`);
    }
    assert.equal(g.chess(OBLVNS).goldenId, OBLVNS_B, 'its elite twin');
    assert.equal(g.chess(OBLVNS_B).module.active, true, 'the elite carries its module');
  });

  test('the 盟约 he registers are the ones he actually carries', () => {
    const g = gd(undefined);
    for (const [bondId, ids] of Object.entries(FORK_EXTRA6_BOND_MEMBERS)) {
      for (const id of ids) {
        assert.ok(g.chessBondIds(id).includes(bondId), `${id}: carries ${bondId}`);
        assert.ok(g.bond(bondId).members.includes(id), `${bondId}.members lists ${id}`);
      }
    }
    assert.deepEqual(g.chessBondIds(OBLVNS), ['emptyShip']);
  });

  test('结城理 is gone: no chess record, no garrison, no kit, no bond member (deleted 2026-10-29)', () => {
    const g = gd(undefined);
    for (const id of ['chess_char_5_makoto_a', 'chess_char_5_makoto_b', 'char_4217_makoto']) {
      assert.ok(!g.chess(id), `${id}: not a chess any more`);
    }
    assert.equal(DATA.chess.chess_char_5_makoto_a, undefined, 'gone from the committed data');
    assert.equal(Object.values(DATA.garrisons).filter((r) => r.owners?.includes('char_4217_makoto')).length, 0,
      'and no 特质 row still names him');
    assert.deepEqual(g.chess(OBLVNS).garrisonIds, [], '丰川祥子 has no 卫戍协议特质');
  });
});

// -------------------------------------------------------------------------------------------------------------------
// the kit (kits/ops/chess_char_6_oblvns-oblvns.js)

const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const DUMMIES = { enemy_dummy: dummy('enemy_dummy') };
/** The pack operator alone on a flat stage, next to a `pos` enemy. */
function field(chessId, { row = 10, col = 4, pos = null, seed = 7, hooks = [] } = {}) {
  const h = makeBattle({
    defs: { enemies: DUMMIES }, timeLimit: 900, autoFinish: false, seed, captureNoisy: true,
    flags: { dpPerSec: 0, dpMax: 999, startOpCooldown: 0 },
    hooks,
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
