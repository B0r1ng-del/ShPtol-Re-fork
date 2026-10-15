// test/match/item-sell.test.js — 房主配置 装备可售卖 (HOST_CONFIG_KEYS `itemSell`, fork 二.7; server/match/player/economy.js
// sell, shared/constants.js ITEM_SELL_PRICE). Default OFF = the official rule: an item can only be 销毁. ON: a loose item
// may be SOLD for the flat ITEM_SELL_PRICE, through 销毁's own path — so it follows the same gate (hand / temp only, an
// equipped one is locked either way) and the item's own onDestroy still resolves. A chess sale is untouched by the switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMatch, give, giveItem, checkInvariants, chessOfTier } from './harness.js';
import { ITEM_SELL_PRICE } from '../../shared/constants.js';

/** A co-op match with one human, driven into PREP (where 出售 / 销毁 are legal), plus its PlayerState. */
function solo(extra = {}) {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 3, ...extra }).start().toPrep();
  return { h, m: h.m, ps: h.ps('p_0') };
}

/** The first plain 1 阶 chess this match's data actually offers (not golden, not pack-owned). */
const tier1 = (m) => chessOfTier(1).find((id) => m.gd.chess(id) && m.pool.has(id));

test('装备可售卖 off (the default): selling a loose item is refused, 销毁 still works', () => {
  const { m, ps } = solo();
  const item = giveItem(m, ps, 'chess_item_1_01_e_a');
  const f0 = ps.funds;
  const res = ps.sell(item.uid);
  assert.ok(!res.ok, 'items cannot be sold');
  assert.match(String(res.detail || ''), /items cannot be sold/);
  assert.equal(ps.funds, f0, 'nothing paid');
  assert.ok(ps.find(item.uid), 'the item is still there');
  assert.equal(m.itemSell, false, 'the match defaults to the official rule');
  assert.ok(ps.destroy(item.uid).ok, '销毁 is unaffected');
  assert.equal(ps.find(item.uid), null);
  checkInvariants(m);
  m.dispose();
});

test('装备可售卖 on: a loose item sells for ITEM_SELL_PRICE and leaves the player', () => {
  const { m, ps } = solo({ itemSell: true });
  assert.equal(m.itemSell, true);
  const item = giveItem(m, ps, 'chess_item_1_01_e_a');
  const f0 = ps.funds;
  const s0 = ps.stats.sells;
  const res = ps.sell(item.uid);
  assert.ok(res.ok, res.detail || res.error);
  assert.equal(ps.funds, f0 + ITEM_SELL_PRICE, `paid ${ITEM_SELL_PRICE}`);
  assert.equal(ITEM_SELL_PRICE, 1, 'the agreed price is 1 块钱');
  assert.equal(ps.find(item.uid), null, 'the item is gone');
  assert.equal(ps.stats.sells, s0 + 1, 'it counts as a sale');
  checkInvariants(m);
  m.dispose();
});

test('an equipped item is locked either way: selling it is refused and nothing is paid', () => {
  const { m, ps } = solo({ itemSell: true });
  const carrier = give(m, ps, tier1(m), 'board', [9, 3]);
  const item = giveItem(m, ps, 'chess_item_1_01_e_a');
  assert.ok(ps.equip(item.uid, carrier.uid).ok, 'equip it');
  const f0 = ps.funds;
  const onCarrier = carrier.items[0];
  const res = ps.sell(onCarrier.uid);
  assert.ok(!res.ok, 'equipped items are locked');
  assert.match(String(res.detail || ''), /equipped items are locked/);
  assert.equal(ps.funds, f0);
  assert.equal(carrier.items.length, 1, 'still equipped');
  checkInvariants(m);
  m.dispose();
});

test('a sold item resolves its own onDestroy: 神秘顾客 pays its coins on a sale, exactly as on a 销毁', () => {
  const { m, ps } = solo({ itemSell: true });
  const item = giveItem(m, ps, 'chess_item_6_01_m'); // 神秘顾客: onDestroy adds funds (trap_disney_special)
  const f0 = ps.funds;
  const res = ps.sell(item.uid);
  assert.ok(res.ok, res.detail || res.error);
  assert.ok(ps.funds >= f0 + ITEM_SELL_PRICE, 'the sale paid, and the item handler ran on top of it');
  assert.equal(ps.find(item.uid), null);
  checkInvariants(m);
  m.dispose();
});

test('the switch does not change an operator\'s price', () => {
  const off = solo();
  const offChess = give(off.m, off.ps, tier1(off.m));
  const offF0 = off.ps.funds;
  assert.ok(off.ps.sell(offChess.uid).ok);
  const offGain = off.ps.funds - offF0;
  checkInvariants(off.m);
  off.m.dispose();

  const on = solo({ itemSell: true });
  const onChess = give(on.m, on.ps, tier1(on.m));
  const onF0 = on.ps.funds;
  assert.ok(on.ps.sell(onChess.uid).ok);
  assert.equal(on.ps.funds - onF0, offGain, 'an operator sells for its own price either way');
  checkInvariants(on.m);
  on.m.dispose();
});

test('a token cannot be sold, with or without the switch', () => {
  for (const itemSell of [false, true]) {
    const { m, ps } = solo({ itemSell });
    const carrier = give(m, ps, tier1(m), 'board', [9, 3]);
    ps.grantTokensFor(carrier);
    const token = [...ps.board.values()].find((p) => p.kind === 'token');
    if (token) {
      const f0 = ps.funds;
      assert.ok(!ps.sell(token.uid).ok, 'tokens cannot be sold');
      assert.equal(ps.funds, f0);
    }
    checkInvariants(m);
    m.dispose();
  }
});

test('the switch rides on the room like the other 房主配置 options and is published to the client', () => {
  const off = makeMatch({ mode: 'coop', humans: 1, bots: 3 }).start();
  assert.equal(off.m.publicView().hostConfig.itemSell, false);
  off.m.dispose();
  const on = makeMatch({ mode: 'coop', humans: 1, bots: 3, itemSell: true }).start();
  assert.equal(on.m.publicView().hostConfig.itemSell, true, 'm.public.hostConfig.itemSell drives the client buttons');
  on.m.dispose();
});
