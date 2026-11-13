// server/match/waves.js — per-match enemy setup and per-round spawn generation: the OFFICIAL generator decoded from
// the client (`RandomEnemyGenerater`, research 08 §2; DESIGN §14 "Corrections from research 08/09"). No custom balance:
// counts, kinds, timing and stat scaling are the official ones.
//
// Per match (setupMatchWaves):
//   * stage: weighted (stages[id].weight) among mode.stages that are active with weight > 0 — official mode data:
//     标准 (FUNNY) / 入门 = 战场#01 only, 险境 = 8 stages, 绝境 / 终极 = 7 (no 战场#01), weight 50 each, so the match seed
//     picks uniformly (test/match/stagepick.test.js)
//   * factions: `specialEnemyNum` (3) distinct types among the involveRandom ones (FLY/TIMES/ELEMENT/DOT/INVISIBLE/
//     REFLECTION), uniform (shuffle, take 3)
//   * type schedule: each chosen type owns `count` (3) of the `maxLevelCnt` (15) round slots, SPECIAL fills the other 6;
//     the slots are shuffled — typeSlots[r-1] = the ONE type of round r (the briefing shows the 3 types, the order
//     stays hidden)
//   * picks: for every round 1..15, generated now (so the preview and every battle agree): half = r ≤ 7; a weighted
//     (entry.weight) special entry of the round's type and half whose SPECIAL key is not in the mode's
//     inactiveEnemyKeys (attached keys are never filtered); normal / elite = a random attached key
//   * boss: weighted mode.bossWeights; hidden boss: weighted mode.hiddenBossWeights (independent)
// Per round (buildNormalWave / buildBossWave; one composition shared by every player):
//   * every template SPAWN action whose key is a placeholder (N/E/S walk, NF/EF/SF fly) becomes the pick's
//     normal / elite / special key — or is SKIPPED (not spawned, not previewed) when the new key's movement class differs
//     from the placeholder's (ground rounds drop NF/EF/SF, FLY rounds drop N/E/S);
//     n' = clamp(roundHalfEven(f32(f32(n·P(tpl))/f(tpl)) / f32(P(new)/f(new))), 1, 5) per ACTION (P = enemies.json
//     attrPower, f = beFactor), unit i spawning at time + i·max(n·interval/n', 0.05·n·interval) (same window);
//     literal keys (R1 源石虫, leader escorts) and T/TF tokens are kept; 炎佑 (enemy_9012_acloon) is never an enemy
//   * leader / hidden rounds use the pick of their own slot (14, 15; solo 标准 9), so only E or EF escorts spawn
//   * stat scaling: mods = config.modes[m].enemyScale[r] (the PRTS table = the ENEMY effects 攻坚装备 / 补给线 / 急行军,
//     which hit every enemy but 炎佑 — no other multiplier), also for bounty enemies and leader parts; the leader takes
//     the ATK / speed multipliers but never HP (its HP is the shared server pool)
//   * every SpawnSpec = one action ({ time, enemyKey, routeIndex, count, interval, mods, actionIndex, preview }):
//     `mods.slot` (placeholder class) lets 联防 route leaks, `preview` = { gate, start, fly, elite, boss } feeds previewOf
// Bounties (bountySpawns / withBounties): each bounty unit joins the round template's first `lrsldr` (walker) / `yokai`
// (flyer) action (else action 0), inserted among that action's own units at floor((i+1)·len/(n+1)), and the whole list
// is spread over the action window (client `_InsertSpActionToNormal` + `_CalculateActionPredelay`, decoded).
// 联防 (buildUniteWave): walkers → the escaped template's `lrsldr` action, flyers → `yokai`, tokens → `gopro_2` /
// `lazerd` (else action 0); owner k starts 0.5·k s after the action, units step min(max(W/M, 0.05·W), 5 s) with M the
// largest owner group (client `_CalculateActionPredelayConsiderUid`, decoded).

import { createRng, deriveSeed } from '../sim/rng.js';
import { PLUGIN_ACTION_UNITS } from '../../shared/plugins/limits.js';
import { ARC_SEASON, ARC_LEADER_ID, ARC_HIDDEN_ID, arcSchedule, arcWeighted } from '../../shared/crisisArc.js';

const ACLOON = 'enemy_9012_acloon';
const DEFAULT_PLACEHOLDERS = Object.freeze({
  N: { cls: 'normal', fly: false }, E: { cls: 'elite', fly: false }, S: { cls: 'special', fly: false },
  NF: { cls: 'normal', fly: true }, EF: { cls: 'elite', fly: true }, SF: { cls: 'special', fly: true },
});
const MIN_ACTION_INTERVAL_RATIO = 0.05;
/** The most units one wave action fields (templateSpawns' count clamp; replacedCount and bountyPlan stay within it) — the
 * data-plugin check caps the replaced counts at the same number (shared/plugins/limits.js). */
const MAX_ACTION_UNITS = PLUGIN_ACTION_UNITS;
/** 联防 timing (client `_CalculateActionPredelayConsiderUid`): owner offset ACTION_INTERVAL_FOR_UID, unit step cap
 * MAX_ACTION_INTERVAL_FOR_UID. */
const UNITE_OWNER_STEP = 0.5;
const UNITE_MAX_UNIT_STEP = 5;

/** Weighted pick of [id, weight] pairs with the rng. */
export function weightedPick(rng, pairs) {
  let total = 0;
  for (const [, w] of pairs) total += Math.max(0, Number(w) || 0);
  if (total <= 0) return pairs.length ? pairs[0][0] : null;
  let r = rng() * total;
  for (const [id, w] of pairs) { r -= Math.max(0, Number(w) || 0); if (r < 0) return id; }
  return pairs[pairs.length - 1][0];
}

/** C# Math.Round(double): banker's rounding (half to even). */
export function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.floor(x + 0.5);
}

const gen = (gd) => (gd.factions.generation && typeof gd.factions.generation === 'object' ? gd.factions.generation : {});
const intOr = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);

/** Official movement class of an enemy key (randomEnemyAttributeDict.isFlyEnemy, else its motion). */
/**
 * 一张敌人记录，**契约专用敌人也算**（data/enemies-crisis.json）。波次构建必须走这里：
 * 弧光作战的敌人有一半在 enemies-crisis.json 里，`gd.enemy()` 只查 enemies.json，查不到就整条替换被跳过。
 */
export const anyEnemy = (gd, key) => (typeof gd.enemyAny === 'function' ? gd.enemyAny(key) : gd.enemy(key));

export function isFlyKey(gd, key) {
  const e = gd.enemy(key);
  if (!e) return false;
  if (typeof e.isFlyEnemy === 'boolean') return e.isFlyEnemy;
  return !!(e.stats && e.stats.motion === 'FLY');
}

/**
 * Official attribute power P(k) (float32), enemies.json `attrPower`; derived from the stats when absent.
 * ★ 查表必须走 anyEnemy：契约敌人在 data/enemies-crisis.json 里，用 gd.enemy() 会得到 0，而 0 会让 replacedCount
 *   的 ratio 落到下限 —— 弧光每回合的怪量就被压成 1（用户 2026-11-13 反馈「敌人每回合数量不对，太少了」）。
 */
