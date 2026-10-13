// test/fork-ultimate-bans.test.js — 终极模拟's bond bans, as reversed by the owner on 2026-10-13.
//
// HISTORY. Requirement 二.1 first made the six-博士 room ban nothing: the fork mode carried its own
// `bans: { core: 0, addon: 0 }` table and `GameData.bans()` preferred it, so the per-match draw removed no 盟约 and no
// 干员 ever left the shop pool. The owner's report of 2026-10-13 reverses that: 「六人模式恢复像同盟模拟一样禁用一些盟约，
// 全不禁止需要在 mod 菜单开启」 — the six-博士 room is a NORMAL room and bans 盟约 exactly like 同盟模拟; "ban nothing"
// moved behind the Mod 开关 `noBondBan` (shared/constants.js MOD_KEYS, test/fork-mod-switches.test.js).
//
// So the mode carries NO table of its own and `bans()` falls back to the difficulty's (`config.bans.ABYSS` = 3 + 4).
// This suite pins down both halves: that the fork mode now resolves exactly what AC-4 resolves, and that the switch
// still restores the old no-ban behaviour when a player turns it on.
//
// How the game removes bonds (server/match/pool.js drawDisabledBonds): it draws `core` core bonds and `addon` add-on
// bonds out of the difficulty's table and bans every 干员 whose whole bond list is covered by that draw plus the mode's
// inactiveBondIds. Removing one bond is enough to take a 干员 out of the shop for the whole run.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../server/match/gamedata.js';
import { SharedPool, drawDisabledBonds } from '../server/match/pool.js';
import { createRng } from '../server/sim/rng.js';
import { ULTIMATE_SEATS } from '../shared/constants.js';
import { DATA, makeMatch } from './match/harness.js';

const FORK = 'mode_ultimate_abyss';
const COOP_ABYSS = 'mode_multi_abyss';
const gd = (modeId, mods) => new GameData(DATA, modeId, mods);

