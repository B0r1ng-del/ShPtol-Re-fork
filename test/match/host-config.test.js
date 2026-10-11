// 房主配置 (opts.sharedPool / opts.sharedBounty / opts.multiAlliance; server/match/Match.js) — the three room options the
// host sets in the 准备房间 beyond 「AI 队友最后选择」 (test/match/ai-picks-last.test.js), as the engine runs them:
//
//   共享卡池      ON  — one 干员 stock for the whole team, one player's copy is gone for the others (the official rule)
//                 OFF — every player has their own stock; nothing anybody takes is denied to the others
//   共享悬赏      ON  — one 悬赏决策 draft, the first pick consumes the card (「全队共用一套悬赏决策牌，先选先得」)
//                 OFF — a teammate's 悬赏 pick leaves the card pickable for me
//   多同盟模式    ON  — more than one 博士 may take the SAME 策略 (the 队友已选 lock is lifted)
//                 OFF — the official 「每个策略只能由一位博士选择」
//
// Every option defaults to the OFFICIAL behaviour when opts carries nothing, which is what keeps the golden scenarios
// and every other caller byte-identical (test/golden/*.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';
import { SharedPool } from '../../server/match/pool.js';

/** Drive a match to BAND_DRAFT (every human confirms the briefing); `before(m)` runs while still in INFO_CHECK. */
function toBandDraft(o, before) {
  const h = makeMatch({ mode: 'coop', ...o }).start();
  if (before) before(h.m);
  for (const ps of h.m.players.values()) if (!ps.isBot && !ps.left) h.m.handle(ps.playerId, { t: 'g.infoReady' });
  h.run(() => h.m.phase !== PHASE.INFO_CHECK);
  assert.equal(h.m.phase, PHASE.BAND_DRAFT);
  return h;
}

test('the three options: off unless opts says otherwise, never in a solo match', () => {
  const mk = (o, pick) => { const h = makeMatch(o); const v = pick(h.m); h.m.dispose(); return v; };
  const three = (m) => [m.sharedPool, m.sharedBounty, m.multiAlliance];
  // a caller that passes nothing gets the official behaviour: one shared pool, one shared 悬赏 set, no duplicate picks
  assert.deepEqual(mk({ mode: 'coop', humans: 1, bots: 3 }, three), [true, true, false]);
  assert.deepEqual(mk({ mode: 'coop', humans: 1, bots: 3, sharedPool: true, sharedBounty: true, multiAlliance: true }, three), [true, true, true]);
  assert.deepEqual(mk({ mode: 'coop', humans: 1, bots: 3, sharedPool: false, sharedBounty: false, multiAlliance: false }, three), [false, false, false]);
  // only a real `false` turns a sharing option off, only a real `true` turns 多同盟模式 on
  assert.deepEqual(mk({ mode: 'coop', humans: 1, bots: 3, sharedPool: 'no', multiAlliance: 'yes' }, three), [true, true, false]);
  // solo: nothing to share with, so the official per-player behaviour either way
  assert.deepEqual(mk({ mode: 'solo', humans: 1, sharedPool: false, sharedBounty: false, multiAlliance: true }, three), [true, true, false]);
});

test('共享卡池 on (the official default): one pool for the team, a copy taken is gone for everybody', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 2 }).start();
  const [a, b] = h.m.alivePlayers();
  assert.equal(a.stock(), h.m.pool, 'the shared pool itself');
  assert.equal(b.stock(), h.m.pool);
  assert.equal(a.stock(), b.stock(), 'one stock');
  const base = [...h.m.pool.entries.keys()].find((id) => h.m.pool.left(id) > 0 && !h.m.gd.chess(id).isDiy);
  const before = h.m.pool.left(base);
  assert.equal(a.poolOf(base).take(base, 1), 1);
  assert.equal(b.poolOf(base).left(base), before - 1, 'the copy left the team stock');
  h.m.dispose();
});

