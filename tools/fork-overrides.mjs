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

import { FORK_EXTRA6_BOND_MEMBERS } from './fork-extra6.mjs';
import { KAZDEL_BOND, KAZDEL_EQUIPMENT } from '../shared/kazdel.js';

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
    // 2026-10-17 (需求方): the mode is called 扩展模拟, not 终极模拟. The official AC-4 DIFFICULTY keeps its own name
    // (DIFFICULTY_NAMES.ABYSS = 终极模拟, the official 险境/绝境/终极 scale), so only this room's own name changes.
    name: '扩展模拟',
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
 * @param {Record<string, any>} backups data/backups.json
 * @param {Record<string, any>} [chess] data/chess.json of the same generation — needed to drop the operators that are
 *   chess records already from `diy.ownedPool` (see the tail of this function). Optional so an older caller that only
 *   has `backups` keeps working; the pool fix then simply does not run.
 * @returns {Record<string, any>} a new object (or the input when the data it needs is absent)
 */
export function applyForkBackups(backups, chess = null) {
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
  // The 自选 slots and the owned-pool fix are INDEPENDENT: a file that already carries every fork slot (`after.size`
  // 0 — the usual case on a second run) still needs the pool filtered, so neither branch may short-circuit the other.
  const pool = ownedPoolOf(backups, chess);
  const poolPatch = pool ? { ownedPool: pool } : null;
  if (!after.size) return poolPatch ? { ...backups, diy: { ...diy, ...poolPatch } } : backups;
  const out = {};
  for (const [id, s] of Object.entries(slots)) {
    if (FORK_DIY_SLOT_ID_SET.has(id)) continue;
    out[id] = s;
    const add = after.get(id);
    if (add) for (const [nid, ns] of add) out[nid] = ns;
  }
  return { ...backups, diy: { ...diy, slots: out, ...poolPatch } };
}

/**
 * `diy.ownedPool` 里剔掉「已经是棋手」的干员（需求方 2026-10-23 报的重复干员 bug）。
 *
 * 为什么会有这条：`diy.ownedPool` 是「玩家拥有的、**不在棋池里**的 6★」——`build-data.mjs` 用 `!roster.has(id)`
 * 算它，而 `roster` 读的是 `act.charShopChessDatas`，也就是**官方**那一份。内容包（莱茵生命 / 卡兹戴尔 / 雷姆必拓）
 * 的棋手记录是**之后**由本文件叠加进 `chess` 的，build 那一刻它们还不在 `roster` 里 —— 于是伊芙利特这类干员既
 * 是一张棋手卡、又被列进自选编队的可选池，玩家能把她重复加进自选编队，局内卡池的刷新概率因此异常
 * （同一个干员在两处各占一份拷贝）。
 *
 * 修在数据层而不是 UI：`shared/diy.js` 的 `diyPool` 把 `ownedPool` 原样交给每个阶的槽位，客户端只是照单显示；
 * 池子里本来就不该有她。`chess` 缺席时**原样返回**（旧调用方不受影响），空池也不产出这个键（KEY DISCIPLINE）。
 *
 * @param {Record<string, any>} backups
 * @param {Record<string, any>|null} chess
 * @returns {string[]|null} the filtered pool, or null when nothing should change
 */
function ownedPoolOf(backups, chess) {
  const pool = backups?.diy?.ownedPool;
  if (!Array.isArray(pool) || !pool.length || !isPlainObject(chess)) return null;
  const roster = new Set();
  for (const rec of Object.values(chess)) if (isPlainObject(rec) && typeof rec.charId === 'string' && rec.charId) roster.add(rec.charId);
  const kept = pool.filter((id) => !roster.has(id));
  return kept.length === pool.length ? null : kept;
}

