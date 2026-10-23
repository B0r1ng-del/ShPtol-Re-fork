// test/fork-data.test.js — the fork's data layer (tools/fork-overrides.mjs) against the committed data files.
//
// `data/config.json`, `data/choices.json`, `data/chess.json` and `data/backups.json` are build products of
// tools/build-data.mjs, which now calls the appliers before writing. `node tools/fork-data.mjs` applies the same
// functions to the committed files in place (the small reviewable diff).
//
// The first test of each block is the drift guard and the reason the override is written as a pure, idempotent function:
// applyFork*(committed file) must return the committed file EXACTLY. It fails when
//   * a data file is regenerated without the override (or hand-edited),
//   * the fork record in it no longer matches what the override builds, or
//   * someone edits the data file instead of tools/fork-overrides.mjs.
// The rest pin down what the fork actually is, so a later change to it is a deliberate one.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyForkOverrides, forkUltimateMode, applyForkChoices, applyForkChess, applyForkBackups,
  FORK_MODE_ID, FORK_BASE_MODE_ID, FORK_DIY_SLOT_IDS, forkDiySlotId, forkDiyGoldenId,
  applyForkBonds, applyForkEffects, applyForkPackMembers, applyForkPackAphris, applyForkAssets,
  FORK_RHINE_BOND_ID, FORK_RHINE_CHESS, FORK_RHINE_ICON, FORK_APHRIS_CHAR_ID, FORK_APPLIERS,
} from '../tools/fork-overrides.mjs';
import { MOD_RANDOM_SP_FAMILIES } from '../shared/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (name) => JSON.parse(readFileSync(join(ROOT, 'data', `${name}.json`), 'utf8'));
const readConfig = () => readJson('config');

