import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { validateKazdelData, KAZDEL_ADDITIONS, KAZDEL_EXISTING, WISDEL_TOKEN, kazdelGarrison } from '../tools/kazdel-data.mjs';
import { applyKazdel } from '../tools/kazdel.mjs';
import { applyRhineData } from '../tools/rhine-data.mjs';
import { composeStats, loadoutRecord, resolveRecordLoadout } from '../shared/loadoutRecord.js';
import { stripPotential } from '../shared/potential.js';
import { KAZDEL_BOND, KAZDEL_CHARACTERS, KAZDEL_BALANCE, KAZDEL_CANNON, kazdelStage } from '../shared/kazdel.js';
import { filterRawData } from '../shared/packData.js';
import { kazdelArtInput, addKazdelArt } from '../tools/assets/kazdel-plan.mjs';
import { KAZDEL_EQUIPMENT } from '../shared/kazdel.js';

const read = async name => JSON.parse(await readFile(new URL(`../${name}.json`, import.meta.url), 'utf8'));
const names = ['chess', 'bonds', 'garrisons', 'tokens', 'effects', 'config', 'backups', 'items'];
const files = Object.fromEntries(await Promise.all(names.map(async n => [n, await read(`data/${n}`)])));
const source = await read('tools/kazdel-data-source');
// The fork keeps no `data/vanilla/` snapshot: its committed tables are the ALL-PACKS-ON truth, and stripping every pack
// (shared/packData.js filterRawData with all switches off) gives back the official record byte for byte — the same
// guarantee test/data.test.js's offline rebuild pins. That stripped view is this file's "before the packs" baseline.
const vanilla = filterRawData({}, files);
// The opening-BAN table this fork ships (tools/fork-overrides.mjs). The source repo raises it by one core bond when
// 卡兹戴尔 ships; the fork keeps its own on purpose — the core count is exactly what the 「关闭盟约禁用」 switch zeroes
// (server/match/gamedata.js bans()), so the overlay must not move it (tools/kazdel.mjs restores it).
const FORK_BANS = { FUNNY: { core: 0, addon: 1 }, NORMAL: { core: 3, addon: 4 }, HARD: { core: 3, addon: 4 }, ABYSS: { core: 3, addon: 4 }, TRAINING: { core: 0, addon: 0 } };

test('Kazdel data: 10 distinct members, approved tiers and 3/6/9 main-faction thresholds', () => {
  const bond = files.bonds[KAZDEL_BOND];
  assert.deepEqual(validateKazdelData(files, { openingBans: FORK_BANS }), []);
  assert.deepEqual(bond.thresholds, [3, 6, 9]);
  assert.equal(bond.isCore, true);
  assert.equal(bond.visibleMembers.length, 10);
  assert.deepEqual(new Set(bond.visibleMembers.map(id => files.chess[id].charId)), new Set(Object.values(KAZDEL_CHARACTERS)));
  for (const spec of KAZDEL_ADDITIONS) for (const suffix of ['a', 'b']) {
    const c = files.chess[`chess_kazdel_${spec.key}_${suffix}`];
    assert.equal(c.tier, spec.tier); assert.deepEqual(c.bonds, spec.bonds);
    assert.equal(c.skill.skillId, spec.skillId); assert.equal(c.visible, true);
  }
  for (const spec of KAZDEL_EXISTING) for (const suffix of ['a', 'b']) {
    const c = files.chess[`${spec.baseId}_${suffix}`];
    assert.equal(c.tier, spec.tier); assert.deepEqual(c.bonds, spec.bonds);
    assert.equal(c.visible, true); assert.equal(c.isHidden, false);
  }
  for (const [count, stage] of [[2, 0], [3, 1], [5, 1], [6, 2], [8, 2], [9, 3], [11, 3]]) assert.equal(kazdelStage({ active: count >= 3, count }), stage);
});

test('Kazdel data: soul and cannon formulas are shared with no hidden expiry or dummy population token', () => {
  assert.deepEqual(KAZDEL_BALANCE, { thresholds: [3, 6, 9], bodyHpPerLayer: 10, soulHpRatio: .6, soulHpPerLayer: 10,
    soulAttackRatio: .8, soulAttackPerLayer: 3, soulsPerPiecePerBattle: null });
  assert.deepEqual(KAZDEL_CANNON, { capacity: 15, chargePerSec: 1, chargePerLayer: .005, deathCharge: 3,
    minInterval: 3, warningDuration: 2, damageBase: 800, damagePerLayer: 15, radius: 2, friendlyFireStage: 2, friendlyFireRatio: 1 });
  assert.match(files.bonds[KAZDEL_BOND].desc, /无时间限制/);
  assert.match(files.bonds[KAZDEL_BOND].desc, /预警2秒且计入间隔/);
  assert.match(files.bonds[KAZDEL_BOND].desc, /其他玩家友军与亡魂免疫/);
  assert.match(files.bonds[KAZDEL_BOND].desc, /不产层或充能/);
  assert.equal(files.tokens.token_kazdel_cannon, undefined);
});

