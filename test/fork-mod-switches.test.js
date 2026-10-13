// test/fork-mod-switches.test.js — the Mod 开关 of the 模式界面 (fork feature): 「关闭盟约禁用」 and 「机变不限时」.
//
// The lobby's Mod button opens a submenu of gameplay switches, laid out beside 干员调配. They are a per-device preference
// (public/js/ui/mods.js, localStorage) that the room creator carries into the room it makes (`room.create.mods`,
// MOD_KEYS in shared/constants.js); the room keeps them and the match reads them when it starts.
//
// Each switch must be OFF by default: a room created without them, and every caller that passes nothing (the golden
// scenarios, the rehearsal tools, every test), has to stay byte-identical to the official mode. This suite pins that
// down first, then the two switches' own behaviour.
//
//   noBondBan  关闭盟约禁用  — no 盟约 is disabled in ANY mode: neither the per-match draw (config.bans /
//                            modes[].bans) nor the mode's static inactiveBondIds list (标准模拟's ten).
//   untimedSp  机变不限时    — the 机变 draft of ANY mode runs without a clock (spFirst / spTurn not armed), and ends
//                            once every alive player has picked.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../server/match/gamedata.js';
import { drawDisabledBonds } from '../server/match/pool.js';
import { createRng } from '../server/sim/rng.js';
import { ERR, PHASE, MOD_KEYS, MOD_DEFAULTS, normalizeMods } from '../shared/constants.js';
import { DATA, makeMatch, checkInvariants } from './match/harness.js';

const gd = (modeId, mods) => new GameData(DATA, modeId, mods);
/** 标准模拟 (FUNNY) is the mode with the ten static bans; 险境模拟 (NORMAL) has none but draws 3 + 4. */
const FUNNY = 'mode_multi_funny';
const NORMAL = 'mode_multi_normal';
const ABYSS = 'mode_multi_abyss';

describe('Mod 开关 — the catalogue and its defaults', () => {
  test('every catalogue key defaults off (the official behaviour)', () => {
    // The catalogue grows as switches are added (四.1 has two, 四.2 adds a third). Assert the INVARIANT — every key
    // listed, every default off — rather than a frozen list, so adding a switch cannot silently pass by not being
    // covered here; test/fork-mod-random-sp.test.js pins the individual switches' own rules.
    for (const k of MOD_KEYS) assert.equal(MOD_DEFAULTS[k], false, `${k} defaults off`);
    assert.ok(MOD_KEYS.includes('noBondBan') && MOD_KEYS.includes('untimedSp'), '四.1 keys present');
    assert.equal(Object.keys(MOD_DEFAULTS).length, MOD_KEYS.length, 'defaults cover exactly the catalogue');
    for (const k of Object.keys(MOD_DEFAULTS)) assert.ok(MOD_KEYS.includes(k), `${k} is a catalogue key`);
  });

  test('normalizeMods is total: garbage and unknown keys never switch anything on', () => {
    /** The all-off payload of the current catalogue (every key false). */
    const allOff = () => Object.fromEntries(MOD_KEYS.map((k) => [k, false]));
    assert.deepEqual(normalizeMods(undefined), allOff());
    assert.deepEqual(normalizeMods(null), allOff());
    assert.deepEqual(normalizeMods('nope'), allOff());
    assert.deepEqual(normalizeMods([1, 2]), allOff());
    // a non-boolean truthy value is NOT `true` (the protocol only ever sends booleans)
    assert.deepEqual(normalizeMods(Object.fromEntries(MOD_KEYS.map((k) => [k, 1]))), allOff());
    assert.deepEqual(normalizeMods({ untimedSp: 'yes' }), allOff());
    // an unknown key is dropped, not carried through
    assert.deepEqual(normalizeMods({ noBondBan: true, bogus: true }), { ...allOff(), noBondBan: true });
  });

  test('an absent / partial payload is exactly the official mode', () => {
    for (const modeId of [FUNNY, NORMAL, ABYSS, 'mode_single_normal', 'mode_ultimate_abyss']) {
      const plain = gd(modeId);
      for (const k of MOD_KEYS) assert.equal(plain.mods[k], false, `${modeId}: ${k} off`);
      // a partial payload that only names one switch leaves every other off
      assert.deepEqual(gd(modeId, { noBondBan: true }).mods, { ...Object.fromEntries(MOD_KEYS.map((k) => [k, false])), noBondBan: true }, modeId);
    }
  });
});

