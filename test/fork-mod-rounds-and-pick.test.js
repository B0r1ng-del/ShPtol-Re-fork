// test/fork-mod-rounds-and-pick.test.js — the two Mod 开关 of 2026-10-13 (requirement 三 + 四, one PR):
//
//   extraRounds  额外 4 回合 — 「开启时：无论单人、同盟、终极模拟，回合数都由 14 回合变为 18 回合。新增的 4 回合皆为普通回合，
//                              即不是 Boss 回合。关闭时：恢复原版 14 回合。」
//   targetedPick 定向甄选   — 「开启时：三个相同干员合为进阶干员时，奖励的高阶干员三选一阶段，三个干员的刷新机制改为：从当前
//                              已激活最高层数的盟约旗下的干员中随机。要求：关闭时保持原版刷新机制。」
//
// Both are OFF by default, so a room created without them — every golden scenario, every existing test — is unchanged.
//
// The round rule the owner chose (asked directly): the boss moves LATER rather than the run continuing past it, so
// 「14 → 18」 means the boss round itself becomes 18 and the four inserted rounds are ordinary ones before it. The
// inserted rounds reuse the mode's LAST ORDINARY round table (its battlefield, prep time, timers) rather than a new
// generated table: they are the game's own last normal round, and nothing downstream has to learn about them.
//
// Setup facts this suite depends on (all measured, see the comments): 盟约 membership counts DISTINCT base ids, so three
// copies of one operator count as 1; and a bond activates at its `thresholds` count — 炎 at 3 members on the board.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../server/match/gamedata.js';
import { computeBonds } from '../server/match/bondsMeta.js';
import { MOD_KEYS, MOD_DEFAULTS, MOD_EXTRA_ROUNDS } from '../shared/constants.js';
import { DATA, makeMatch } from './match/harness.js';

const gd = (modeId, mods) => new GameData(DATA, modeId, mods);
const MODES = ['mode_single_abyss', 'mode_multi_abyss', 'mode_ultimate_abyss'];

/** Deploy `n` DIFFERENT members of `bondId` on their OWN free tiles (a second move onto the same tile replaces it). */
function deployDistinct(m, ps, bondId, n) {
  const byBase = new Map();
  for (const id of m.gd.chessOfBond(bondId)) {
    const c = m.gd.chess(id);
    if (!c || c.tier > 3) continue;
    const base = m.gd.baseIdOf(id);
    if (!byBase.has(base)) byBase.set(base, id);
  }
  const used = new Set();
  for (const [, id] of byBase) {
    if (used.size >= n) break;
    const piece = ps.acquireChess(id, { source: 'grant' });
    if (!piece) continue;
    const tile = [...ps.deployMap()].find(([k, v]) => v && !used.has(k));
    if (!tile) break;
    const [row, col] = tile[0].split(',').map(Number);
    ps.move(piece.uid, { area: 'board', row, col });
    if (ps.board.has(tile[0])) used.add(tile[0]);
  }
  return used.size;
}

/** A coop player with 炎 ACTIVE (3 distinct members on the board) and layers, ready for a promotion reward. */
function activeYan(mods, { seed = 3, level = 5 } = {}) {
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, seed, fake: true, mods }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.funds = 9999;
  ps.shop.level = level;
  const placed = deployDistinct(h.m, ps, 'yanShip', 3);
  ps.layers.yanShip = 30;
  ps.layers.swiftShip = 1;
  const bonds = computeBonds(h.m.gd, ps);
  return { h, m: h.m, ps, bonds, yan: bonds.yanShip || {}, placed };
}

describe('额外 4 回合 — the catalogue entry and its defaults', () => {
  test('both new switches are in MOD_KEYS, listed exactly, and default OFF', () => {
    assert.ok(MOD_KEYS.includes('extraRounds'), 'extraRounds is a catalogue key');
    assert.ok(MOD_KEYS.includes('targetedPick'), 'targetedPick is a catalogue key');
    assert.equal(MOD_DEFAULTS.extraRounds, false);
    assert.equal(MOD_DEFAULTS.targetedPick, false);
    assert.equal(Object.keys(MOD_DEFAULTS).length, MOD_KEYS.length, 'defaults cover exactly the catalogue');
    assert.equal(MOD_EXTRA_ROUNDS, 4);
  });

  test('MOD_ROWS offers both, with label + tip msgids', async () => {
    const { MOD_ROWS } = await import('../public/js/ui/mods.js');
    const byKey = new Map(MOD_ROWS.map((r) => [r.key, r]));
    for (const k of ['extraRounds', 'targetedPick']) {
      assert.ok(byKey.has(k), `MOD_ROWS has a row for ${k}`);
      assert.ok(byKey.get(k).label && byKey.get(k).tip, `${k} has a label and a tip`);
    }
    // every catalogue key has a row and vice versa
    assert.deepEqual(MOD_ROWS.map((r) => r.key).sort(), [...MOD_KEYS].sort());
  });
});