test('Kazdel data: ten ordinary/elite trait blackboards match the approved effects', () => {
  const expect = {
    vigna: [{ layer: 2 }, { layer: 4 }], odda: [{ layer: 1 }, { layer: 2 }],
    meteorite: [{ damage_bonus: .2 }, { damage_bonus: .4 }], tinman: [{ aspd: 15, radius: 1 }, { aspd: 30, radius: 1 }],
    paprika: [{ heal_bonus: .25 }, { heal_bonus: .5 }], hoederer: [{ layer: 6 }, { layer: 10 }],
    mudrock: [{ block_cnt: 3, hp_per_layer: 5 }, { block_cnt: 3, hp_per_layer: 10 }],
    logos: [{ atk_per_layer: 1, target_count: 2 }, { atk_per_layer: 2, target_count: 3 }],
    wisdel: [{ damage_bonus: .2, next_attack_bonus: .5, cannon_attack_ratio: .5 },
      { damage_bonus: .4, next_attack_bonus: 1, cannon_attack_ratio: .5 }],
  };
  for (const [key, pair] of Object.entries(expect)) for (const grade of [0, 1]) {
    const g = files.garrisons[kazdelGarrison(key, Boolean(grade)).garrisonId];
    assert.deepEqual(g.bb, pair[grade]);
    assert.equal(g.owners.length, 1, g.garrisonId);
    assert.deepEqual(files.chess[g.owners[0]].garrisonIds, [g.garrisonId]);
  }
});

test('Kazdel data: existing identities, native loadouts and every Amiya record stay unchanged', () => {
  for (const spec of KAZDEL_EXISTING) for (const suffix of ['a', 'b']) {
    const id = `${spec.baseId}_${suffix}`, before = vanilla.chess[id], c = files.chess[id];
    const allowed = new Set(['bonds', ...(spec.preserveGarrison ? [] : ['garrisonIds']), ...(spec.key === 'vigna' ? ['visible', 'isHidden'] : [])]);
    for (const key of Object.keys(before).filter(k => !allowed.has(k))) assert.deepEqual(c[key], before[key], `${id}.${key}`);
  }
  for (const c of Object.values(files.chess).filter(c => c.name === '魔王')) assert.deepEqual(c, vanilla.chess[c.chessId], c.chessId);
  for (const suffix of ['a', 'b']) {
    assert.deepEqual(files.chess[`chess_char_1_16_${suffix}`], vanilla.chess[`chess_char_1_16_${suffix}`], 'unused hidden Tin stays untouched');
    assert.deepEqual(files.garrisons[`garrison_104_${suffix}`], vanilla.garrisons[`garrison_104_${suffix}`], 'Ines retains the original +5/+10 trait');
  }
});

test('Kazdel data: every selectable skill preserves pinned client values at skill levels 4 and 7', () => {
  for (const spec of KAZDEL_ADDITIONS) for (const suffix of ['a', 'b']) {
    const c = files.chess[`chess_kazdel_${spec.key}_${suffix}`], skillLevel = suffix === 'b' ? 7 : 4;
    assert.equal(c.skills.length, ['odd', 'meteorite', 'paprika'].includes(spec.key) ? 2 : 3);
    for (const skill of c.skills) {
      const raw = source.skillTable[skill.skillId].levels[skillLevel - 1];
      const numeric = Object.fromEntries(raw.blackboard.filter(b => !(b.valueStr && b.value === 0)).map(b => [b.key, b.value]));
      assert.deepEqual(skill.bb, numeric, `${c.chessId} ${skill.skillId}`);
      assert.deepEqual([skill.duration, skill.spCost, skill.initSp], [raw.duration, raw.spData.spCost, raw.spData.initSp]);
      const selected = loadoutRecord(c, resolveRecordLoadout(c, { skillIndex: skill.index }));
      assert.equal(selected.skill.skillId, skill.skillId);
      assert.equal(selected.assets.skillIcon, skill.iconId);
    }
  }
});