test('共享卡池 off: every player has their own stock — nothing anybody takes is denied to the others', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 2, sharedPool: false }).start();
  const [a, b] = h.m.alivePlayers();
  assert.notEqual(a.stock(), b.stock(), 'a stock each');
  assert.equal(a.stock(), a.stock(), 'and the same one on every read');
  assert.ok(a.stock() instanceof SharedPool);
  // the same caps and bans as the shared pool: only the contention goes away
  const base = [...h.m.pool.entries.keys()].find((id) => h.m.pool.left(id) > 0 && !h.m.gd.chess(id).isDiy);
  const cap = h.m.pool.cap(base);
  assert.equal(a.stock().cap(base), cap, 'same caps');
  assert.equal(a.stock().take(base, 1), 1);
  assert.equal(a.stock().left(base), cap - 1);
  assert.equal(b.stock().left(base), cap, 'the teammate still has every copy');
  assert.equal(h.m.pool.left(base), cap, 'the team pool is untouched');
  h.m.dispose();
});

test('共享卡池 off: the shop roll draws the player\'s own stock, so the same base can appear for both', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 2, sharedPool: false, seed: 7 }).start();
  const [a, b] = h.m.alivePlayers();
  // drain one base completely in A's stock and leave B's alone: B can still roll it, A cannot
  const base = [...a.stock().entries.keys()].find((id) => !h.m.gd.chess(id).isDiy && a.stock().cap(id) > 0);
  const cap = a.stock().cap(base);
  a.stock().take(base, cap, { overdraw: true });
  assert.equal(a.stock().left(base), 0);
  assert.equal(b.stock().left(base), cap, 'B never lost a copy');
  // the shop roll reads the stock, not the team pool (PlayerState._rollChessSlot → PlayerState.stock)
  const seen = [];
  for (let i = 0; i < 60; i++) seen.push(a._rollChessSlot());
  const drained = seen.filter((s) => s && h.m.gd.baseIdOf(s.id) === base);
  assert.equal(drained.length, 0, 'A cannot roll a base its own stock ran out of');
  h.m.dispose();
});

test('多同盟模式 off (the official rule): a strategy a teammate took is refused with 队友已选', () => {
  const h = toBandDraft({ humans: 2, bots: 0, seed: 3 });
  const order = h.m.draft.order.slice();
  const first = order[0];
  const second = order[1];
  const band = h.m.gd.bandIds()[0];
  h.m.handle(first, { t: 'g.band', bandId: band });
  h.run(() => h.m.draft.picks[first] != null);
  assert.equal(h.m.bandTaken(band, second), true);
  const r = h.m.handle(second, { t: 'g.band', bandId: band });
  assert.equal(r && r.error, 'BAD_TARGET', JSON.stringify(r));
  assert.equal(h.m.draft.picks[second], undefined, 'the pick never landed');
  h.m.dispose();
});

test('多同盟模式 on: more than one 博士 may take the SAME 策略 (the 队友已选 lock is lifted)', () => {
  const h = toBandDraft({ humans: 2, bots: 0, seed: 3, multiAlliance: true });
  assert.equal(h.m.multiAlliance, true);
  const order = h.m.draft.order.slice();
  const first = order[0];
  const second = order[1];
  const band = h.m.gd.bandIds()[0];
  h.m.handle(first, { t: 'g.band', bandId: band });
  h.run(() => h.m.draft.picks[first] != null);
  assert.equal(h.m.bandTaken(band, second), false, 'nothing is taken');
  h.m.handle(second, { t: 'g.band', bandId: band });
  h.run(() => h.m.draft.picks[second] != null);
  assert.equal(h.m.draft.picks[second], band, 'the second pick landed');
  assert.equal(h.m.players.get(first).bandId, band);
  assert.equal(h.m.players.get(second).bandId, band, 'the same strategy for both');
  h.m.dispose();
});

test('多同盟模式 on: a timeout keeps the highlighted strategy even while a teammate holds it', () => {
  const h = toBandDraft({ humans: 2, bots: 0, seed: 3, multiAlliance: true });
  const order = h.m.draft.order.slice();
  const first = order[0];
  const second = order[1];
  const band = h.m.gd.bandIds()[0];
  h.m.handle(first, { t: 'g.band', bandId: band });
  h.run(() => h.m.draft.picks[first] != null);
  // the second player highlights the strategy the first one took: a timeout gives it to it (no 队友已选 detour)
  h.m.handle(second, { t: 'g.bandFocus', bandId: band });
  assert.equal(h.m.timeoutBand(second), band);
  // …and off it falls back to the free default, exactly as before
  const off = toBandDraft({ humans: 2, bots: 0, seed: 3 });
  const oOrder = off.m.draft.order.slice();
  const oBand = off.m.gd.bandIds()[0];
  off.m.handle(oOrder[0], { t: 'g.band', bandId: oBand });
  off.run(() => off.m.draft.picks[oOrder[0]] != null);
  off.m.handle(oOrder[1], { t: 'g.bandFocus', bandId: oBand });
  assert.notEqual(off.m.timeoutBand(oOrder[1]), oBand, 'off: never 队友已选');
  h.m.dispose();
  off.m.dispose();
});