describe('fork data layer (tools/fork-overrides.mjs ⇄ data/)', () => {
  const config = readConfig();
  const choices = readJson('choices');

  test('data/config.json already carries every fork override (idempotence drift guard)', () => {
    assert.deepEqual(
      applyForkOverrides(config),
      config,
      'data/config.json is stale — run: node tools/fork-data.mjs',
    );
  });

  test('applyForkOverrides is pure: the input config is never mutated', () => {
    const before = JSON.stringify(config);
    const out = applyForkOverrides(config);
    assert.equal(JSON.stringify(config), before, 'the input is untouched');
    assert.notEqual(out, config, 'a new object is returned');
    assert.deepEqual(applyForkOverrides(out), out, 'idempotent');
    assert.notEqual(applyForkOverrides(out), out, 'idempotent, and still a fresh object');
  });

  test('a partial data set is a no-op, never a throw', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { modes: null }, { modes: [] }, { modes: {} }]) {
      assert.doesNotThrow(() => applyForkOverrides(bad));
    }
    assert.equal(applyForkOverrides(null), null);
    const noBase = { modes: { mode_multi_hard: { modeId: 'mode_multi_hard' } } };
    assert.equal(applyForkOverrides(noBase), noBase, 'without the base mode there is nothing to build from');
    assert.equal(forkUltimateMode(noBase.modes), null);
  });

  test('mode_ultimate_abyss exists as the AC-4 co-op room, derived from mode_multi_abyss', () => {
    const m = config.modes[FORK_MODE_ID];
    const base = config.modes[FORK_BASE_MODE_ID];
    assert.ok(m, `${FORK_MODE_ID} missing from data/config.json`);
    assert.ok(base, `${FORK_BASE_MODE_ID} missing`);
    assert.equal(m.modeId, FORK_MODE_ID);
    assert.equal(m.name, '扩展模拟');
    assert.equal(m.code, 'AC-4');
    assert.equal(m.difficulty, 'ABYSS');
    assert.equal(m.type, 'MULTI', 'a multiplayer room: every `type` reader must treat it like 同盟模拟');
    assert.equal(m.inScope, true);
    assert.notEqual(m.sortId, base.sortId, 'its own slot in the mode list');
  });

  test('the fork room starts from the AC-4 table and shares no object with the base mode', () => {
    const m = config.modes[FORK_MODE_ID];
    const base = config.modes[FORK_BASE_MODE_ID];
    // fields the fork has NOT (yet) changed: they must still mirror AC-4 exactly, and be their own copies. A fork
    // change moves its field OUT of this list into its own assertion below (二.1: bans; 二.2: shopSlots; …).
    for (const key of ['rounds', 'enemyScale', 'spRounds', 'upgradePrices', 'maxShopLevel',
      'stages', 'bossWeights', 'hiddenBossWeights', 'activeBondIds', 'inactiveBondIds', 'inactiveEnemyKeys',
      'lastRound', 'bossRound', 'hiddenRound', 'combatTimeLimit', 'bossHpScale', 'levelTagColors']) {
      assert.deepEqual(m[key], base[key], `${FORK_MODE_ID}.${key} still mirrors ${FORK_BASE_MODE_ID}`);
      // structured values must not be shared: a later fork change to one mode may never reach the other
      if (m[key] !== null && typeof m[key] === 'object') {
        assert.notEqual(m[key], base[key], `${FORK_MODE_ID}.${key} is its own copy`);
      }
    }
  });

  test('二.1 (reversed 2026-10-13): the fork mode carries NO ban table — it bans like 同盟模拟', () => {
    const m = config.modes[FORK_MODE_ID];
    // The six-博士 room used to carry `bans: { core: 0, addon: 0 }` so nothing was ever drawn out of play. The owner's
    // report of 2026-10-13 — 「六人模式恢复像同盟模拟一样禁用一些盟约，全不禁止需要在 mod 菜单开启」 — reverses that:
    // the record carries no table, so GameData.bans() falls back to the difficulty's, exactly as mode_multi_abyss does.
    assert.equal(m.bans, undefined, 'no ban table of its own: the ABYSS difficulty table applies');
    assert.equal(config.modes[FORK_BASE_MODE_ID].bans, undefined, 'the official AC-4 record stays difficulty-keyed');
    assert.deepEqual(config.bans.ABYSS, { core: 3, addon: 4 }, 'and the ABYSS difficulty table is untouched');
    assert.equal(m.inactiveBondIds.length, 0);
    assert.equal(m.activeBondIds.length, 23, 'every 盟约 stays active');
    // …so the card can no longer claim the unlocked roster (二.1's line), and the mode's own extras remain
    assert.ok(!m.effectDescList.some((l) => l.includes('全部解锁')), 'the card does not claim the unlocked roster');
    assert.deepEqual(m.effectDescList, ['·第 4 回合起敌人强度提升', '·作战环境无比困难', '·出现极度危险的敌人']);
    assert.deepEqual(
      config.modes[FORK_BASE_MODE_ID].effectDescList,
      ['·作战环境无比困难', '·出现极度危险的敌人'],
      'the official AC-4 card does not change',
    );
  });

  test('二.2: the fork mode carries the shop-slot table (one 干员槽 per level, the last upgrade a 道具槽)', () => {
    const m = config.modes[FORK_MODE_ID];
    assert.deepEqual(m.shopSlots, {
      1: { chess: 3, item: 1 }, 2: { chess: 4, item: 1 }, 3: { chess: 5, item: 1 },
      4: { chess: 6, item: 1 }, 5: { chess: 7, item: 1 }, 6: { chess: 7, item: 2 },
    });
    assert.deepEqual(config.modes[FORK_BASE_MODE_ID].shopSlots, {
      1: { chess: 3, item: 1 }, 2: { chess: 4, item: 1 }, 3: { chess: 4, item: 1 },
      4: { chess: 5, item: 1 }, 5: { chess: 5, item: 1 }, 6: { chess: 5, item: 1 },
    }, 'the official AC-4 table stays as it was');
    assert.deepEqual(m.upgradePrices, [5, 8, 11, 12, 13], 'the upgrade prices are the AC-4 ones');
    assert.equal(m.maxShopLevel, 6);
  });

  test('二.3: the fork mode carries the enemy adjustment block, and only the fork mode', () => {
    const m = config.modes[FORK_MODE_ID];
    assert.deepEqual(m.enemyAdjust, {
      fromRound: 4,
      normal: { hp: 1.1 },
      leader: { hp: 1.2, def: 1.2, atk: 1.08 },
      hidden: { hp: 1.35, def: 1.35, atk: 1.16 },
    });
    assert.equal(config.modes[FORK_BASE_MODE_ID].enemyAdjust, undefined, 'the official AC-4 record has none');
    for (const [id, mode] of Object.entries(config.modes)) {
      if (id === FORK_MODE_ID) continue;
      assert.equal(mode.enemyAdjust, undefined, `${id} must not carry a fork adjustment`);
    }
    // the official per-round table itself is untouched by 二.3 (the extras sit beside it, they do not rewrite it)
    assert.deepEqual(m.enemyScale, config.modes[FORK_BASE_MODE_ID].enemyScale);
    assert.ok(m.effectDescList.some((l) => l.includes('第 4 回合起敌人强度提升')), 'the card says so');
  });

  test('二.4: 机变 is NOT a property of the fork mode any more — the Mod 开关 decide (owner report 2026-10-13)', () => {
    const m = config.modes[FORK_MODE_ID];
    // 二.4 used to hard-code `spDraft: { untimed: true, parallel: false, randomVote: {...} }` on this mode, which made
    // the two Mod 开关 dead here: `GameData.spDraftRules` ORed the mode's own value into the switch's answer, so turning
    // 机变不限时间 OFF left `untimed: true` standing and turning 机变随机分配 OFF left the vote offered. The owner's ruling
    // is that the switches decide and OFF means the OFFICIAL draft in every mode, so the mode declares no block at all.
    assert.equal(m.spDraft, undefined, 'the fork mode must not carry its own 机变 block');
    for (const [id, mode] of Object.entries(config.modes)) {
      assert.equal(mode.spDraft, undefined, `${id} must not carry a fork 机变 block`);
    }
    // the 悬赏 rule is now structural in the switch's own list (shared/constants.js MOD_RANDOM_SP_FAMILIES)
    assert.ok(!MOD_RANDOM_SP_FAMILIES.includes('bounty'), '悬赏类不要添加随机机制');
  });

  test('二.4: data/choices.json already carries the fork schedule (the same drift guard as config.json)', () => {
    assert.deepEqual(applyForkChoices(choices), choices, 'data/choices.json is stale — run: node tools/fork-data.mjs');
    const fork = choices.schedule[FORK_MODE_ID];
    const base = choices.schedule[FORK_BASE_MODE_ID];
    assert.ok(fork, `${FORK_MODE_ID} has no 机变 schedule (the mode would fall back to a 道具补给 draft every round)`);
    assert.deepEqual(fork, base, 'the schedule is the AC-4 one');
    assert.notEqual(fork, base, 'and its own copy');
    for (const r of [3, 9, 11]) {
      assert.deepEqual(fork.rounds[String(r)].families, base.rounds[String(r)].families, `R${r} families`);
    }
    assert.equal(fork.rounds['3'].families[0].family, 'bounty', 'AC-4 R3 is 悬赏决策 — the fork keeps that');
    assert.equal(applyForkChoices(null), null);
    assert.deepEqual(applyForkChoices({}), {});
    const noBase = { schedule: { mode_multi_hard: { rounds: {} } } };
    assert.equal(applyForkChoices(noBase), noBase, 'without the base schedule there is nothing to copy');
  });
});

