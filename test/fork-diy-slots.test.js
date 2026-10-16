// test/fork-diy-slots.test.js — 二.8: the fork's 自选编队 has 5 slots per tier (10 total) instead of the official 2 + 2,
// and a full 10-slot roster plays through the real match engine.
//
// The slots themselves are data (tools/fork-overrides.mjs applyForkChess / applyForkBackups; the drift guard is
// test/fork-data.test.js). This file proves the RULES still hold at 10: the wire check accepts 10 and refuses 11, a
// 10-slot roster validates and is stored per player, every slot gets its own stock at its tier's 调度中心 level, and
// the tier rules (one operator twice in a tier, an owned operator in one slot only, a prototype at both tiers) are
// unaffected by the count — they are Map/Set based, not count based.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkDiyPicks, validateC2S, DIY_LIMITS } from '../shared/protocol.js';
import { diySlotIds, validateDiyPicks, diyRecord } from '../shared/diy.js';
import { KITTED_CHARS } from '../server/sim/content/kits/index.js';
import { hasGeneratedData } from '../server/sim/simdata.js';
import { DATA, makeMatch } from './match/harness.js';

const REAL = { skip: !hasGeneratedData() };

const SLOTS = diySlotIds(DATA);
const T5 = SLOTS.filter((id) => DATA.backups.diy.slots[id].tier === 5);
const T6 = SLOTS.filter((id) => DATA.backups.diy.slots[id].tier === 6);
const SIEGE = 'char_112_siege'; // an owned 6★ with a kit
const SHARP = 'char_609_acguad'; // a 6★ prototype: legal at tier 5 and tier 6
const CGUARD = 'char_601_cguard'; // a 4★ reserve: tier 5 only
const OWNED = DATA.backups.diy.ownedPool.filter((id) => KITTED_CHARS.includes(id));

/** A legal 10-slot roster: 3 prototypes + 2 owned per tier (distinct within a tier). */
function fullRoster() {
  const p5 = DATA.backups.diy.prototypes[5].filter((id) => KITTED_CHARS.includes(id));
  const p6 = DATA.backups.diy.prototypes[6].filter((id) => KITTED_CHARS.includes(id));
  return {
    [T5[0]]: { charId: p5[0] }, [T5[1]]: { charId: p5[1] }, [T5[2]]: { charId: p5[2] },
    [T5[3]]: { charId: OWNED[0], skillIndex: 0 }, [T5[4]]: { charId: OWNED[1], skillIndex: 0 },
    [T6[0]]: { charId: p6[0] }, [T6[1]]: { charId: p6[1] }, [T6[2]]: { charId: p6[2] },
    [T6[3]]: { charId: OWNED[2], skillIndex: 0 }, [T6[4]]: { charId: OWNED[3], skillIndex: 0 },
  };
}

test('the data carries 10 slots — 5 per tier — and DIY_LIMITS.slots matches', () => {
  assert.equal(SLOTS.length, 10);
  assert.equal(T5.length, 5);
  assert.equal(T6.length, 5);
  assert.equal(DIY_LIMITS.slots, 10, 'the wire limit must admit a full roster');
  for (const id of SLOTS) assert.ok(diyRecord(id, { charId: SHARP }, { data: DATA }), `${id}: composes a record`);
});

test('the wire check admits 10 slot entries and refuses 11', () => {
  const ten = Object.fromEntries(SLOTS.map((id) => [id, null]));
  assert.equal(validateC2S({ t: 'room.diy', picks: ten }), null, '10 entries are fine');
  const eleven = { ...ten, chess_char_5_diy6_a: null };
  assert.match(validateC2S({ t: 'room.diy', picks: eleven }) || '', /bad field picks/);
});

test('a full 10-slot roster validates and keeps every pick', () => {
  const roster = fullRoster();
  const res = validateDiyPicks(roster, { data: DATA, kitted: KITTED_CHARS });
  assert.ok('ok' in res, 'ok' in res ? '' : `${res.error}: ${res.detail}`);
  assert.deepEqual(Object.keys(res.picks), SLOTS, 'all ten slots kept, in slot order');
  // the server's lenient pass agrees and drops nothing
  const kept = checkDiyPicks(roster, { data: DATA, kitted: KITTED_CHARS });
  assert.equal(kept.dropped, 0);
  assert.deepEqual(Object.keys(kept.picks), SLOTS);
});