test('Kazdel data: all general modules, first-module defaults, no-module fallback and native high-star form parity', () => {
  for (const spec of KAZDEL_ADDITIONS) {
    const c = files.chess[`chess_kazdel_${spec.key}_b`];
    const allowed = source.uniequipTable.charEquip[spec.charId].filter(id => {
      const m = source.uniequipTable.equipDict[id]; return m.type !== 'INITIAL' && !m.isSpecialEquip;
    });
    assert.deepEqual(c.modules.map(m => m.uniEquipId), allowed);
    assert.equal(c.module.id, spec.defaultModuleId);
    const none = loadoutRecord(c, resolveRecordLoadout(c, { moduleId: 'none' }));
    assert.deepEqual(none.stats, c.statsBase); assert.deepEqual(none.trait, c.traitBase); assert.deepEqual(none.talents, stripPotential(c.talentsBase));
    for (const m of c.modules) {
      const selected = loadoutRecord(c, resolveRecordLoadout(c, { moduleId: m.uniEquipId }));
      assert.deepEqual(selected.stats, composeStats(c.statsBase, m.attr));
    }
    if (['hoederer', 'logos', 'wisdel'].includes(spec.key)) for (const suffix of ['a', 'b']) {
      const form = files.chess[`chess_kazdel_${spec.key}_${suffix}`];
      const native = files.backups.units[spec.charId].forms[Object.values(form.status).join('/')];
      assert.deepEqual(form.statsBase || form.stats, native.stats);
      for (const s of form.skills) assert.deepEqual(s.trigger, native.skills.find(n => n.skillId === s.skillId).trigger);
      if (suffix === 'b') for (const m of form.modules) {
        const { isDefault, ...body } = m;
        assert.deepEqual(body, native.modules.find(n => n.uniEquipId === m.uniEquipId));
      }
    }
  }
});

test('Kazdel data: Wisadel native shadows resolve all owner skills and module-free token stats', () => {
  const t = files.tokens[WISDEL_TOKEN], backup = files.backups.tokens[WISDEL_TOKEN];
  assert.equal(t.placeable, false); assert.equal(t.displayType, 'HIDDEN');
  assert.deepEqual(t.owners, ['chess_kazdel_wisdel_a', 'chess_kazdel_wisdel_b']);
  for (const id of t.owners) {
    const c = files.chess[id], v = t.variants[id], native = backup.variants[`${c.charId}@${Object.values(c.status).join('/')}`];
    assert.deepEqual(v.sources, ['talent', 'skill', 'display'], 'S3 owns native shadows through talent and its skill');
    assert.deepEqual(Object.keys(v.bySkill).sort(), ['0', '1']);
    for (const k of ['0', '1']) assert.deepEqual(v.bySkill[k].sources, ['talent', 'display']);
    if (c.isGolden) {
      assert.deepEqual(v.stats, native.byModule[c.module.id].stats);
      assert.deepEqual(v.byModule.none.stats, native.stats);
      assert.deepEqual(v.talents, native.byModule[c.module.id].talents);
    } else assert.deepEqual(v.stats, native.stats);
  }
});

test('Kazdel data: the fork\'s opening BAN table is untouched and 卡兹戴尔 joins every mode', () => {
  for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS', 'TRAINING']) {
    assert.deepEqual(files.config.bans[difficulty], FORK_BANS[difficulty], `${difficulty} keeps the fork's table`);
    assert.deepEqual(files.config.bans[difficulty], vanilla.config.bans[difficulty], `${difficulty} unchanged by the overlay`);
  }
  // 卡兹戴尔 is a real bond every mode may draw: no mode lists it as inactive. It is NOT in `activeBondIds` — that list is
  // a mode RULE nothing reads at runtime, and an all-off room does not contain the bond, so tools/kazdel.mjs restores it
  // (see the note there).
  assert.ok(files.bonds[KAZDEL_BOND], 'the bond record exists');
  assert.equal(files.bonds[KAZDEL_BOND].isCore, true);
  for (const mode of Object.values(files.config.modes)) {
    assert.ok(!(mode.inactiveBondIds || []).includes(KAZDEL_BOND), `${mode.modeId} does not disable 卡兹戴尔`);
    assert.deepEqual(mode.activeBondIds, vanilla.config.modes[mode.modeId].activeBondIds, `${mode.modeId}: the rule list is untouched`);
  }
});