describe('Mod 开关 关闭盟约禁用 (noBondBan) — no 盟约 is disabled in any mode', () => {
  test('bans() returns 0 / 0 in every mode, whatever the difficulty table says', () => {
    // the official tables, for the record: FUNNY 0 + 1, NORMAL / HARD / ABYSS 3 + 4, 终极模拟 0 + 0
    assert.deepEqual(gd(FUNNY).bans('FUNNY'), { core: 0, addon: 1 });
    assert.deepEqual(gd(NORMAL).bans('NORMAL'), { core: 3, addon: 4 });
    assert.deepEqual(gd(ABYSS).bans('ABYSS'), { core: 3, addon: 4 });
    for (const [modeId, difficulty] of [[FUNNY, 'FUNNY'], [NORMAL, 'NORMAL'], [ABYSS, 'ABYSS'], ['mode_multi_hard', 'HARD'], ['mode_single_normal', 'NORMAL'], ['mode_ultimate_abyss', 'ABYSS']]) {
      assert.deepEqual(gd(modeId, { noBondBan: true }).bans(difficulty), { core: 0, addon: 0 }, `${modeId}/${difficulty}`);
    }
  });

  test("the mode's own static list is emptied too — 标准模拟's ten 盟约 come back", () => {
    // 标准模拟 never activates ten 盟约 (inactiveBondIds). The switch is "no 盟约 is disabled this match", so those ten
    // must come back with it — otherwise it would be half a switch.
    const off = gd(FUNNY);
    assert.equal(off.modeInactiveBonds.size, 10, 'the official list');
    assert.ok(off.modeInactiveBonds.has('lateranoShip') && off.modeInactiveBonds.has('arcaneShip'));
    const on = gd(FUNNY, { noBondBan: true });
    assert.deepEqual([...on.modeInactiveBonds], []);
    // a mode with no static list is unaffected either way
    assert.equal(gd(NORMAL).modeInactiveBonds.size, 0);
    assert.equal(gd(NORMAL, { noBondBan: true }).modeInactiveBonds.size, 0);
  });

  test('the per-match draw is empty in every mode and over many seeds, and bans no 干员', () => {
    for (const modeId of [FUNNY, NORMAL, ABYSS, 'mode_multi_hard', 'mode_single_normal']) {
      const g = gd(modeId, { noBondBan: true });
      for (let seed = 1; seed <= 30; seed++) {
        const { drawn, staticOff, banned } = drawDisabledBonds(g, createRng(seed));
        assert.deepEqual(drawn, [], `${modeId} seed ${seed}: nothing drawn`);
        assert.deepEqual(staticOff, [], `${modeId} seed ${seed}: nothing statically off`);
        assert.deepEqual(banned, [], `${modeId} seed ${seed}: no 干员 banned`);
      }
    }
  });

  test('a real match with the switch on opens the whole pool; with it off nothing changes', () => {
    for (const mode of ['solo', 'coop', 'ultimate']) {
      const on = makeMatch({ mode, difficulty: 'ABYSS', humans: mode === 'solo' ? 1 : 2, seed: 5, fake: true, mods: { noBondBan: true } });
      try {
        const m = on.m;
        assert.deepEqual(m.disabledBonds, [], `${mode}: no 盟约 drawn`);
        assert.deepEqual(m.staticInactiveBonds, [], `${mode}: no statically inactive 盟约`);
        assert.deepEqual(m.bannedChess, [], `${mode}: no 干员 banned`);
        assert.equal(m.pool.entries.size, m.gd.visibleChess.length, `${mode}: the whole roster stays rollable`);
        assert.equal(m.mods.noBondBan, true, `${mode}: reported back to the client`);
      } finally {
        on.m.dispose();
      }
    }
    // off (and absent) = the official behaviour, unchanged
    const off = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, seed: 5, fake: true });
    try {
      assert.equal(off.m.disabledBonds.length, 7, '3 core + 4 add-on');
      assert.ok(off.m.pool.entries.size < off.m.gd.visibleChess.length, 'and that removes 干员 from the pool');
      assert.deepEqual(off.m.mods, Object.fromEntries(MOD_KEYS.map((k) => [k, false])));
    } finally {
      off.m.dispose();
    }
  });

  test('the switch reaches the client: m.public.mods carries it on every frame', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, seed: 5, fake: true, mods: { noBondBan: true } }).start();
    try {
      const pub = h.lastBc('m.public');
      assert.ok(pub, 'a public frame was broadcast');
      assert.deepEqual(pub.mods, { ...Object.fromEntries(MOD_KEYS.map((k) => [k, false])), noBondBan: true });
      // and the bonds the client greys: with the switch on nothing is 本局禁用
      assert.deepEqual(pub.disabledBonds, []);
      assert.deepEqual(pub.drawnDisabledBonds, []);
    } finally {
      h.m.dispose();
    }
  });
});