test('the tier rules are count-independent: same operator twice in a tier / one owned operator in two slots', () => {
  const roster = fullRoster();
  // a prototype may fill a tier-5 AND a tier-6 slot, but not two of the same tier
  const protoTwice = { [T5[0]]: { charId: SHARP }, [T5[1]]: { charId: SHARP } };
  const r1 = validateDiyPicks(protoTwice, { data: DATA, kitted: KITTED_CHARS });
  assert.equal(r1.error, 'BAD_TARGET');
  assert.match(r1.detail, /two tier-5 slots/);
  assert.ok('ok' in validateDiyPicks({ [T5[0]]: { charId: SHARP }, [T6[0]]: { charId: SHARP } }, { data: DATA, kitted: KITTED_CHARS }), 'one slot per tier is fine');
  // an owned operator fills one slot only, even with ten available
  const ownedTwice = { [T5[0]]: { charId: OWNED[0], skillIndex: 0 }, [T6[0]]: { charId: OWNED[0], skillIndex: 0 } };
  assert.match(validateDiyPicks(ownedTwice, { data: DATA, kitted: KITTED_CHARS }).detail, /fills .* and .* \(an owned operator fills one slot\)/);
  // a 4★ reserve stays tier-5 only
  assert.ok('ok' in validateDiyPicks({ [T5[4]]: { charId: CGUARD } }, { data: DATA, kitted: KITTED_CHARS }));
  assert.equal(validateDiyPicks({ [T6[4]]: { charId: CGUARD } }, { data: DATA, kitted: KITTED_CHARS }).error, 'BAD_TARGET');
  // the roster itself is untouched by the failed attempts
  assert.ok('ok' in validateDiyPicks(roster, { data: DATA, kitted: KITTED_CHARS }));
});

test('the real match takes all 10 picks, gives each slot its own stock and sells them from its tier\'s level', REAL, () => {
  const roster = fullRoster();
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: roster },
    { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true },
  ];
  const h = makeMatch({ mode: 'coop', seats, seed: 21 }).start();
  const m = h.m;
  const p0 = h.ps('p_0');
  h.toPrep(1);
  assert.deepEqual(Object.keys(p0.diy), SLOTS, 'every slot kept');
  // per-tier stock: 8 copies at tier 5 and 5 at tier 6 (economy.poolCopies), one stock per slot — doubled in co-op
  // like the shared pool (the maintainer's decision of 2026-10-15, GitHub #650, DESIGN §32.14.31; gamedata.poolCopies
  // no longer exempts a 自选 slot, so this co-op match gets 16 / 10, as test/match/diy-shop.test.js and docs/PLAYING.md
  // state). This test used to pin the single-player 8 / 5, which the 0.3.0 merge superseded.
  assert.deepEqual(p0.diyStock.snapshot(), Object.fromEntries(SLOTS.map((id) => [id, DATA.backups.diy.slots[id].tier === 5 ? 16 : 10])));
  for (const id of SLOTS) assert.ok(!m.pool.has(id), `${id}: never in the shared pool`);
  // the shop lists them from the slot's own 调度中心 level
  const seen = (level, n = 400) => {
    p0.shop.level = level;
    const ids = new Set();
    for (let i = 0; i < n; i++) { p0.rollShop(); for (const s of p0.shop.slots) if (s && s.kind === 'chess' && /_diy/.test(s.id)) ids.add(s.id); }
    return [...ids].sort();
  };
  assert.deepEqual(seen(4), [], 'level 4: no 自选 slot yet');
  assert.deepEqual(seen(5), [...T5].sort(), 'level 5: the five tier-5 slots');
  assert.deepEqual(seen(6, 800), [...SLOTS].sort(), 'level 6: all ten');
  h.invariants();
  m.dispose();
});

test('every slot fields its own operator in battle, normal and elite', REAL, () => {
  const roster = fullRoster();
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: roster },
    { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true },
  ];
  const h = makeMatch({ mode: 'coop', seats, seed: 22 }).start();
  const p0 = h.ps('p_0');
  h.toPrep(1);
  for (const id of SLOTS) {
    const pick = roster[id];
    for (const elite of [false, true]) {
      const chessId = elite ? DATA.backups.diy.slots[id].goldenId : id;
      const rec = p0.gd.chess(chessId);
      assert.equal(rec.charId, pick.charId, `${chessId}: fields its pick`);
      assert.equal(rec.diyFor, id, `${chessId}: remembers its slot`);
      const want = diyRecord(id, pick, { elite, data: DATA });
      assert.equal(rec.name, want.name, chessId);
      assert.equal(rec.tier, want.tier, chessId);
    }
  }
  h.invariants();
  h.m.dispose();
});