test('共享悬赏 off: a 悬赏决策 card a teammate took stays available to me (先选先得 is lifted)', () => {
  // a 悬赏决策 draft: choices.json bountyDrafts drives the family (server/match/choices.js bountyDraftKind)
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 11, sharedBounty: false }).start();
  const m = h.m;
  assert.equal(m.sharedBounty, false);
  // force a 悬赏决策 draft and read the availability rule the picker uses
  const bounty = m.gd.choices.bountyDrafts.initial;
  const cards = bounty.groups[0].cards.slice(0, 2).map((c, i) => ({ ...c, idx: i, family: 'bounty' }));
  m.sp = { family: 'bounty', name: 'x', desc: '', eventId: null, cards, order: ['a', 'b'], idx: 0, picks: {}, taken: {}, untimed: true, turnDeadline: 0, parallel: false, randomOffer: [], randomVotes: new Set(), randomResolved: false };
  assert.equal(m.spCardsShared, false, '共享悬赏 off: the 悬赏 cards are not contended');
  m.sp.taken[0] = 'someone-else';
  assert.equal(m.spCardAvailable(cards[0]), true, 'still pickable for me');
  // on: the official rule — the first pick consumes the card
  m.sharedBounty = true;
  assert.equal(m.spCardsShared, true);
  assert.equal(m.spCardAvailable(cards[0]), false, '先选先得');
  // a non-悬赏 draft is always contended: the option names 悬赏 only
  m.sharedBounty = false;
  m.sp.family = 'supply';
  assert.equal(m.spCardsShared, true);
  assert.equal(m.spCardAvailable(cards[0]), false);
  h.m.dispose();
});

test('共享悬赏 on (the official default): a taken 悬赏决策 card is refused to the rest of the team', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 11 }).start();
  const m = h.m;
  assert.equal(m.sharedBounty, true, 'the official default');
  const cards = m.gd.choices.bountyDrafts.initial.groups[0].cards.slice(0, 2).map((c, i) => ({ ...c, idx: i, family: 'bounty' }));
  m.sp = { family: 'bounty', name: 'x', desc: '', eventId: null, cards, order: ['a', 'b'], idx: 0, picks: {}, taken: {}, untimed: true, turnDeadline: 0, parallel: false, randomOffer: [], randomVotes: new Set(), randomResolved: false };
  m.sp.taken[0] = 'a';
  assert.equal(m.spCardAvailable(cards[0]), false);
  assert.equal(m.spCardAvailable(cards[1]), true, 'an untaken card is fine');
  h.m.dispose();
});

test('the options never move the random streams: the same seed draws the same setup', () => {
  const draws = (o) => {
    const h = makeMatch({ mode: 'coop', humans: 2, bots: 2, seed: 4242, ...o }).start();
    const d = { setup: h.m.rngSetup(), shop: h.m.rngShop(), waves: h.m.rngWaves(), draft: h.m.rngDraft(), meta: h.m.rngMeta(), bots: h.m.rngBots() };
    const ids = [...h.m.pool.entries].map(([k, e]) => [k, e.left, e.cap]);
    h.m.dispose();
    return { d, ids };
  };
  const off = draws({});
  assert.deepEqual(draws({ sharedPool: true, sharedBounty: true, multiAlliance: false }), off, 'the official values are the default');
  assert.deepEqual(draws({ sharedPool: false, sharedBounty: false, multiAlliance: true }), off, 'turning them over draws nothing');
});

test('the options are published on every m.public frame, so the client can mark what they change', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 2, sharedPool: false, multiAlliance: true }).start();
  const v = h.m.publicView();
  assert.deepEqual(v.hostConfig, { sharedPool: false, sharedBounty: true, aiPicksLast: false, multiAlliance: true });
  h.m.dispose();
});
