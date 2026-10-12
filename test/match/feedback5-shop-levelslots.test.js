// The 调度中心 upgrade fills the new level's extra slots AT ONCE, each with a freshly drawn card — the owner's ruling of
// 2026-10-12, on a live report that the new slot looked broken ("商店升级后，新的购买槽位不会自动刷新出现干员，而是需要等下一次
// 手动刷新"). 0.2.0 drew a card into each new slot (item 19 of the community report of 2026-10-06, 「升级商店获得新的商店位时
// 用新卡补上，而不是空着」); 0.2.2 §27.52 reverted that to a `null` slot on a second-hand reading of bilibili BV1AXwuzdEys 1:39
// (GitHub #332 / PR #333 by @2321Robin) — the note itself says that frame rests on the reporter, never on a watched video —
// plus the fact that the official texts only name the slots (the tutorial's 休整期 page 「升级后将出现更多的商品栏位」, PRTS
// 帮助 「增加刷新栏位」). The owner's own experience wins: the slot is filled. The 0.2.2 empty slot is the documented
// deviation, kept in docs/history/0.2.2.md §27.52 as the record of the old rule. Either way the upgrade leaves the cards
// already shown where they are (chess slots keep their index, the item slot(s) stay after them), and the new card follows
// the freeze toggle as a manual refresh's cards do [ASSUMED].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';

const ids = (slots) => slots.map((s) => (s ? `${s.kind}:${s.id}${s.sold ? '(sold)' : ''}` : null));
const tierOf = (id) => DATA.chess[id]?.tier ?? 0;

test('a level-up fills the new operator slot with a card drawn at the new level; the cards shown stay in place', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 7, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.funds = 200;
  assert.deepEqual(h.m.gd.shopSlots(1), { chess: 3, item: 1 });
  const s1 = ps.shop.slots.slice();
  assert.equal(s1.length, 4);
  assert.deepEqual(h.m.handle('p_0', { t: 'g.levelUp' }), { ok: true });
  // level 2: 4 operator slots + the item slot — the three cards and the item kept (the same objects), the new slot filled
  assert.equal(ps.shop.level, 2);
  assert.deepEqual(ps.shop.layout, { chess: 4, item: 1 });
  assert.equal(ps.shop.slots.length, 5);
  for (let i = 0; i < 3; i++) assert.equal(ps.shop.slots[i], s1[i], `operator card ${i} kept`);
  assert.equal(ps.shop.slots[4], s1[3], 'the item card stays after the operator cards');
  const fresh = ps.shop.slots[3];
  assert.ok(fresh && fresh.kind === 'chess' && !fresh.sold, 'the new slot carries a fresh operator');
  assert.ok(tierOf(fresh.id) >= 1 && tierOf(fresh.id) <= 2, `drawn at the new level (tier ${tierOf(fresh.id)} ≤ 2)`);
  // the player sees it right away (m.private shop)
  assert.deepEqual(ids(ps.privateView().shop.slots), ids(ps.shop.slots));
  // 2 → 3 keeps 4 operator slots: nothing rerolled, nothing added
  const s2 = ps.shop.slots.slice();
  h.m.handle('p_0', { t: 'g.levelUp' });
  assert.equal(ps.shop.level, 3);
  assert.deepEqual(ps.shop.slots, s2, 'no extra slot at level 3, no reroll');
  // 3 → 4: the fifth operator slot, filled as well
  h.m.handle('p_0', { t: 'g.levelUp' });
  assert.equal(ps.shop.level, 4);
  assert.deepEqual(ps.shop.layout, { chess: 5, item: 1 });
  for (let i = 0; i < 4; i++) assert.equal(ps.shop.slots[i], s2[i]);
  assert.equal(ps.shop.slots[5], s2[4]);
  const fresh4 = ps.shop.slots[4];
  assert.ok(fresh4 && fresh4.kind === 'chess' && !fresh4.sold, 'the fifth slot carries a fresh operator');
  assert.ok(tierOf(fresh4.id) >= 1 && tierOf(fresh4.id) <= 4, `drawn at the new level (tier ${tierOf(fresh4.id)} ≤ 4)`);
  h.invariants();
  h.m.dispose();
});