export function attrPower(gd, key) {
  const e = anyEnemy(gd, key);
  if (!e) return 0;
  if (typeof e.attrPower === 'number' && Number.isFinite(e.attrPower)) return e.attrPower;
  const s = e.stats || {};
  const f = Math.fround;
  const bf = gen(gd).beFactors || {};
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  let p = f(f(f(n(s.atk) * (bf.atk ?? 5)) + f(n(s.maxHp) * (bf.hp ?? 1))) + f(n(s.def) * (bf.def ?? 3)));
  p = f(p + f((bf.res ?? 3) * n(s.res)));
  return p;
}

const beFactor = (gd, key) => {
  const v = anyEnemy(gd, key)?.beFactor;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
};

/**
 * Units a placeholder action of `n` template enemies becomes (client `_CalculateEnemyCountByBattleEffectiveness`):
 * clamp(roundHalfEven(f32(f32(f32(n·P(t))/f(t)) / f32(P(new)/f(new)))), min, max).
 */
export function replacedCount(gd, tplKey, n, newKey) {
  const g = gen(gd);
  // (bounded like a template action's own count — templateSpawns' 1–50: a data plugin's 4e7 would be one action's units,
  // and an array of them in bountyPlan; the official 1 / 5 are unchanged)
  const min = Math.max(1, Math.min(MAX_ACTION_UNITS, Number.isInteger(g.minReplacedEnemyCount) ? g.minReplacedEnemyCount : 1));
  const max = Math.max(1, Math.min(MAX_ACTION_UNITS, Number.isInteger(g.maxReplacedEnemyCount) ? g.maxReplacedEnemyCount : 5));
  const f = Math.fround;
  const origin = f(f(n * attrPower(gd, tplKey)) / beFactor(gd, tplKey));
  const unit = f(attrPower(gd, newKey) / beFactor(gd, newKey));
  if (!(unit > 0)) return min;
  const ratio = f(origin / unit);
  return Math.max(min, Math.min(max, roundHalfEven(ratio)));
}

/** Placeholder key → { slot, cls, fly } (factions.generation.placeholders, else built from templateSlots). */
function placeholderMap(gd) {
  const g = gen(gd);
  if (g.placeholders && typeof g.placeholders === 'object') return g.placeholders;
  const out = {};
  const ts = gd.factions.templateSlots && typeof gd.factions.templateSlots === 'object' ? gd.factions.templateSlots : {};
  for (const [slot, key] of Object.entries(ts)) if (DEFAULT_PLACEHOLDERS[slot]) out[key] = { slot, ...DEFAULT_PLACEHOLDERS[slot] };
  return out;
}

/**
 * 弧光作战的占位映射：**它自己的模板槽**，不是卫戍协议本季的 templateSlots。
 *
 * 本季的 `templateSlots`（factions.json）把 N/E/S 指向 `enemy_1422_lrsldr` 等莱茵生命敌人，而弧光的波次模板
 * （`arc_*` 与它复用的 `act1autochess_01`）里的普通槽是 `enemy_1007_slime` / `enemy_1005_yokai` 这类**不在表里**的
 * key，于是 `templateSpawns` 的 `p = ph[key0]` 为空，pick 根本没机会替换 —— 实测第 1 回合出的就是史莱姆。
 *
 * 所以弧光要自己说「这些模板 key 是哪个槽」：凡是被弧光 pick 覆盖的模板（`arc_` 前缀，以及本季的普通模板），
 * 把它里面**不是首领、不是 part、且确实是敌人**的 key 都当作按 `classOf` 分类的占位。这样 `arcSchedule` 挑的
 * 弧光敌人才会真正出场（用户 2026-11-13 反馈：出怪完全没按种子）。
 * @param {import('./gamedata.js').GameData} gd
 */
export function arcPlaceholderMap(gd) {
  const out = {};
  // the season's own table still applies (a template can mix both vocabularies)
  Object.assign(out, placeholderMap(gd));
  const slotOf = { N: 'normal', E: 'elite', S: 'special', NF: 'normal', EF: 'elite', SF: 'special' };
  const addByKey = (key, slot) => {
    if (typeof key !== 'string' || out[key]) return;
    const e = gd.enemy(key);
    if (!e) return;
    // 模板给了槽就照槽走；没给槽（第 1 回合的 enemy_1007_slime 就是这种）就按敌人自己的 rank / fly 判类，
    // 否则它会漏出占位表、原样出场 —— 那正是「出怪完全不按种子」的最后一个缺口。
    const cls = slotOf[slot] || (e.rank === 'ELITE' ? 'elite' : 'normal');
    out[key] = { slot: slot || null, cls, fly: slot ? /F$/.test(slot) : !!isFlyKey(gd, key) };
  };
  // ★ 弧光的普通回合**复用本季的模板**（roundCfg 的 template 来自 modeDataDict，不区分赛季），所以占位表必须覆盖
  //   本季全部模板里出现的 key，不能只看 arc_*。第 1 回合就是 act1autochess_01，里面是 enemy_1007_slime 等。
  const waves = gd.raw.waves && typeof gd.raw.waves === 'object' ? gd.raw.waves : {};
  for (const w of Object.values(waves)) {
    if (!w || typeof w !== 'object') continue;
    for (const s of Array.isArray(w.spawns) ? w.spawns : []) {
      if (!s || s.tag === 'boss' || s.tag === 'part') continue;
      addByKey(s.key ?? s.enemyKey, s.slot || null);
    }
  }
  // a template key that names no slot still needs a class: fall back to the enemy's own rank / fly
  for (const w of Object.values(waves)) {
    if (!w || typeof w !== 'object') continue;
    for (const s of Array.isArray(w.spawns) ? w.spawns : []) {
      if (!s || s.tag === 'boss' || s.tag === 'part') continue;
      const key = s.key ?? s.enemyKey;
      if (out[key]) continue;
      const e = gd.enemy(key);
      if (!e) continue;
      out[key] = { slot: null, cls: e.rank === 'ELITE' ? 'elite' : 'normal', fly: !!isFlyKey(gd, key) };
    }
  }
  return out;
}

const firstHalfMax = (gd) => intOr(gen(gd).firstHalfMaxRound, Math.floor(intOr(gen(gd).maxLevelCnt, 15) / 2));