/**
 * `backups.tokens` 里 owner 全都不在自选池里的记录（棋手那份在 `data/tokens.json`，是另一套，不动）。
 * 自选池剔掉某人之后，只为她存在的那条召唤物记录永远不会被用到 —— 留着就是一条孤儿，
 * `test/backups.test.js` 也会（正确地）判它错。部分 owner 仍在时保留那几条（owners / variants 一起收窄）。
 *
 * 与 `tools/build-data.mjs` 写盘前那一段是同一件事的两半（那条是重建、这条是增量 patch），所以判据写在这里
 * 一份、由 `applyForkPackAphris` 调用。
 * @param {Record<string, any>} backups
 * @param {string[]} pool the filtered pool
 * @returns {Record<string, any>|null} the new token map, or null when nothing changes
 */
function tokensOf(backups, pool) {
  const tokens = backups?.tokens;
  if (!isPlainObject(tokens) || !Array.isArray(pool)) return null;
  const inPool = new Set(pool);
  const out = {};
  let changed = false;
  for (const [tid, rec] of Object.entries(tokens)) {
    const owners = (Array.isArray(rec?.owners) ? rec.owners : []).filter((o) => inPool.has(String(o).split('@')[0]));
    if (owners.length === (rec?.owners || []).length) { out[tid] = rec; continue; }
    changed = true;
    if (!owners.length) continue;
    const variants = {};
    for (const o of owners) if (rec.variants && rec.variants[o]) variants[o] = rec.variants[o];
    out[tid] = { ...rec, owners, variants };
  }
  return changed ? out : null;
}

// =====================================================================================================================
// 六.3 莱茵生命 (Rhine Lab) — the ported 盟约 and its members

/**
 * The ported 莱茵生命 盟约 (`rhineShip`), one of the 内容包 switches (六.2). It is CARRIED BY TWO switches: 莱茵生命
 * (`packRhine`, the whole Rhine expansion — 谬因·并入莱茵 was merged into it on 2026-10-23, so it is ONE switch now)
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
/**
 * 八: the 卡兹戴尔 盟约's icon and its two 装备 icons. `public/art/kazdel/README.md` carries the provenance: `bond.png`
 * is the PNG the owner supplied for it, the two `-v2.png` are the equipment illustrations, and neither is official art
 * (`public/assets/` stays ignored). `shared/kazdel.js` owns the bond / equipment ids.
 */
export const FORK_KAZDEL_BOND_ID = KAZDEL_BOND;
export const FORK_KAZDEL_ICON = '/art/kazdel/bond.png';
export const FORK_KAZDEL_ITEM_ICONS = Object.freeze(Object.fromEntries(
  Object.keys(KAZDEL_EQUIPMENT).map((key) => [`trap_kazdel_${key}`, `/art/kazdel/${key}-v2.png`]),
));
const FORK_RHINE_PACKS = Object.freeze(['packRhine']);