test('a bought card stays sold; the new card follows the freeze toggle; the round start fills the rest', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 11, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.funds = 200;
  assert.deepEqual(h.m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  assert.equal(ps.shop.slots[0].sold, true);
  assert.deepEqual(h.m.handle('p_0', { t: 'g.freeze' }), { ok: true });
  h.m.handle('p_0', { t: 'g.levelUp' });
  assert.equal(ps.shop.slots[0].sold, true, 'the bought slot is not refilled');
  assert.ok(ps.shop.slots[3] && ps.shop.slots[3].kind === 'chess', 'the new slot carries an operator');
  assert.equal(ps.shop.slots[3].frozen, true, 'the new card follows the freeze toggle, as a refresh\'s cards do');
  const keep = ps.shop.slots.filter((s) => s && !s.sold && s.frozen).map((s) => s.id);
  assert.equal(keep.length, 4, 'three operator cards and the item carry the freeze toggle');
  // the round start fills every slot of the new level: frozen cards kept in place, the sold slot rolled
  h.drive(() => h.m.phase === 'PREP' && h.m.round === 2);
  assert.equal(ps.shop.slots.length, 5);
  for (const s of ps.shop.slots) assert.ok(s, 'the round start leaves no empty slot');
  assert.deepEqual(ps.shop.slots.slice(1).map((s) => s.id).slice(0, 3), keep.slice(0, 3), 'the frozen operator cards kept');
  assert.equal(ps.shop.slots[4].id, keep[3], 'the frozen item kept after the operator slots');
  assert.notEqual(ps.shop.slots[0].id, undefined, 'the sold slot rerolled');
  h.invariants();
  h.m.dispose();
});

test('every mode\'s slot table: a level-up opens exactly the new positions, each filled at the new level', () => {
  for (const [mode, difficulty] of [['solo', 'FUNNY'], ['solo', 'NORMAL'], ['coop', 'FUNNY'], ['coop', 'ABYSS'], ['ultimate', 'ABYSS']]) {
    const h = makeMatch({ mode, difficulty, seed: 3, fake: true, humans: 1, bots: mode === 'solo' ? 0 : 1 }).start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    const gd = h.m.gd;
    ps.funds = 500;
    for (let lv = 2; lv <= gd.maxShopLevel; lv++) {
      const before = ps.shop.slots.slice();
      assert.deepEqual(h.m.handle('p_0', { t: 'g.levelUp' }), { ok: true });
      const { chess, item } = gd.shopSlots(lv);
      assert.equal(ps.shop.slots.length, chess + item, `${mode} ${difficulty} L${lv}`);
      const kept = ps.shop.slots.filter((s) => s && before.includes(s)).length;
      assert.equal(kept, before.filter((s) => s).length, `${mode} ${difficulty} L${lv}: every shown card kept`);
      // every position this level opened is filled straight away, and nothing else is rerolled
      assert.ok(ps.shop.slots.every((s) => s), `${mode} ${difficulty} L${lv}: no empty slot`);
      assert.equal(ps.shop.slots.length, chess + item, `${mode} ${difficulty} L${lv}: slot count`);
    }
    // nothing to fill at the final level, so a refresh only rerolls
    assert.deepEqual(h.m.handle('p_0', { t: 'g.refresh' }), { ok: true });
    for (const s of ps.shop.slots) assert.ok(s, `${mode} ${difficulty}: the refresh leaves no empty slot`);
    h.invariants();
    h.m.dispose();
  }
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((l) => new GameData(DATA, 'mode_single_funny').shopSlots(l).chess), [3, 4, 4, 4, 4, 5]);
});