/** The special entry list (factions.json entries) sorted by key. */
function entryList(gd) {
  const e = gd.factions.entries && typeof gd.factions.entries === 'object' ? Object.values(gd.factions.entries) : [];
  return e.filter((x) => x && typeof x.key === 'string').sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The round pick of a type (client `_GenerateRandomEnemyData`): weighted entry of that type and half whose SPECIAL key
 * is allowed in the mode, plus a random attached normal / elite key (never filtered by the mode).
 * @returns {null | { round: number, type: string, key: string, normal: string|null, elite: string|null, fly: boolean, firstHalf: boolean }}
 */
export function pickRoundEntry(gd, rng, type, round) {
  const half = round <= firstHalfMax(gd);
  const ok = (e) => e.type === type && !!e.firstHalf === half && e.key !== ACLOON && !!gd.enemy(e.key) && !gd.inactiveEnemies.has(e.key);
  let cands = entryList(gd).filter(ok);
  if (!cands.length && type !== 'SPECIAL') return pickRoundEntry(gd, rng, 'SPECIAL', round);
  if (!cands.length) return null;
  const idx = weightedPick(rng, cands.map((e, i) => [i, e.weight ?? 1]));
  const e = cands[Number(idx) || 0];
  const pickKey = (list) => {
    const keys = (Array.isArray(list) ? list : []).map((x) => (typeof x === 'string' ? x : x && x.key)).filter((k) => typeof k === 'string' && gd.enemy(k) && k !== ACLOON);
    return keys.length ? keys[Math.floor(rng() * keys.length)] : null;
  };
  return { round, type: e.type, key: e.key, normal: pickKey(e.N), elite: pickKey(e.E), fly: typeof e.fly === 'boolean' ? e.fly : isFlyKey(gd, e.key), firstHalf: half };
}

/**
 * 弧光作战的**路线转写**（`data/stages-crisis.json` 的 `routeAdapt`）。
 *
 * 弧光的普通回合复用本季的波次模板，那些模板的 `routes` 是**本季战场**的坐标（`start [9,10] → end [9,2]` 等），
 * 而弧光用的是滞空焦点那张图：同一个「蓝门」在那边是 `[9,1]`，在活动图上是 `[9,2]`。参考站用 `routeAdapt` 把
 * 本季坐标搬到活动图：`points` 是端点的逐点对应，`walk` 是整条替代路径。
 *
 * 不转写的后果（用户 2026-11-13 反馈「敌人甚至能走进障碍物」）：路线端点落在 `[1,3]` / `[2,7]` / `[2,5]` 这类
 * `tile_forbidden` 格上，敌人就直接踩进去。
 *
 * @param {any} stage data/stages-crisis.json 的 `custom_cc4_focus`
 * @param {{ motion?: string, start?: number[], end?: number[], checkpoints?: number[][] }} route
 * @returns {typeof route} 转写后的路线（没有 `routeAdapt` 时原样返回）
 */
export function adaptArcRoute(stage, route) {
  const ra = stage && stage.routeAdapt;
  if (!ra || !route || typeof route !== 'object') return route;
  const pt = (p) => (Array.isArray(p) ? (ra.points?.[p.join(',')] || p) : p);
  const start = pt(route.start);
  const end = pt(route.end);
  // a whole replacement walk wins over the template's own checkpoints (the template's path is on another map)
  const walk = Array.isArray(ra.walk) ? ra.walk.find((w) => w && Array.isArray(w.start) && Array.isArray(w.via)
    && w.start[0] === start?.[0] && w.start[1] === start?.[1]
    && (!Array.isArray(w.end) || (Array.isArray(end) && w.end.some((e) => e[0] === end[0] && e[1] === end[1])))) : null;
  if (walk) return { ...route, start, end, checkpoints: walk.via.map((p) => [p[0] + 0, p[1] + 0]) };
  return { ...route, start, end, checkpoints: (Array.isArray(route.checkpoints) ? route.checkpoints : []).map(pt) };
}

/** `adaptArcRoute` over a list (`gd.arcSeason` only; every other season keeps the template's own routes). */
function adaptRoutes(gd, list) {
  if (!Array.isArray(list)) return [];
  if (!gd.arcSeason) return list;
  const arc = gd.stage(ARC_SEASON.stage);
  return arc ? list.map((r) => adaptArcRoute(arc, r)) : list;
}

/** Round type schedule: each chosen type × its slot count, filled with SPECIAL to maxLevelCnt, shuffled. */
export function makeTypeSchedule(gd, rng, factions) {
  const g = gen(gd);
  const max = Math.min(256, Math.max(0, intOr(g.maxLevelCnt, 15))); // loop-cap: schedule length [ASSUMED] DESIGN §32.5
  const fill = typeof g.fillType === 'string' ? g.fillType : (typeof g.alwaysIncludedType === 'string' ? g.alwaysIncludedType : 'SPECIAL');
  const types = gd.factions.types && typeof gd.factions.types === 'object' ? gd.factions.types : {};
  const slots = [];
  for (const t of factions) {
    const n = intOr(types[t]?.count, 3);
    for (let i = 0; i < n && slots.length < max; i++) slots.push(t);
  }
  while (slots.length < max) slots.push(fill); // loop-cap: schedule length
  rng.shuffle(slots);
  return slots;
}

function scheduleRng(rng) {
  const seed = typeof rng.state === 'function' ? deriveSeed(rng.state(), 'waves:schedule') : Math.floor(rng() * 4294967296);
  return createRng(seed);
}

/** Weighted stage draw of the mode (shared by the normal and arc paths): 危机合约's BAN 地图 removes the banned ids
 * from the pool, never the last one (the page enforces the same rule); an empty or absent list keeps the draw
 * byte-identical, so golden scenarios that pass no bans are unchanged. */
function drawStage(gd, rng, bans) {
  const stageIds = Array.isArray(gd.mode.stages) ? gd.mode.stages : [];
  const allowed = Array.isArray(bans) && bans.length ? new Set(stageIds.filter((id) => !bans.includes(id))) : null;
  const pool = allowed && allowed.size ? stageIds.filter((id) => allowed.has(id)) : stageIds;
  const stagePairs = pool.map((id) => [id, gd.stage(id)]).filter(([, s]) => s && s.active !== false && Number(s.weight) > 0).map(([id, s]) => [id, s.weight]);
  let stageId = stagePairs.length ? weightedPick(rng, stagePairs) : null;
  if (!stageId) {
    const any = Object.keys(gd.raw.stages || {}).filter((id) => gd.stage(id) && gd.stage(id).active);
    stageId = any.length ? any.sort()[0] : null;
  }
  return stageId;
}

/** 弧光作战's fixed setup: arcSchedule(seed) gives the 15-round picks and the leader / hidden draws (0..1); the map is
 * ARC_SEASON.stage — falling back to drawStage when that stage is not in the data (warned once, never thrown) — and the
 * leader / hidden draws pick the mode's own leader lists through arcWeighted. */
function arcWaves(gd, rng, bans, arcSeed) {
  const schedule = arcSchedule(arcSeed);
  const picks = schedule.picks;
  // 官方弧光的专属战场（custom_cc4_focus）不在本项目的 data/stages.json 里 —— 这是**已知且预期**的缺口，
  // 不是错误：官方前端也把它当占位，地图名一律走 ARC_SEASON.stageName（「危机合约 滞空焦点」）。
  // 所以这里静默回退到模式自身的抽图，不再每次弧光开局都往控制台打一条 warn（那只是噪音）。
  const stageId = (gd.stage(ARC_SEASON.stage) ? ARC_SEASON.stage : null) ?? drawStage(gd, rng, bans);
  // ★ 弧光作战的两个领袖是**固定的**（官方与设计文档一致）：第 14 回合多萝西、第 15 回合“唤醒”。
  //   不能走 bossWeights 的加权随机 —— 那是卫戍协议本季十个领袖的抽法，弧光不吃这套。
  //   两个记录由 tools/fork-arc-leaders.mjs 经 FORK_APPLIERS 写进 data/bosses.json（官方 autoChessData 里没有它们）。
  //   只有在本季数据确实带这两个记录时才固定（版本回退时退回加权抽，不至于完全没有领袖）。
  const fixedLeader = gd.boss(ARC_LEADER_ID) ? ARC_LEADER_ID : null;
  const fixedHidden = gd.boss(ARC_HIDDEN_ID) ? ARC_HIDDEN_ID : null;
  const bw = gd.bossWeights(false);
  const bossId = fixedLeader ?? (bw.length ? arcWeighted(bw, schedule.leader) : null);
  const hw = gd.bossWeights(true);
  const hiddenBossId = fixedHidden ?? (hw.length && gd.hiddenRound ? arcWeighted(hw, schedule.hidden) : null);
  const factions = [];
  Object.defineProperty(factions, 'schedule', { value: Object.freeze({ typeSlots: [], picks }), enumerable: false });
  return { stageId, factions, bossId, hiddenBossId, typeSlots: [], picks };
}

/**
 * @param {import('./gamedata.js').GameData} gd
 * @param {Function} rng
 * @param {string[]|null} [bans]
 * @param {number|null} [arcSeed] 弧光作战的开局种子: when set, the setup is arcWaves(gd, rng, bans, arcSeed) — the 15-round
 *   picks come from arcSchedule(arcSeed) and the map is ARC_SEASON.stage; absent for every other path (byte-identical).
 * @returns {{ stageId: string|null, factions: string[], bossId: string|null, hiddenBossId: string|null, typeSlots: string[], picks: object[] }}
 *   `factions` also carries the schedule as a non-enumerable `schedule` property ({ typeSlots, picks }), so callers
 *   that keep only the factions array (Match: buildNormalWave(gd, rng, this.factions, r)) get the official rounds.
 */
export function setupMatchWaves(gd, rng, bans = null, arcSeed = null) {
  if (arcSeed != null) return arcWaves(gd, rng, bans, arcSeed);
  const stageId = drawStage(gd, rng, bans);
  // factions
  const types = gd.factions.types && typeof gd.factions.types === 'object' ? gd.factions.types : {};
  const n = Number.isInteger(gen(gd).specialEnemyNum) ? gen(gd).specialEnemyNum : 3;
  const random = Object.values(types).filter((t) => t && t.involveRandom).map((t) => t.type).sort();
  const shuffled = random.slice();
  rng.shuffle(shuffled);
  const chosen = shuffled.slice(0, Math.min(n, shuffled.length));
  const factions = chosen.slice().sort((a, b) => (types[a]?.sortId ?? 9) - (types[b]?.sortId ?? 9));
  // bosses
  const bw = gd.bossWeights(false);
  const bossId = bw.length ? weightedPick(rng, bw) : null;
  const hw = gd.bossWeights(true);
  const hiddenBossId = hw.length && gd.hiddenRound ? weightedPick(rng, hw) : null;
  // the 15-round schedule and picks (own rng stream derived from the setup rng's state: the draws above and whatever
  // the caller draws next from `rng` are unchanged)
  const srng = scheduleRng(rng);
  const typeSlots = makeTypeSchedule(gd, srng, chosen);
  const picks = [null];
  for (let r = 1; r <= typeSlots.length; r++) picks.push(pickRoundEntry(gd, srng, typeSlots[r - 1], r));
  Object.defineProperty(factions, 'schedule', { value: Object.freeze({ typeSlots: typeSlots.slice(), picks }), enumerable: false });
  return { stageId, factions, bossId, hiddenBossId, typeSlots, picks };
}

/**
 * The pick of round r: from a setup object ({ picks }), a factions array carrying the hidden schedule, or — for a plain
 * factions array (tools, tests) — drawn now: the round's type from the schedule's marginal distribution (each faction
 * 3 of 15 slots, SPECIAL the rest), then its entry.
 */
export function roundPick(gd, rng, factionsOrSetup, round) {
  const src = factionsOrSetup;
  const picks = src && !Array.isArray(src) && Array.isArray(src.picks) ? src.picks : (src && src.schedule && Array.isArray(src.schedule.picks) ? src.schedule.picks : null);
  if (picks) return picks[round] ?? null;
  const factions = Array.isArray(src) ? src : (src && Array.isArray(src.factions) ? src.factions : []);
  const g = gen(gd);
  const types = gd.factions.types && typeof gd.factions.types === 'object' ? gd.factions.types : {};
  const max = intOr(g.maxLevelCnt, 15);
  const pairs = factions.map((t) => [t, intOr(types[t]?.count, 3)]);
  const used = pairs.reduce((s, [, w]) => s + w, 0);
  pairs.push([typeof g.fillType === 'string' ? g.fillType : 'SPECIAL', Math.max(1, max - used)]);
  return pickRoundEntry(gd, rng, weightedPick(rng, pairs), round);
}

/** Enemy scale mods for round r (bosses excluded by the caller). */
export function scaleFor(gd, r) {
  return gd.enemyScale(r);
}

/** The spawn mods of a round's scale for a non-leader enemy: HP / ATK / speed, plus `supplyHpMul` when the round has one. */
export function roundMods(scale, ex = null, gd = null) {
  const m = { hpMul: scale.hpMul, atkMul: scale.atkMul, speedMul: scale.speedMul };
  if (scale.supplyHpMul != null) m.supplyHpMul = scale.supplyHpMul;
  // the MODE's own spawn extras on top of the official table (fork 二.3; all 1 for every official mode). An ordinary
  // spawn takes the +HP only: the leader / hidden core ATK+DEF extra is applied by the boss branch of templateSpawns.
  if (ex) m.hpMul *= ex.normalHp;
  // the 房主配置「对局选项」DEF / RES buff (GameData.enemyBuffDefRes; null without one, so an unbuffed spec is byte-identical
  // — the two keys are only written when they are not 1). HP / ATK are already in `scale` (GameData.enemyScale folds them
  // into the round table, which is what makes the buff reach every enemy kind in one place).
  const dr = gd && typeof gd.enemyBuffDefRes === 'object' ? gd.enemyBuffDefRes : null;
  if (dr) { m.defMul = dr.defMul; m.resMul = dr.resMul; }
  return m;
}

/** Slot class of an enemy that has no placeholder slot (literal template keys, bounty adds). */
export function classOf(gd, enemyKey) {
  const e = gd.enemy(enemyKey);
  const fly = isFlyKey(gd, enemyKey);
  const elite = !!(e && e.rank === 'ELITE');
  if (fly) return elite ? 'EF' : 'NF';
  return elite ? 'E' : 'N';
}

/** Preview pen upper zone anchor row ((18,7); the lower anchor is (15,7)) and the client's row offsets. */
const PEN_UPPER_ROW = 18;
const PREVIEW_ROW_OFFSET = 6;
const PREVIEW_ROW_OFFSET_LEADER = 13;

/**
 * 'upper' | 'lower' preview zone of a route start (client `AutoChessEnemyPreviewManager`, research 08 §4.2): target row =
 * start row + 6 (leader rounds: + 13); the zone is the Manhattan-nearest anchor among those with anchor row ≤ target
 * row — (18,7) upper, (15,7) lower — so only a target row ≥ 18 reaches the upper zone: normal fields row 12 (upper
 * gate (12,10); rows 9–11 lower), boss fields row 5 (rows 2–4 lower: the leaders at (3,x)/(4,x) and the (2,10) gate).
 * A target below row 15 has no zone (the client picks a random pen tile) and is reported 'lower'.
 * @param {number[]|null} start [row, col]
 * @param {boolean} [leader] leader / hidden round (default: a boss-field row, ≤ 8)
 */
export function gateOf(start, leader) {
  const r = Array.isArray(start) ? start[0] : null;
  if (!Number.isFinite(r)) return 'lower';
  const lead = typeof leader === 'boolean' ? leader : r <= 8;
  const target = r + (lead ? PREVIEW_ROW_OFFSET_LEADER : PREVIEW_ROW_OFFSET);
  // both anchors share col 7, so with target ≥ 18 the upper one is always the nearer; below it only (15,7) qualifies
  return target >= PEN_UPPER_ROW ? 'upper' : 'lower';
}

const isLeaderTemplate = (tpl) => !!tpl && (tpl.kind === 'boss' || tpl.kind === 'hidden');

function previewInfo(gd, key, route, boss = false, leader = undefined) {
  const e = gd.enemy(key);
  const start = route && Array.isArray(route.start) ? route.start.slice(0, 2) : null;
  return { gate: gateOf(start, leader), start, fly: isFlyKey(gd, key), elite: !!(e && e.rank && e.rank !== 'NORMAL'), boss };
}

/**
 * The actions of a template with the round pick applied.
 * @returns {{ spawns: object[], actions: object[] }} actions[i] = { index, key, tplKey, slot, time, count, tplCount, window, routeIndex, valid,
 *   server } (`server` = client ShouldActionUpToServer: valid, not the leader, no random spawn group)
 */
function templateSpawns(gd, tpl, round, pick) {
  const scale = scaleFor(gd, round);
  // the MODE's own spawn extras on top of the official table (fork 二.3; all 1 for every official mode)
  const ex = gd.enemyExtras(round);
  // the 房主配置「对局选项」DEF / RES buff, `{ defMul: 1, resMul: 1 }` without one (see roundMods for the ordinary-spawn path;
  // HP / ATK arrive already folded into `scale`)
  const buffDR = gd.enemyBuffDefRes || { defMul: 1, resMul: 1 };
  // 弧光作战用自已的占位表（模板 key → 槽），否则 arcSchedule 挑的敌人换不进来（见 arcPlaceholderMap）
  const ph = gd.arcSeason ? arcPlaceholderMap(gd) : placeholderMap(gd);
  const routes = Array.isArray(tpl.routes) ? tpl.routes : [];
  const leader = isLeaderTemplate(tpl);
  const spawns = [];
  const actions = [];
  const list = Array.isArray(tpl.spawns) ? tpl.spawns : [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || (s.action && String(s.action).toUpperCase() !== 'SPAWN')) continue;
    const key0 = s.key ?? s.enemyKey;
    if (typeof key0 !== 'string' || key0 === ACLOON) continue;
    const tag = s.tag ?? null;
    const isBoss = tag === 'boss';
    const isPart = tag === 'part';
    const n = Math.max(1, Math.min(50, Number.isInteger(s.count) ? s.count : 1));
    const interval = Math.max(0, Number(s.interval) || 0);
    const time = Math.max(0, Number(s.time) || 0);
    const routeIndex = Number.isInteger(s.routeIndex) ? s.routeIndex : 0;
    const window = n * interval;
    let key = key0;
    let count = n;
    let step = interval;
    const p = !isBoss && !isPart ? ph[key0] : null;
    if (p && pick) {
      const newKey = p.cls === 'special' ? pick.key : p.cls === 'elite' ? pick.elite : pick.normal;
      // ★ 弧光必须用 anyEnemy()：它的敌人一半在 data/enemies-crisis.json 里（contract 专用），gd.enemy() 只查
      //   enemies.json，查不到就整条替换被跳过 —— 那正是「出怪完全不按种子」的最终根因。
      //   其它赛季保持 gd.enemy()：任何对普通对局的放宽都会让 19 个 golden 场景漂移。
      if (typeof newKey === 'string' && (gd.arcSeason ? anyEnemy(gd, newKey) : gd.enemy(newKey))) {
        if (isFlyKey(gd, newKey) !== !!p.fly) {
          // the other movement class: not spawned, not sent, not previewed (isValid = false)
          actions.push({ index: i, key: null, tplKey: key0, slot: p.slot ?? s.slot ?? null, time, count: 0, tplCount: n, window, routeIndex, valid: false, server: false });
          continue;
        }
        count = replacedCount(gd, key0, n, newKey);
        step = Math.max(window / count, MIN_ACTION_INTERVAL_RATIO * window);
        key = newKey;
      }
    }
    if (!(gd.arcSeason ? anyEnemy(gd, key) : gd.enemy(key))) continue;
    const slot = s.slot || classOf(gd, key);
    const spec = {
      time,
      enemyKey: key,
      routeIndex,
      count,
      interval: count > 1 ? step : 0,
      // the round multipliers are ENEMY effects on every enemy but 炎佑 (aceffect_enemy_1–5 `enemy_attribute_mul`,
      // enemy_exclude = enemy_9012_acloon): leader parts take them all; the leader takes ATK / speed but not HP — its HP
      // is the server pool, "领袖单位于服务器的生命值加成不受上述加成影响" (PRTS 下半). `supplyHpMul` (roundMods) rides along for
      // the 器物 hit-count units, which 补给线 / 补给线II leave out (archetypes.js `times`; also a 频次 enemy's death spawn).
      // The mode's own extras sit on top (ex.*, fork 二.3): the ordinary +HP never reaches the leader (it has no hpMul
      // here) nor a 部位 (`isPart`), while the leader's / hidden core's ATK and DEF do — `defMul` is only added when it
      // is not 1, so an official spec is byte-identical to before.
      //
      // The 房主配置「对局选项」reaches a leader through `scale` (HP / ATK, `GameData.enemyScale`) and through `buffDR` here
      // (DEF / RES). Its HP is the shared pool, so its own `hpMul` stays absent — `finalAssault.bossPoolHp` applies the
      // HP buff to the pool itself.
      mods: isBoss
        ? {
          atkMul: scale.atkMul * ex.bossAtk, speedMul: scale.speedMul, slot,
          ...(ex.bossDef * buffDR.defMul !== 1 ? { defMul: ex.bossDef * buffDR.defMul } : null),
          ...(buffDR.resMul !== 1 ? { resMul: buffDR.resMul } : null),
        }
        : { ...roundMods(scale, isPart ? null : ex, gd), slot },
      actionIndex: i,
      preview: previewInfo(gd, key, routes[routeIndex], isBoss, leader),
    };
    if (tag) spec.tag = tag;
    if (s.unharmful || isPart) spec.countInTotal = false;
    spawns.push(spec);
    // client ShouldActionUpToServer: valid, not the leader, no randomSpawnGroupKey — only those units are in the list a
    // bounty is inserted into (the others spawn locally on their own timing)
    actions.push({ index: i, key, tplKey: key0, slot: s.slot ?? null, time, count, tplCount: n, window, routeIndex, valid: true, server: !isBoss && !s.group });
  }
  return { spawns, actions };
}

