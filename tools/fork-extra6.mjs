// tools/fork-extra6.mjs — 内容包 packExtra6 (额外干员, 原作者 remember-4): the two ported operators' rows in the season's
// own tables.
//
// WHY THIS FILE EXISTS. 丰川祥子 (char_4182_oblvns) and 结城理 (char_4217_makoto) are official characters —
// `character_table.json` has their stats, traits, talents, skills, modules and ranges, and the fork's `buildChess`
// resolves all of that on its own. What the official data does NOT have is a 卫戍协议 row for them: act2autochess never
// shipped them as shop chess, so `charShopChessDatas` / `charChessDataDict` / `chessNormalIdLookupDict` have no entry and
// the builder never reaches them. This module SYNTHESIZES those rows from the character table, shaped exactly like the
// official ones, and `loadContext` injects them into `act` before anything is built.
//
// That is the whole port: because every downstream builder (`buildChess` / `buildBackups` / `buildGarrisons` /
// `buildBonds`) reads the season tables, and nothing in `build-data.mjs` special-cases a chess id, injecting the rows is
// enough for the two operators to be built, validated and written like any other. The alternative — hand-pinning a copy
// of the character/skill/module tables in the repo, as the source expansion does — would duplicate megabytes of data
// the build already has and drift from it on the next client update.
//
// The rows are the ALL-PACKS-ON truth like every other record (`data/*.json` holds the full content set); the 内容包开关
// strips them out of a room (`packId`, shared/packData.js + tools/fork-overrides.mjs applyForkPackMembers).

/** The pack key (shared/constants.js PACK_KEYS) every record this file adds belongs to. */
export const FORK_EXTRA6_PACK = 'packExtra6';

/**
 * The ported operators, in the order their rows are numbered. `bonds` are the official 盟约 the operator joins — the
 * source expansion's own assignment, and this fork's builder derives nothing else (a 补位 / 自选 operator gets its bonds
 * from its powers, but a PRESET shop chess carries them in its own row: `charChessDataDict[].bondIds`).
 *
 * Both are 联动 operators (`mujica` / `sees`, DIY_EXCLUDED_TEAMS), which is why they reach neither the 自选 pool nor the
 * 补位 tables, and both are PRESET: `chessType` PRESET is what the fork's own 卫戍协议 rows use, and it is what keeps the
 * 17 补位 stand-ins out of this port — a NORMAL row would have to name another operator's charId as its `backup`
 * (`data/backups.json`, shared/standIn.js) and drag the whole stand-in machinery in with it.
 */
export const FORK_EXTRA6_CHARS = Object.freeze([
  { charId: 'char_4217_makoto', tier: 5, bonds: Object.freeze(['lateranoShip', 'indomShip']) },
  { charId: 'char_4182_oblvns', tier: 6, bonds: Object.freeze(['emptyShip']) },
]);

/**
 * The 独有特质 (garrison) the source expansion gives 结城理: 被击倒 or 替身切换 stacks 【拉特兰】/【不屈】. The official
 * season has no such row, so it is authored here in the `garrisonDataDict` blackboard shape `buildGarrisons` reads
 * (`flattenBB`), with `effectKey` naming a dispatcher the sim already has — `act1autochess_gar_event_selfdead`
 * (`server/sim/content/garrisons/battle.js`), which fires on `death` and, for a 替身 garrison, on every `trait.doll`
 * toggle. The three `0 + valueStr` entries are the official idiom for a string blackboard value.
 *
 * `[ASSUMED]` the wording and the 3/6 count: the effect reads as the 拉特兰 garrison (「每消耗7发弹药 … +1」) does, `+3`
 * normal / `+6` elite, taken from the source expansion's own text. No official row settles it.
 */
export const FORK_EXTRA6_GARRISONS = Object.freeze({
  char_4217_makoto: {
    bonds: 'lateranoShip,indomShip',
    count: Object.freeze({ a: 3, b: 6 }),
    desc: (n) => `<战斗中>自身被击倒或替身与本体进行切换时，使已激活的【拉特兰】层数+${n}、【不屈】层数+${n}`,
  },
});