describe('fork 自选编队 slots (二.8: 5 × tier 5 + 5 × tier 6)', () => {
  const chess = readJson('chess');
  const backups = readJson('backups');

  test('data/chess.json already carries the extra 自选 slots (idempotence drift guard)', () => {
    assert.deepEqual(applyForkChess(chess), chess, 'data/chess.json is stale — run: node tools/fork-data.mjs');
  });

  test('data/backups.json already carries the extra 自选 slots (idempotence drift guard)', () => {
    assert.deepEqual(applyForkBackups(backups), backups, 'data/backups.json is stale — run: node tools/fork-data.mjs');
  });

  test('both appliers are pure and idempotent', () => {
    for (const [apply, input] of [[applyForkChess, chess], [applyForkBackups, backups]]) {
      const before = JSON.stringify(input);
      const out = apply(input);
      assert.equal(JSON.stringify(input), before, 'the input is untouched');
      assert.notEqual(out, input, 'a new object is returned');
      assert.deepEqual(apply(out), out, 'idempotent');
      assert.notEqual(apply(out), out, 'idempotent, and still a fresh object');
    }
  });

  test('a partial data set is a no-op, never a throw', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { chess_char_5_diy1_a: {} }]) {
      assert.doesNotThrow(() => applyForkChess(bad));
      assert.doesNotThrow(() => applyForkBackups(bad));
    }
    assert.equal(applyForkChess(null), null);
    assert.equal(applyForkBackups(null), null);
    // no official slot pair of a tier → nothing to copy from
    const noOfficial = { chess_char_5_diy3_a: { isDiy: true, tier: 5, isGolden: false } };
    assert.equal(applyForkChess(noOfficial), noOfficial);
    assert.deepEqual(applyForkBackups({ diy: {} }), { diy: {} });
    assert.deepEqual(applyForkBackups({}), {});
  });

  test('the fork owns exactly 6 extra slots — 5 per tier, official 2 + fork 3', () => {
    assert.deepEqual(FORK_DIY_SLOT_IDS, [
      'chess_char_5_diy3_a', 'chess_char_5_diy4_a', 'chess_char_5_diy5_a',
      'chess_char_6_diy3_a', 'chess_char_6_diy4_a', 'chess_char_6_diy5_a',
    ]);
    const slots = backups.diy.slots;
    assert.deepEqual(Object.keys(slots), [
      'chess_char_5_diy1_a', 'chess_char_5_diy2_a', 'chess_char_5_diy3_a', 'chess_char_5_diy4_a', 'chess_char_5_diy5_a',
      'chess_char_6_diy1_a', 'chess_char_6_diy2_a', 'chess_char_6_diy3_a', 'chess_char_6_diy4_a', 'chess_char_6_diy5_a',
    ], '10 slots, in build order (tier, then the id\'s natural sort)');
    for (const tier of [5, 6]) {
      assert.equal(Object.values(slots).filter((s) => s.tier === tier).length, 5, `tier ${tier}: 5 slots`);
    }
  });

  test('every extra slot is its tier\'s official slot pair with its own ids — same status, price, merge, requirement', () => {
    for (const id of FORK_DIY_SLOT_IDS) {
      const s = backups.diy.slots[id];
      const rec = chess[id];
      const golden = chess[s.goldenId];
      const tier = rec.tier;
      const official = chess[`chess_char_${tier}_diy1_a`];
      const officialGolden = chess[`chess_char_${tier}_diy1_b`];
      assert.ok(rec && golden, `${id}: the record pair exists`);
      assert.equal(s.goldenId, id.replace(/_a$/, '_b'));
      assert.equal(s.shopLevel, tier, `${id}: enters the shop at its tier's 调度中心 level`);
      assert.equal(s.requirement, 'TIER_6');
      // a 自选 record: the operator comes from the pick, so the slot is the tier's slot
      assert.deepEqual(
        [rec.isDiy, rec.chessType, rec.tier, rec.price, rec.sellPrice, rec.diyRequirement, rec.visible, rec.charId],
        [true, 'DIY', tier, 4, 1, 'TIER_6', false, null], id,
      );
      assert.deepEqual([rec.status, golden.status], [official.status, officialGolden.status], `${id}: the tier's statuses`);
      assert.deepEqual([rec.bonds, rec.garrisonIds], [[], []], id);
      assert.deepEqual([rec.upgradeNum, golden.upgradeNum, golden.isGolden], [3, 0, true], id);
      assert.equal(rec.baseId, id);
      assert.equal(golden.baseId, id);
      assert.equal(rec.goldenId, s.goldenId);
      assert.equal(rec.upgradeChessId, s.goldenId);
      // identifiers continue the official run and stay unique; shopSortId continues the tier's own 自选 sequence
      assert.ok(Number.isInteger(rec.identifier) && Number.isInteger(golden.identifier), id);
      assert.notEqual(rec.identifier, golden.identifier, id);
    }
    const ids = Object.values(chess).map((c) => c.identifier).filter(Number.isInteger);
    assert.equal(new Set(ids).size, ids.length, 'every identifier is unique');
  });

  test('the extra slots land in build order: after their tier\'s official slots, keys still naturally sorted', () => {
    const naturalCmp = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
    const keys = Object.keys(chess);
    assert.deepEqual(keys, [...keys].sort(naturalCmp), 'data/chess.json is written in natural sort order');
    const slotKeys = Object.keys(backups.diy.slots);
    assert.deepEqual(slotKeys, [...slotKeys].sort(naturalCmp), 'diy.slots too');
    // each extra pair sits directly after the previous slot of its tier, its elite twin right behind it
    for (const id of FORK_DIY_SLOT_IDS) {
      const at = keys.indexOf(id);
      assert.equal(keys[at + 1], chess[id].goldenId, `${id}: its elite twin follows`);
      assert.ok(at > keys.indexOf(`chess_char_${chess[id].tier}_diy1_a`), `${id}: after the official slots`);
    }
    // and the fork ids are exactly the ones the applier builds
    for (const id of FORK_DIY_SLOT_IDS) {
      const n = Number(/_diy(\d)_a$/.exec(id)[1]);
      assert.equal(forkDiySlotId({ tier: chess[id].tier, n }), id);
      assert.equal(forkDiyGoldenId({ tier: chess[id].tier, n }), chess[id].goldenId);
    }
  });

  test('nothing else in backups.json needed a fork entry: a new slot reuses its tier\'s forms', () => {
    // the unit forms / summon variants are keyed by statusKey, and prototypes / locked / ownedPool by tier
    assert.deepEqual(applyForkBackups(backups).diy.prototypes, backups.diy.prototypes);
    assert.deepEqual(applyForkBackups(backups).diy.locked, backups.diy.locked);
    assert.deepEqual(applyForkBackups(backups).diy.ownedPool, backups.diy.ownedPool);
    assert.deepEqual(Object.keys(applyForkBackups(backups)), Object.keys(backups), 'no new top-level key');
    assert.deepEqual(Object.keys(applyForkBackups(backups).diy), Object.keys(backups.diy), 'no new diy key');
  });
});