function entriesView(gd, pick) {
  if (!pick) return { ground: null, fly: null };
  const e = gd.factions.entries && gd.factions.entries[pick.key];
  const view = e ? { ...e, pick } : { key: pick.key, type: pick.type, firstHalf: pick.firstHalf, pick };
  return pick.fly ? { ground: null, fly: view } : { ground: view, fly: null };
}

/**
 * Shared composition of a normal round.
 * @param {string[]|object} factions setupMatchWaves().factions (carries the schedule), the setup object, or a plain
 *   factions array (the round's type is then drawn with `rng`)
 * @returns {{ templateId: string|null, spawns: object[], routes: object[], extraRoutes: object[], timeLimit: number,
 *   overrides: object, pick: object|null, entries: { ground: object|null, fly: object|null }, actions: object[] }}
 */
export function buildNormalWave(gd, rng, factions, round) {
  const rc = gd.roundCfg(round);
  const templateId = rc && typeof rc.template === 'string' ? rc.template : null;
  const tpl = templateId ? gd.wave(templateId) : null;
  const timeLimit = gd.combatTimeLimit(round);
  if (!tpl) return { templateId, spawns: [], routes: [], extraRoutes: [], timeLimit, overrides: {}, pick: null, entries: { ground: null, fly: null }, actions: [] };
  const pick = roundPick(gd, rng, factions, round);
  const { spawns, actions } = templateSpawns(gd, tpl, round, pick);
  return {
    templateId,
    spawns,
    // 弧光作战：模板路线是本季战场坐标，必须按活动图的 routeAdapt 转写（否则端点落在禁区块上，敌人会走进障碍物）
    routes: adaptRoutes(gd, tpl.routes),
    extraRoutes: adaptRoutes(gd, tpl.extraRoutes),
    timeLimit,
    overrides: tpl.overrides && typeof tpl.overrides === 'object' ? tpl.overrides : {},
    pick,
    entries: entriesView(gd, pick),
    actions,
  };
}