// ---------------------------------------------------------------------------------------------------------------------
// 二.1 地灵 (需求方 2026-10-23)
//
// 参考 https://m.prts.wiki/w/地灵 与官方数据表：她的两条棋手记录 `chess_char_1_11_a/b`（tier 1，价 2，辅助）已经
// 一字不差地存在于 `data/chess.json`——盟约 `miraShip`（奇迹）+ `visiShip`（远见），特质 `garrison_25_a/b`，其中
// `garrison_25_b` 的原文就是「<获得时>自身所属盟约层数+4（无需激活盟约）」，正是需求描述的那一条。差的只有一件事：
// `charShopChessDatas` 把她标成 `isHidden`，于是 `build-data` 写出 `visible: false`，卫戍协议里看不到也抽不到。
//
// 所以这个"mod"没有新数值、新特质、新盟约可写，它只是**把她放回池子**。`packRestore` 负责关包时放回 `visible: false`。
export const FORK_BEANSTALK_PACK = 'packBeanstalk';
/** 地灵的两条棋手记录（普通 + 精锐）。 */
export const FORK_BEANSTALK_CHESS = Object.freeze(['chess_char_1_11_a', 'chess_char_1_11_b']);
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
      // `isCore: true`: 莱茵生命 is an eighth 阵营 盟约 beside the official seven (its `bondType` is SEASON like 炎 /
      // 萨尔贡 / … and its `identifier` 24 continues their sequence), and every one of those is core — the six/five
      // operator list opens one 科研装置 per tier like a faction count does. It was false while the port only seeded
      // the record; the ported operators then showed it under 附加盟约 in the 准备开局 briefing (owner report 2026-10-15).
      bondId: FORK_RHINE_BOND_ID, name, identifier, isCore: true, bondType: 'SEASON', bondOrder: identifier,
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
      // (its `packId` carries `packRhine`), so while `packRhine` is off it has to fall back to the six
      // official members. Carrying it through keeps the in-place `tools/fork-data.mjs` patch from erasing it.
      ...(prev && isPlainObject(prev.packRestore) ? { packRestore: prev.packRestore } : {}),
    },
  };
  // 六.C: register the ported operators as members of the official 盟约 they join. 2026-10-15 (owner): the pack is
  // embedded, not switched, so the names are plain membership — no `packMembers` bookkeeping to take back out. The
  // official lists are only ever appended to — the ids are sorted the way buildBonds writes them, so a regeneration
  // and this diff agree.
  for (const [bondId, ids] of Object.entries(FORK_EXTRA6_BOND_MEMBERS)) {
    const rec = out[bondId];
    if (!isPlainObject(rec)) continue;
    const members = Array.isArray(rec.members) ? rec.members : [];
    const add = ids.filter((id) => !members.includes(id));
    if (!add.length) continue;
    out[bondId] = {
      ...rec,
      members: [...members, ...add].sort(),
      visibleMembers: (Array.isArray(rec.visibleMembers) ? rec.visibleMembers : []).concat(add).sort(),
    };
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
 * `data/chess.json` with the pack contributions of 六.3. Keyed off the record:
 *
 *   * 六.3 — every 莱茵生命 member lists the ported 盟约. The operators themselves are untouched; this only appends
 *     `rhineShip` to their `bonds` and records WHERE it came from (`packBonds`, so `shared/packData.js` takes it back
 *     out while neither 莱茵生命 switch is on).
 *
 * 2026-10-15 (owner): 六.C's 结城理 / 丰川祥子 are no longer a pack — the two operators are embedded in the game, so
 * their records (and the garrisons their `garrisonIds` name) carry no `packId` and no room can strip them.
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
    // 二.1 地灵 (需求方 2026-10-23): 官方数据里她本来就在（`chess_char_1_11_a/b`，盟约 奇迹 + 远见，特质
    // `garrison_25_b` = 「获得时自身所属盟约层数+4（无需激活盟约）」），只是 `charShopChessDatas` 标了 isHidden，
    // 所以卫戍协议里不可见、不进池。这个包只做一件事：把她变成可见的。
    //
    // `packRestore` 记的是**关包时要还原的值**（`data/*.json` 是全开真相，开关负责 strip），所以这里写
    // `{ visible: false }`；`shared/packData.js withPackRestore` 据此把 `visible` 放回去，其他字段一个字不动 ——
    // 她的盟约 / 特质 / 价格全部沿用官方值，不复制、不覆盖。
    if (FORK_BEANSTALK_CHESS.includes(id) && (rec.visible !== true || rec.isHidden === true)) {
      patch.visible = true;
      // ★ `isHidden` 也要一起改：`GameData.visibleChess`（server/match/gamedata.js）要求 `visible && !isHidden`，
      // 只翻 visible 的话她仍然抽不到 —— 这是第一版漏掉的那一格。
      patch.isHidden = false;
      patch.packRestore = {
        ...(isPlainObject(rec.packRestore) ? rec.packRestore : {}),
        [FORK_BEANSTALK_PACK]: { visible: false, isHidden: true },
      };
    }
    if (!Object.keys(patch).length) { out[id] = rec; continue; }
    changed = true;
    out[id] = { ...rec, ...patch };
  }
  return changed ? out : chess;
}