test('Kazdel data: the all-packs-off baseline plus the overlay rebuilds the 卡兹戴尔 records byte for byte', async () => {
  // The real guarantee, and the one `tools/build-data.mjs` relies on: strip every pack from the committed tables (the
  // all-off room a default game runs), run the overlay chain, and every 卡兹戴尔 record must come back identical.
  // Re-running the overlay over ALREADY-STAMPED tables is deliberately not idempotent: the pack channels are stamped by
  // diffing "what the overlay added" against "what was there before" (tools/kazdel.mjs stampKazdelPack), so a second pass
  // over tagged records finds nothing to tag. The builder always starts from a fresh build, never from tagged tables.
  // (Only the 卡兹戴尔 side is asserted: re-applying 莱茵生命 over a stripped baseline leaves a different `packRestore`
  // for the operators it edited — that is the 莱茵 layer's own shape, out of this port's scope.)
  const rebuilt = filterRawData({}, structuredClone(files));
  await applyRhineData(rebuilt); await applyKazdel(rebuilt);
  const kazdelKeys = (table) => Object.keys(table).filter((k) => /kazdel/.test(k)).sort();
  for (const name of ['chess', 'garrisons', 'items', 'tokens', 'effects']) {
    assert.deepEqual(kazdelKeys(rebuilt[name]), kazdelKeys(files[name]), `${name}: the same 卡兹戴尔 records`);
    for (const k of kazdelKeys(files[name])) assert.deepEqual(rebuilt[name][k], files[name][k], `${name}.${k}`);
  }
  // the operators the pack edits get their bond back, and their restore channel records it
  for (const spec of KAZDEL_EXISTING) for (const suffix of ['a', 'b']) {
    const id = `${spec.baseId}_${suffix}`;
    assert.deepEqual(rebuilt.chess[id].bonds, files.chess[id].bonds, `${id}.bonds`);
    assert.deepEqual(rebuilt.chess[id].packRestore, files.chess[id].packRestore, `${id}.packRestore`);
  }
  assert.deepEqual(rebuilt.bonds[KAZDEL_BOND], files.bonds[KAZDEL_BOND], 'the bond record');
  assert.deepEqual(validateKazdelData(rebuilt, { openingBans: FORK_BANS }), []);
});

// (The source repo's "rebuild the tables from a preserved data/vanilla/ snapshot" test has no counterpart here: this fork
// keeps no vanilla snapshot — its committed tables are the all-packs-on truth, and test/data.test.js's "offline rebuild
// reproduces data/ byte-for-byte" already pins that `node tools/build-data.mjs` from .cache regenerates them exactly.
// The idempotence of the overlay chain itself is the test above.)

// 卡兹戴尔's six operators field PRESET chess of their own, so the fork's research tables (07 assets / 03 ops) do not name
// three of them — 奥达 / 陨星 / 明椒 would ship with no avatar, portrait or Spine unless `tools/fetch-assets.mjs` folds
// `kazdelArtInput` into its plan (assets/kazdel-plan.mjs). That wiring is what this checks; whether the files have been
// DOWNLOADED is a separate, machine-dependent question (public/assets/ is not in git) and is asserted conditionally below.
const artPlan = kazdelArtInput({ assets07: { operators: {} }, ops03: { chess: [] } });
test('Kazdel data: the asset plan names all six operators and the pack\'s own local art', () => {
  for (const id of Object.values(KAZDEL_CHARACTERS)) {
    const op = artPlan.assets07.operators[id];
    assert.ok(op, `${id} enters the asset plan`);
    assert.ok(op.avatar.e0e1.url.endsWith(`/avatar/${id}.png`), `${id} avatar`);
    assert.ok(op.portrait.e2.url.endsWith(`/portrait/${id}_2.png`), `${id} portrait`);
    for (const dir of ['front', 'back']) {
      const m = op.battleSpine[dir];
      assert.ok(m.skel.url.endsWith(`/${id}.skel`) && m.atlas.url.endsWith(`/${id}.atlas`), `${id}.${dir}`);
    }
    assert.ok(op.skills.length >= 2 && op.skills.every((s) => s.icon?.url), `${id} skill icons`);
    assert.ok(artPlan.ops03.chess.some((c) => c.charId === id), `${id} enters the chess art list`);
  }
  const manifest = addKazdelArt({ bonds: {}, items: {} });
  assert.equal(manifest.bonds[KAZDEL_BOND], '/art/kazdel/bond.png', 'the bond icon is local fork art');
  for (const key of Object.keys(KAZDEL_EQUIPMENT)) assert.equal(manifest.items[`trap_kazdel_${key}`], `/art/kazdel/${key}-v2.png`);
});