/**
 * Boss / hidden round template for one boss field; escorts follow the pick of the round's own slot.
 * @param {{ bossId: string, solo: boolean }} opts solo → `_s` template (lone player or solo mode)
 */
export function buildBossWave(gd, rng, factions, round, { bossId, solo }) {
  const rc = gd.roundCfg(round);
  const map = rc && rc.bossTemplates && typeof rc.bossTemplates === 'object' ? rc.bossTemplates : {};
  let templateId = typeof map[bossId] === 'string' ? map[bossId] : null;
  // ★ 首领记录自带的模板优先（data/bosses.json `templates[modeId] = { round, template }`）：弧光的两个固定领袖
  //   （boss_arc1 / boss_arc2）是危机合约独有的，模式的 bossTemplates 里没有它们的条目，只看 rc 会回退到第一个
  //   首领模板（实测第 14 回合用了 act1autochess_h07_01_s，出的是本季敌人而不是多萝西的护卫）。
  if (!templateId && typeof gd.boss === 'function') {
    const own = gd.boss(bossId)?.templates?.[gd.modeId]?.template;
    if (typeof own === 'string' && gd.wave(own)) templateId = own;
  }
  if (!templateId) {
    const first = Object.values(map).find((v) => typeof v === 'string');
    templateId = first || null;
  }
  if (templateId && solo && !/_s$/.test(templateId) && gd.wave(`${templateId}_s`)) templateId = `${templateId}_s`;
  if (templateId && !solo && /_s$/.test(templateId) && gd.wave(templateId.replace(/_s$/, ''))) templateId = templateId.replace(/_s$/, '');
  const tpl = templateId ? gd.wave(templateId) : null;
  if (!tpl) return { templateId, spawns: [], routes: [], extraRoutes: [], timeLimit: Infinity, overrides: {}, pick: null, entries: { ground: null, fly: null }, actions: [] };
  const pick = roundPick(gd, rng, factions, round);
  const { spawns, actions } = templateSpawns(gd, tpl, round, pick);
  return {
    templateId,
    spawns,
    // 弧光作战：模板路线是本季战场坐标，必须按活动图的 routeAdapt 转写（否则端点落在禁区块上，敌人会走进障碍物）
    routes: adaptRoutes(gd, tpl.routes),
    extraRoutes: adaptRoutes(gd, tpl.extraRoutes),
    timeLimit: Infinity,
    overrides: tpl.overrides && typeof tpl.overrides === 'object' ? tpl.overrides : {},
    pick,
    entries: entriesView(gd, pick),
    actions,
  };
}

