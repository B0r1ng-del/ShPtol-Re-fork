// test/fork-mod-random-sp.test.js — the Mod 开关 四.2 「机变随机分配」 (`randomSpVote`): the 机变 draft of ANY mode offers
// the 「随机分配」 vote.
//
// Requirement 3 of the owner's list: 「机变阶段随机抽取选项：改为全模式都有」. The vote itself already exists — 二.4 built it
// for 终极模拟 (`g.choiceRandom`, half the alive players resolve it, one card each) — so this change only decides WHO is
// offered it. The owner's call (2026-10-13) was to make it a Mod 开关 that defaults OFF, so the official modes keep the
// official draft: 「放进 Mod 子菜单，默认关闭（推荐）」.
//
// The seam is `GameData.spDraftRules.randomFamilies` — the list the client's vote button and the server's
// `randomVoteOffered()` both key on. The switch fills it in for a mode whose own `spDraft` does not (and never narrows
// one that does, so 终极模拟 keeps its own list). 悬赏 is never in it, for the 二.4 reason the comment there gives.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PHASE, MOD_KEYS, MOD_DEFAULTS, MOD_RANDOM_SP_FAMILIES, normalizeMods } from '../shared/constants.js';
import { GameData } from '../server/match/gamedata.js';
import { DATA, makeMatch, checkInvariants } from './match/harness.js';

const gd = (modeId, mods) => new GameData(DATA, modeId, mods);
const FORK = 'mode_ultimate_abyss';
/** Every official mode (none of them carries an `spDraft` block). */
const OFFICIAL = ['mode_multi_abyss', 'mode_multi_hard', 'mode_multi_normal', 'mode_multi_funny', 'mode_single_abyss', 'mode_single_normal', 'mode_single_funny'];