describe('额外 4 回合 — 14 → 18 rounds, the four new ones ordinary', () => {
  for (const modeId of MODES) {
    test(`${modeId}: last/boss/hidden move by exactly ${MOD_EXTRA_ROUNDS}, and the inserted rounds are ordinary`, () => {
      const off = gd(modeId);
      const on = gd(modeId, { extraRounds: true });
      assert.equal(off.extraRounds, 0, 'off by default');
      assert.equal(on.extraRounds, MOD_EXTRA_ROUNDS);
      assert.equal(on.lastRound, off.lastRound + MOD_EXTRA_ROUNDS);
      assert.equal(on.bossRound, off.bossRound + MOD_EXTRA_ROUNDS);
      assert.equal(on.lastRound, 18, 'the owner asked for 18');
      assert.equal(on.bossRound, 18, 'the boss IS round 18 — it moved rather than the run continuing past it');
      assert.equal(off.hiddenRound == null ? on.hiddenRound == null : on.hiddenRound === off.hiddenRound + MOD_EXTRA_ROUNDS, true,
        'the hidden core moves with it (or this mode has none)');
      // the four inserted rounds are ordinary and read a real table
      for (let r = off.lastRound; r < on.bossRound; r++) {
        const c = on.roundCfg(r);
        assert.ok(c, `round ${r} has a table`);
        assert.equal(c.isBoss, false, `round ${r} is not a boss round`);
        assert.equal(c.isHidden, false, `round ${r} is not the hidden core`);
      }
      // the boss and the hidden core are still themselves at their new numbers
      assert.equal(on.roundCfg(on.bossRound).isBoss, true, `round ${on.bossRound} is the boss`);
      if (on.hiddenRound != null) assert.equal(on.roundCfg(on.hiddenRound).isHidden, true, `round ${on.hiddenRound} is the hidden core`);
      // nothing before the boss changes
      for (let r = 1; r < off.lastRound; r++) {
        assert.deepEqual(on.roundCfg(r), off.roundCfg(r), `round ${r} is untouched`);
      }
    });
  }

  test('the inserted rounds reuse the mode\'s last ordinary round table', () => {
    const off = gd('mode_multi_abyss');
    const on = gd('mode_multi_abyss', { extraRounds: true });
    const lastOrdinary = off.roundCfg(off.lastRound - 1);
    for (let r = off.lastRound; r < on.bossRound; r++) {
      assert.deepEqual(on.roundCfg(r), lastOrdinary, `round ${r} is the last ordinary round's own table`);
    }
  });

  test('a real match in every mode reports 18 rounds and the boss on 18', () => {
    for (const [mode, humans] of [['solo', 1], ['coop', 2], ['ultimate', 2]]) {
      const h = makeMatch({ mode, difficulty: 'ABYSS', humans, seed: 7, fake: true, mods: { extraRounds: true } }).start();
      try {
        assert.equal(h.m.gd.lastRound, 18, `${mode}: 18 rounds`);
        assert.equal(h.m.gd.bossRound, 18, `${mode}: the boss is round 18`);
      } finally {
        h.m.dispose();
      }
      const off = makeMatch({ mode, difficulty: 'ABYSS', humans, seed: 7, fake: true }).start();
      try {
        assert.equal(off.m.gd.lastRound, 14, `${mode}: 14 rounds with the switch off (the official run)`);
      } finally {
        off.m.dispose();
      }
    }
  });
});