/** Boss-field column that splits the left (L) and the right (R) player's half (the goals are at cols 2–3 / 17). */
const BOSS_MID_COL = 10;

/**
 * Route index of the first template route with the requested motion (fallback 0). `side` ('L' | 'R') prefers a route
 * that ends on that player's half of a boss field (pair templates route to both goals).
 */
export function routeByMotion(routes, fly, side = null) {
  const ok = (r) => r && (fly ? r.motion === 'FLY' : r.motion !== 'FLY' && r.motion !== 'E_NUM');
  if (side === 'L' || side === 'R') {
    const j = routes.findIndex((r) => ok(r) && Array.isArray(r.end) && (side === 'R' ? r.end[1] > BOSS_MID_COL : r.end[1] < BOSS_MID_COL));
    if (j >= 0) return j;
  }
  const i = routes.findIndex(ok);
  return i >= 0 ? i : 0;
}

/**
 * The template action an added enemy joins (client `_GetSpEnemyActionData`): the first SPAWN action of the round's
 * ORIGINAL template whose key is the normal placeholder of the enemy's movement class (`templateEnemyNormal` /
 * `…NormalFly`; tokens `templateEnemyToken` / `…TokenFly`), else the first SPAWN action.
 */
function hostAction(gd, wave, { fly, token = false }) {
  const tpl = wave && wave.templateId ? gd.wave(wave.templateId) : null;
  const list = tpl && Array.isArray(tpl.spawns) ? tpl.spawns : [];
  const ts = gd.factions.templateSlots || {};
  const want = token ? ts[fly ? 'TF' : 'T'] : ts[fly ? 'NF' : 'N'];
  let first = -1;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || (s.action && String(s.action).toUpperCase() !== 'SPAWN')) continue;
    if (first < 0) first = i;
    if ((s.key ?? s.enemyKey) === want) return { index: i, s };
  }
  return first >= 0 ? { index: first, s: list[first] } : null;
}