/** The base chess id of a ported operator: `char_4217_makoto` at tier 5 → `chess_char_5_makoto_a`. */
export const forkExtra6BaseId = (char) => `chess_char_${char.tier}_${char.charId.replace(/^char_\d+_/, '')}_a`;
/** The elite id of a ported operator (`chess_char_5_makoto_b`): the official `_b` twin of its base (the `_a` becomes a `_b`). */
export const forkExtra6GoldenId = (char) => `${forkExtra6BaseId(char).slice(0, -1)}b`;

/**
 * The base id of every ported operator — the records this pack OWNS (`applyForkPackMembers` stamps their `packId`, and
 * `shared/packData.js recordAvailable` drops them while `packExtra6` is off). `tools/fork-data.mjs` needs the list
 * without the character table, so it is derived from the frozen rows, not from a built `act`.
 */
export const FORK_EXTRA6_BASES = Object.freeze(FORK_EXTRA6_CHARS.map(forkExtra6BaseId));
/** Both forms of every ported operator (`_a` and its `_b` elite). */
export const FORK_EXTRA6_CHESS = Object.freeze(FORK_EXTRA6_BASES.flatMap((id) => [id, `${id.slice(0, -1)}b`]));

/**
 * The OFFICIAL bonds the ported operators join, as `{ bondId: [chessId, …] }` — the member lists the pack contributes
 * to. A bond's `members` / `visibleMembers` list chess ids, and a dropped chess record does not drop what points at it,
 * so the bond records carry this as their `packMembers` (`shared/packData.js withPackMembers`) and the ported names come
 * out of the list while the switch is off.
 */
export const FORK_EXTRA6_BOND_MEMBERS = Object.freeze(FORK_EXTRA6_CHARS.reduce((acc, char) => {
  const base = forkExtra6BaseId(char);
  for (const bondId of char.bonds) (acc[bondId] ||= []).push(base);
  for (const ids of Object.values(acc)) ids.sort();
  return acc;
}, Object.create(null)));

/** The ADVANCED module of an operator, or null — the module the elite equips (the official rows' own choice). */
function advancedModule(uniequip, charId) {
  for (const id of uniequip?.charEquip?.[charId] || []) if (uniequip?.equipDict?.[id]?.type === 'ADVANCED') return id;
  return null;
}

/**
 * The next free `shopLevelSortId` of a tier: one past the largest the official shop rows use there, so the ported cards
 * sort after every official one of their tier instead of colliding with one. Falls back to the row count.
 */
function nextSortId(shop, tier) {
  const used = Object.values(shop).filter((r) => r.chessLevel === tier).map((r) => r.shopLevelSortId ?? 0);
  return used.length ? Math.max(...used) + 1 : 1;
}

/**
 * The 精英 module level of a tier — the official convention, read from the tier's own price table
 * (`shopCharChessInfoData[tier]`, the row the shop's 精锐 card is priced from) instead of a number of our own: the
 * season equips tier 5's elites at module level 1 and tier 6's at 3, and a ported card must follow its tier.
 */
function eliteEquipLevel(act, tier) {
  const rows = act?.shopCharChessInfoData?.[String(tier)] || act?.shopCharChessInfoData?.[tier] || [];
  const golden = rows.find((r) => r && r.isGolden);
  return golden?.equipLevel ?? 0;
}

/**
 * `act` with the two operators' rows added (a new object; the input is never mutated). Returns the input unchanged when
 * the character table does not have them — a partial gamedata cache must not fail the build, it just cannot port them.
 *
 * @param {Record<string, any>} act `activity.AUTOCHESS_SEASON[SEASON]`
 * @param {{ charTable: Record<string, any>, uniequip: Record<string, any> }} tables the official tables the rows derive from
 */