describe('四.2 Mod 开关 机变随机分配 (randomSpVote) — the 随机分配 vote in every mode', () => {
  test('the switch is in the catalogue and defaults off', () => {
    assert.ok(MOD_KEYS.includes('randomSpVote'));
    assert.equal(MOD_DEFAULTS.randomSpVote, false);
    assert.deepEqual(normalizeMods(undefined).randomSpVote, false);
    assert.equal(normalizeMods({ randomSpVote: true }).randomSpVote, true);
    // the switch's default family list never contains 悬赏 (二.4's rule, and the reason a 悬赏决策 draft has no vote)
    assert.ok(!MOD_RANDOM_SP_FAMILIES.includes('bounty'));
    assert.deepEqual([...MOD_RANDOM_SP_FAMILIES], ['supply', 'shop', 'tactic']);
  });

  test('off: every official mode keeps its official draft (no offer), 终极模拟 keeps its own', () => {
    for (const id of OFFICIAL) {
      assert.deepEqual(gd(id).spDraftRules, { untimed: false, parallel: false, randomFamilies: null }, id);
      assert.equal(gd(id).spDraft, null, id);
    }
    assert.deepEqual(gd(FORK).spDraftRules.randomFamilies, ['supply', 'shop', 'tactic'], '二.4 unchanged');
  });

  test('on: every official mode offers the vote with the switch\'s families', () => {
    for (const id of OFFICIAL) {
      const rules = gd(id, { randomSpVote: true }).spDraftRules;
      assert.deepEqual(rules.randomFamilies, ['supply', 'shop', 'tactic'], id);
      // and it changes nothing else: the switch is not a timer and not a parallel switch
      assert.equal(rules.untimed, false, `${id}: still timed`);
      assert.equal(rules.parallel, false, `${id}: still sequential`);
    }
  });

  test('on: 终极模拟 keeps its OWN families — the switch widens the offer, it never narrows a mode\'s own', () => {
    const fork = gd(FORK, { randomSpVote: true }).spDraftRules;
    assert.deepEqual(fork.randomFamilies, ['supply', 'shop', 'tactic']);
    assert.deepEqual(fork, { untimed: true, parallel: false, randomFamilies: ['supply', 'shop', 'tactic'] });
    // a mode whose own list is narrower keeps exactly that list, not the switch's default
    const patched = {
      ...DATA,
      config: {
        ...DATA.config,
        modes: {
          ...DATA.config.modes,
          mode_narrow_vote: { ...DATA.config.modes['mode_multi_hard'], modeId: 'mode_narrow_vote', spDraft: { randomVote: { families: ['tactic'] } } },
        },
      },
    };
    assert.deepEqual(new GameData(patched, 'mode_narrow_vote', { randomSpVote: true }).spDraftRules.randomFamilies, ['tactic']);
    // and a malformed own list falls back to the switch's, not to null
    const bad = { ...DATA, config: { ...DATA.config, modes: { ...DATA.config.modes, mode_bad_vote: { ...DATA.config.modes['mode_multi_hard'], modeId: 'mode_bad_vote', spDraft: { randomVote: { families: 'nope' } } } } } };
    assert.deepEqual(new GameData(bad, 'mode_bad_vote', { randomSpVote: true }).spDraftRules.randomFamilies, ['supply', 'shop', 'tactic']);
    assert.equal(new GameData(bad, 'mode_bad_vote').spDraftRules.randomFamilies, null, 'and nothing without the switch');
  });

  test('on: a real co-op 机变 draft carries the offer to the client and accepts the vote', () => {
    // 险境模拟 (NORMAL) is an official mode: its draft is timed and offers nothing without the switch. With it, the
    // public frame carries the list, the vote is accepted, and half the alive players resolve the draft.
    const off = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 3, fake: true });
    try {
      assert.equal(off.m.spRules.randomFamilies, null, 'no offer without the switch');
    } finally {
      off.m.dispose();
    }
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 4, seed: 3, fake: true, mods: { randomSpVote: true } }).start();
    try {
      const m = h.m;
      assert.deepEqual(m.spRules.randomFamilies, ['supply', 'shop', 'tactic']);
      // run to the first 机变 draft — the runToPhase assertion fails loudly rather than skipping silently
      h.runToPhase(PHASE.SP_DRAFT);
      const pub = m.publicView().sp;
      assert.ok(pub, 'the public sp block is there');
      assert.equal(pub.untimed, false, 'the switch did not touch the timer');
      assert.equal(m.deadline > 0, true, 'and the official clock is armed');
      // 悬赏 never offers it, whatever the switch says (二.4's rule)
      if (pub.family === 'bounty') {
        assert.equal(m.randomVoteOffered(), false, '悬赏决策 never offers 随机分配');
        assert.equal(pub.randomOffer, null);
      } else {
        assert.equal(m.randomVoteOffered(), true, `${pub.family} offers it with the switch`);
        assert.deepEqual(pub.randomOffer, ['supply', 'shop', 'tactic']);
        // four alive players → half is two, so ONE vote does not resolve the draft yet: the count is observable
        const pids = m.alivePlayers().map((p) => p.playerId);
        assert.equal(pids.length, 4);
        const voter = pids[pids.length - 1];
        assert.deepEqual(m.handle(voter, { t: 'g.choiceRandom' }), { ok: true });
        assert.ok(m.sp.randomVotes.has(voter));
        assert.deepEqual(m.publicView().sp.randomVotes, [voter], 'the vote is public');
        assert.equal(m.voteRandomReached(), false, '1 of 4 is below half');
        assert.equal(m.phase, PHASE.SP_DRAFT, 'the draft goes on');
        // a second vote reaches half and resolves the draft on the spot, handing the cards out at random
        const other = pids.find((pid) => pid !== voter);
        assert.deepEqual(m.handle(other, { t: 'g.choiceRandom' }), { ok: true });
        assert.equal(m.phase, PHASE.PREP, 'half the alive players resolve it into the prep');
        checkInvariants(m);
      }
    } finally {
      h.m.dispose();
    }
  });

  test('on: the switch is independent of the other two', () => {
    const only = gd('mode_multi_normal', { randomSpVote: true });
    assert.deepEqual(only.bans('NORMAL'), { core: 3, addon: 4 }, '关闭盟约禁用 is off: the bans stay');
    assert.equal(only.spDraftRules.untimed, false, '机变不限时 is off: still timed');
    assert.deepEqual(only.spDraftRules.randomFamilies, ['supply', 'shop', 'tactic'], 'and this one is on');
    const all = gd('mode_multi_normal', { noBondBan: true, untimedSp: true, randomSpVote: true });
    assert.deepEqual(all.bans('NORMAL'), { core: 0, addon: 0 });
    assert.equal(all.spDraftRules.untimed, true);
    assert.deepEqual(all.spDraftRules.randomFamilies, ['supply', 'shop', 'tactic']);
  });
});