describe('定向甄选 — the 三选一 comes from the highest-layer active bond', () => {
  test('highestLayerActiveBond: the highest ACTIVE one wins; inactive layers do not count; ties are deterministic', () => {
    const g = gd('mode_multi_abyss');
    const bonds = { yanShip: { active: true, layers: 20 }, swiftShip: { active: true, layers: 5 }, lateranoShip: { active: false, layers: 99 } };
    assert.equal(g.highestLayerActiveBond(bonds), 'yanShip', 'an inactive bond with far more layers must not win');
    assert.equal(g.highestLayerActiveBond({}), null);
    assert.equal(g.highestLayerActiveBond(null), null);
    assert.equal(g.highestLayerActiveBond({ yanShip: { active: true } }), 'yanShip', 'a missing layer count reads as 0');
    // a tie resolves the same way whatever the object's key order is (gamedata.bondIds order)
    const a = g.highestLayerActiveBond({ swiftShip: { active: true, layers: 7 }, yanShip: { active: true, layers: 7 } });
    const b = g.highestLayerActiveBond({ yanShip: { active: true, layers: 7 }, swiftShip: { active: true, layers: 7 } });
    assert.equal(a, b, 'a tie is order-independent');
  });

  test('chessOfBond / chessBondIds: every returned operator really belongs to the bond', () => {
    const g = gd('mode_multi_abyss');
    const ops = g.chessOfBond('yanShip');
    assert.ok(ops.length > 0, '炎 has operators');
    assert.ok(ops.every((id) => g.chessBondIds(id).includes('yanShip')), 'each one lists the bond');
    assert.deepEqual(g.chessOfBond('nope'), []);
    assert.deepEqual(g.chessBondIds('nope'), []);
    // only shop-eligible operators: a hidden / golden / DIY record is not in visibleChess
    assert.ok(ops.every((id) => g.visibleChess.includes(id)));
  });

  test('ON: a promotion reward draws from the bond; at a tier the bond can fill, ALL slots do', () => {
    const a = activeYan({ targetedPick: true });
    try {
      assert.equal(a.yan.active, true, `炎 is active (count ${a.yan.count})`);
      assert.equal(a.m.gd.highestLayerActiveBond(a.bonds), 'yanShip', 'the focus band is 炎');
      const focusOps = new Set(a.m.gd.chessOfBond('yanShip'));
      // tier 5 has 3 炎 operators, so a 3-slot offer is filled entirely from the bond
      const yan5 = a.m.gd.chessOfBond('yanShip').filter((id) => a.m.gd.chess(id).tier === 5);
      assert.equal(yan5.length, 3, 'the data really has three tier-5 炎 operators');
      const ids = (a.ps.pushRewardOffer('merge', { tier: 5 })?.slots || []).map((s) => s.id);
      assert.equal(ids.length, 3, 'three slots');
      assert.ok(ids.every((id) => focusOps.has(id)), `all three come from 炎 (got ${JSON.stringify(ids)})`);
    } finally {
      a.h.m.dispose();
    }
  });

  test('ON at a tier the bond cannot fill: bond-first, and no slot comes back empty', () => {
    // 炎 has exactly ONE tier-2 operator, but a reward offer wants three DIFFERENT ones — so the offer must top up from
    // the ordinary roll rather than leaving a slot empty (a guarantee must never hand back an empty slot).
    const a = activeYan({ targetedPick: true });
    try {
      const yan2 = a.m.gd.chessOfBond('yanShip').filter((id) => a.m.gd.chess(id).tier === 2);
      assert.equal(yan2.length, 1, 'the data really has one tier-2 炎 operator');
      const ids = (a.ps.pushRewardOffer('merge', { tier: 2 })?.slots || []).map((s) => s.id);
      assert.equal(ids.length, 3, 'all three slots are filled anyway');
      assert.equal(new Set(ids).size, ids.length, 'and never the same operator twice');
      assert.ok(ids.includes(yan2[0]), 'the bond\'s own operator of that tier is offered first');
    } finally {
      a.h.m.dispose();
    }
  });

  test('OFF: the official roll, demonstrably not restricted to the bond', () => {
    const a = activeYan({});
    try {
      assert.equal(a.m.gd.mods.targetedPick, false, 'off by default');
      const focusOps = new Set(a.m.gd.chessOfBond('yanShip'));
      const ids = (a.ps.pushRewardOffer('merge', { tier: 5 })?.slots || []).map((s) => s.id);
      assert.equal(ids.length, 3, 'three slots');
      assert.ok(ids.some((id) => !focusOps.has(id)), `the off roll is not restricted (got ${JSON.stringify(ids)})`);
    } finally {
      a.h.m.dispose();
    }
  });

  test('only the promotion reward is affected: an explicit-id offer is passed through untouched', () => {
    const a = activeYan({ targetedPick: true });
    try {
      const ids = ['chess_char_2_18_a'];
      const offer = a.ps.pushRewardOffer('effect', { ids });
      assert.ok(offer, 'the offer was built');
      assert.deepEqual(offer.slots.map((s) => s.id), ids, 'an explicit list is never re-rolled');
    } finally {
      a.h.m.dispose();
    }
  });

  test('with the switch on but NO active bond, the offer still fills (focus null falls through)', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, seed: 5, fake: true, mods: { targetedPick: true } }).start();
    try {
      h.toPrep(1);
      const ps = h.ps('p_0');
      ps.layers.yanShip = 5; // layers without an active bond are inert (the mode's own rule)
      assert.equal(h.m.gd.highestLayerActiveBond(computeBonds(h.m.gd, ps)), null);
      const offer = ps.pushRewardOffer('merge');
      assert.ok(offer && offer.slots.length > 0, 'every slot is still filled');
    } finally {
      h.m.dispose();
    }
  });
});
