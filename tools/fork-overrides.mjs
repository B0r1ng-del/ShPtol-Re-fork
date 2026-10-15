// tools/fork-overrides.mjs — the fork's own data layer over the generated `data/*.json`.
//
// WHY THIS FILE EXISTS. `data/config.json` is a build product: tools/build-data.mjs `buildConfig()` (build-data.mjs:
// 2927-2993) derives every `modes[modeId]` entry from the official client tables (`act.modeDataDict` /
// `battleDataDict` / `shopLevelDataDict`, decoded from the game's activity data) — a fork cannot add a mode the game
// never shipped by editing that generator alone, and hand-editing `data/config.json` would be erased by the next
// `npm run build-data`. So the fork keeps its additions HERE, as one explicit, reviewable, pure function:
//
//   * `applyForkOverrides(config)` returns a NEW config object with the fork's modes/fields applied. It never mutates
//     its input and is IDEMPOTENT — applying it to an already-overridden config yields the same object, which is what
//     `test/fork-data.test.js` asserts against the committed `data/config.json` (drift guard).
//   * tools/build-data.mjs calls it on the freshly built config before writing (so a full regeneration keeps it), and
//     `node tools/fork-data.mjs` applies it to the committed `data/config.json` in place (the small, reviewable diff).
//
// Every fork feature that lives in generated data lands here, one block per feature, each with the reason it exists:
//   * `bans: { core: 0, addon: 0 }` on the 终极模拟 mode — no per-match bond ban there (requirement 二.1)
//   * the 自选编队 slots of `data/chess.json` / `data/backups.json` — 5 per tier instead of the official 2 (二.8)

import { FORK_EXTRA6_BOND_MEMBERS, FORK_EXTRA6_CHESS, FORK_EXTRA6_PACK } from './fork-extra6.mjs';

/** modeId of the fork's third room mode (终极模拟, AC-4, up to six 博士). */
export const FORK_MODE_ID = 'mode_ultimate_abyss';
/** The official mode every fork field of `FORK_MODE_ID` is derived from (identical rules, difficulty ABYSS). */
export const FORK_BASE_MODE_ID = 'mode_multi_abyss';

