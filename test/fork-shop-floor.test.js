// test/fork-shop-floor.test.js — requirement 4: 6 人模式商店保底.
//
// The owner's wording: 「6人模式里的商店升到5级后，第一个槽位无论怎么刷新，必定是5阶干员，到达6级商店后，第一个槽位无论怎么刷新，
// 必是5阶或6阶干员」, and when asked when it applies: 「只要在该等级，每次刷新都保底」.
//
// So: in the SIX-博士 room (终极模拟), the FIRST 干员槽位 is guaranteed a high-tier card from level 5 on —
//   * level 5 → a 5 阶 operator;
//   * level 6 → a 5 阶 or 6 阶 operator;
// and it holds on every roll at that level (a manual refresh, the round start's automatic refresh, and the level-up
// that opens the slot). Levels 1–4 carry no floor, and no official mode has one at all.
//
// The guarantee lives in generated data — `modes[mode_ultimate_abyss].shopFloor = { 5: { tiers: [5] }, 6: { tiers: [5, 6] } }`
// (tools/fork-overrides.mjs, so it survives a `build-data`) — read by GameData.shopFloor(level) and applied by
// PlayerState._rollChessSlot(floor). A floored tier with no copies left falls through to the next listed tier and then
// to the ordinary draw, because a guarantee must never hand back an empty slot.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../server/match/gamedata.js';
import { SharedPool } from '../server/match/pool.js';
import { DATA, makeMatch, checkInvariants } from './match/harness.js';

const FORK = 'mode_ultimate_abyss';
const gd = (modeId) => new GameData(DATA, modeId);
const tierOf = (id) => DATA.chess[id]?.tier ?? DATA.chess[DATA.chess[id]?.baseId]?.tier ?? 0;

describe('四.3 商店保底 — the rule itself', () => {
  test('the fork mode carries the floor table; every official mode has none', () => {
    const fork = gd(FORK);
    assert.deepEqual(fork.shopFloor(5), [5], 'level 5 → 5 阶');
    assert.deepEqual(fork.shopFloor(6), [5, 6], 'level 6 → 5 阶 or 6 阶');
    for (const lv of [1, 2, 3, 4]) assert.equal(fork.shopFloor(lv), null, `level ${lv}: no floor`);
    // the official modes are untouched: the requirement names the SIX-博士 mode
    for (const id of ['mode_multi_abyss', 'mode_multi_hard', 'mode_multi_normal', 'mode_multi_funny', 'mode_single_abyss', 'mode_single_normal']) {
      for (let lv = 1; lv <= 6; lv++) assert.equal(gd(id).shopFloor(lv), null, `${id} L${lv}`);
    }
  });

  test('a malformed table can never ask for an impossible tier', () => {
    const withFloor = (tiers) => {
      const data = { ...DATA, config: { ...DATA.config, modes: { ...DATA.config.modes, mode_floor_test: { ...DATA.config.modes['mode_multi_abyss'], modeId: 'mode_floor_test', shopFloor: { 5: { tiers } } } } } };
      return new GameData(data, 'mode_floor_test');
    };
    assert.deepEqual(withFloor([5]).shopFloor(5), [5]);
    assert.equal(withFloor([7]).shopFloor(5), null, 'above maxShopLevel → no floor');
    assert.equal(withFloor([0, -1, 2.5, '5', null]).shopFloor(5), null, 'junk → no floor');
    assert.deepEqual(withFloor([6, 5]).shopFloor(5), [5], 'a tier above the LEVEL is dropped (6 at level 5)');
    assert.deepEqual(withFloor([3, 5]).shopFloor(5), [3, 5], 'a lower tier is allowed');
    assert.equal(withFloor('nope').shopFloor(5), null, 'a non-array is no floor');
    assert.equal(withFloor(undefined).shopFloor(5), null);
  });
});