describe('二.1 (reversed) — 终极模拟 bans 盟约 exactly like 同盟模拟', () => {
  test('the fork mode has no ban table of its own: bans() resolves the difficulty table, as AC-4 does', () => {
    // the mode record carries no `bans` key at all, so the difficulty's ABYSS table (3 core + 4 add-on) applies
    assert.equal(gd(FORK).mode.bans, undefined, 'the fork mode carries no ban table');
    assert.deepEqual(gd(FORK).bans('ABYSS'), { core: 3, addon: 4 });
    // …which is byte-for-byte what the official AC-4 co-op room resolves
    assert.deepEqual(gd(COOP_ABYSS).bans('ABYSS'), { core: 3, addon: 4 });
    assert.deepEqual(gd(FORK).bans('ABYSS'), gd(COOP_ABYSS).bans('ABYSS'), 'the two rooms agree');
    // the other official modes keep the difficulty they were given
    assert.deepEqual(gd('mode_multi_hard').bans('HARD'), { core: 3, addon: 4 });
    assert.deepEqual(gd('mode_multi_funny').bans('FUNNY'), { core: 0, addon: 1 });
    assert.deepEqual(gd('mode_single_normal').bans('NORMAL'), { core: 3, addon: 4 });
    assert.deepEqual(gd('mode_training_1').bans('TRAINING'), { core: 0, addon: 0 });
  });

  test('GameData.bans() still honours a mode table when one exists, and a partial one means 0 for the rest', () => {
    // the mechanism 二.1 used is intact — only 终极模拟 stopped using it. A mode table still wins over the difficulty's.
    const patched = {
      ...DATA,
      config: {
        ...DATA.config,
        modes: {
          ...DATA.config.modes,
          mode_partial_bans: { ...DATA.config.modes[COOP_ABYSS], modeId: 'mode_partial_bans', bans: { core: 2 } },
          mode_empty_bans: { ...DATA.config.modes[COOP_ABYSS], modeId: 'mode_empty_bans', bans: {} },
          mode_bad_bans: { ...DATA.config.modes[COOP_ABYSS], modeId: 'mode_bad_bans', bans: 'nope' },
        },
      },
    };
    assert.deepEqual(new GameData(patched, 'mode_partial_bans').bans('ABYSS'), { core: 2, addon: 0 });
    assert.deepEqual(new GameData(patched, 'mode_empty_bans').bans('ABYSS'), { core: 0, addon: 0 });
    assert.deepEqual(new GameData(patched, 'mode_bad_bans').bans('ABYSS'), { core: 3, addon: 4 }, 'a malformed table falls back');
  });

  test('the per-match draw removes 盟约 and 干员 from the fork mode, over many seeds', () => {
    const g = gd(FORK);
    assert.equal(g.modeInactiveBonds.size, 0, 'no statically inactive bond (the mode record has none)');
    let sawBanned = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { drawn, staticOff, banned } = drawDisabledBonds(g, createRng(seed));
      assert.equal(drawn.length, 7, `seed ${seed}: 3 core + 4 add-on, as AC-4`);
      assert.deepEqual(staticOff, [], `seed ${seed}: nothing statically off`);
      if (banned.length) sawBanned++;
    }
    assert.ok(sawBanned > 0, 'the draw really takes 干员 out of the shop in some matches');
  });

  test('a real 终极模拟 match bans like an AC-4 co-op match; the switch restores the old no-ban behaviour', () => {
    const fork = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans: 2, seed: 5, fake: true });
    try {
      const m = fork.m;
      assert.equal(m.modeId, FORK);
      assert.equal(m.disabledBonds.length, 7, '3 core + 4 add-on, like 同盟模拟');
      assert.deepEqual(m.staticInactiveBonds, []);
      assert.ok(m.pool.entries.size < m.gd.visibleChess.length, 'and that removes 干员 from the pool');
    } finally {
      fork.m.dispose();
    }
    const coop = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, seed: 5, fake: true });
    try {
      assert.equal(coop.m.disabledBonds.length, 7, 'the official AC-4 room, unchanged');
    } finally {
      coop.m.dispose();
    }
    // 「全不禁止需要在 mod 菜单开启」: the switch is the only way back to no bans now
    const on = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans: 2, seed: 5, fake: true, mods: { noBondBan: true } });
    try {
      const m = on.m;
      assert.deepEqual(m.disabledBonds, [], 'the switch lifts the draw');
      assert.deepEqual(m.staticInactiveBonds, []);
      assert.deepEqual(m.bannedChess, []);
      assert.deepEqual(m.pool.banned, []);
      assert.equal(m.pool.entries.size, m.gd.visibleChess.length, 'the whole roster is rollable again');
    } finally {
      on.m.dispose();
    }
  });

  test('the SIX-player room bans like AC-4 over many seeds, and the switch lifts it every time', () => {
    assert.equal(ULTIMATE_SEATS, 6);
    for (let seed = 1; seed <= 25; seed++) {
      const six = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans: ULTIMATE_SEATS, seed, fake: true });
      try {
        const m = six.m;
        assert.equal(m.roomMode, 'ultimate');
        assert.equal(m.modeId, FORK);
        assert.equal(m.players.size, ULTIMATE_SEATS, 'all six 博士 are seated');
        assert.equal(m.disabledBonds.length, 7, `seed ${seed}: the AC-4 draw`);
      } finally {
        six.m.dispose();
      }
      const lifted = makeMatch({ mode: 'ultimate', difficulty: 'ABYSS', humans: ULTIMATE_SEATS, seed, fake: true, mods: { noBondBan: true } });
      try {
        const m = lifted.m;
        assert.deepEqual(m.disabledBonds, [], `seed ${seed}: the switch lifts the draw`);
        assert.deepEqual(m.bannedChess, [], `seed ${seed}: no 干员 banned`);
        assert.equal(m.pool.entries.size, m.gd.visibleChess.length, `seed ${seed}: the whole roster stays rollable`);
      } finally {
        lifted.m.dispose();
      }
    }
  });

  test('the ban resolution does not depend on the difficulty a caller carries: 终极模拟 resolves its own record either way', () => {
    // Regression (player report: "在六人终极模式里盟约还是被用了一些"). 终极模拟 has ONE config record
    // (`mode_ultimate_abyss`); there is no `mode_ultimate_hard` / `_normal` / `_funny`. A room, a direct Match or a
    // tool that carried another difficulty built an id naming a record that is not in config.modes, so GameData got an
    // EMPTY mode record and the bans fell back to whatever difficulty was asked for. The room must always resolve the
    // fork record and clamp to ABYSS, so the draw is the AC-4 one whatever the caller passed.
    for (const asked of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
      const h = makeMatch({ mode: 'ultimate', difficulty: asked, humans: ULTIMATE_SEATS, seed: 5, fake: true });
      try {
        const m = h.m;
        assert.equal(m.difficulty, 'ABYSS', `${asked}: the room runs the one 终极模拟 table`);
        assert.equal(m.modeId, FORK, `${asked}: the fork record, not an id that is not in config.modes`);
        assert.equal(m.disabledBonds.length, 7, `${asked}: the AC-4 draw, whatever was asked for`);
      } finally {
        h.m.dispose();
      }
    }
    // the official modes keep the difficulty they were given: only 终极模拟 is clamped
    for (const [mode, difficulty, modeId] of [['coop', 'HARD', 'mode_multi_hard'], ['coop', 'ABYSS', 'mode_multi_abyss'], ['solo', 'NORMAL', 'mode_single_normal']]) {
      const h = makeMatch({ mode, difficulty, humans: 1, seed: 5, fake: true });
      try {
        assert.equal(h.m.difficulty, difficulty, `${mode}/${difficulty}: unchanged`);
        assert.equal(h.m.modeId, modeId, `${mode}/${difficulty}: unchanged id`);
        assert.ok(h.m.disabledBonds.length > 0, `${mode}/${difficulty}: still draws its bans`);
      } finally {
        h.m.dispose();
      }
    }
  });

  test('the mode advertises the FULL roster no longer — the card line is gone', () => {
    // 二.1 made the difficulty card say 「盟约与干员全部解锁」. That is false again now that the mode draws bans, so the
    // line is removed from both the generated mode record and the lobby's embedded fallback card.
    assert.ok(!gd(FORK).mode.effectDescList.some((l) => l.includes('全部解锁')), '终极模拟 no longer claims it');
    assert.ok(!gd(COOP_ABYSS).mode.effectDescList.some((l) => l.includes('全部解锁')), 'and neither does 同盟模拟 AC-4');
    // the mode still lists all 23 bonds as active: what leaves play is the per-match draw, not a static list
    const g = gd(FORK);
    assert.equal(g.mode.activeBondIds.length, 23, 'all 23 bonds are still active in the mode record');
    assert.deepEqual([...g.modeInactiveBonds], [], 'and none is statically inactive');
  });
});