/** Structured deep copy of plain JSON (the override owns its records; nothing is shared with the input). */
function cloneJson(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(cloneJson);
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = cloneJson(x);
  return out;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The fork's 终极模拟 mode record: the AC-4 co-op mode (`FORK_BASE_MODE_ID`) under a modeId and a name of its own.
 *
 * It is a copy of the official AC-4 room — same rounds, shop, enemy table, bond set, stages and boss weights — so the
 * mode is playable the moment it exists; the fork's per-mode rules (no bond bans, the shop-slot table, the enemy stat
 * adjustments, the voting 机变) are added on top by their own changes and land here.
 *
 * `type: 'MULTI'` is deliberate: 终极模拟 is a multiplayer room, and every `type` reader (GameData.isSolo,
 * build-data's inScope / bossHpScale / prepTime branches, the client) must treat it like 同盟模拟, never like a solo
 * run. `difficulty: 'ABYSS'` keeps the difficulty-keyed lookups (bans, bloodPointAbyss, the mode's own enemyScale)
 * on the AC-4 table, which is the baseline the fork's numbers are defined against.
 *
 * @param {Record<string, any>} modes `config.modes`
 * @returns {object | null} the record, or null when the base mode is missing (partial data → no-op)
 */
export function forkUltimateMode(modes) {
  const base = isPlainObject(modes) ? modes[FORK_BASE_MODE_ID] : null;
  if (!isPlainObject(base)) return null;
  return {
    ...cloneJson(base),
    modeId: FORK_MODE_ID,
    name: '终极模拟',
    code: 'AC-4',
    sortId: 6,
    type: 'MULTI',
    difficulty: 'ABYSS',
    inScope: true,
    desc: '敌方攻击强度到达极限的模拟训练',
    // 盟约禁用 (the owner's report of 2026-10-13, reversing 二.1): 终极模拟 bans 盟约 exactly like 同盟模拟 does.
    // 二.1 originally gave the mode its own `bans: { core: 0, addon: 0 }` table so the per-match draw never removed
    // anything. The owner's ruling reverses that: "六人模式恢复像同盟模拟一样禁用一些盟约，全不禁止需要在 mod 菜单开启".
    // So the mode carries NO table of its own and `GameData.bans()` falls back to the difficulty's —
    // `config.bans.ABYSS` = 3 core + 4 add-on, byte-for-byte what `mode_multi_abyss` resolves. "No 盟约 is banned at
    // all" is now the Mod 开关 `noBondBan`'s job (shared/constants.js MOD_KEYS): that switch already overrides
    // `bans()` with `{ core: 0, addon: 0 }` and empties `modeInactiveBonds` in EVERY mode, which is exactly the
    // 「全不禁止」 the owner wants behind a switch. `activeBondIds` still lists all 23 bonds and `inactiveBondIds` is
    // still empty, so the per-match draw is the only thing that takes 盟约 out of play — as in AC-4.
    // …and the difficulty card no longer claims the unlocked roster: it said 「盟约与干员全部解锁」, which the draw
    // above makes false. What is left is what the mode really does.
    effectDescList: ['·第 4 回合起敌人强度提升', '·作战环境无比困难', '·出现极度危险的敌人'],
    // 局内商店升级规则 (requirement 二.2): every operator level adds one 干员购买槽位 (3→4→5→6→7); the LAST one adds a
    // second 道具购买槽位 instead. The official AC-4 table is {3,4,4,5,5,5} with ONE item slot throughout, so the top
    // operator level is 7 slots — two more than AC-4's 5 — and level 6 carries two item slots.
    // GameData.shopSlots(level) reads this table (clamping to chess ≤ 8, item ≤ 4) and PlayerState.rollShop lays the
    // slots out from it (`shop.layout = { chess, item }`), so nothing but these numbers changes.
    shopSlots: {
      1: { chess: 3, item: 1 },
      2: { chess: 4, item: 1 },
      3: { chess: 5, item: 1 },
      4: { chess: 6, item: 1 },
      5: { chess: 7, item: 1 },
      6: { chess: 7, item: 2 },
    },
    // 商店保底 (requirement 4): the FIRST 干员槽位 is guaranteed a high-tier card from level 5 on. GameData.shopFloor(level)
    // reads it and PlayerState._rollChessSlot draws the first slot at exactly that tier.
    //   * level 5 — slot 0 is a 5 阶 operator, every roll (the owner's wording: 「6人模式里的商店升到5级后，第一个槽位无论
    //     怎么刷新，必定是5阶干员」);
    //   * level 6 — slot 0 is a 5 阶 or 6 阶 operator, every roll (「到达6级商店后，第一个槽位无论怎么刷新，必是5阶或6阶干员」).
    // `tiers` is the allow-list the draw picks its tier from, in order of preference; the tier is chosen with the shop
    // rng, so the guarantee is deterministic per seed like every other shop roll. Levels 1–4 carry no entry → no floor.
    shopFloor: {
      5: { tiers: [5] },
      6: { tiers: [5, 6] },
    },
    // 敌人属性调整 (requirement 二.3), from round 4 on, on top of the AC-4 table:
    //   * ordinary enemies — never the leader, never the hidden core, never one of their 部位/parts: +10 % HP only;
    //   * the 最终攻势 leader: +20 % HP, +20 % DEF, +8 % ATK;
    //   * the 隐秘核心: +35 % HP, +35 % DEF, +16 % ATK.
    // Every value is a multiplier (1.2 = +20 %). GameData.enemyExtras(r) hands the ordinary HP bonus and the leader /
    // hidden-core ATK + DEF to server/match/waves.js per spawn, and GameData.bossHpExtra(bossId) applies the HP part
    // PER BOSS: a leader's HP is the shared pool and the pool is `boss.bloodPoint[difficulty]`, so the 1.20 lands on
    // boss_1…boss_7 and the 1.35 on boss_8…boss_10 separately (a hidden core is a boss id of `hiddenBossWeights`) —
    // "领袖和隐秘核心分开计算", never one blanket multiplier over the pool. DEF is an additive percentage on the
    // enemy's own DEF (`def × (1 + pct)`), i.e. the `defMul` spawn mod Battle.js already supports.
    enemyAdjust: {
      fromRound: 4,
      normal: { hp: 1.1 },
      leader: { hp: 1.2, def: 1.2, atk: 1.08 },
      hidden: { hp: 1.35, def: 1.35, atk: 1.16 },
    },
    // 机变阶段改造 (requirement 二.4) — NOW SWITCH-CONTROLLED, not a property of this mode.
    //
    // 二.4 originally put `spDraft: { untimed: true, parallel: false, randomVote: {...} }` here, i.e. 终极模拟 hard-coded
    // 「no clock + a random-allocation vote」. That made the two Mod 开关 dead in this mode: `GameData.spDraftRules` ORed
    // the mode's own value into the switch's answer, so turning 机变不限时间 OFF left `untimed: true` standing and turning
    // 机变随机分配 OFF left the vote offered — the owner's report of 2026-10-13 (「无论开启还是关闭，在所有模式里机变阶段都是
    // 不限时的，开关没有生效」 / 「该 mod 功能在六人模式里无论开启还是关闭都不生效」).
    //
    // The owner's ruling: the switches decide, and OFF means the OFFICIAL draft in every mode. So this mode declares no
    // 机变 block at all, and both behaviours come from the Mod 开关 alone:
    //   * 机变不限时间 (`untimedSp`)  on  → no mode's 机变 runs on a clock.  off → the official clock (30 s first turn,
    //     16 s after; PLAYING.md §1) is back for 终极模拟 exactly as for 同盟模拟.
    //   * 机变随机分配 (`randomSpVote`) on  → the 「随机分配」 vote is offered in every mode.  off → no mode offers it.
    // `parallel` stays false (三.4 restored the official turn order; no switch changes it).
    //
    // The vote itself is unchanged — castable at any time, half the alive players resolve the draft into a random
    // allocation, 悬赏 cards are never drawn, and a mode that ever wants its own list can still declare one
    // (`spDraftRules` reads it as the default the switch overrides).
  };
}

/**
 * Apply every fork override to a config object. Pure and idempotent; returns the input unchanged when the data it
 * needs is absent (a partial data set must still yield a working server).
 * @param {Record<string, any>} config `data/config.json`
 * @returns {Record<string, any>} a new config (or the input when nothing applies)
 */
export function applyForkOverrides(config) {
  if (!isPlainObject(config)) return config;
  const modes = isPlainObject(config.modes) ? config.modes : null;
  if (!modes) return config;
  const mode = forkUltimateMode(modes);
  if (!mode) return config;
  return { ...config, modes: { ...modes, [FORK_MODE_ID]: mode } };
}

/**
 * The fork's own `data/choices.json` layer: the 机变 draft schedule of the fork mode.
 *
 * `choices.schedule` is keyed by modeId (`schedule[modeId].rounds[r].families`, read by
 * `server/match/choices.js:100-106 scheduleFor`), and the official data naturally has no entry for a mode that never
 * shipped. Without this copy the fork mode falls back to a plain 道具补给 draft every 机变 round: it would no longer be
 * "以 AC-4 为基础", and 悬赏决策 drafts would never appear at all (AC-4 R3/R9 are 100 % 悬赏, R11 mostly) — which would
 * also make 二.4's "悬赏类不要添加随机机制" unreachable in real play. The fork therefore copies the AC-4 schedule onto
 * its own modeId, so the mode drafts exactly like AC-4 and the vote is offered exactly where AC-4 offers a non-悬赏
 * family.
 *
 * Pure and idempotent like applyForkOverrides.
 * @param {Record<string, any>} choices `data/choices.json`
 * @returns {Record<string, any>} a new object (or the input when the data it needs is absent)
 */
export function applyForkChoices(choices) {
  if (!isPlainObject(choices)) return choices;
  const schedule = isPlainObject(choices.schedule) ? choices.schedule : null;
  if (!schedule) return choices;
  // always rebuilt from the BASE mode, never from an existing fork entry: a hand-edit of the fork's own schedule is
  // then reverted by the applier and caught by test/fork-data.test.js (the same reason applyForkOverrides overwrites)
  const base = schedule[FORK_BASE_MODE_ID];
  if (!isPlainObject(base)) return choices;
  return { ...choices, schedule: { ...schedule, [FORK_MODE_ID]: cloneJson(base) } };
}

// ---- 二.8 自选编队：每阶 5 个槽位 -------------------------------------------------------------------------------

/**
 * The fork's extra 自选 slots (requirement 二.8): three more per tier, so a 自选编队 fills **5 × 5阶 + 5 × 6阶 = 10**
 * positions instead of the official 2 + 2.
 *
 * WHY IT LIVES HERE. A 自选 slot is not a UI concept: it is a `data/chess.json` record pair (`…_diyN_a` normal, `…_diyN_b`
 * elite) listed in `data/backups.json` `diy.slots`, and both files are build products of `tools/build-data.mjs` (the
 * official `act.diyChessDict` / `charShopChessDatas` tables have exactly four slots). Hand-editing them would be erased
 * by the next `npm run build-data`, so the extra slots are built here like every other fork value.
 *
 * The three per tier are copies of that tier's first official slot pair: every official slot of a tier shares its
 * `status` (E2 Lv1 rank 4, elite E2 Lv60 rank 7 with the module at stage 1 for tier 5 / 3 for tier 6), price (4 / sell 1)
 * and merge (3), so a copy is that tier's slot with new ids — the operator comes from the pick, not from the record.
 * `identifier` continues the official run (the official 自选 records end at 265) and `shopSortId` continues the tier's own
 * 自选 sequence (tier 5: 24, 25 → 26…; tier 6: 21, 22 → 23…). Neither is read for a 自选 record — it is `visible: false`,
 * so the shop-order readers (`ui/loadoutModel.js`, `ui/ownershipModel.js`) skip it — they are carried because the record
 * shape is (shared/standIn.js `IDENTITY_FIELDS`).
 */
const FORK_DIY_SLOT_SPECS = Object.freeze([
  { tier: 5, n: 3, identifier: 266, goldenIdentifier: 267, shopSortId: 26 },
  { tier: 5, n: 4, identifier: 268, goldenIdentifier: 269, shopSortId: 27 },
  { tier: 5, n: 5, identifier: 270, goldenIdentifier: 271, shopSortId: 28 },
  { tier: 6, n: 3, identifier: 272, goldenIdentifier: 273, shopSortId: 23 },
  { tier: 6, n: 4, identifier: 274, goldenIdentifier: 275, shopSortId: 24 },
  { tier: 6, n: 5, identifier: 276, goldenIdentifier: 277, shopSortId: 25 },
]);

/** The base id of a fork slot spec (`chess_char_5_diy3_a`). @param {{tier: number, n: number}} s */
export const forkDiySlotId = (s) => `chess_char_${s.tier}_diy${s.n}_a`;
/** The elite twin of a fork slot spec (`chess_char_5_diy3_b`). @param {{tier: number, n: number}} s */
export const forkDiyGoldenId = (s) => `chess_char_${s.tier}_diy${s.n}_b`;

/** Every 自选 base id the fork owns — the ids the two appliers below add, drop and rebuild. */
export const FORK_DIY_SLOT_IDS = Object.freeze(FORK_DIY_SLOT_SPECS.map(forkDiySlotId));
// BOTH forms of every fork slot: the appliers must recognise a `_b` twin of a previous run too, or a second pass reads
// it as an official anchor and rebuilds the file in a different order (test/fork-data.test.js idempotence).
const FORK_DIY_SLOT_ID_SET = new Set(FORK_DIY_SLOT_SPECS.flatMap((s) => [forkDiySlotId(s), forkDiyGoldenId(s)]));
const FORK_DIY_TIERS = Object.freeze([5, 6]);

/**
 * Where each fork slot pair goes in a file whose order is the build's: per tier, the last OFFICIAL 自选 key in that
 * order (the build writes `Object.keys(charChessDataDict).sort(naturalCmp)`, so a tier's slots are consecutive and the
 * extra ones belong directly after them) and the template records they are copied from.
 * @param {Record<string, any>} chess data/chess.json
 * @returns {Map<number, {anchor: string, template: any, golden: any}>|null} null when a tier has no official slot pair
 */
function forkDiyAnchors(chess) {
  const found = new Map();
  for (const tier of FORK_DIY_TIERS) {
    let anchor = null;
    let template = null;
    for (const [id, rec] of Object.entries(chess)) {
      if (!isPlainObject(rec) || !rec.isDiy || rec.tier !== tier || FORK_DIY_SLOT_ID_SET.has(id)) continue;
      anchor = id;
      if (!template && !rec.isGolden) template = rec;
    }
    const golden = template ? chess[template.goldenId] : null;
    if (!anchor || !template || !isPlainObject(golden)) continue;
    found.set(tier, { anchor, template, golden });
  }
  return found.size ? found : null;
}

/**
 * The fork's own `data/chess.json` layer (二.8): the official records plus the extra 自选 slot pairs, in build order.
 *
 * Pure and idempotent. The fork's slots are OWNED here: every id in FORK_DIY_SLOT_IDS is dropped and rebuilt from its
 * tier's official template, so a hand-edit of one is reverted and caught by test/fork-data.test.js — the same contract
 * as applyForkOverrides overwriting the fork mode record.
 * @param {Record<string, any>} chess data/chess.json
 * @returns {Record<string, any>} a new object (or the input when the data it needs is absent)
 */
export function applyForkChess(chess) {
  if (!isPlainObject(chess)) return chess;
  const anchors = forkDiyAnchors(chess);
  if (!anchors) return chess;
  /** @type {Map<string, Array<[string, any]>>} */
  const after = new Map();
  for (const spec of FORK_DIY_SLOT_SPECS) {
    const { anchor, template, golden } = anchors.get(spec.tier);
    const baseId = forkDiySlotId(spec);
    const goldenId = forkDiyGoldenId(spec);
    const list = after.get(anchor) ?? [];
    list.push([baseId, {
      ...cloneJson(template), chessId: baseId, baseId, goldenId,
      identifier: spec.identifier, shopSortId: spec.shopSortId, upgradeChessId: goldenId,
    }]);
    list.push([goldenId, {
      ...cloneJson(golden), chessId: goldenId, baseId, goldenId,
      identifier: spec.goldenIdentifier, shopSortId: spec.shopSortId,
    }]);
    after.set(anchor, list);
  }
  const out = {};
  for (const [id, rec] of Object.entries(chess)) {
    if (FORK_DIY_SLOT_ID_SET.has(id)) continue;
    out[id] = rec;
    const add = after.get(id);
    if (add) for (const [nid, nrec] of add) out[nid] = nrec;
  }
  return out;
}

/**
 * The fork's own `data/backups.json` layer (二.8): the extra 自选 slots of `diy.slots`, in the build's order (the build
 * lists them by the natural sort of the base ids, so a tier's slots are consecutive). Each new entry copies its tier's
 * official slot metadata (`shopLevel` — the 调度中心 level the slot enters the shop at — and `requirement`), and only its
 * `goldenId` differs.
 *
 * Nothing else in `backups` needs a fork entry: a new slot reuses its tier's `status`, so the unit forms and the summon
 * variants of that tier (`backups.units[].forms`, `backups.tokens[].variants`, keyed by `statusKey`) already cover it,
 * and `diy.prototypes` / `locked` / `ownedPool` are keyed by tier, not by slot.
 *
 * Pure and idempotent, and it owns its slots exactly like applyForkChess.
 * @param {Record<string, any>} backups data/backups.json
 * @returns {Record<string, any>} a new object (or the input when the data it needs is absent)
 */
export function applyForkBackups(backups) {
  if (!isPlainObject(backups)) return backups;
  const diy = isPlainObject(backups.diy) ? backups.diy : null;
  const slots = isPlainObject(diy?.slots) ? diy.slots : null;
  if (!slots) return backups;
  /** @type {Map<string, Array<[string, any]>>} */
  const after = new Map();
  for (const tier of FORK_DIY_TIERS) {
    let anchor = null;
    for (const [id, s] of Object.entries(slots)) {
      if (FORK_DIY_SLOT_ID_SET.has(id) || !isPlainObject(s) || s.tier !== tier) continue;
      anchor = id;
    }
    if (!anchor) continue;
    after.set(anchor, FORK_DIY_SLOT_SPECS.filter((s) => s.tier === tier).map((s) => [forkDiySlotId(s), {
      tier, goldenId: forkDiyGoldenId(s), shopLevel: slots[anchor].shopLevel, requirement: slots[anchor].requirement,
    }]));
  }
  if (!after.size) return backups;
  const out = {};
  for (const [id, s] of Object.entries(slots)) {
    if (FORK_DIY_SLOT_ID_SET.has(id)) continue;
    out[id] = s;
    const add = after.get(id);
    if (add) for (const [nid, ns] of add) out[nid] = ns;
  }
  return { ...backups, diy: { ...diy, slots: out } };
}

// =====================================================================================================================
// 六.3 莱茵生命 (Rhine Lab) — the ported 盟约 and its members

/**
 * The ported 莱茵生命 盟约 (`rhineShip`), one of the 内容包 switches (六.2). It is CARRIED BY TWO switches: 莱茵生命
 * (`packRhine`, the whole Rhine expansion) and 谬因·并入莱茵 (`packAphris`, the one-operator change) — either of them
 * has to bring the 盟约 with it, since a member with no 盟约 to join is meaningless. `packId` is an ARRAY for exactly
 * that reason (`shared/constants.js packEnabled`).
 *
 * Values are the source expansion's own (`YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine` `data/bonds.json`
 * `rhineShip`), which itself reads the official 莱茵生命 insignia and the maintainer's balance table
 * (`shared/rhineResearch.js` there): 3 / 6 / 9 distinct members, base ATK 300, +4 per 科研 layer, and the 6-member
 * ATK sharing of 15 % / 25 % (elite).
 */
export const FORK_RHINE_BOND_ID = 'rhineShip';
/** The ported 盟约's icon: the author's own monochrome SVG redraw of the 莱茵生命 insignia (`public/art/rhine/bond.svg`). */
export const FORK_RHINE_ICON = '/art/rhine/bond.svg';
const FORK_RHINE_PACKS = Object.freeze(['packRhine', 'packAphris']);
/** `rhineShip`'s blackboard and its 效果 text (the source expansion's own words). */
const FORK_RHINE = Object.freeze({
  name: '莱茵生命',
  identifier: 24,
  thresholds: [3, 6, 9],
  effectId: 'bondeffect_rhine',
  bb: { base_atk: 300, atk_per_stack: 4, sharing_count: 6, sharing_atk: 0.15, sharing_golden_atk: 0.25 },
  desc: '在场3名不同【莱茵生命】干员时启动一台科研装置；在场6名时同时启动两台，9名时三台全部启动。达到6名时，除伊芙利特和治疗干员外的莱茵输出干员获得己方已部署装置中最高基础攻击力的15%，精锐25%，作为额外攻击力；多个装置不重复共享。3名时获得生态维持仪与能量谐振仪，9名时解锁只有一级的全场激光钻机。装置基础攻击力300，每层科研增加4点。生态维持仪与能量谐振仪参战成功获得2研究点，失败获得1点；第1次突破需要5点，第2次突破需要5点。每次突破后研究点清零，溢出不保留；科研层数不受影响，激光钻机不积累研究点或突破。',
});

/**
 * The official 莱茵生命 operators that already exist in this fork's chess pool (`character_table` groupId `rhine`).
 * They are ordinary operators — the port only ADDS `rhineShip` to their bond list, so the membership disappears again
 * with the switch (`packBonds`). 谬因 (`char_4229_aphris`) is not here: she is a 自选 operator and joins through
 * `data/backups.json` `diy.operators` instead (`applyForkPackAphris`).
 *
 * Both forms of each operator are patched, but `bonds[].members` lists the BASE (`_a`) ids only — the same convention
 * every official bond follows (`data.test.js` asserts a member is a non-golden chess).
 */
const FORK_RHINE_BASES = Object.freeze([
  'chess_char_2_02_a', 'chess_char_4_21_a', 'chess_char_5_16_a', 'chess_char_5_11_a', 'chess_char_6_11_a', 'chess_char_6_16_a',
]);
export const FORK_RHINE_CHESS = Object.freeze(FORK_RHINE_BASES.flatMap((id) => [id, `${id.slice(0, -1)}b`]));
/** The 自选 operator the 谬因·并入莱茵 switch makes a 莱茵生命 member. */
export const FORK_APHRIS_CHAR_ID = 'char_4229_aphris';

/**
 * `data/bonds.json` with the ported 莱茵生命 盟约 added (六.3) and the ported operators registered as members of the
 * official 盟约 they join (六.C).
 *
 * The `rhineShip` record is OWNED here (rebuilt from FORK_RHINE on every run), so a hand-edit is reverted and caught by
 * test/fork-data.test.js. For 六.C there is nothing to own — the official bonds are the official bonds — only the list
 * of names the pack contributed, as `packMembers` (`shared/packData.js withPackMembers` takes them back out while
 * `packExtra6` is off, so an all-off room sees the original member list).
 * @param {Record<string, any>} bonds data/bonds.json
 */
export function applyForkBonds(bonds) {
  if (!isPlainObject(bonds)) return bonds;
  const { bb, name, identifier, thresholds, effectId, desc } = FORK_RHINE;
  // 六.F: `tools/rhine-data.mjs` recomputes every 盟约's member list from the chess that name it (the source
  // expansion's own recompute), which is what adds the four ported operators (梅尔 / 伊芙利特 / 溯光星源 / 多萝西) to this
  // one — 10 members, 9 visible (白面鸮's II-cost form is hidden). This applier runs BEFORE that overlay in
  // `tools/build-data.mjs` (where the record does not exist yet, so the six bases seed it) and AFTER it in
  // `node tools/fork-data.mjs` (where the record is already complete). Preserving an existing list keeps both orders
  // on the same result instead of truncating the ported members back off on every in-place patch.
  const prev = isPlainObject(bonds[FORK_RHINE_BOND_ID]) ? bonds[FORK_RHINE_BOND_ID] : null;
  const seeded = (field) => (prev && Array.isArray(prev[field]) && prev[field].length ? prev[field] : [...FORK_RHINE_BASES]);
  const out = {
    ...bonds,
    [FORK_RHINE_BOND_ID]: {
      bondId: FORK_RHINE_BOND_ID, name, identifier, isCore: false, bondType: 'SEASON', bondOrder: identifier,
      powerIdList: [], iconId: FORK_RHINE_BOND_ID, activeCount: thresholds[0], thresholds: [...thresholds],
      maxCount: null, thresholdTemplate: 'count_threshold_upward', countMode: 'BOARD', countsHand: false,
      countsGoldenOnly: false, activeType: 'BATTLE', isActiveInDeck: false, noStack: false, weight: 10,
      maxInactiveBondCount: -1, layerMilestones: [],
      desc, descRaw: desc, effectId, effectName: name, effectDesc: desc, effectDescRaw: desc, effectDescParams: [],
      bb: { ...bb },
      // Every other 盟约's numbers are read through `env_gbuff_new` (`sim/content/bonds/addon/battle.js bondBb`), so this
      // one carries its blackboard the same way instead of inventing a second lookup. `bbStr.key` keeps the source
      // expansion's own rune key name.
      bbStr: { key: 'rhine_research' },
      buffs: [{ key: 'env_gbuff_new', bb: { ...bb }, bbStr: { key: 'rhine_research' } }],
      baseParams: [], perStackParams: [],
      members: seeded('members'), visibleMembers: seeded('visibleMembers'), packId: [...FORK_RHINE_PACKS],
      // `packRestore` (shared/packData.js) is the overlay's, not this applier's: the record outlives a single switch
      // (its `packId` is an array), so while `packRhine` is off but `packAphris` on it has to fall back to the six
      // official members. Carrying it through keeps the in-place `tools/fork-data.mjs` patch from erasing it.
      ...(prev && isPlainObject(prev.packRestore) ? { packRestore: prev.packRestore } : {}),
    },
  };
  // 六.C: register the ported operators as members of the official 盟约 they join, and record the names as the pack's
  // own contribution so they come back out with the switch. The official lists are only ever appended to — the ids are
  // sorted and de-duplicated the way buildBonds writes them, so a regeneration and this diff agree.
  for (const [bondId, ids] of Object.entries(FORK_EXTRA6_BOND_MEMBERS)) {
    const rec = out[bondId];
    if (!isPlainObject(rec)) continue;
    const members = Array.isArray(rec.members) ? rec.members : [];
    const add = ids.filter((id) => !members.includes(id));
    const next = { ...rec, packMembers: { ...(isPlainObject(rec.packMembers) ? rec.packMembers : {}), [FORK_EXTRA6_PACK]: [...ids] } };
    if (add.length) {
      next.members = [...members, ...add].sort();
      next.visibleMembers = (Array.isArray(rec.visibleMembers) ? rec.visibleMembers : []).concat(add).sort();
    }
    out[bondId] = next;
  }
  return out;
}

/**
 * `data/effects.json` with the 莱茵生命 盟约's effect record. `effectType` BOND, `buffs` empty (the 盟约's numbers are
 * read from the bond record's own `bb` by the sim's generic path, like the other add-on bonds whose effect is all in
 * `env_gbuff_new`), and the same `packId` as the bond so the pair appears and disappears together.
 * @param {Record<string, any>} effects data/effects.json
 */
export function applyForkEffects(effects) {
  if (!isPlainObject(effects)) return effects;
  const { name, desc, effectId, bb } = FORK_RHINE;
  return {
    ...effects,
    [effectId]: {
      effectId, effectType: 'BOND', name, desc, descRaw: desc, counterType: 'NONE', continuedRound: -1,
      decoIconId: null, enemyPrice: 0, buffs: [], params: { ...bb }, packId: [...FORK_RHINE_PACKS],
    },
  };
}

/**
 * `data/chess.json` with the pack contributions of 六.3 and 六.C. Two independent blocks, both keyed off the record:
 *
 *   * 六.3 — every 莱茵生命 member lists the ported 盟约. The operators themselves are untouched; this only appends
 *     `rhineShip` to their `bonds` and records WHERE it came from (`packBonds`, so `shared/packData.js` takes it back
 *     out while neither 莱茵生命 switch is on).
 *   * 六.C — the two ported operators are the pack's own records, so they carry `packId: 'packExtra6'` and the whole
 *     card pair disappears with the switch (`shared/packData.js recordAvailable`). The builder synthesized their rows
 *     (tools/fork-extra6.mjs), so this is the one place that names them as a pack's.
 *
 * Their `garrisonIds` point at records `buildGarrisons` synthesizes too — `applyForkGarrisons` stamps those, because a
 * garrison the pack owns must leave with it (`test/pack-extra6.test.js`).
 *
 * Idempotent: a second pass writes the same fields.
 * @param {Record<string, any>} chess data/chess.json
 */
export function applyForkPackMembers(chess) {
  if (!isPlainObject(chess)) return chess;
  const out = {};
  let changed = false;
  for (const [id, rec] of Object.entries(chess)) {
    if (!isPlainObject(rec)) { out[id] = rec; continue; }
    const patch = {};
    if (FORK_RHINE_CHESS.includes(id)) {
      const bonds = Array.isArray(rec.bonds) ? rec.bonds : [];
      if (!bonds.includes(FORK_RHINE_BOND_ID)) {
        patch.bonds = [...bonds, FORK_RHINE_BOND_ID];
        patch.packBonds = { ...(isPlainObject(rec.packBonds) ? rec.packBonds : {}), packRhine: [FORK_RHINE_BOND_ID] };
      }
    }
    if (FORK_EXTRA6_CHESS.includes(id) && rec.packId !== FORK_EXTRA6_PACK) patch.packId = FORK_EXTRA6_PACK;
    if (!Object.keys(patch).length) { out[id] = rec; continue; }
    changed = true;
    out[id] = { ...rec, ...patch };
  }
  return changed ? out : chess;
}

/**
 * `data/garrisons.json` with the 六.C garrison records owned by the pack. `buildGarrisons` synthesizes them from the act
 * row `tools/fork-extra6.mjs` writes (makoto's 卫戍协议特质), but it knows nothing about packs: without this the record
 * would outlive its switch — `chess.json` loses the operator while `garrisons.json` keeps a record whose `owners` name
 * it, which every `garrison` lookup would still resolve.
 *
 * The ids are derived from the operators the pack owns, so a third operator added to `FORK_EXTRA6_CHARS` is covered
 * without touching this function. Idempotent.
 * @param {Record<string, any>} garrisons data/garrisons.json
 */
export function applyForkGarrisons(garrisons) {
  if (!isPlainObject(garrisons)) return garrisons;
  const owned = new Set(FORK_EXTRA6_CHESS);
  const out = {};
  let changed = false;
  for (const [id, rec] of Object.entries(garrisons)) {
    if (!isPlainObject(rec)) { out[id] = rec; continue; }
    const mine = Array.isArray(rec.owners) && rec.owners.some((owner) => owned.has(owner));
    if (!mine || rec.packId === FORK_EXTRA6_PACK) { out[id] = rec; continue; }
    changed = true;
    out[id] = { ...rec, packId: FORK_EXTRA6_PACK };
  }
  return changed ? out : garrisons;
}

/**
 * `data/backups.json` with 谬因 a 莱茵生命 member — 六.3's 「谬因·并入莱茵」, which is a 自选 operator's bond list
 * (`diy.operators[charId].bonds`, shared/diy.js reads it). Handled apart from the chess records because she has no
 * chess record at all: she is fielded through a 自选 slot. Idempotent like the others.
 * @param {Record<string, any>} backups data/backups.json
 */
export function applyForkPackAphris(backups) {
  if (!isPlainObject(backups)) return backups;
  const diy = isPlainObject(backups.diy) ? backups.diy : null;
  const operators = isPlainObject(diy?.operators) ? diy.operators : null;
  const rec = operators && isPlainObject(operators[FORK_APHRIS_CHAR_ID]) ? operators[FORK_APHRIS_CHAR_ID] : null;
  if (!rec) return backups;
  const bonds = Array.isArray(rec.bonds) ? rec.bonds : [];
  if (bonds.includes(FORK_RHINE_BOND_ID)) return backups;
  return {
    ...backups,
    diy: {
      ...diy,
      operators: {
        ...operators,
        [FORK_APHRIS_CHAR_ID]: {
          ...rec,
          bonds: [...bonds, FORK_RHINE_BOND_ID],
          packBonds: { ...(isPlainObject(rec.packBonds) ? rec.packBonds : {}), packAphris: [FORK_RHINE_BOND_ID] },
        },
      },
    },
  };
}

/**
 * `data/assets.json` with the ported 盟约's icon. The file is a tracked build product of `tools/fetch-assets.mjs` (not of
 * `tools/build-data.mjs`), and `test/ui/assetUrls.test.js` requires EVERY bond in `data/bonds.json` to have one, so the
 * ported bond needs its entry here. The file itself is the author's own monochrome SVG redraw of the 莱茵生命 insignia
 * (`public/art/rhine/bond.svg`, GPL-3.0-or-later per that folder's README) — no official art is committed.
 * @param {Record<string, any>} assets data/assets.json
 */
export function applyForkAssets(assets) {
  if (!isPlainObject(assets)) return assets;
  const bonds = isPlainObject(assets.bonds) ? assets.bonds : null;
  if (!bonds || bonds[FORK_RHINE_BOND_ID] === FORK_RHINE_ICON) return assets;
  return { ...assets, bonds: { ...bonds, [FORK_RHINE_BOND_ID]: FORK_RHINE_ICON } };
}

/**
 * The fork layer of the generated data files, by file name — the ONE list both directions read:
 * `tools/build-data.mjs` applies it to a freshly built file set before writing, and `tools/fork-data.mjs` applies the
 * same functions to the committed files. A fork feature that lives in generated data gets its applier named here and
 * nowhere else.
 *
 * That is not tidiness: 六.3 added its appliers to the CLI's own list but not to the builder's, and a full
 * `npm run build-data` silently dropped the ported 盟约 — the builder *and* a regeneration both looked fine, because the
 * committed files had been patched in place. Only `test/data.test.js`'s offline rebuild check could see it, and that
 * check skips without `.cache/gamedata`, so CI never caught it either.
 *
 * `assets` is in the list although `tools/fetch-assets.mjs` owns that file (docs/ASSETS.md) and build-data.mjs never
 * writes it: one list means the CLI needs no list of its own. build-data looks each name up in the files it built, so
 * it simply never reaches `assets`.
 */
export const FORK_APPLIERS = {
  config: applyForkOverrides,
  choices: applyForkChoices,
  chess: applyForkPackMembers,
  backups: applyForkPackAphris,
  bonds: applyForkBonds,
  garrisons: applyForkGarrisons,
  effects: applyForkEffects,
  assets: applyForkAssets,
};

/**
 * The subset of `FORK_APPLIERS` `tools/build-data.mjs` runs on EVERY potential pass (潜能 1–6) instead of once on the
 * finished files, and — because each of them also has a later half — the file each one finishes at the end.
 *
 * Two reasons these two files are special:
 *   * `attachPotential` rebuilds every chess record and unit form from `passes.map((p) => p.chess[id])` and reports
 *     "missing at a rank" for an id only one pass has, so a record the fork adds (`applyForkChess` / `applyForkBackups`,
 *     二.8's 自选 slots) must exist at all six ranks;
 *   * it also annotates the FULL-rank record **in place**, and `files.chess` / `files.backups` are that very object, so
 *     their remaining additions (`applyForkPackMembers` / `applyForkPackAphris`, 六.3's `bonds` / `packBonds`) must land
 *     AFTER it — a spread appends at the end, and `data/chess.json` is the file `tools/fork-data.mjs` patched in place,
 *     where `packBonds` therefore sits after `potDown`. Building it the other way round is the same JSON in the same
 *     order only by luck; it is not, and the byte-for-byte check says so.
 */
export const FORK_PASS_APPLIERS = {
  chess: applyForkChess,
  backups: applyForkBackups,
};