/**
 * Bounty spawns for one player's battle (悬赏 / 战术特训 / 教鞭 / “神秘顾客”): kill bounties pay the killer (Battle
 * bounty), perfect bounties are paid by the match at settlement. No bounty-specific stat change (the solo 70 % is the
 * global base already in enemyScale). Client timing (`GenerateSelfBattleEnemyData` → `_GetSpEnemyActionData` →
 * `_InsertSpActionToNormal` → `_CalculateActionPredelay`, decoded): every bounty unit joins the ORIGINAL template's
 * first `lrsldr` (walker) / `yokai` (flyer) action (else action 0); the n bounty units of a host action are INSERTED
 * among its own n' units — unit i at index floor((i+1)·len/(n+1)), len = the list length so far — (the bounty list
 * alone when the host spawns nothing, e.g. a walker bounty in a FLY round), then the whole list is spread over the
 * action window: unit j at preDelay + j·max(W/total, 0.05·W). Returned here: the bounty specs only (a bounty's
 * consecutive units share a spec); the host action's own units are NOT re-timed — `withBounties` gives the exact
 * combined list. Bounties of several battles (`rounds` > 1: "接下来两场作战", and the multi-round cards, which last
 * choices.js MULTI_ROUND_BOUNTY_BATTLES) spawn in every battle of the player while they last — the Final Assault and the
 * Hidden Core included (`side`: the player's half of the boss field, see routeByMotion).
 * @param {Array<{ id: string, card: object }>} bounties
 */
export function bountySpawns(gd, round, wave, bounties, playerId, { solo = false, side = null } = {}) { // eslint-disable-line no-unused-vars
  return bountyPlan(gd, round, wave, bounties, playerId, side).specs;
}

/** Runs of consecutive equal markers: [{ v, start, len }]. */
function runsOf(list) {
  const out = [];
  for (let j = 0; j < list.length; j++) {
    const last = out[out.length - 1];
    if (last && last.v === list[j]) last.len++;
    else out.push({ v: list[j], start: j, len: 1 });
  }
  return out;
}

function bountyPlan(gd, round, wave, bounties, playerId, side) {
  const scale = scaleFor(gd, round);
  // a bounty unit is an ordinary enemy: it takes the mode's +HP extra like the round's own spawns (never a boss)
  const ex = gd.enemyExtras(round);
  const routes = (wave && wave.routes) || [];
  const acts = Array.isArray(wave && wave.actions) ? wave.actions : [];
  const leader = isLeaderTemplate(wave && wave.templateId ? gd.wave(wave.templateId) : null);
  const groups = new Map(); // host action index → { host, items: [{ b, c, fly, count }] }
  for (const b of bounties || []) {
    const c = b && b.card ? b.card : {};
    if (!gd.enemy(c.enemyKey)) continue;
    const fly = isFlyKey(gd, c.enemyKey);
    const host = hostAction(gd, wave, { fly });
    const key = host ? host.index : -1;
    if (!groups.has(key)) groups.set(key, { host, items: [] });
    groups.get(key).items.push({ b, c, fly, count: Math.max(1, Math.min(20, Number.isInteger(c.count) ? c.count : 1)) });
  }
  const specs = [];
  const retime = new Map(); // host action index → { time, step, ownRuns: [{ start, len }] }
  const OWN = 0;
  for (const { host, items } of groups.values()) {
    const hs = host ? host.s : null;
    const time = hs ? Math.max(0, Number(hs.time) || 0) : 4;
    const window = hs ? Math.max(1, Number.isInteger(hs.count) ? hs.count : 1) * Math.max(0, Number(hs.interval) || 0) : 0;
    const act = host ? acts.find((a) => a.index === host.index) : null;
    // the host's own units: only a server-sent action has any (a leader / random-group / invalid host spawns the
    // bounty list alone over its window — client _InsertSpActionToNormal finds no normal list for it)
    const own = act && act.valid && act.server !== false ? Math.min(MAX_ACTION_UNITS, act.count) : 0;
    const sp = [];
    for (const it of items) for (let k = 0; k < it.count; k++) sp.push(it);
    // _InsertSpActionToNormal: insert the bounty units among the action's own units (list.Insert(FloorToInt(...)))
    let list;
    if (own > 0) {
      list = new Array(own).fill(OWN);
      for (let i = 0; i < sp.length; i++) list.splice(Math.floor(((i + 1) * list.length) / (sp.length + 1)), 0, sp[i]);
    } else {
      list = sp.slice();
    }
    const step = window > 0 ? Math.max(window / list.length, MIN_ACTION_INTERVAL_RATIO * window) : 0;
    const runs = runsOf(list);
    if (host && own > 0) retime.set(host.index, { time, step, ownRuns: runs.filter((r) => r.v === OWN) });
    for (const run of runs) {
      if (run.v === OWN) continue;
      const { b, c, fly } = run.v;
      let routeIndex = hs && Number.isInteger(hs.routeIndex) ? hs.routeIndex : routeByMotion(routes, fly, side);
      const r = routes[routeIndex];
      const motionOk = r && (fly ? r.motion === 'FLY' : r.motion !== 'FLY' && r.motion !== 'E_NUM');
      const sideOk = !(side === 'L' || side === 'R') || (r && Array.isArray(r.end) && (side === 'R' ? r.end[1] > BOSS_MID_COL : r.end[1] < BOSS_MID_COL));
      if (!motionOk || !sideOk) routeIndex = routeByMotion(routes, fly, side);
      const spec = {
        time: time + run.start * step,
        enemyKey: c.enemyKey,
        routeIndex,
        count: run.len,
        interval: run.len > 1 ? step : 0,
        mods: { ...roundMods(scale, ex, gd), slot: classOf(gd, c.enemyKey), bountyId: b.id },
        tag: 'bounty',
        ownerPlayerId: playerId,
        preview: previewInfo(gd, c.enemyKey, routes[routeIndex], false, leader),
      };
      if (host) spec.actionIndex = host.index;
      if (c.payout !== 'perfect' && Number(c.coin) > 0) spec.bounty = { coins: Math.trunc(c.coin), ownerPlayerId: playerId };
      specs.push(spec);
    }
  }
  return { specs, retime };
}

/**
 * A player's full spawn list for the round, exactly like the client: the wave's specs (copied; the own units of an
 * action that bounties join are re-timed around the inserted bounty units — one spec per run of consecutive own units)
 * followed by the bounty specs. Use it instead of `[...wave.spawns, ...bountySpawns(…)]`, which keeps the host
 * action's own spacing.
 */
export function withBounties(gd, round, wave, bounties, playerId, { side = null } = {}) {
  const { specs, retime } = bountyPlan(gd, round, wave, bounties, playerId, side);
  const out = [];
  for (const s of wave.spawns || []) {
    const rt = s.tag !== 'bounty' && Number.isInteger(s.actionIndex) ? retime.get(s.actionIndex) : null;
    if (!rt) { out.push({ ...s, mods: s.mods ? { ...s.mods } : undefined }); continue; }
    for (const run of rt.ownRuns) {
      out.push({ ...s, mods: s.mods ? { ...s.mods } : undefined, time: rt.time + run.start * rt.step, count: run.len, interval: run.len > 1 ? rt.step : 0 });
    }
  }
  return out.concat(specs);
}

