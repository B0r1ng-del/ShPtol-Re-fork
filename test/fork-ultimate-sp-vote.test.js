// test/fork-ultimate-sp-vote.test.js — the 机变阶段改造 (二.4's rules, now driven by the two Mod 开关).
//
//   * 机变不限时间 (`untimedSp`) — with the switch on the draft has no clock at all (`sp.untimed`, `m.deadline === 0`);
//   * 机变随机分配 (`randomSpVote`) — with the switch on any player may vote for a RANDOM allocation instead of picking a
//     card (`g.choiceRandom`); as soon as HALF of the alive players have voted (`votes × 2 ≥ alive`) the system hands the
//     cards out at random, one per alive player, over their own pick; below half every player keeps the card it picked;
//   * A LOSING VOTE STILL EARNS A CARD (owner's report of 2026-10-13): a vote is a request rather than a decision, so the
//     voter keeps its turn and may pick normally — 「选择「随机分配」的玩家应能正常选择道具或敌人或增益」;
//   * 悬赏类不要添加随机机制 — a 悬赏 card adds its enemies to the PICKER's own next battles, so it is never part of the
//     random draw, and in a 悬赏决策 draft (AC-4 R3/R9) the vote is not offered at all;
//   * 保持轮次顺序 — the draft KEEPS the turn order (`parallel: false`). 二.4 first made the whole draft parallel, on the
//     theory that no clock + one player at a time could stall the round; the owner's report of 2026-10-12 (「无论在哪个机变
//     阶段，它都没有按照顺序来，而是谁手快谁先抢到」) shows that is not the official behaviour, and the official 机变 is a
//     turn order (the overlay's 决策顺序 row). The order is back, and the vote — castable at ANY time, not only on the
//     voter's turn — is what keeps an untimed sequential draft from stalling: half the alive players voting ends it.
//
// 二.4 used to hard-code all of this on the mode, which made both switches dead in 六人模式; the switches now decide and
// OFF is the official draft everywhere, so a test wanting these rules turns them on via `mods` (see `atSpDraft`).
//
// The draft machinery is driven through a real six-player match. The vote tests inject a synthetic 道具补给 draft after
// reaching a real SP_DRAFT (a 悬赏 one at R3) so the random path is exercised with a family the vote is offered for.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ERR, PHASE, MOD_RANDOM_SP_FAMILIES } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';
import { GameData } from '../server/match/gamedata.js';
import { DATA, makeMatch, checkInvariants } from './match/harness.js';

const FORK = 'mode_ultimate_abyss';
const COOP = 'mode_multi_abyss';

/**
 * A six-player 终极模拟 match driven to the 机变 of round `round` (the harness must not pick for the humans).
 *
 * 二.4's 机变 rules used to be hard-coded on the mode; since the owner's report of 2026-10-13 they are the two Mod 开关's
 * business, so a test asking for an untimed / voting draft must turn them on.
 */
function atSpDraft(round, { humans = 6, bots = 0, seed = 21, mods = { untimedSp: true, randomSpVote: true } } = {}) {
  const h = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans, bots, seed, fake: true, mods }).start();
  h.drive(() => (h.m.phase === PHASE.ROUND_START && h.m.round === round) || h.m.round > round);
  h.run(() => h.m.phase === PHASE.SP_DRAFT || h.m.round > round);
  return h;
}

/** Replace the real draft with a synthetic one of `family` so the vote is offered (see the header). */
function injectDraft(m, family = 'supply') {
  const g = m.gd;
  const ids = Object.values(g.shopItemsByTier).flat().slice(0, 6);
  const cards = ids.map((id, i) => ({
    kind: 'item', id, name: DATA.items[id].name, desc: '', tier: DATA.items[id].tier, price: 0,
    idx: i, family,
  }));
  const s = m.sp;
  m.sp = {
    ...s, family, name: '道具补给', cards, picks: {}, taken: {},
    randomVotes: new Set(), randomResolved: false, randomOffer: g.spDraftRules.randomFamilies,
  };
  m.startSpTurn();
  return m.sp;
}