describe('fork 莱茵生命 盟约 (六.3: rhineShip + 谬因·并入莱茵)', () => {
  const chess = readJson('chess');
  const bonds = readJson('bonds');
  const effects = readJson('effects');
  const backups = readJson('backups');
  const assets = readJson('assets');

  // The five appliers own five records across four files; each file's block starts with its drift guard.
  test('every 六.3 record already carries what the applier builds (idempotence drift guards)', () => {
    assert.deepEqual(applyForkBonds(bonds), bonds, 'data/bonds.json is stale — run: node tools/fork-data.mjs');
    assert.deepEqual(applyForkEffects(effects), effects, 'data/effects.json is stale — run: node tools/fork-data.mjs');
    assert.deepEqual(applyForkPackMembers(chess), chess, 'data/chess.json is stale — run: node tools/fork-data.mjs');
    assert.deepEqual(applyForkPackAphris(backups), backups, 'data/backups.json is stale — run: node tools/fork-data.mjs');
    assert.deepEqual(applyForkAssets(assets), assets, 'data/assets.json is stale — run: node tools/fork-data.mjs');
  });

  test('all five appliers are pure and idempotent', () => {
    const pairs = [
      [applyForkBonds, bonds], [applyForkEffects, effects], [applyForkPackMembers, chess],
      [applyForkPackAphris, backups], [applyForkAssets, assets],
    ];
    for (const [apply, input] of pairs) {
      const before = JSON.stringify(input);
      const out = apply(input);
      assert.equal(JSON.stringify(input), before, 'the input is untouched');
      assert.deepEqual(apply(out), out, 'idempotent');
      // the two 叠加 appliers return the SAME object when there is nothing to add (the committed data is already
      // patched, so the drift guard above is exactly that case); the two OWNER appliers rebuild their record every run
      if (apply === applyForkBonds || apply === applyForkEffects) assert.notEqual(out, input);
    }
    assert.notEqual(applyForkBonds(bonds), bonds, 'the owner appliers rebuild instead of sharing');
  });

  test('a partial data set is a no-op, never a throw', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}]) {
      for (const apply of [applyForkBonds, applyForkEffects, applyForkPackMembers, applyForkPackAphris, applyForkAssets]) {
        assert.doesNotThrow(() => apply(bad));
      }
    }
    // an unrelated record set is returned as it is, and only the bridge files have a shape to check
    assert.equal(applyForkBonds(null), null);
    assert.equal(applyForkAssets(null), null);
    // the two OWNER appliers build their record from FORK_RHINE, so a set without it gains the record and keeps the rest
    const onlyOther = { yanShip: { bondId: 'yanShip' } };
    const withRhine = applyForkBonds(onlyOther);
    assert.equal(withRhine.yanShip, onlyOther.yanShip, 'the other records are shared, not copied');
    assert.ok(withRhine[FORK_RHINE_BOND_ID], 'and the 盟约 record is rebuilt');
    assert.deepEqual(onlyOther, { yanShip: { bondId: 'yanShip' } }, 'the input is untouched');
    // the three 叠加 appliers add nothing when there is nobody to add to
    assert.deepEqual(applyForkPackMembers({ yanShip: {} }), { yanShip: {} });
    assert.deepEqual(applyForkAssets({ chars: {} }), { chars: {} }, 'no bonds block → nothing to write into');
    assert.deepEqual(applyForkPackAphris({ diy: {} }), { diy: {} });
    assert.deepEqual(applyForkPackAphris({ diy: { operators: {} } }), { diy: { operators: {} } });
  });

  test('rhineShip is the source expansion\'s own record, owned by BOTH 莱茵 switches', () => {
    const b = bonds[FORK_RHINE_BOND_ID];
    assert.ok(b, `${FORK_RHINE_BOND_ID} missing from data/bonds.json`);
    assert.deepEqual(
      [b.bondId, b.name, b.identifier, b.bondType, b.countMode, b.activeCount],
      [FORK_RHINE_BOND_ID, '莱茵生命', 24, 'SEASON', 'BOARD', 3],
    );
    assert.deepEqual(b.thresholds, [3, 6, 9], '3 / 6 / 9 distinct members');
    // an ARRAY packId: only ONE of the two switches has to be on for the 盟约 to exist (shared/constants.js packEnabled)
    assert.deepEqual(b.packId, ['packRhine']);
    assert.deepEqual(b.bb, { base_atk: 300, atk_per_stack: 4, sharing_count: 6, sharing_atk: 0.15, sharing_golden_atk: 0.25 });
    assert.equal(b.bbStr.key, 'rhine_research', 'the device table key the 六.4 port will read');
    // The numbers are read through the SAME `env_gbuff_new` blackboard every other 盟约 uses (`addon/battle.js bondBb`,
    // `rhine.js rhineBb`). A `buffs: []` here reads back as `{}` and silently zeroes the 盟约's whole effect, so this is
    // pinned rather than left to the record's shape.
    assert.equal(b.buffs.length, 1, 'one env_gbuff_new blackboard');
    assert.equal(b.buffs[0].key, 'env_gbuff_new');
    assert.deepEqual(b.buffs[0].bb, b.bb, 'the buff carries the bond\'s own numbers');
    assert.equal(b.buffs[0].bbStr.key, b.bbStr.key);
    // Members list the BASE (`_a`) ids only: data.test.js asserts a member is a non-golden chess. The six official
    // 莱茵 operators plus the four ported ones that name the 盟约 (tools/rhine-data.mjs recomputes the list from the
    // chess that carry it), in the natural key order `data/chess.json` is written in.
    // 多萝西 → 麦哲伦：Rhine 2026-10-14 起莱茵生命把多萝西换成了麦哲伦（带「装置攻击研究」新机制）。
    assert.deepEqual(b.members, [
      'chess_char_2_02_a', 'chess_char_4_21_a', 'chess_char_5_11_a', 'chess_char_5_16_a', 'chess_char_6_11_a', 'chess_char_6_16_a',
      'chess_rhine_astgenne_a', 'chess_rhine_ifrit_a', 'chess_rhine_magallan_a', 'chess_rhine_mayer_a',
    ]);
    // 白面鸮's II-cost form is HIDDEN, so the visible list is one shorter — the 9 the 盟约's own thresholds need
    assert.deepEqual(b.visibleMembers, b.members.filter((id) => id !== 'chess_char_5_16_a'));
    assert.equal(b.visibleMembers.length, 9, 'the 盟约 starts at 3 and caps at 9');
    assert.ok(!FORK_RHINE_CHESS.some((id) => b.members.includes(id) && id.endsWith('_b')), 'no golden member');
    const ids = Object.values(bonds).map((x) => x.identifier).filter(Number.isInteger);
    assert.equal(new Set(ids).size, ids.length, 'identifier 24 continues the official run and stays unique');
  });

  test('the effect record resolves, carries the same numbers and the same two packs', () => {
    const e = effects[bonds[FORK_RHINE_BOND_ID].effectId];
    assert.ok(e, 'data.test.js requires every bond\'s effectId to resolve');
    assert.equal(e.effectType, 'BOND');
    assert.deepEqual(e.packId, bonds[FORK_RHINE_BOND_ID].packId, 'the pair appears and disappears together');
    assert.deepEqual(e.params, bonds[FORK_RHINE_BOND_ID].bb);
    // the source expansion ships no effect buff either, and the sim reads the BOND record's blackboard — repeating the
    // numbers here would be a second copy to keep in sync
    assert.deepEqual(e.buffs, []);
  });

  test('every ported member lists the 盟约 and the pack that contributed it — both forms, _a and _b', () => {
    assert.equal(FORK_RHINE_CHESS.length, 12, '6 operators × (normal, elite)');
    for (const id of FORK_RHINE_CHESS) {
      const c = chess[id];
      assert.ok(c, `${id} is not a chess record`);
      assert.ok(c.bonds.includes(FORK_RHINE_BOND_ID), `${id} lacks ${FORK_RHINE_BOND_ID}`);
      assert.deepEqual(c.packBonds, { packRhine: [FORK_RHINE_BOND_ID] });
    }
    // the operators themselves are untouched: nothing about the card is rewritten, only its bond list appended to
    const base = chess[FORK_RHINE_CHESS[0]];
    assert.equal(base.isGolden, false);
    assert.ok(Array.isArray(base.bonds));
  });

  test('谬因 joins through her 自选 bond list (there is no chess record for her at all)', () => {
    assert.ok(!chess[FORK_APHRIS_CHAR_ID], 'she has no chess record — she is fielded through a 自选 slot');
    const rec = backups.diy.operators[FORK_APHRIS_CHAR_ID];
    assert.ok(rec, `${FORK_APHRIS_CHAR_ID} missing from backups.diy.operators`);
    assert.ok(rec.bonds.includes(FORK_RHINE_BOND_ID), 'she is a 莱茵生命 member in the committed (all-packs-on) data');
    assert.deepEqual(rec.packBonds, { packRhine: [FORK_RHINE_BOND_ID] }, '谬因·并入莱茵 merged into 莱茵生命 (2026-10-23)');
    // the roster of 自选 operators is unchanged: the port adds a membership, not an operator
    assert.ok(Object.values(backups.diy.operators).every((o) => !o.packId));
  });

  test('the 盟约 has its icon, and the SVG it names is committed (assetUrls.test.js needs every bond to resolve)', () => {
    assert.equal(assets.bonds[FORK_RHINE_BOND_ID], FORK_RHINE_ICON);
    assert.deepEqual(assets.bonds[FORK_RHINE_BOND_ID], '/art/rhine/bond.svg');
    assert.ok(existsSync(join(ROOT, 'public', FORK_RHINE_ICON)), `${FORK_RHINE_ICON} is not committed`);
    assert.ok(!assets.bonds[FORK_RHINE_BOND_ID].startsWith('/assets/'), 'never an official art path — public/assets is gitignored');
  });
});