describe('四.3 商店保底 — a real six-player 终极模拟 match', () => {
  /** A six-player fork match, driven into round 1's prep with a given shop level. */
  const atShop = (level, seed = 5) => {
    const h = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans: 6, seed, fake: true }).start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    ps.funds = 9999;
    ps.shop.level = level;
    return { h, ps };
  };

  test('every refresh at level 5 puts a 5 阶 operator in slot 0', () => {
    const { h, ps } = atShop(5);
    try {
      for (let i = 0; i < 60; i++) {
        ps.rollShop();
        const s0 = ps.shop.slots[0];
        assert.ok(s0 && s0.kind === 'chess', `roll ${i}: slot 0 is a 干员 card`);
        assert.equal(tierOf(s0.id), 5, `roll ${i}: slot 0 is 5 阶 (got ${s0.id})`);
      }
      checkInvariants(h.m);
    } finally {
      h.m.dispose();
    }
  });

  test('every refresh at level 6 puts a 5 阶 or 6 阶 operator in slot 0', () => {
    const { h, ps } = atShop(6);
    try {
      const seen = new Set();
      for (let i = 0; i < 120; i++) {
        ps.rollShop();
        const s0 = ps.shop.slots[0];
        assert.ok(s0 && s0.kind === 'chess', `roll ${i}: slot 0 is a 干员 card`);
        const t = tierOf(s0.id);
        assert.ok(t === 5 || t === 6, `roll ${i}: slot 0 is 5 or 6 阶 (got tier ${t}: ${s0.id})`);
        seen.add(t);
      }
      // both tiers must actually be reachable — a floor that always picked 5 would satisfy the assertion above but
      // not the requirement ("5阶或6阶")
      assert.ok(seen.has(5) && seen.has(6), `both tiers occur (saw ${[...seen].sort().join('/')})`);
      checkInvariants(h.m);
    } finally {
      h.m.dispose();
    }
  });

  test('the guarantee holds on every kind of roll: manual refresh, round start, and the level-up that opens the slot', () => {
    const { h, ps } = atShop(5);
    try {
      /** slot 0 must be a 干员 card of one of `tiers`. */
      const assertSlot0 = (what, tiers = [5]) => {
        const s0 = ps.shop.slots[0];
        assert.ok(s0 && s0.kind === 'chess', `${what}: slot 0 is a 干员 card`);
        assert.ok(tiers.includes(tierOf(s0.id)), `${what}: slot 0 is ${tiers.join('/')} 阶 (got ${tierOf(s0.id)}: ${s0.id})`);
      };
      // 1. the manual refresh (g.refresh path → rollShop)
      assert.deepEqual(h.m.handle('p_0', { t: 'g.refresh' }), { ok: true });
      assertSlot0('manual refresh');
      // 2. the round start (PlayerState.startRound → rollShop keepFrozen)
      ps.rollShop({ keepFrozen: true });
      assertSlot0('round start (keepFrozen)');
      // 3. the level-up that opens the shop (levelUp → _openLevelSlots): from an EMPTY shop the first slot is the floor.
      //    Level 6's floor is 5 阶 or 6 阶, so this asserts the pair — not 5 alone.
      ps.shop.slots = [];
      ps.shop.layout = { chess: 0, item: 0 };
      ps.shop.level = 6;
      ps.rollShop();
      assertSlot0('level-up opening the shop (L6)', [5, 6]);
      checkInvariants(h.m);
    } finally {
      h.m.dispose();
    }
  });

  test('a frozen first slot keeps its own card — the floor rerolls positions, it does not re-roll frozen cards', () => {
    const { h, ps } = atShop(5);
    try {
      ps.rollShop();
      const kept = ps.shop.slots[0].id;
      ps.shop.frozen = true;
      for (const s of ps.shop.slots) if (s && !s.sold) s.frozen = true;
      // a keepFrozen roll must leave slot 0 exactly as it was
      ps.rollShop({ keepFrozen: true });
      assert.equal(ps.shop.slots[0].id, kept, 'the frozen card stays');
      // and a manual refresh (keepFrozen false) rerolls it — still under the floor
      ps.shop.frozen = false;
      for (const s of ps.shop.slots) if (s) s.frozen = false;
      ps.rollShop({ keepFrozen: false });
      assert.equal(tierOf(ps.shop.slots[0].id), 5, 'and the fresh one is 5 阶');
      checkInvariants(h.m);
    } finally {
      h.m.dispose();
    }
  });

  test('the other slots are NOT floored: only the first one is', () => {
    const { h, ps } = atShop(5);
    try {
      const tiers = new Set();
      for (let i = 0; i < 60; i++) {
        ps.rollShop();
        // slots 1..n-1 are the ordinary tier-weighted draw, which can reach anything ≤ the shop level
        for (const s of ps.shop.slots.slice(1).filter((x) => x && x.kind === 'chess')) tiers.add(tierOf(s.id));
      }
      assert.ok([...tiers].some((t) => t < 5), `the ordinary draw reaches below 5 阶 too (saw ${[...tiers].sort().join('/')})`);
      checkInvariants(h.m);
    } finally {
      h.m.dispose();
    }
  });

  test('levels 1–4 have no floor: the first slot draws normally', () => {
    for (const level of [1, 2, 3, 4]) {
      const { h, ps } = atShop(level, 7);
      try {
        const tiers = new Set();
        for (let i = 0; i < 40; i++) {
          ps.rollShop();
          const s0 = ps.shop.slots[0];
          assert.ok(s0 && s0.kind === 'chess');
          tiers.add(tierOf(s0.id));
        }
        // with no floor the first slot is not pinned to the top tier of its level
        assert.ok([...tiers].some((t) => t < level) || level === 1, `L${level}: slot 0 is not pinned (saw ${[...tiers].sort().join('/')})`);
        checkInvariants(h.m);
      } finally {
        h.m.dispose();
      }
    }
  });

  test('an official mode with the same level has no floor at all', () => {
    // 同盟模拟 AC-4: the same difficulty, six... four seats, and slot 0 draws normally
    const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 4, seed: 5, fake: true }).start();
    try {
      h.toPrep(1);
      const ps = h.ps('p_0');
      ps.funds = 9999;
      ps.shop.level = 5;
      const tiers = new Set();
      for (let i = 0; i < 60; i++) {
        ps.rollShop();
        tiers.add(tierOf(ps.shop.slots[0].id));
      }
      assert.ok([...tiers].some((t) => t !== 5), `the official mode is not floored (saw ${[...tiers].sort().join('/')})`);
      checkInvariants(h.m);
    } finally {
      h.m.dispose();
    }
  });

  test('the floor falls through rather than handing back an empty slot', () => {
    const { h, ps } = atShop(5);
    try {
      // Give this player a stock with NO 5 阶 copies left — a real SharedPool over the same data with every tier-5
      // base banned. (Draining the shared pool's copies instead would break the pool's own accounting invariant:
      // copies must be `left + held`, and nothing holds a shop card.) The guarantee then has nothing to draw from, so
      // the ordinary draw must run instead of leaving slot 0 empty.
      // The stub must ALSO carry the match's own bans: 终极模拟 draws bond bans like 同盟模拟 since 2026-10-13, so
      // some 干员 are out of play and a stand-in pool that forgot them would hand back a banned card (which
      // checkInvariants rightly rejects). `banned` is the pool's own list, so union it.
      const g = h.m.gd;
      const tier5 = g.visibleChess.filter((id) => g.tierOf(id) === 5);
      assert.ok(tier5.length > 0, 'the data has 5 阶 operators');
      assert.ok(h.m.pool.banned.length > 0, 'the six-player room really does ban 干员 now');
      const drained = new SharedPool(g, { banned: [...tier5, ...h.m.pool.banned] });
      assert.equal(drained.entries.size > 0, true, 'the stub still has lower tiers');
      const realStock = ps.stock.bind(ps);
      ps.stock = () => drained;
      try {
        ps.rollShop();
        const s0 = ps.shop.slots[0];
        assert.ok(s0 && s0.kind === 'chess', 'slot 0 is still filled');
        assert.notEqual(g.tierOf(s0.id), 5, 'and it is not pinned to the empty tier');
        assert.ok(drained.has(g.baseIdOf(s0.id)), 'the fall-through card comes from the available stock');
      } finally {
        ps.stock = realStock;
      }
      checkInvariants(h.m);
    } finally {
      h.m.dispose();
    }
  });
});