/**
 * `data/backups.json` with 谬因 a 莱茵生命 member — 六.3's 「谬因·并入莱茵」, which is a 自选 operator's bond list
 * (`diy.operators[charId].bonds`, shared/diy.js reads it). Handled apart from the chess records because she has no
 * chess record at all: she is fielded through a 自选 slot. Idempotent like the others.
 * @param {Record<string, any>} backups data/backups.json
 */
export function applyForkPackAphris(backups, chess = null) {
  if (!isPlainObject(backups)) return backups;
  const diy = isPlainObject(backups.diy) ? backups.diy : null;
  // 这段有两件事，彼此独立，谁都不许提前返回把另一件带掉：
  //   1. 缪因·并入莱茵（2026-10-23 起并入 packRhine）—— 给她的自选记录挂上 rhineShip；
  //   2. `diy.ownedPool` 剔除「已经是棋手」的干员（需求方 2026-10-23 的重复干员 bug）。内容包的棋手记录由本文件
  //      叠加进 chess，build 那一刻还不在官方 roster 里，于是伊芙利特这类干员既是一张棋手卡、又在自选可选池里。
  const pool = ownedPoolOf(backups, chess);
  // ★ 只剔池子，不动 `backups.tokens`：那些记录同时被棋手用（见 build-data 同处注释）。
  const poolPatch = pool ? { ownedPool: pool } : null;
  const operators = isPlainObject(diy?.operators) ? diy.operators : null;
  const rec = operators && isPlainObject(operators[FORK_APHRIS_CHAR_ID]) ? operators[FORK_APHRIS_CHAR_ID] : null;
  const bonds = rec && Array.isArray(rec.bonds) ? rec.bonds : [];
  const needsAphris = !!rec && !bonds.includes(FORK_RHINE_BOND_ID);
  if (!needsAphris && !poolPatch) return backups;
  /** @type {Record<string, any>} */
  const nextDiy = { ...diy };
  if (pool) nextDiy.ownedPool = pool;
  void tokensOf;
  // `backups.tokens` 是**顶层**键（不在 diy 里）：孤儿召唤物的清理要写到 backups 上，不是 diy 上。
  if (needsAphris) {
    nextDiy.operators = {
      ...operators,
      [FORK_APHRIS_CHAR_ID]: {
        ...rec,
        bonds: [...bonds, FORK_RHINE_BOND_ID],
        packBonds: { ...(isPlainObject(rec.packBonds) ? rec.packBonds : {}), packRhine: [FORK_RHINE_BOND_ID] },
      },
    };
  }
  return { ...backups, diy: nextDiy };
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
  if (!bonds) return assets;
  const patch = {};
  if (bonds[FORK_RHINE_BOND_ID] !== FORK_RHINE_ICON) patch[FORK_RHINE_BOND_ID] = FORK_RHINE_ICON;
  // 八: the 卡兹戴尔 盟约's icon. The file is the PNG the owner supplied for it (see `public/art/kazdel/README.md` for
  // its provenance and the licence boundary). The two equipment icons are the same pipeline's, and both live under
  // `public/art/kazdel/`, which — like `public/art/rhine/` — is the fork's own art rather than a game asset.
  if (bonds[FORK_KAZDEL_BOND_ID] !== FORK_KAZDEL_ICON) patch[FORK_KAZDEL_BOND_ID] = FORK_KAZDEL_ICON;
  const items = isPlainObject(assets.items) ? assets.items : {};
  for (const [trapId, url] of Object.entries(FORK_KAZDEL_ITEM_ICONS)) if (items[trapId] !== url) patch[trapId] = url;
  if (!Object.keys(patch).length) return assets;
  const bondsNext = { ...bonds };
  const itemsNext = { ...items };
  for (const [id, url] of Object.entries(patch)) (id.startsWith('trap_') ? itemsNext : bondsNext)[id] = url;
  return { ...assets, bonds: bondsNext, items: itemsNext };
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