describe('the fork layer reaches BOTH directions (tools/build-data.mjs ⇄ tools/fork-data.mjs)', () => {
  // 六.3's regression: its appliers reached the CLI but not the builder, so `npm run build-data` silently dropped the
  // ported 盟约. Nothing failed — the committed files had been patched in place, and the one test that could see it
  // (test/data.test.js, byte-for-byte offline rebuild) skips without `.cache/gamedata`, so CI never ran it. These
  // assertions are structural and need no cache: they fail the moment a fork feature is wired to one direction only.
  test('every applier the builder runs is one the CLI runs too, from the same list', () => {
    const src = (p) => readFileSync(join(ROOT, p), 'utf8');
    // Comments in these files legitimately NAME the appliers while explaining why the file does not call them, so the
    // code-only body is what the structural checks below read (the same reason test/pack-switches.test.js strips them).
    const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const builderCode = code('tools/build-data.mjs');
    const cli = src('tools/fork-data.mjs');
    // both read the shared list
    for (const [name, body] of [['build-data', builderCode], ['fork-data', cli]]) {
      assert.match(body, /FORK_APPLIERS/, `${name}: must read the shared FORK_APPLIERS list`);
    }
    // the CLI's file list is exactly the shared list — a name it forgot would never be patched
    const cliNames = [...cli.matchAll(/\{ name: '([a-z]+)'/g)].map((m) => m[1]);
    assert.deepEqual([...cliNames].sort(), Object.keys(FORK_APPLIERS).sort(), 'the CLI patches every fork-applied file');
    // the builder applies the shared list rather than naming appliers itself
    assert.match(builderCode, /Object\.entries\(FORK_APPLIERS\)/, 'the builder iterates the shared list');
    for (const fn of ['applyForkBonds', 'applyForkEffects', 'applyForkPackMembers', 'applyForkPackAphris']) {
      assert.ok(!new RegExp(`\\b${fn}\\b`).test(builderCode), `build-data must not call ${fn} by hand — it comes from FORK_APPLIERS`);
    }
  });

  test('a data file the CLI patches is one the builder either writes or never owns', () => {
    const builder = readFileSync(join(ROOT, 'tools/build-data.mjs'), 'utf8');
    // build-data writes these; `assets` it does not (tools/fetch-assets.mjs owns it, docs/ASSETS.md), which is why the
    // builder skips a name missing from its `files` map instead of throwing.
    assert.match(builder, /if \(FORK_PASS_APPLIERS\[name\] \|\| !files\[name\]\) continue;/);
    assert.ok(!/files\.assets\b|`\$\{name\}\.json`.*assets/.test(builder), 'build-data never writes data/assets.json');
  });
});