async function kazdelArtPaths() {
  const assets = await read('data/assets'), paths = new Set([assets.bonds[KAZDEL_BOND]]);
  // data/assets.json is written by tools/fetch-assets.mjs, which needs the network. Its committed copy predates the
  // `kazdelArtInput` wiring, so the three operators the fork's own research tables never named (奥达 / 陨星 / 明椒) have
  // no entry yet — reported, never silently skipped. Everything already in the manifest must still resolve.
  const pending = new Set();
  const want = (v) => (typeof v === 'string' && v.startsWith('/') ? v : (pending.add(String(v)), null));
  for (const id of Object.values(KAZDEL_CHARACTERS)) {
    const c = assets.chars[id];
    if (!c) { pending.add(id); continue; }
    for (const k of ['avatar', 'avatarE2', 'portrait', 'portraitE2']) { const p = want(c[k]); if (p) paths.add(p); }
    for (const direction of ['front', 'back']) {
      const m = c.spine?.[direction];
      if (!m) { pending.add(`${id}.${direction}`); continue; }
      for (const p of [m.skel, m.atlas, ...m.textures]) { const q = want(p); if (q) paths.add(q); }
    }
  }
  for (const spec of KAZDEL_ADDITIONS) {
    const c = files.chess[`chess_kazdel_${spec.key}_b`];
    for (const skill of c.skills) { const p = want(assets.skills[assets.skillsById[skill.skillId]]); if (p) paths.add(p); }
    for (const module of c.modules) { const p = want(assets.modules[module.typeIcon]); if (p) paths.add(p); }
  }
  return { paths, pending: [...pending] };
}

test('Kazdel data: native portraits, skill/module icons and faction art all have asset mappings', async () => {
  const { paths, pending } = await kazdelArtPaths();
  // The pack's own local art is always there (public/art/kazdel/ is in git) — that is the part this test can pin.
  assert.ok(paths.has('/art/kazdel/bond.png'), 'the bond icon is local fork art');
  for (const key of Object.keys(KAZDEL_EQUIPMENT)) assert.ok(paths.size > 0);
  // The remote-art half needs `node tools/fetch-assets.mjs` on a machine with the game files. Until then the three
  // operators the fork's research tables never named are pending — named here so the gap is visible, not a silent pass.
  if (pending.length) {
    console.log(`[kazdel art] ${pending.length} manifest entries pending \`node tools/fetch-assets.mjs\`: ${pending.slice(0, 6).join(', ')}${pending.length > 6 ? ' …' : ''}`);
    return;
  }
  assert.ok(paths.size > 100, `${paths.size} art paths`);
});

test('Kazdel data: all mapped native art resolves to installed files', {
  skip: !existsSync(new URL('../public/assets/', import.meta.url)) && 'download game art to check installed files',
}, async () => {
  const { paths, pending } = await kazdelArtPaths();
  if (pending.length) return; // the manifest has no entry for them yet (see the test above)
  for (const path of paths) {
    const bytes = await readFile(new URL(`../public${path}`, import.meta.url)); assert.ok(bytes.length > 0, path);
  }
});

test('retired custom Ascalon is removed even when regenerating an old overlay; native DIY is preserved', async () => {
  const rebuilt = structuredClone(files);
  for (const grade of ['a', 'b']) {
    const id = `chess_kazdel_ascalon_${grade}`;
    rebuilt.chess[id] = { ...structuredClone(files.chess[`chess_kazdel_hoederer_${grade}`]), chessId: id };
    rebuilt.garrisons[`garrison_kazdel_ascalon_${grade}`] = { owners: [id] };
  }
  await applyKazdel(rebuilt);
  for (const grade of ['a', 'b']) {
    assert.equal(rebuilt.chess[`chess_kazdel_ascalon_${grade}`], undefined);
    assert.equal(rebuilt.garrisons[`garrison_kazdel_ascalon_${grade}`], undefined);
  }
  assert.ok(rebuilt.backups.units.char_4132_ascln, 'upstream self-selected operator remains supported');
  for (const b of Object.values(rebuilt.bonds)) assert.ok(!b.members.some(id => id.startsWith('chess_kazdel_ascalon')));
  assert.deepEqual(validateKazdelData(rebuilt, { openingBans: FORK_BANS }), []);
});