describe('Mod 开关 机变不限时间 (untimedSp) — the 机变 draft of any mode loses its clock', () => {
  test('spDraftRules.untimed follows the switch in EVERY mode, both on and off', () => {
    for (const modeId of [FUNNY, NORMAL, ABYSS, 'mode_multi_hard', 'mode_single_normal', 'mode_ultimate_abyss']) {
      // OFF = the official clock, in every mode (the owner's report of 2026-10-13: the switch used to be dead in
      // 六人模式 because the mode's own hard-coded `untimed: true` was ORed into the answer)
      assert.equal(gd(modeId).spDraftRules.untimed, false, `${modeId}: timed without the switch`);
      assert.equal(gd(modeId, { untimedSp: true }).spDraftRules.untimed, true, `${modeId}: untimed with the switch`);
    }
    // the switch never touches `parallel` (三.4 restored the official turn order) nor `randomFamilies` (the 随机分配
    // switch's business) — whatever the mode carries, the timer switch leaves it exactly as it was
    const plainFork = gd('mode_ultimate_abyss').spDraftRules;
    const switchFork = gd('mode_ultimate_abyss', { untimedSp: true }).spDraftRules;
    assert.equal(switchFork.parallel, plainFork.parallel, 'parallel unchanged');
    assert.deepEqual(switchFork.randomFamilies, plainFork.randomFamilies, 'randomFamilies unchanged');
    assert.equal(plainFork.randomFamilies, null, 'the fork mode carries no 机变 block of its own any more');
  });

  test('a real match runs an untimed 机变 draft: no deadline is armed', () => {
    // 险境模拟 / ABYSS is timed officially (spFirst 30 s / spTurn 16 s). With the switch the draft must arm nothing.
    const on = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, seed: 3, fake: true, mods: { untimedSp: true } });
    try {
      const m = on.m;
      assert.equal(m.spRules.untimed, true);
      // the official mode is timed: this pins that the switch is what changed it, not the mode
      assert.ok(m.gd.timer('spFirst') > 0, 'the mode still has its official timer values');
    } finally {
      on.m.dispose();
    }
    const off = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, seed: 3, fake: true });
    try {
      assert.equal(off.m.spRules.untimed, false);
    } finally {
      off.m.dispose();
    }
  });

  test('六人模式 (终极模拟): the switch decides in a REAL match, both ways (owner report 2026-10-13)', () => {
    // 「该功能无论开启还是关闭，在所有模式里机变阶段都是不限时的，开关没有生效」 — the mode used to hard-code
    // `spDraft.untimed: true`, which `spDraftRules` ORed into the switch's answer, so OFF could not restore the clock.
    for (const [on, expected] of [[false, false], [true, true]]) {
      const h = makeMatch({
        mode: 'ultimate', difficulty: 'ABYSS', humans: 2, bots: 4, seed: 9, fake: true,
        mods: on ? { untimedSp: true } : {},
      }).start();
      try {
        h.drive(() => h.m.phase === PHASE.SP_DRAFT || h.m.round > 3);
        assert.equal(h.m.phase, PHASE.SP_DRAFT, 'reached a real 六人模式 机变');
        assert.equal(h.m.sp.untimed, expected, `untimedSp ${on ? 'ON' : 'OFF'} → sp.untimed ${expected}`);
        assert.equal(h.m.spRules.untimed, expected);
        if (expected) assert.equal(h.m.deadline, 0, 'no clock is armed');
        else assert.ok(h.m.deadline > 0, 'the official clock is armed again (关闭时恢复原版的时间限制)');
        checkInvariants(h.m);
      } finally { h.m.dispose(); }
    }
  });

  test('六人模式 (终极模拟): 机变随机分配 follows the switch in a REAL match, both ways', () => {
    // 「该 mod 功能在六人模式里无论开启还是关闭都不生效」 — same OR bug, same fix
    const off = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans: 2, bots: 4, seed: 9, fake: true }).start();
    try {
      off.drive(() => off.m.phase === PHASE.SP_DRAFT || off.m.round > 3);
      const s = off.m.sp;
      assert.equal(s.randomOffer, null, 'OFF: the vote is not offered in 六人模式');
      assert.equal(off.m.randomVoteOffered(), false);
      // and the protocol refuses it there, so a stale tab cannot force it on
      assert.equal(off.m.handle(off.m.alivePlayers()[0].playerId, { t: 'g.choiceRandom' }).error, ERR.WRONG_PHASE);
    } finally { off.m.dispose(); }
    const on = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans: 2, bots: 4, seed: 9, fake: true, mods: { randomSpVote: true } }).start();
    try {
      on.drive(() => on.m.phase === PHASE.SP_DRAFT || on.m.round > 3);
      const s = on.m.sp;
      assert.deepEqual(s.randomOffer, ['supply', 'shop', 'tactic'], 'ON: the vote is offered');
      // a 悬赏 draft still refuses it (悬赏类不要添加随机机制)
      if (s.family === 'bounty') assert.equal(on.m.randomVoteOffered(), false);
      checkInvariants(on.m);
    } finally { on.m.dispose(); }
  });

  test('both switches are independent: turning one on leaves the other alone', () => {
    const onlyBan = gd(NORMAL, { noBondBan: true });
    assert.deepEqual(onlyBan.bans('NORMAL'), { core: 0, addon: 0 });
    assert.equal(onlyBan.spDraftRules.untimed, false, '机变 stays timed');
    const onlySp = gd(NORMAL, { untimedSp: true });
    assert.deepEqual(onlySp.bans('NORMAL'), { core: 3, addon: 4 }, 'the bans stay drawn');
    assert.equal(onlySp.spDraftRules.untimed, true);
  });
});