describe('二.4 — 终极模拟 机变：去时限 + 轮次顺序 + 随机分配投票', () => {
  test('the Mod 开关 decide the rules; OFF is the official sequential timed draft in every mode', () => {
    // 二.4 used to hard-code these on the fork mode, which made both switches dead there (owner report 2026-10-13).
    // The switches now own both behaviours, so OFF is the official draft everywhere — the fork mode included.
    assert.deepEqual(new GameData(DATA, FORK).spDraftRules, { untimed: false, parallel: false, randomFamilies: null });
    assert.deepEqual(new GameData(DATA, FORK, { untimedSp: true }).spDraftRules, {
      untimed: true, parallel: false, randomFamilies: null,
    });
    assert.deepEqual(new GameData(DATA, FORK, { randomSpVote: true }).spDraftRules, {
      untimed: false, parallel: false, randomFamilies: ['supply', 'shop', 'tactic'],
    });
    for (const id of [COOP, 'mode_multi_hard', 'mode_multi_normal', 'mode_single_abyss', 'mode_multi_funny', FORK]) {
      assert.deepEqual(new GameData(DATA, id).spDraftRules, { untimed: false, parallel: false, randomFamilies: null }, id);
      assert.equal(new GameData(DATA, id).spDraft, null, id);
    }
    assert.ok(!MOD_RANDOM_SP_FAMILIES.includes('bounty'), '悬赏 is never in the list');
  });

  test('protocol: g.choiceRandom is a known client message (empty payload, extras ignored like every {} intent)', () => {
    assert.equal(validateC2S({ t: 'g.choiceRandom' }), null);
    assert.notEqual(validateC2S({ t: 'g.choiceRandomX' }), null, 'an unknown message stays BAD_MSG');
    assert.notEqual(validateC2S(null), null, 'a non-object stays BAD_MSG');
  });

  test('a real R3 悬赏 draft: untimed, sequential, and the random vote is NOT offered', () => {
    const h = atSpDraft(3);
    try {
      const m = h.m;
      assert.equal(m.phase, PHASE.SP_DRAFT);
      assert.equal(m.sp.family, 'bounty', 'AC-4 R3 is 悬赏决策 (the fork copies its schedule)');
      assert.equal(m.sp.untimed, true, '移除时间限制');
      assert.equal(m.sp.parallel, false, '保持轮次顺序 (the owner\'s report of 2026-10-12)');
      assert.equal(m.deadline, 0, 'no clock at all');
      const pub = m.publicView().sp;
      assert.equal(pub.untimed, true);
      assert.equal(pub.parallel, false);
      assert.equal(pub.randomOffer, null, '悬赏决策 never offers 随机分配');
      assert.deepEqual(pub.randomVotes, []);
      // the vote is refused, and the turn order applies (one player at a time, no clock to run out)
      const pids = m.alivePlayers().map((p) => p.playerId);
      assert.equal(m.handle(pids[1], { t: 'g.choiceRandom' }).error, ERR.WRONG_PHASE);
      const turn = m.spTurn();
      const notTurn = pids.find((pid) => pid !== turn);
      assert.equal(m.handle(notTurn, { t: 'g.choice', idx: 0 }).error, ERR.NOT_YOUR_TURN, '谁手快谁先抢到 is gone');
      // each player picks in turn; the phase ends once every seat has acted — no timer needed
      for (let i = 0; i < pids.length; i++) {
        const cur = m.spTurn();
        const avail = m.sp.cards.map((c) => c.idx).find((k) => m.sp.taken[k] == null);
        assert.deepEqual(m.handle(cur, { t: 'g.choice', idx: avail }), { ok: true }, `${cur} picks in turn`);
      }
      h.sched.advance(1);
      assert.equal(m.phase, PHASE.PREP, '机变 ends once everyone has picked — no timer needed');
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test('a real six-player draft is untimed and sequential, and the bots wait for their turn', () => {
    const h = atSpDraft(3, { humans: 2, bots: 4, seed: 22 });
    try {
      const m = h.m;
      assert.equal(m.phase, PHASE.SP_DRAFT);
      assert.equal(m.deadline, 0);
      assert.equal(m.sp.parallel, false);
      assert.equal(m.alivePlayers().length, 6);
      // the humans pick as the turn reaches them; the bots take their own turns as the scheduler reaches them
      for (let i = 0; i < 6; i++) {
        const cur = m.spTurn();
        if (cur == null) break;
        const avail = m.sp.cards.map((c) => c.idx).find((k) => m.sp.taken[k] == null);
        if (cur === 'p_0' || cur === 'p_1') assert.deepEqual(m.handle(cur, { t: 'g.choice', idx: avail }), { ok: true });
        else h.sched.advance(2000);
      }
      h.sched.advance(2000);
      assert.equal(m.phase, PHASE.PREP, 'every seat ended the draft (humans picked, bots picked)');
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test('below half the votes nothing is drawn: each player keeps its own pick — the VOTER included', () => {
    const h = atSpDraft(3, { humans: 4, bots: 0, seed: 23 });
    try {
      const m = h.m;
      const s = injectDraft(m, 'supply');
      assert.equal(m.randomVoteOffered(), true);
      const pids = m.alivePlayers().map((p) => p.playerId);
      assert.equal(pids.length, 4);
      // one vote of four = below half (1 × 2 < 4). `s` is the live draft object (m.sp is cleared once the phase moves on)
      assert.deepEqual(m.handle(pids[0], { t: 'g.choiceRandom' }), { ok: true });
      assert.equal(s.randomResolved, false);
      assert.equal(m.voteRandomReached(), false);
      assert.deepEqual(m.publicView().sp.randomVotes, [pids[0]]);
      assert.equal(m.handle(pids[0], { t: 'g.choiceRandom' }).error, ERR.ALREADY, 'one vote each');
      // THE OWNER'S BUG (2026-10-13): a vote used to count as a finished turn, so the voter's seat was skipped and the
      // draft ended with it holding nothing (「导致最后一名玩家没有拿到任何道具或敌人」). The vote is only a request, so
      // every player — the voter included — still picks its own card, and below half nothing is drawn over those picks.
      const chosen = {};
      for (let i = 0; i < pids.length; i++) {
        const cur = m.spTurn();
        assert.ok(cur != null, `the draft still has a seat to ask at step ${i} — the voter must not be skipped`);
        const avail = s.cards.map((c) => c.idx).find((k) => s.taken[k] == null);
        chosen[cur] = avail;
        assert.deepEqual(m.handle(cur, { t: 'g.choice', idx: avail }), { ok: true }, `${cur} picks on its turn`);
      }
      const picks = { ...s.picks };
      for (const [pid, idx] of Object.entries(chosen)) assert.equal(picks[pid], idx, `${pid} keeps its own pick`);
      assert.ok(Number.isInteger(picks[pids[0]]), 'the voter still received a card of its own');
      assert.equal(Object.keys(chosen).length, pids.length, 'every player picked, the voter included');
      assert.equal(new Set(Object.values(chosen)).size, pids.length, 'no card went to two players');
      h.sched.advance(1);
      assert.equal(m.phase, PHASE.PREP);
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test("the owner's exact sequence: everyone picks, the LAST seat votes, and it still gets a card", () => {
    // 「前几名玩家都选择了道具，最后一名玩家选择了“随机分配”，但无法选择道具。系统判定投票随机分配的玩家不够，便直接结束
    //   了机变阶段，导致最后一名玩家没有拿到任何道具或敌人」
    const h = atSpDraft(3, { humans: 4, bots: 0, seed: 26 });
    try {
      const m = h.m;
      const s = injectDraft(m, 'supply');
      const pids = m.alivePlayers().map((p) => p.playerId);
      // the first three seats pick their own cards, in the draft's own turn order
      const picked = [];
      while (picked.length < pids.length - 1) {
        const cur = m.spTurn();
        assert.ok(cur != null, 'the draft still has a seat to ask');
        assert.deepEqual(m.handle(cur, { t: 'g.choice', idx: picked.length }), { ok: true }, `${cur} picks on its turn`);
        picked.push(cur);
      }
      const last = m.spTurn();
      assert.ok(!picked.includes(last), 'the last seat is the one nobody has asked yet');
      const takenBefore = Object.keys(s.taken).filter((k) => s.taken[k] != null).length;
      assert.deepEqual(m.handle(last, { t: 'g.choiceRandom' }), { ok: true }, 'the last seat votes');
      assert.equal(s.randomResolved, false, '1 of 4 is below half — nothing is drawn');
      assert.equal(m.phase, PHASE.SP_DRAFT, 'the phase did NOT end on the failed vote');
      // the reported 「无法选择道具」: the seat must still be able to pick, and must be asked
      assert.deepEqual(m.handle(last, { t: 'g.choice', idx: 3 }), { ok: true }, 'the voter can still pick a card');
      assert.equal(s.picks[last], 3, 'the voter now holds a card');
      assert.equal(Object.keys(s.taken).filter((k) => s.taken[k] != null).length, takenBefore + 1, 'exactly one more card was taken');
      for (const pid of pids) assert.ok(Number.isInteger(s.picks[pid]), `${pid} ended the draft with a card`);
      h.sched.advance(1);
      assert.equal(m.phase, PHASE.PREP);
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test('a vote that loses must not leave a seat empty even if it never gets to pick (the last net)', () => {
    // safety net: if the draft reaches its end with a living seat still holding nothing, `finishSpDraft` hands it a card
    const h = atSpDraft(3, { humans: 4, bots: 0, seed: 27 });
    try {
      const m = h.m;
      const s = injectDraft(m, 'supply');
      const voter = m.spTurn();
      assert.deepEqual(m.handle(voter, { t: 'g.choiceRandom' }), { ok: true }, 'the seat on turn votes');
      // every OTHER seat picks; the voter is skipped by hand so the draft can reach its end with it still empty
      for (let i = 0; i < 8; i++) {
        const cur = m.spTurn();
        if (cur == null || cur === voter) break;
        const avail = s.cards.map((c) => c.idx).find((k) => s.taken[k] == null);
        assert.deepEqual(m.handle(cur, { t: 'g.choice', idx: avail }), { ok: true }, `${cur} picks`);
      }
      assert.equal(s.picks[voter], undefined, 'the voter still holds nothing at this point');
      m.finishSpDraft();
      assert.ok(Number.isInteger(s.picks[voter]), 'the empty seat was filled before PREP');
      assert.equal(s.taken[s.picks[voter]], voter, 'taken ↔ picks agree');
      assert.equal(m.phase, PHASE.PREP);
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test('half the votes is enough: the system hands the cards out at random, one per player', () => {
    const h = atSpDraft(3, { humans: 4, bots: 0, seed: 24 });
    try {
      const m = h.m;
      const s = injectDraft(m, 'supply');
      const pids = m.alivePlayers().map((p) => p.playerId);
      // two of four take their own picks on their turns — the random draw overrides them
      const pickers = [];
      for (let i = 0; i < 2; i++) {
        const cur = m.spTurn();
        pickers.push(cur);
        assert.deepEqual(m.handle(cur, { t: 'g.choice', idx: i }), { ok: true }, `${cur} picks on its turn`);
      }
      const before = { ...s.picks };
      const voters = pids.filter((pid) => !pickers.includes(pid));
      assert.deepEqual(m.handle(voters[0], { t: 'g.choiceRandom' }), { ok: true });
      assert.equal(s.randomResolved, false, '2 of 4 is half — one vote is not enough');
      assert.deepEqual(m.handle(voters[1], { t: 'g.choiceRandom' }), { ok: true });
      assert.equal(s.randomResolved, true, '2 × 2 ≥ 4 → resolved at once');
      // every alive player ends with exactly one card, and the cards are a set of distinct indexes
      const picks = pids.map((pid) => s.picks[pid]);
      assert.ok(picks.every((i) => Number.isInteger(i)), `every player got a card (${JSON.stringify(picks)})`);
      assert.equal(new Set(picks).size, pids.length, 'no card went to two players');
      for (const pid of pids) assert.equal(s.taken[s.picks[pid]], pid, 'taken ↔ picks agree');
      for (const pid of pickers) assert.ok(before[pid] != null, `${pid}: the earlier own pick was overridden by the draw`);
      h.sched.advance(1);
      assert.equal(m.phase, PHASE.PREP);
      assert.equal(m.publicView().sp, undefined, 'the draft is over');
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test('悬赏 cards are never part of the random draw, even when the family is listed', () => {
    const h = atSpDraft(3, { humans: 4, bots: 0, seed: 25 });
    try {
      const m = h.m;
      const s = injectDraft(m, 'supply');
      // mark two of the six cards as 悬赏 and list 'bounty' in the offer: the draw must still skip them
      s.cards[4].family = 'bounty';
      s.cards[5].family = 'bounty';
      s.randomOffer = ['supply', 'bounty'];
      assert.equal(m.randomChoiceEligible(s.cards[4]), false, 'a bounty card is never drawn');
      assert.equal(m.randomChoiceEligible(s.cards[0]), true);
      const pids = m.alivePlayers().map((p) => p.playerId);
      for (const pid of pids.slice(0, 2)) assert.deepEqual(m.handle(pid, { t: 'g.choiceRandom' }), { ok: true });
      assert.equal(s.randomResolved, true);
      const picks = pids.map((pid) => s.picks[pid]);
      for (const i of [4, 5]) assert.ok(!picks.includes(i), `card ${i} (悬赏) was not handed out`);
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });

  test('the official modes are untouched: timed, sequential, and g.choiceRandom is refused', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 3, seed: 14, fake: true }).start();
    try {
      const m = h.m;
      h.drive(() => (m.phase === PHASE.ROUND_START && m.round === 3) || m.round > 3);
      h.run(() => m.phase === PHASE.SP_DRAFT || m.round > 3);
      assert.equal(m.phase, PHASE.SP_DRAFT);
      assert.equal(m.sp.untimed, false);
      assert.equal(m.sp.parallel, false, 'no parallel draft outside the fork mode');
      assert.equal(m.randomVoteOffered(), false);
      assert.ok(m.deadline > 0, 'the official 机变 keeps its clock');
      const pids = m.sp.order.slice();
      assert.equal(m.handle(pids[1], { t: 'g.choiceRandom' }).error, ERR.WRONG_PHASE);
      assert.equal(m.handle(pids[1], { t: 'g.choice', idx: 0 }).error, ERR.NOT_YOUR_TURN, 'the turn order still applies');
      assert.deepEqual(m.handle(pids[0], { t: 'g.choice', idx: 0 }), { ok: true });
      checkInvariants(m);
    } finally {
      h.m.dispose();
    }
  });
});