export function applyForkExtra6Act(act, tables) {
  const { charTable, uniequip } = tables || {};
  if (!act || typeof act !== 'object' || !charTable || !uniequip) return act;
  const ported = FORK_EXTRA6_CHARS.filter((c) => charTable[c.charId]);
  if (!ported.length) return act;

  const charShopChessDatas = { ...act.charShopChessDatas };
  const charChessDataDict = { ...act.charChessDataDict };
  const chessNormalIdLookupDict = { ...act.chessNormalIdLookupDict };
  const garrisonDataDict = { ...act.garrisonDataDict };
  const bondInfoDict = { ...act.bondInfoDict };
  const sortId = { 5: nextSortId(charShopChessDatas, 5), 6: nextSortId(charShopChessDatas, 6) };

  ported.forEach((char, i) => {
    const baseId = forkExtra6BaseId(char);
    const goldenId = forkExtra6GoldenId(char);
    const moduleId = advancedModule(uniequip, char.charId);
    const equipLevel = eliteEquipLevel(act, char.tier);
    // 10001+ — clear of every official identifier and of the fork's own 自选 slots (266–277); only a display order key.
    const identifier = 10001 + i * 2;
    const garrison = FORK_EXTRA6_GARRISONS[char.charId] || null;
    for (const [id, gold] of [[baseId, false], [goldenId, true]]) {
      chessNormalIdLookupDict[id] = baseId;
      charChessDataDict[id] = {
        isGolden: gold,
        identifier: identifier + (gold ? 1 : 0),
        bondIds: [...char.bonds],
        garrisonIds: garrison ? [`garrison_${char.charId.replace(/^char_\d+_/, '')}_${gold ? 'b' : 'a'}`] : [],
        upgradeNum: gold ? 0 : 3,
        upgradeChessId: gold ? null : goldenId,
        status: {
          evolvePhase: 'PHASE_2', charLevel: gold ? 60 : 1, skillLevel: gold ? 7 : 4,
          favorPoint: 0, equipLevel: gold ? equipLevel : 0,
        },
      };
    }
    charShopChessDatas[baseId] = {
      charId: char.charId, chessLevel: char.tier, goldenChessId: goldenId,
      defaultUniEquipId: moduleId, chessType: 'PRESET', shopLevelSortId: sortId[char.tier], defaultSkillIndex: 2,
      // A PRESET row is its own 补位: the record the shop sells fields the operator itself (`data.test.js`: a PRESET
      // chess's backup is itself), so the five official backup fields repeat this row.
      backupCharId: char.charId, backupTmplId: null, backupCharSkillIndex: 2,
      backupCharUniEquipId: moduleId, backupCharPotRank: 0,
    };
    if (garrison) {
      for (const [form, key] of [['a', 'a'], ['b', 'b']]) {
        const gid = `garrison_${char.charId.replace(/^char_\d+_/, '')}_${key}`;
        const n = garrison.count[form];
        const desc = garrison.desc(n);
        garrisonDataDict[gid] = {
          garrisonDesc: desc, description: desc,
          eventType: 'IN_BATTLE', eventTypeDesc: '持续叠加', eventTypeIcon: 'icon_bond',
          effectType: 'ADD_BOND', battleRuneKey: 'env_gbuff_new_with_verify', charLevel: 0,
          blackboard: [
            { key: 'key', value: 0, valueStr: 'act1autochess_gar_event_selfdead' },
            { key: 'bond_type', value: 0, valueStr: 'bond_by_id' },
            { key: 'bond_id', value: 0, valueStr: garrison.bonds },
            { key: 'bond_add_type', value: 0, valueStr: 'by_count' },
            { key: 'bond_add_count', value: n, valueStr: null },
          ],
        };
      }
    }
    // Every 盟约 the operator joins lists it: `buildBonds` takes a bond's members from `chessIdList` only, and
    // test/data.test.js mirrors each chess's `bonds` into that list.
    for (const bondId of char.bonds) {
      const bond = bondInfoDict[bondId];
      if (!bond) continue;
      const list = Array.isArray(bond.chessIdList) ? bond.chessIdList : [];
      if (list.includes(baseId)) continue;
      bondInfoDict[bondId] = { ...bond, chessIdList: [...list, baseId].sort() };
    }
  });

  return { ...act, charShopChessDatas, charChessDataDict, chessNormalIdLookupDict, garrisonDataDict, bondInfoDict };
}

export default { applyForkExtra6Act, FORK_EXTRA6_CHARS, FORK_EXTRA6_PACK };