/**
 * nextEnemies preview (m.private.nextEnemies): one entry per spawn action (research 08 §4.2 input), in spawn order:
 * `{ enemyKey, count, gate: 'upper'|'lower', t, fly, elite, boss, source: 'wave'|'bounty', tag, start? }` — `tag` 'boss' /
 * 'bounty' / null kept for the drawer's grouping; Σ count = the enemies of the round (HUD). Boss parts are omitted.
 * The client places the models in the gate's pen zone (≤ 50 shown, elites and bosses always) — except a leader: its
 * entry carries its spawn tile `start` ([row, col] on the boss field) and the Final Assault / Hidden Core prep shows it
 * standing there (render/app.js, community report #12; display only).
 */
export function previewOf(spawns) {
  const out = [];
  let seq = 0;
  for (const s of spawns || []) {
    if (!s || typeof s.enemyKey !== 'string' || s.tag === 'part') continue;
    const tag = s.tag === 'boss' ? 'boss' : s.tag === 'bounty' ? 'bounty' : null;
    const pv = s.preview && typeof s.preview === 'object' ? s.preview : {};
    out.push({
      enemyKey: s.enemyKey,
      count: Math.max(1, Math.trunc(Number(s.count) || 1)),
      gate: pv.gate === 'upper' ? 'upper' : 'lower',
      t: Math.max(0, Number(s.time) || 0),
      fly: !!pv.fly,
      elite: !!pv.elite || tag === 'boss',
      boss: tag === 'boss',
      source: tag === 'bounty' ? 'bounty' : 'wave',
      tag,
      ...(tag === 'boss' && Array.isArray(pv.start) && pv.start.length >= 2 && pv.start.every(Number.isFinite) ? { start: [pv.start[0], pv.start[1]] } : {}),
      _seq: seq++,
    });
  }
  out.sort((a, b) => a.t - b.t || a._seq - b._seq);
  for (const e of out) delete e._seq;
  return out;
}

/**
 * 联防 spawns from the union of leaked enemies (research 08 §5; client `GenerateHelpBattleEnemyData` /
 * `_GetSpEnemyActionData` / `_CalculateActionPredelayConsiderUid`, decoded): every leak becomes a 1-unit action on the
 * route of the escaped template's host action — walkers the first `lrsldr` action, flyers `yokai`, tokens (enemies
 * only ever summoned — enemies.json tokenOnly, or `isToken` on the leak) `gopro_2` / `lazerd`, else action 0; elites
 * and specials are NOT routed through the E / S actions. Per host action the units are grouped by owner (source
 * player, first-leak order); with W = count·interval of the host action and M = the largest owner group,
 * step = min(max(W / M, 0.05·W), MAX_ACTION_INTERVAL_FOR_UID 5 s), and unit i of the k-th owner spawns at
 * preDelay + k·ACTION_INTERVAL_FOR_UID (0.5 s) + i·step.
 * @param {Array<{ enemyKey: string, mods: object|null, sourcePlayerId: string, bounty?: object|null, isToken?: boolean }>} leaked
 * @param {number} helperCount 1 | 2
 * @returns {{ templateId: string|null, spawns: object[], routes: object[] }}
 */
export function buildUniteWave(gd, leaked, helperCount, timeLimit) { // eslint-disable-line no-unused-vars
  const templates = gd.unite.templates;
  const templateId = templates[String(helperCount)] || templates[helperCount] || null;
  const tpl = templateId ? gd.wave(templateId) : null;
  const routes = tpl && Array.isArray(tpl.routes) ? tpl.routes : [];
  const ts = gd.factions.templateSlots || {};
  const list = tpl && Array.isArray(tpl.spawns) ? tpl.spawns : [];
  const isSpawn = (s) => s && !(s.action && String(s.action).toUpperCase() !== 'SPAWN');
  /** client `_GetSpEnemyActionData`: the first action whose key is the class placeholder, else action 0 */
  const hostIndex = (fly, token) => {
    const want = token ? ts[fly ? 'TF' : 'T'] : ts[fly ? 'NF' : 'N'];
    for (let i = 0; i < list.length; i++) if (isSpawn(list[i]) && (list[i].key ?? list[i].enemyKey) === want) return i;
    return list.length ? 0 : -1;
  };
  const groups = new Map(); // host action index → Map(owner → leaks), insertion order
  const flyOf = new Map();
  for (const l of leaked || []) {
    if (!l || !gd.enemy(l.enemyKey)) continue;
    const fly = isFlyKey(gd, l.enemyKey);
    const token = l.isToken === true || gd.enemy(l.enemyKey).tokenOnly === true;
    const idx = hostIndex(fly, token);
    if (!groups.has(idx)) { groups.set(idx, new Map()); flyOf.set(idx, fly); }
    const owners = groups.get(idx);
    const owner = l.sourcePlayerId ?? '';
    if (!owners.has(owner)) owners.set(owner, []);
    owners.get(owner).push(l);
  }
  const spawns = [];
  for (const [idx, owners] of groups) {
    const a = idx >= 0 ? list[idx] : null;
    const t0 = a ? Math.max(0, Number(a.time) || 0) : 3;
    const window = a ? Math.max(1, Number.isInteger(a.count) ? a.count : 1) * Math.max(0, Number(a.interval) || 0) : 40;
    let most = 1;
    for (const units of owners.values()) most = Math.max(most, units.length);
    const step = Math.min(Math.max(window / most, MIN_ACTION_INTERVAL_RATIO * window), UNITE_MAX_UNIT_STEP);
    let routeIndex = a && Number.isInteger(a.routeIndex) ? a.routeIndex : routeByMotion(routes, flyOf.get(idx));
    if (routeIndex < 0 || routeIndex >= routes.length) routeIndex = 0;
    let k = 0;
    for (const units of owners.values()) {
      const start = t0 + k * UNITE_OWNER_STEP;
      units.forEach((l, i) => {
        const spec = {
          time: start + i * step, enemyKey: l.enemyKey, routeIndex, count: 1, interval: 0,
          mods: l.mods ? { ...l.mods } : { slot: classOf(gd, l.enemyKey) }, sourcePlayerId: l.sourcePlayerId,
          preview: previewInfo(gd, l.enemyKey, routes[routeIndex]),
        };
        if (idx >= 0) spec.actionIndex = idx;
        if (l.bounty && l.bounty.coins > 0) spec.bounty = { coins: l.bounty.coins, ownerPlayerId: l.bounty.ownerPlayerId ?? l.sourcePlayerId };
        if (l.tag === 'bounty') spec.tag = 'bounty';
        spawns.push(spec);
      });
      k++;
    }
  }
  spawns.sort((a, b) => a.time - b.time);
  return { templateId, spawns, routes };
}