// server/match/gamedata.js — typed, defaulted view of data/*.json for the match engine.
//
// Every lookup is an own-property lookup (ids come from client intents) that never throws and returns null for
// unknown ids. Tunables come from data/config.json with the documented defaults (research 00-INDEX §2–§8) when a
// key is missing, so a partial data set (tests, data being regenerated) still yields a working match.
//
// No custom balance (DESIGN §14 corrections, research 08 §6): enemy numbers are the official ones — the PRTS
// per-round enemyScale table of data/config.json, the leader pool = bloodPoint per player alive at the fight's start
// (bossPoolShareOf). data/tuning.json only overrides result titles:
//   titles[titleId]                                                { stat?, rule? } merged over config.titles
// (the former enemyHpMul / enemyAtkMul / enemySpeedMul / bossHpMul / flyPlaceholders knobs were removed; a tuning file
// that still carries them is ignored).

import { getConfig, getMode } from '../data.js';
import { isShopItem } from '../sim/simdata.js';
import { mergeData } from '../../shared/plugins/dataUtils.js';
import { standInRecord } from '../../shared/standIn.js';
import { normalizeMods, MOD_RANDOM_SP_FAMILIES, MOD_EXTRA_ROUNDS, layerCapFor, enemyBuffMul } from '../../shared/constants.js';
import { filterRawData, effectiveBonds } from '../../shared/packData.js';
import { MAX_OFFER_SLOTS } from './player/common.js';
// 行为开关 `morphPairing` 的两半（工坊 mod 层移植 2026-10-17）：档位归一化与装备位策略都只有 `shared/morph.js` 一份。
import { morphPairingOf, morphSlotPolicy } from '../../shared/morph.js';

const own = (map, id) => (map && typeof map === 'object' && typeof id === 'string' && Object.hasOwn(map, id) && map[id] && typeof map[id] === 'object' ? map[id] : null);
const numOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const posIntOr = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);

export const DEFAULTS = Object.freeze({
  income: [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 12, 12, 12, 12, 12],
  incomeCap: 12,
  chessPrice: { 1: 2, 2: 3, 3: 3, 4: 3, 5: 4, 6: 4 },
  sellPrice: 1,
  refreshPrice: 1,
  poolCopies: { 1: 12, 2: 14, 3: 18, 4: 16, 5: 8, 6: 5 },
  mergeCount: 3,
  goldenCopies: 3,
  itemMergeCount: 2,
  benchSize: 10,
  tempSize: 5,
  deployCap: 8,
  equipPerChess: 2,
  maxArtsPerRound: 2,
  rewardOffer: { count: 3, tierOffset: 1, maxTier: 6, price: 0 },
  upgradePrices: [5, 8, 11, 12, 13],
  maxShopLevel: 6,
  shopSlots: { 1: { chess: 3, item: 1 }, 2: { chess: 4, item: 1 }, 3: { chess: 4, item: 1 }, 4: { chess: 5, item: 1 }, 5: { chess: 5, item: 1 }, 6: { chess: 5, item: 1 } },
  defaultBandId: 'band_bldsk',
  defaultStartLp: 28,
  lpCapPerRound: 10,
  bossOvertimeAfter: 150,
  bossOvertimeDrainPerSec: 1,
  hiddenCore: { single: 350, multi: 1200, minTeamLpExclusive: 1, difficulties: ['NORMAL', 'HARD', 'ABYSS'] },
  dp: { init: 10, perSec: 1, max: 99 },
  unite: { maxHelpers: 2, templates: { 1: 'act1autochess_escaped_single', 2: 'act1autochess_escaped_multi' } },
  timers: { infoCheck: 25, bandDraft: 50, bandTurn: 30, battleCheck: 3, spFirst: 30, spTurn: 16 },
  bans: { FUNNY: { core: 0, addon: 1 }, NORMAL: { core: 3, addon: 4 }, HARD: { core: 3, addon: 4 }, ABYSS: { core: 3, addon: 4 } },
  bandDraft: { skipsPerPlayer: 1, timeoutBandId: 'band_bldsk' },
  leftoverFundsKeptByBands: ['band_cannot'],
});

/** Game seconds per real second of a battle (forced 2×): combat limits in data are real seconds (combatTimeLimit). */
export const COMBAT_TIME_SCALE = 2;

/**
 * Multiplier of bloodPoint[difficulty] for the shared leader pool (DESIGN §20.10, §25.13.4), from config bossHpScale —
 * each key from the mode's entry first, then the global one; the defaults are the current rule:
 *   solo   `solo` (1: the table value — one player's share);
 *   co-op  `perPlayer` true (the owner's decision of 2026-10-06, adopting PR #209 by @qingjingshenghuo): `coop` (1) × the
 *          players alive when the fight starts — bots and AI 托管 seats count, eliminated and departed seats do not —
 *          at most `aliveFull` (4); a count left out means a full team;
 *          `perPlayer` false: the fixed pool of 0.1.x (「保持固定血量」, restorable with `solo` 0.25): `coop` whatever the
 *          count, × min(alive, aliveFull) / aliveFull with `aliveScaling`.
 * @param {object|null|undefined} modeScale config.modes[modeId].bossHpScale
 * @param {object|null|undefined} cfgScale config.bossHpScale
 * @param {boolean} isSolo
 * @param {number} [aliveCount] alive players at the Final Assault / Hidden Core start (co-op)
 * @returns {number}
 */
export function bossPoolShareOf(modeScale, cfgScale, isSolo, aliveCount) {
  const ms = modeScale && typeof modeScale === 'object' ? modeScale : {};
  const cs = cfgScale && typeof cfgScale === 'object' ? cfgScale : {};
  const pick = (k, d) => (Number.isFinite(ms[k]) && ms[k] > 0 ? ms[k] : Number.isFinite(cs[k]) && cs[k] > 0 ? cs[k] : d);
  const flag = (k, d) => (typeof ms[k] === 'boolean' ? ms[k] : typeof cs[k] === 'boolean' ? cs[k] : d);
  if (isSolo) return pick('solo', 1);
  const full = Math.max(1, Math.floor(pick('aliveFull', 4)));
  const n = Number(aliveCount);
  const alive = Number.isFinite(n) && n >= 1 ? Math.min(full, Math.floor(n)) : full;
  if (flag('perPlayer', true)) return pick('coop', 1) * alive;
  return pick('coop', 1) * (flag('aliveScaling', false) ? alive / full : 1);
}

/** Strip the _a/_b suffix of an item id (the registry key of an item family). */
export const itemKey = (id) => (typeof id === 'string' ? id.replace(/_[ab]$/, '') : '');

/** raw.factions 是冻结对象，poolExtras 的 Set 用 WeakMap 缓存（同一个 raw 只建一次）。 */
const POOL_EXTRA_SETS = new WeakMap();

/** 危机合约 R2 的八个囚犯（数据里 confinement.times 都是 4，见 tools/crisis-enemies.mjs 同源核查）。 */
/** 危机合约 R3 的四类敌人（攻击间隔缩短 15%）。 */
const R3_KEYS = Object.freeze([
  'enemy_1045_hammer', 'enemy_1160_hvyslr', 'enemy_1160_hvyslr_2', 'enemy_1320_wdrrl_2', 'enemy_1275_dwlock_2',
]);

/** 危机合约 R2 的八个囚犯（数据里 confinement.times 都是 4，见 tools/crisis-enemies.mjs 同源核查）。 */
const PRISONER_KEYS = Object.freeze([
  'enemy_1116_liprr', 'enemy_1116_liprr_2', 'enemy_1118_lidbox', 'enemy_1118_lidbox_2',
  'enemy_1119_vofsd', 'enemy_1119_vofsd_2', 'enemy_1121_lifbos', 'enemy_1121_lifbos_2',
]);

export class GameData {
  /**
   * @param {Readonly<Record<string, any>>} data server/data.js getData() (may be partial)
   * @param {string} modeId e.g. 'mode_multi_hard'
   * @param {any} [mods] Mod 开关 (shared/constants.js MOD_KEYS, `room.create.mods`): the per-device gameplay switches the
   *   room creator carried in. Normalised here so an unknown / malformed value is the official default, and read by
   *   `modeInactiveBonds`, `bans()` and `spDraftRules` — the three rule seams the switches change. Absent = all off =
   *   the official mode, byte-identical to before (the golden scenarios, the tools and every test pass nothing).
   * @param {any} [behaviour] 本局合成后的行为声明（`shared/behaviour.js` 的归一化数组，来自 `Match.behaviour`）。工坊
   *   mod 层移植 (2026-10-17) 新增的**第 5 个可选参数** —— 位置形式，既有调用方（4 参）一个字节都不用改，缺省
   *   `undefined` ⇒ 每一格都取官方档。只被 `morphPairing` 那两半（`morphPairing` / `morphSlots`）读。
   */
  constructor(data, modeId, mods, enemyBuff, behaviour) {
    /** Mod 开关 of this match (MOD_KEYS, all off by default). @type {Record<string, boolean>} */
    this.mods = normalizeMods(mods);
    /**
     * 房主配置「对局选项」(HOST_ENEMY_KEYS, `room.setEnemyBuff`): the four enemy buff multipliers, or null when the host
     * turned none up. `enemyScale` folds HP / ATK into the official round table so EVERY consumer of it inherits them
     * (ordinary spawns, the leader / hidden-core pool, leader summons' `flags.enemyScale`, the client's own spec);
     * `waves.js roundMods` adds DEF / RES from `enemyBuffDefRes` (they have no place in the round table). Null — the
     * default, and what every caller that passes nothing gets — allocates nothing and changes no number.
     * @type {{ hp: number, atk: number, def: number, res: number } | null}
     */
    this.enemyBuff = enemyBuffMul(enemyBuff);
    /**
     * 行为开关 `morphPairing` 的档位（第 7 段 · 工坊 mod 层移植 2026-10-17）。挂在 `GameData` 上是因为 `GameData` 是
     * **这一局**的读取视图，而它的两个读取方手上只有它：prep 侧的 `bondsMeta.pieceBonds`（`gd.morphPairing`）与
     * 装备位那几处（`gd.morphSlots`）。
     *
     * 缺省（没传 `behaviour`、或那一格没声明）⇒ `official` = **引擎今天的行为**，`bondsMeta` 的 `morphed` 于是取
     * `official`，与从前逐字相同。
     * @type {'official'|'plus'}
     */
    this.morphPairing = morphPairingOf(behaviour ?? null);
    /**
     * 装备位语义的策略（第 7 段，与上面那一行是**同一格开关的另外半条**）：`plus` 档下变形同构体不占装备位、
     * 每名干员最多一件、第三件顶掉真正占格的那两件；缺省档 ⇒ `OFFICIAL_SLOT_POLICY`（**共享的冻结单例**，每一个
     * 方法都逐字是引擎今天那条算术）。
     *
     * **它不参与 `equipPerChess` 的取值** —— 那两格装备位是官方的；策略只回答「这一行占了几格、能不能再放一件、
     * 顶替挑哪一件」。服务端四处调用方手上只有 `m` 或 `ps.m`，所以它们走 `matchSlotPolicy(m)` 那一个薄包装，
     * 而这里这一份是给手里只有 `gd` 的调用方的同一份判据。
     * @type {import('../../shared/morph.js').MorphSlotPolicy}
     */
    this.morphSlots = morphSlotPolicy(behaviour ?? null);
    // 内容包开关: the ported packs' records are dropped HERE, once, so every accessor below — the shop pool, the reels,
    // the 盟约 lists, the detail cards, the client-result bounds — sees only what this room actually contains. With
    // every pack off (the default, every golden scenario, every test) `filterRawData` returns `data` itself and this
    // constructor reads exactly what it read before the packs existed.
    this.raw = filterRawData(this.mods, data && typeof data === 'object' ? data : {});
    this.config = getConfig(this.raw) || {};
    this.modeId = modeId;
    this.mode = getMode(modeId, this.raw) || {};
    // Mode-level globals inherit field by field; the vanilla mode never changes its config object.
    const overrides = Object.fromEntries(Object.keys(this.config).filter(k => k !== 'modes' && Object.hasOwn(this.mode, k)).map(k => [k, this.mode[k]]));
    if (Object.keys(overrides).length) this.config = mergeData(this.config, overrides);
    this.economy = this.config.economy && typeof this.config.economy === 'object' ? this.config.economy : {};
    const chess = this.raw.chess && typeof this.raw.chess === 'object' ? this.raw.chess : {};
    this._chess = chess;
    this._items = this.raw.items && typeof this.raw.items === 'object' ? this.raw.items : {};
    // Fixed operator gifts are unlimited outputs, but every produced normal/advanced item still occupies 1/2 copies
    // (card-pool experiment BV1eLXXBqEgF, maintainer-confirmed 2026-10-11). Random subset gifts are not exempt.
    this._fixedGiftItems = new Set(Object.values(this.raw.garrisons || {})
      .filter(g => g.effectKey === 'SERVER_GAIN_EQUIP').map(g => g.bbStr?.chess).filter(id => this._items[id]));
    this._bonds = this.raw.bonds && typeof this.raw.bonds === 'object' ? this.raw.bonds : {};
    /** visible, shop-eligible base (normal) chess ids */
    this.visibleChess = Object.keys(chess).filter((id) => {
      const c = chess[id];
      return c && c.visible && !c.isGolden && !c.isDiy && !c.isHidden && Number.isInteger(c.tier);
    }).sort();
    /**
     * Shop item ids by tier (sim/simdata.js isShopItem: normal EQUIP, not hidden, not effect-only — the special
     * 维式重锤 and 突变细胞 are never sold). Every shop-item draw uses it: the shop item slot (pool.js), the 道具补给 /
     * 机密商店 cards (choices.js) and the shop-eligible item pools (Match.rollItemId). A pool's `also` list
     * (pool_equip_kathe: 突变细胞, #631) is appended there and is not in this table, so the shop slot still never sells it.
     */
    this.shopItemsByTier = {};
    for (const [id, it] of Object.entries(this._items)) {
      if (!isShopItem(it)) continue;
      (this.shopItemsByTier[it.tier] ||= []).push(id);
    }
    for (const k of Object.keys(this.shopItemsByTier)) this.shopItemsByTier[k].sort();
    this.bondIds = Object.keys(this._bonds).sort((a, b) => (numOr(this._bonds[a].identifier, 99) - numOr(this._bonds[b].identifier, 99)) || (a < b ? -1 : 1));
    /**
     * The 盟约 this mode never activates ("本局禁用"): the mode record's `inactiveBondIds` (标准模拟 leaves 拉特兰 阿戈尔
     * 卡西米尔 灵巧 奥术 奇迹 投资人 突袭 独行 绝技 off). Mod 开关 `noBondBan` 关闭盟约禁用 empties it in EVERY mode: the
     * switch's whole point is that no 盟约 is disabled this match, so the static list must go with the drawn one —
     * otherwise 标准模拟 would still refuse its ten and the switch would be half a switch. Read by the pool draw
     * (pool.js drawDisabledBonds), the bot's bond weighting, bondsMeta's listing and MatchInfra.bondLive.
     * @type {Set<string>}
     */
    this.modeInactiveBonds = new Set(this.mods.noBondBan ? [] : (Array.isArray(this.mode.inactiveBondIds) ? this.mode.inactiveBondIds : []));
    /** bandBondIds memo */
    this._bandBonds = new Map();
    this.inactiveEnemies = new Set(Array.isArray(this.mode.inactiveEnemyKeys) ? this.mode.inactiveEnemyKeys : []);
    /** data/tuning.json (titles only, see the header) */
    this.tuning = this.raw.tuning && typeof this.raw.tuning === 'object' ? this.raw.tuning : {};
    /** standIn memo: chess id → composed 补位 record | null */
    this._standIns = new Map();
  }

  /**
   * Leader HP pool multiplier — always 1 (no custom balance). Kept for callers written against the old tuning layer
   * (finalAssault.bossPoolHp); use `bossPoolHp` / `bossPoolShare` for the official pool.
   * @deprecated
   */
  bossHpMul(bossId) { // eslint-disable-line no-unused-vars
    return 1;
  }

  /**
   * Shared leader HP pool (DESIGN §20.10, §25.13.4): ONE pool for every boss field of the match (official tip "最终攻势中，
   * 所有人将一起对敌方领袖造成伤害"; the mirrored copies of a pair field share it — notice 5114 "两侧的敌方领袖共享生命值
   * （敌方领袖的总生命值不变）", which is about those copies). Size = bloodPoint[difficulty] × bossPoolShare: the table value
   * per player alive when the fight starts (the owner's decision of 2026-10-06, PR #209; it replaces the fixed pool of
   * 「保持固定血量」, which config bossHpScale restores — bossPoolShareOf); `aliveCount` omitted ⇒ a full team. Leaders are
   * never scaled by enemyScale ("领袖单位于服务器的生命值加成不受上述加成影响").
   * @param {string} bossId
   * @param {number} [aliveCount] alive players at the Final Assault / Hidden Core start (co-op)
   * @returns {number}
   */
  bossPoolHp(bossId, aliveCount) {
    const boss = this.boss(bossId);
    const diff = this.difficulty;
    let base = boss && boss.bloodPoint && Number.isFinite(boss.bloodPoint[diff]) ? boss.bloodPoint[diff] : null;
    if (base == null && boss && boss.bloodPoint) base = Object.values(boss.bloodPoint).find((v) => Number.isFinite(v)) ?? null;
    if (base == null) base = 500000;
    // × the fork's per-class extra (二.3): the leader's and the hidden core's factors are looked up separately by boss
    // id (`bossHpExtra`), so this is a per-boss value and not one blanket multiplier over the pool. 1 officially.
    // × the 房主配置「对局选项」血量 buff (enemyBuff.hp, 1 without one): the leader's HP is the shared pool, so it takes
    // the buff here rather than through `enemyScale` — that is the only place a leader's HP lives.
    const buffHp = this.enemyBuff ? this.enemyBuff.hp : 1;
    return Math.max(1, Math.round(base * this.bossPoolShare(aliveCount) * this.bossHpExtra(bossId) * buffHp));
  }

  /**
   * Multiplier of bloodPoint for the leader pool (see bossPoolHp; the rule and the config keys: bossPoolShareOf).
   * @param {number} [aliveCount]
   */
  bossPoolShare(aliveCount) {
    return bossPoolShareOf(this.mode.bossHpScale, this.config.bossHpScale, this.isSolo, aliveCount);
  }

  /** config.titles with the tuning overrides (stat / rule per title id) merged in. */
  get titles() {
    const list = Array.isArray(this.config.titles) ? this.config.titles : [];
    const ov = this.tuning.titles && typeof this.tuning.titles === 'object' ? this.tuning.titles : {};
    return list.map((t) => {
      if (!t || typeof t.id !== 'string' || !Object.hasOwn(ov, t.id) || !ov[t.id] || typeof ov[t.id] !== 'object') return t;
      const o = ov[t.id];
      const out = { ...t };
      if (typeof o.stat === 'string') out.stat = o.stat;
      if (o.rule === 'max' || o.rule === 'min') out.rule = o.rule;
      return out;
    });
  }

  // ---- ids ------------------------------------------------------------------------------------------

  chess(id) { return own(this._chess, id); }
  item(id) { return own(this._items, id); }
  bond(id) { return own(this._bonds, id); }

  /**
   * The 盟约 a chess belongs to (data `chess[id].bonds`, e.g. `['lateranoShip','swiftShip']`).
   * @param {string} id
   * @returns {string[]}
   */
  chessBondIds(id) {
    // `effectiveBonds`: a record's own bonds plus what the ENABLED packs contribute (`packBonds`), so 谬因 counts as a
    // 莱茵生命 member while that pack is on and as an ordinary operator while it is off. Nothing to add ⇒ the same array.
    const b = effectiveBonds(this.mods, own(this._chess, id));
    return b.filter((x) => typeof x === 'string');
  }

  /**
   * The shop-eligible operators under a bond: every visible chess that lists `bondId`.
   * @param {string} bondId
   * @returns {string[]}
   */
  chessOfBond(bondId) {
    if (typeof bondId !== 'string' || !bondId) return [];
    return this.visibleChess.filter((id) => this.chessBondIds(id).includes(bondId));
  }

  /**
   * 「定向甄选」 (the `targetedPick` Mod 开关): the bond whose 层数 is currently the highest among the player's ACTIVE
   * 盟约, or null when none is active. The owner's wording (2026-10-13): 「从当前已激活最高层数的盟约旗下的干员中随机」 —
   * the single highest one, not a weighted draw over several.
   *
   * Ties go to the lower `identifier` (the game's own bond order, gamedata.bondIds), so a tie is deterministic and the
   * same on the server and in a replay. Bonds that are statically inactive this match (标准模拟's ten, or whatever the
   * difficulty drew out) cannot be active in the first place, so they never win here.
   * @param {Record<string, { active?: boolean, layers?: number }>} bonds the player's computed bond states
   * @returns {string|null}
   */
  highestLayerActiveBond(bonds) {
    if (!bonds || typeof bonds !== 'object') return null;
    let best = null;
    let bestLayers = -1;
    for (const bondId of this.bondIds) {
      const b = bonds[bondId];
      if (!b || b.active !== true) continue;
      const layers = numOr(b.layers, 0);
      if (layers > bestLayers) { best = bondId; bestLayers = layers; }
    }
    return best;
  }
  band(id) { return own(this.raw.bands, id); }
  garrison(id) { return own(this.raw.garrisons, id); }
  effect(id) { return own(this.raw.effects, id); }
  enemy(key) { return own(this.raw.enemies, key); }

  /**
   * 契约专用敌人（data/enemies-crisis.json）：本季 randomEnemyAttributeDict 里有、但波次 / 特训条目 / 首领 /
   * 模板 / 赏金都不引用的那些（P1 冰爆源石虫、Q5 深池逐火战士、T4 特殊类……）。
   *
   * 它们**不在** raw.enemies 里 —— 放进去会改变既有对局的抽取结果（实测：roster 49 组、fields 2 组漂移）。
   * 契约要读它们走这里，波次永远走 enemy()。
   */
  enemyAny(key) {
    return own(this.raw.enemies, key) || own(this.raw['enemies-crisis'], key);
  }
  wave(id) { return own(this.raw.waves, id); }
  /**
   * A stage record. 危机合约 #4「弧光作战」的专属战场（data/stages-crisis.json, custom_cc4_focus）单独放一个文件：
   * 它**不能**进 data/stages.json —— 那张表是「本季能被抽到的战场」，几十处测试与 golden 都以它为基准，
   * 多一张不属于任何模式的图会让 roster 抽到它、golden 全漂。与 enemies / enemies-crisis 是同一种拆分。
   */
  stage(id) { return own(this.raw.stages, id) || own(this.raw['stages-crisis'], id); }
  boss(id) { return own(this.raw.bosses, id); }
  token(id) { return own(this.raw.tokens, id); }
  get choices() { return this.raw.choices && typeof this.raw.choices === 'object' ? this.raw.choices : {}; }
  /**
   * 特训敌人表（data/factions.json）。
   *
   * poolExtras 被换成 Set：那是「只为契约收进 data/enemies.json、本季波次并不引用」的敌人 key，
   * waves.js 的随机抽取据此把它们排除，既有对局的抽取结果因此逐字节不变（golden 不漂移）。
   */
  get factions() {
    const f = this.raw.factions && typeof this.raw.factions === 'object' ? this.raw.factions : {};
    if (!Array.isArray(f.poolExtras)) return f;
    let set = POOL_EXTRA_SETS.get(f);
    if (!set) { set = new Set(f.poolExtras); POOL_EXTRA_SETS.set(f, set); }
    return { ...f, poolExtras: set };
  }

  /**
   * The 补位 record of chess `id` (normal or elite; DATA.md §18): shared/standIn.js standInRecord over data/backups.json
   * — the chess's identity (ids, tier, bonds, 特质, price, merge) with its official stand-in's body (stats, range, skills
   * with the backup skill as the default, talents, module, art, `standInFor`). Null for a PRESET / 自选 chess, an unknown
   * id or data without backups.json. Memoized (frozen records).
   * @param {string} id
   * @returns {object|null}
   */
  standIn(id) {
    if (typeof id !== 'string') return null;
    if (this._standIns.has(id)) return this._standIns.get(id);
    const c = this.chess(id);
    const backups = this.raw.backups && typeof this.raw.backups === 'object' ? this.raw.backups : null;
    let rec;
    try { rec = c && backups ? standInRecord(c, backups) : null; } catch { rec = null; }
    if (rec) Object.freeze(rec);
    this._standIns.set(id, rec);
    return rec;
  }

  /** Normal (base) chess id of a chess id (golden → base). */
  baseIdOf(id) {
    const c = this.chess(id);
    if (!c) return typeof id === 'string' ? id.replace(/_b$/, '_a') : null;
    return c.baseId || (c.isGolden ? id.replace(/_b$/, '_a') : id);
  }

  goldenIdOf(id) {
    const c = this.chess(this.baseIdOf(id));
    if (c && c.goldenId && this.chess(c.goldenId)) return c.goldenId;
    const alt = typeof id === 'string' ? id.replace(/_a$/, '_b') : null;
    return alt && this.chess(alt) ? alt : null;
  }

  isGolden(id) { const c = this.chess(id) || this.item(id); return !!(c && c.isGolden); }

  tierOf(id) {
    const c = this.chess(id) || this.item(id);
    return c && Number.isInteger(c.tier) ? c.tier : 1;
  }

  // ---- economy --------------------------------------------------------------------------------------

  income(round) {
    const arr = Array.isArray(this.economy.income) ? this.economy.income : DEFAULTS.income;
    const cap = numOr(this.economy.incomeCap, DEFAULTS.incomeCap);
    const v = arr[round];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    return Math.max(0, Math.min(cap, 3 + round));
  }

  chessPrice(id) {
    const c = this.chess(id);
    const override = this.mode.economy?.chessPrice?.[this.tierOf(id)]?.[c?.isGolden ? 'golden' : 'normal'];
    if (Number.isFinite(override) && override >= 0) return override;
    if (c && Number.isFinite(c.price) && c.price >= 0) return c.price;
    const tier = this.tierOf(id);
    const row = this.economy.chessPrice && this.economy.chessPrice[tier];
    const golden = c && c.isGolden;
    if (row && typeof row === 'object') return numOr(golden ? row.golden : row.normal, DEFAULTS.chessPrice[tier] ?? 3);
    return DEFAULTS.chessPrice[tier] ?? 3;
  }

  sellPrice(id) {
    const c = this.chess(id);
    const override = this.mode.economy?.chessSell?.[this.tierOf(id)]?.[c?.isGolden ? 'golden' : 'normal'];
    if (Number.isFinite(override) && override >= 0) return override;
    if (c && Number.isFinite(c.sellPrice) && c.sellPrice >= 0) return c.sellPrice;
    const tier = this.tierOf(id);
    const row = this.economy.chessSell && this.economy.chessSell[tier];
    if (row && typeof row === 'object') return numOr(c && c.isGolden ? row.golden : row.normal, DEFAULTS.sellPrice);
    return DEFAULTS.sellPrice;
  }

  itemPrice(id) {
    const it = this.item(id);
    return it && Number.isFinite(it.price) && it.price >= 0 ? it.price : 2;
  }

  get refreshPrice() { return Math.max(0, numOr(this.economy.refreshPrice, DEFAULTS.refreshPrice)); }
  get benchSize() { return posIntOr(this.economy.benchSize, DEFAULTS.benchSize); }
  get tempSize() { return posIntOr(this.economy.tempSize, DEFAULTS.tempSize); }
  get deployCap() { return posIntOr(this.economy.deployCap, DEFAULTS.deployCap); }
  get equipPerChess() { return posIntOr(this.economy.equipPerChess, DEFAULTS.equipPerChess); }
  get maxArtsPerRound() { return posIntOr(this.economy.maxArtsPerRound, DEFAULTS.maxArtsPerRound); }
  get goldenCopies() { return posIntOr(this.economy.goldenCopies, DEFAULTS.goldenCopies); }
  get itemMergeCount() { return posIntOr(this.economy.itemMergeCount, DEFAULTS.itemMergeCount); }
  get leftoverKeptBands() {
    const ids = Array.isArray(this.economy.leftoverFundsKeptByBands) ? this.economy.leftoverFundsKeptByBands : DEFAULTS.leftoverFundsKeptByBands;
    const extra = Object.values(this.raw.bands || {}).filter(b => b.effectRef && ids.includes(b.effectRef)).map(b => b.bandId);
    return extra.length ? [...ids, ...extra] : ids;
  }
  get defaultBandId() { return typeof this.economy.defaultBandId === 'string' ? this.economy.defaultBandId : DEFAULTS.defaultBandId; }
  get defaultStartLp() { return posIntOr(this.economy.defaultStartLp, DEFAULTS.defaultStartLp); }

  rewardOffer() {
    const r = this.economy.rewardOffer && typeof this.economy.rewardOffer === 'object' ? this.economy.rewardOffer : {};
    return {
      // (an offer shows at most MAX_OFFER_SLOTS: a larger count — a data plugin's — only rolled for slots nobody sees)
      count: Math.min(MAX_OFFER_SLOTS, posIntOr(r.count, DEFAULTS.rewardOffer.count)),
      tierOffset: Number.isInteger(r.tierOffset) ? r.tierOffset : DEFAULTS.rewardOffer.tierOffset,
      maxTier: posIntOr(r.maxTier, DEFAULTS.rewardOffer.maxTier),
      price: Math.max(0, numOr(r.price, 0)),
    };
  }

  /**
   * Copies of a base chess in the shared pool — and, for a DIY slot, of a slotted 自选 piece in its player's own stock
   * (player/diy.js buildDiyStock).
   */
  poolCopies(baseId) {
    const ov = this.economy.poolCopiesOverrides;
    const tier = this.tierOf(baseId);
    const pc = this.economy.poolCopies;
    const v = ov && Number.isInteger(ov[baseId]) && ov[baseId] >= 0 ? ov[baseId] : pc?.[tier];
    const base = Number.isInteger(v) && v >= 0 ? v : (DEFAULTS.poolCopies[tier] ?? 10);
    // Co-op doubles the single-player counts: the measured shared pool (shared by the whole team, independent of team
    // size) and each player's private 自选 stock alike — the maintainer's decision of 2026-10-15 (GitHub #650): with
    // the shared pool doubled and the 自选 stock not, a 自选 operator was diluted in the copy-weighted rolls.
    const multiplier = this.isSolo ? 1 : posIntOr(this.economy.coopPoolMultiplier, 1);
    return base * multiplier;
  }

  /** Normal equipment copies in the shared pool; effect-only items have no shop stock limit. */
  itemPoolCopies(id) {
    const base = this.baseIdOf(id), rec = this.item(base);
    if (!rec || !isShopItem(rec)) return null;
    const count = this.economy.itemPoolCopiesOverrides?.[base] ?? this.economy.itemPoolCopies?.[rec.tier];
    return Number.isInteger(count) && count >= 0 ? count : null;
  }

  /** Whether a fixed trait gift may be produced beyond stock (including the advanced version of that item). */
  isUnlimitedGiftItem(id) { return this._fixedGiftItems.has(this.baseIdOf(id)); }

  /** Copies needed to merge (0 = never merges: golden chess). */
  mergeCount(id) {
    const c = this.chess(id);
    if (!c || c.isGolden) return 0;
    if (Number.isInteger(c.upgradeNum) && c.upgradeNum > 0) return c.upgradeNum;
    const ov = this.economy.mergeCountOverrides;
    if (ov && Number.isInteger(ov[id])) return ov[id];
    return posIntOr(this.economy.mergeCount, DEFAULTS.mergeCount);
  }

  // ---- mode -----------------------------------------------------------------------------------------

  get isSolo() { return this.mode.type === 'SINGLE' || /^mode_single_/.test(this.modeId || ''); }
  get difficulty() { return this.mode.difficulty || (this.modeId ? String(this.modeId).split('_').pop().toUpperCase() : 'NORMAL'); }
  get lastRound() {
    if (Number.isInteger(this.mode.lastRound) && this.mode.lastRound > 0) return this.mode.lastRound + this.extraRounds;
    return (this.modeId === 'mode_single_funny' ? 9 : 14) + this.extraRounds;
  }
  get bossRound() {
    const own = Number.isInteger(this.mode.bossRound) && this.mode.bossRound > 0 ? this.mode.bossRound : null;
    return (own ?? (Number.isInteger(this.mode.lastRound) && this.mode.lastRound > 0 ? this.mode.lastRound : this.modeId === 'mode_single_funny' ? 9 : 14)) + this.extraRounds;
  }
  get hiddenRound() {
    const own = Number.isInteger(this.mode.hiddenRound) && this.mode.hiddenRound > 0 ? this.mode.hiddenRound : null;
    return own == null ? null : own + this.extraRounds;
  }
  /**
   * How many extra 普通回合 the 「额外 4 回合」 Mod 开关 adds before the boss (0 when off, 4 when on).
   * The owner's wording (2026-10-13): 「开启时：无论单人、同盟、终极模拟，回合数都由 14 回合变为 18 回合。新增的 4 回合皆为
   * 普通回合，即不是 Boss 回合」 — so the boss moves LATER rather than the run continuing past it: every round number from
   * the boss on is shifted by this many, and `roundCfg` serves the LAST ordinary round's table for the inserted ones.
   */
  get extraRounds() { return this.mods.extraRounds === true ? MOD_EXTRA_ROUNDS : 0; }
  /**
   * The effective per-bond layer ceiling (shared/constants.js `layerCapFor`): the official 999, or Infinity while the
   * 「解除叠层上限」 Mod 开关 is on. Every layer writer reads it, so the switch lifts the ceiling and nothing else.
   */
  get layerCap() { return layerCapFor(this.mods); }
  /** Is the 「解除叠层上限」 Mod 开关 on? Passed to a battle as the wire-safe `flags.uncapLayers` boolean. */
  get uncapLayers() { return this.mods.uncapLayers === true; }
  /**
   * Is the 「联防不禁叠层」 Mod 开关 on? 联防 keeps `flags.layerGainsEnabled` off by default (the official rule: a helper's
   * stack stops growing while it defends). ON lifts exactly that one restriction for the 联防 field — boss / hidden /
   * final-assault fields keep theirs. Both ends read this one getter (the spec carries the resolved boolean), so the
   * client's own simulation and the server's re-run agree.
   */
  get uniteLayers() { return this.mods.uniteLayers === true; }
  /**
   * The 危机合约's compiled effects (`crisisRules(sel).fx`), or null for a room without a contract.
   *
   * Set by the Match from the room's checked contract (`room.crisis.fx`) at construction, NOT from `mods`: a contract is
   * decided once, at create, and never toggled mid-room. It travels to every battle spec as `flags.crisisFx` — the same
   * channel `uncapLayers` / `uniteLayers` use — so the client replica and the server's own re-run apply identical
   * numbers, and an ordinary room's spec stays byte-identical (the key is absent when this is null).
   * @type {Record<string, any> | null}
   */
  get crisisFx() { return this._crisisFx ?? null; }
  set crisisFx(v) { this._crisisFx = v && typeof v === 'object' ? v : null; }

  /**
   * 危机合约 L1 王权高压 — 领袖生命额外增加{25%|40%}，攻击速度增加{10|20}.
   *
   * The leader's HP lives in the shared boss POOL (finalAssault.bossPoolHp), so the multiplier has to land there rather
   * than through the spawn path: a leader unit's own `stats.maxHp` is not what the pool counts. This mirrors
   * `bossHpExtra` (a per-boss factor, never one blanket multiplier) and returns 1 for every ordinary match, so the
   * pool arithmetic of the official modes is byte-identical.
   * @param {string} bossId
   * @returns {number} 1 without a contract, or without L1 in it
   */
  crisisBossHpMul(bossId) { // eslint-disable-line no-unused-vars
    const fx = this.crisisFx;
    const v = fx && fx.L1 && fx.L1.hp;
    return Number.isFinite(v) ? 1 + v : 1;
  }

  /**
   * 危机合约 G1 预算削减 — 第7回合起，每回合系统基础资金减少{1|2|3}，最低为 0；其他收入正常.
   *
   * Only the BASE income is cut (`gd.income(r)`, the round table's own number); a bond/item/strategy payment goes
   * through `addFunds` with its own reason and is untouched — which is exactly "其他收入正常".
   * @param {number} round
   * @param {number} income the round table's base income
   * @returns {number} the income after the contract (unclamped: startRound clamps at 0 with `nonNeg`)
   */
  crisisIncome(round, income) {
    const fx = this.crisisFx;
    const g1 = fx && fx.G1;
    if (!g1 || typeof g1 !== 'object' || !Number.isFinite(g1.cut)) return income;
    const from = Number.isFinite(g1.from) ? g1.from : 1;
    if (Number.isFinite(round) && round < from) return income;
    return Math.max(0, income - g1.cut);
  }

  /**
   * 危机合约 H4 商店封存 — 每次普通主动刷新后，最左侧的干员商品格本次不可购买；自动刷新和独立奖励界面不受影响.
   *
   * Only the LEFT-MOST CHESS slot is sealed: a refresh may put an item there instead, and the official text says 干员
   * 商品格, so the seal follows the slot's KIND rather than its index alone. `refresh()` is the manual path; the
   * automatic ones (startRound's `rollShop`, a strategy's grant) never call it, which is exactly 「自动刷新不受影响」.
   * @returns {boolean}
   */
  crisisSealsLeftmostShop() {
    const fx = this.crisisFx;
    return !!(fx && fx.H4 && typeof fx.H4 === 'object');
  }

  /**
   * 危机合约 H3 授衔延误 — 精锐合成立即生效，但合成附赠的免费选择奖励延至下一回合发放；奖励等阶按合成时计算.
   * @returns {boolean} true when a merge's reward offer must wait for the next round
   */
  crisisDefersMergeReward() {
    const fx = this.crisisFx;
    return !!(fx && fx.H3 && typeof fx.H3 === 'object');
  }

  /**
   * 危机合约 S1/S2/S5 — leader SKILL cooldown contracts, expressed as `enemyOverrides` patches.
   *
   * The engine already reads a wave's `overrides` table (`content/enemies/helpers.js:abOf` → `sk[prefabKey].cd` /
   * `.icd`), and `bossRounds` passes `wave.overrides` straight through — so a cooldown contract needs no sim change at
   * all, it just edits that table. The live numbers come from `data/waves.json`:
   *   “萨米的意志” `enemy_9033_acdeer`: `Lasso`(自然涌动) cd 60 / icd 40, `Doom` cd 999 / icd 999
   *   “假想敌：铳” `enemy_9017_achunt`: skill `1`(最终之罚) cd 999 / icd 999
   *
   *   * S1 一档 — 第二名领袖的【最终之罚】冷却缩短 20%
   *   * S2 一档 — 【自然涌动】首次释放提前 25%、冷却缩短约 17%；二档另加「半血前也同时攻击 2 名目标」
   *   * S5 一档 — 第二名领袖每个主动技能的首次等待时间减半；二档改登场条件（由 crisisDualLeader 处理）
   * @param {Record<string, any>} overrides the wave's own table (never mutated: a copy is returned)
   * @param {Record<string, string>} keys enemyKey of each leader ({ primary, secondary })
   * @returns {Record<string, any>} the patched table, or the input table when no such contract applies
   */
  /**
   * 危机合约 R1 再生护盾 — 把假想敌：再生的**天赋**黑板书改掉。
   *
   * 为什么必须在 gamedata 层：护盾层数 / 重生间隔在 kitRegen（sim/content/enemies/times.js:126）
   * 构造能力时就闭包捕获了，等 enemySpawn 再改已经来不及。enemyOverrides 的 talents.bb 是 abOf
   * 唯一在 kit 之前生效的注入点，所以照 crisisBossSkillOverrides 的先例在这里合并。
   *
   * @param {Record<string, any>} overrides 本场的 enemyOverrides（波次自带的）
   * @returns {Record<string, any>} 打过补丁的表；没有 R1 时原样返回
   */
  crisisTalentOverrides(overrides) {
    const fx = this.crisisFx;
    if (!fx) return overrides;
    const r1 = fx.R1 && typeof fx.R1 === 'object' ? fx.R1 : null;
    const r2 = fx.R2 && typeof fx.R2 === 'object' ? fx.R2 : null;
    const ANY = ['Q2', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'R3'].some((k) => fx[k] && typeof fx[k] === 'object');
    if (!r1 && !r2 && !ANY) return overrides;
    const out = { ...(overrides || {}) };
    const obj = (v) => (v && typeof v === 'object' ? v : null);
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    /**
     * 给一个 key 的 stats 打补丁。spawns.js:97-105 确实消费 enemyOverrides[key].stats（maxHp/atk/def/res/
     * moveSpeed/bat/aspd/rangeRadius/massLevel/lpr/blockCnt），所以这里是有效通道 —— 但只对**出生时**生效，
     * 不参与 kit 构造（那条只能走 talents.bb）。
     */
    const patchStat = (o, key, field, value) => {
      const base = o[key] || {};
      o[key] = { ...base, stats: { ...(base.stats || {}), [field]: value } };
    };
    /** 给一个 key 的 talents.bb 打补丁（保留它自己已有的、以及波次自带的覆盖）。 */
    const patchBb = (key, bb) => {
      const base = out[key] || {};
      out[key] = {
        ...base,
        talents: { ...(base.talents || {}), bb: { ...((base.talents && base.talents.bb) || {}), ...bb } },
      };
    };
    if (r1) {
      patchBb('enemy_9010_acpupp', {
        'Aura.max_damage_block_cnt': Number.isFinite(r1.shield) ? r1.shield : 7,
        'Revive[Trigger].interval': Number.isFinite(r1.reborn) ? r1.reborn : 12,
      });
    }
    if (r2) {
      // R2 囚犯：解除禁锢所需攻击次数 4 -> 3。八个囚犯 key 在数据里都写 confinement.times = 4。
      const hits = Number.isFinite(r2.hits) ? r2.hits : 3;
      for (const key of PRISONER_KEYS) patchBb(key, { 'confinement.times': hits });
    }
    // Q2 淤困寄生：宿主受元素损伤倍率 1.3 -> 1.45；Ⅱ档寄生伤害 0.3 -> 0.4（+ 淤困生命 +30%）
    const q2 = obj(fx.Q2);
    if (q2) {
      const host = { '1.damage_scale': num(q2.hostScale, 1.45), '1.ep_damage_scale': num(q2.hostScale, 1.45) };
      if (q2.atkScale != null) host['1.atk_scale'] = num(q2.atkScale, 0.4);
      patchBb('enemy_9007_acelem', host);
      if (q2.hpMul != null) {
        const raw = own(this.raw.enemies, 'enemy_9007_acelem') || own(this.raw['enemies-crisis'], 'enemy_9007_acelem');
        const hp = raw && raw.stats && Number.isFinite(raw.stats.maxHp) ? raw.stats.maxHp : null;
        if (hp != null) patchStat(out, 'enemy_9007_acelem', 'maxHp', Math.round(hp * num(q2.hpMul, 1.3)));
      }
    }
    // Q4 深池方阵：同伴提供的防御 200 -> 250
    const q4 = obj(fx.Q4);
    if (q4) {
      const def = num(q4.def, 250);
      for (const key of ['enemy_1169_duphlx', 'enemy_1169_duphlx_2']) patchBb(key, { 'auraDefup.def': def });
    }
    // Q5 深池逐火：余烬重生间隔 10 -> 8；Ⅱ档击倒所需次数 5 -> 7（护卫 10 -> 14）
    const q5 = obj(fx.Q5);
    if (q5) {
      const interval = num(q5.interval, 8);
      for (const key of ['enemy_1288_duskls', 'enemy_1288_duskls_2', 'enemy_1292_duskld', 'enemy_1292_duskld_2']) {
        const bb = { 'Revive[Trigger].interval': interval };
        if (q5.hits != null) bb['Revive[Trigger].prop_max_hp'] = num(q5.hits, 7);
        if (q5.guardHits != null && key.startsWith('enemy_1292_')) bb['Revive[Trigger].prop_max_hp'] = num(q5.guardHits, 14);
        patchBb(key, bb);
      }
    }
    // Q6 蚀裂：毒雾半径 0.8 -> 1.2 格；Ⅱ档持续时间 8 -> 12
    const q6 = obj(fx.Q6);
    if (q6) {
      const bb = { '1.projectile_range': num(q6.radius, 1.2) };
      if (q6.lifeTime != null) bb['1.projectile_life_time'] = num(q6.lifeTime, 12);
      patchBb('enemy_9006_actoxi', bb);
    }
    // Q7 控潮：侵蚀比例 0.8 -> 1.0
    const q7 = obj(fx.Q7);
    if (q7) {
      const ratio = num(q7.ratio, 1.0);
      for (const key of ['enemy_1161_tidmag', 'enemy_1161_tidmag_2', 'enemy_1162_magmot_2']) {
        patchBb(key, { 'EpDamage.attack@ep_damage_ratio': ratio });
      }
    }
    // R3 粉碎攻坚手/码头水手/悖谬暴虐兵长/王庭军精锐术师：攻击间隔缩短 15%（stats.bat，spawns.js 消费）
    const r3 = obj(fx.R3);
    if (r3) {
      const cut = num(r3.batCut, 0.15);
      for (const key of R3_KEYS) {
        const raw = own(this.raw.enemies, key) || own(this.raw['enemies-crisis'], key);
        const bat = raw && raw.stats && Number.isFinite(raw.stats.bat) ? raw.stats.bat : null;
        if (bat != null) patchStat(out, key, 'bat', Math.round(bat * (1 - cut) * 1000) / 1000);
      }
    }
    // Q8 深池伙友：力场半径 1.1 -> 1.5；Ⅱ档影刃攻击间隔缩减 1.3 -> 1.6。
    // 影刃数据里默认就是 traitAbility.base_attack_time = -1.3，所以 Ⅰ 档（只有 radius）不需要碰它，
    // 只有 Ⅱ 档带 cut 时才改成 -1.6。字段名是 cut，不是 bladeSpeed（后者在契约参数里不存在）。
    const q8 = obj(fx.Q8);
    if (q8) {
      const r = num(q8.radius, 1.5);
      for (const key of ['enemy_1174_duholy', 'enemy_1174_duholy_2']) patchBb(key, { 'traitAbility.range_radius': r });
      if (Number.isFinite(q8.cut)) {
        for (const key of ['enemy_1175_dushdo', 'enemy_1175_dushdo_2']) {
          patchBb(key, { 'traitAbility.base_attack_time': -q8.cut });
        }
      }
    }
    return out;
  }
  crisisBossSkillOverrides(overrides, keys = {}) {
    const fx = this.crisisFx;
    if (!fx || !overrides || typeof overrides !== 'object') return overrides;
    const S1 = fx.S1 && typeof fx.S1 === 'object' ? fx.S1 : null;
    const S2 = fx.S2 && typeof fx.S2 === 'object' ? fx.S2 : null;
    // S5 一档's params are EMPTY (`t2({}, { below: 0.6, at: 30 })`), and `crisisRules` drops an empty object — so this
    // contract must be detected by the KEY being present, not by the object having fields.
    const S5 = fx.S5 && typeof fx.S5 === 'object' ? fx.S5 : (Object.hasOwn(fx, 'S5') ? {} : null);
    if (!S1 && !S2 && !S5) return overrides;
    const primary = keys.primary || 'enemy_9033_acdeer';
    const secondary = keys.secondary || 'enemy_9017_achunt';
    const out = { ...overrides };
    /** Copy one enemy's override and scale its skills by `fn(name, cd, icd)`; untouched entries stay shared. */
    const patch = (enemyKey, fn) => {
      const src = out[enemyKey];
      if (!src || !Array.isArray(src.skills)) return;
      out[enemyKey] = {
        ...src,
        skills: src.skills.map((s) => {
          if (!s || s.prefabKey == null) return s;
          const next = fn(String(s.prefabKey), numOr(s.cooldown, 0), numOr(s.initCooldown, 0));
          return next ? { ...s, ...next } : s;
        }),
      };
    };
    // S1 `{ cd: 24 }` — the data's 999 is a sentinel ("fires on priority, no timer"), so the wave carries no usable
    // number to shorten by 20%. The official text says 冷却缩短20%, and the 档位表 gives the RESULT (24) rather than a
    // ratio; both readings agree when the base is the leader's real 30 s cadence. The contract therefore writes the
    // table's own number, which is what the site's rule object holds.
    if (S1) patch(secondary, (name, cd) => (Number.isFinite(S1.cd) ? { cooldown: S1.cd } : null));
    // S2 `{ icd: 30, cd: 50 }` — also the RESULT, not a ratio: 自然涌动 starts at 40 s and the contract makes it 30
    // (提前 25%), then runs every 60 s and the contract makes it 50 (缩短约 17%). Writing the values keeps the two
    // readings (ratio vs result) from drifting apart.
    if (S2) {
      patch(primary, (name, cd, icd) => (name !== 'Lasso' ? null : {
        cooldown: Number.isFinite(S2.cd) ? S2.cd : cd,
        initCooldown: Number.isFinite(S2.icd) ? S2.icd : icd,
      }));
    }
    // S5 一档 `{}` — 首次等待时间减半（无参数）; 二档 `{ below: 0.6, at: 30 }` changes the ENTRY condition instead,
    // which crisisDualLeader applies, so only the halving belongs here.
    if (S5) patch(secondary, (name, cd, icd) => ({ initCooldown: Math.round(icd * 0.5 * 1000) / 1000 }));
    return out;
  }

  /**
   * 危机合约 S3 护卫合流 — 第二名领袖关卡的护卫按 50%/100% 加入它所在的每个战场（每批向下取整，至少 1 名）.
   * @param {number} count how many escorts the secondary leader's own level spawns in one batch
   * @returns {number} how many of them join (0 when the contract is absent ⇒ caller appends nothing)
   */
  crisisEscortShare(count) {
    const fx = this.crisisFx;
    const s3 = fx && fx.S3;
    if (!s3 || typeof s3 !== 'object' || !Number.isFinite(s3.share)) return 0;
    const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    if (!n) return 0;
    // 「每批向下取整，至少1名」
    return Math.max(1, Math.floor(n * s3.share));
  }

  /**
   * 危机合约 S4 同步共鸣 — 每 30 秒比较两名领袖的剩余生命百分比.
   *
   *   相差 > 15 个百分点 ⇒ 较高者受到伤害降低 25%，持续 10 秒（BUCKET_GUARD）
   *   相差 ≤ 15 个百分点 ⇒ 两名领袖受到伤害增加 15%，持续 8 秒（BUCKET_VULN）
   *   一名领袖死亡后停止.
   * @returns {null | { period: number, gap: number, cut: number, cutDur: number, vuln: number, vulnDur: number }}
   */
  /**
   * 危机合约 M3 援护限额：「每轮联防最多由 1 名成功玩家承接」。
   * 返回承接人数上限；未选 M3 时返回 null（unite.js 的 helperOrder 用 ?? Infinity 兜底，行为完全不变）。
   */
  /** U4 联防强压：转入联防战的敌人生命乘数（null = 无此合约）。 */
  get crisisUniteHpMul() {
    const fx = this.crisisFx;
    const u4 = fx && fx.U4;
    if (!u4 || typeof u4 !== 'object' || !Number.isFinite(u4.hp)) return null;
    return 1 + u4.hp;
  }

  get crisisUniteHelpers() {
    const fx = this.crisisFx;
    const m3 = fx && fx.M3;
    if (!m3 || typeof m3 !== 'object') return null;
    const n = m3.helpers;
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  crisisLeaderResonance() {
    const fx = this.crisisFx;
    const s4 = fx && fx.S4;
    if (!s4 || typeof s4 !== 'object' || !Number.isFinite(s4.period)) return null;
    return { period: s4.period, gap: s4.gap, cut: s4.cut, cutDur: s4.cutDur, vuln: s4.vuln, vulnDur: s4.vulnDur };
  }

  /**
   * 危机合约 S6 双首破局 — 第二领袖首次登场时本场干员获得技力与护盾；登场 20 秒后两名领袖攻速 +10.
   * @returns {null | { sp: number, shield: number, shieldDur: number, after: number, aspd: number }}
   */
  crisisDualEntrance() {
    const fx = this.crisisFx;
    const s6 = fx && fx.S6;
    if (!s6 || typeof s6 !== 'object') return null;
    return { sp: numOr(s6.sp, 0), shield: numOr(s6.shield, 0), shieldDur: numOr(s6.shieldDur, 0), after: numOr(s6.after, 0), aspd: numOr(s6.aspd, 0) };
  }

  /**
   * 危机合约 L2 双首并临 / L3 第二号令 / L4 双战区：锁链 / L5 交叉追猎 — 并列领袖方案.
   *
   * These four all bring a SECOND leader onto the field, and each names its own HP ratio and its own condition. The
   * engine's leader HP is one shared pool, so a dual scheme needs a second pool rather than a second spawn: the caller
   * asks this for the plan and builds one `SharedBossPool` per entry.
   * @param {string} primaryId the round's own leader (Match.bossId)
   * @param {string} secondaryId the second leader the fork fields beside it (boss_2 「假想敌：铳」)
   * @returns {null | { scheme: string, pools: Array<{ bossId: string, mul: number, at?: number, below?: number, pair?: string }>, gap?: number, cut?: number, atk?: number, swap?: number }}}
   */
  crisisDualLeader(primaryId, secondaryId) {
    const fx = this.crisisFx;
    if (!fx) return null;
    const pick = (id) => (fx[id] && typeof fx[id] === 'object' ? fx[id] : null);
    const L2 = pick('L2');
    const L3 = pick('L3');
    const L4 = pick('L4');
    const L5 = pick('L5');
    const scheme = L2 ? 'L2' : L3 ? 'L3' : L4 ? 'L4' : L5 ? 'L5' : null;
    if (!scheme) return null;
    const cfg = { L2, L3, L4, L5 }[scheme];
    const second = secondaryId || 'boss_2';
    if (scheme === 'L2') {
      // 两者同时登场，各为正常生命的 65%，均须击败
      return { scheme, pools: [{ bossId: primaryId, mul: cfg.hp }, { bossId: second, mul: cfg.hp }] };
    }
    if (scheme === 'L3') {
      // 主先登场（80%）；其生命首次降至 50% 或战斗到 40 秒时，副登场（55%），取较早者。
      // 危机合约 S5 二档覆盖这个登场条件：改为「主领袖生命降至 60% 或战斗到 30 秒」（params { below: 0.6, at: 30 }）。
      // S5 一档 params 是 {}，只做技能首次等待减半（见 crisisLeaderSkillOverrides），不影响登场条件。
      const s5 = pick('S5');
      const useS5 = !!s5 && (Number.isFinite(s5.below) || Number.isFinite(s5.at));
      const at = useS5 && Number.isFinite(s5.at) ? s5.at : cfg.at;
      const below = useS5 && Number.isFinite(s5.below) ? s5.below : cfg.below;
      return { scheme, pools: [{ bossId: primaryId, mul: cfg.hp }, { bossId: second, mul: cfg.hp2, at, below }] };
    }
    if (scheme === 'L4') {
      // 两个拼场各面对一名领袖，各 60%；剩余生命百分比相差 >20 点时低者减伤 30%；一名死亡后另一名攻击 +20%
      return { scheme, pools: [{ bossId: primaryId, mul: cfg.hp, pair: 'b1' }, { bossId: second, mul: cfg.hp, pair: 'b2' }], gap: cfg.gap, cut: cfg.cut, atk: cfg.atk };
    }
    // L5: 两个拼场各面对一名「萨米的意志」，各 60%；每 30 秒交换战区
    return { scheme, pools: [{ bossId: primaryId, mul: cfg.hp, pair: 'b1' }, { bossId: primaryId, mul: cfg.hp, pair: 'b2' }], swap: cfg.swap };
  }

  /**
   * 危机合约 O2 共同命运 — 四人领袖轮合并目标生命后，仅保留 75%，向下取整、最低 1 点.
   * @param {number} merged the team's merged LP entering the leader round
   * @returns {number}
   */
  crisisMergedLp(merged) {
    const fx = this.crisisFx;
    const o2 = fx && fx.O2;
    if (!o2 || typeof o2 !== 'object' || !Number.isFinite(o2.keep)) return merged;
    return Math.max(1, Math.floor(merged * o2.keep));
  }

  /**
   * 危机合约 O3 同生共死 — 领袖轮前全队共享的「保命」次数.
   *
   *   * 一档 `{ saves: 1 }` — 首次有人目标生命将归零时保留为 1；此后再有人归零，全队立即失败.
   *   * 三档 `{ saves: 0 }` — 任意一名玩家目标生命归零，全队立即失败（即没有保命）.
   * @returns {number} the number of saves, or -1 without the contract (caller treats -1 as "official behaviour")
   */
  crisisTeamSaves() {
    const fx = this.crisisFx;
    const o3 = fx && fx.O3;
    if (!o3 || typeof o3 !== 'object' || !Number.isFinite(o3.saves)) return -1;
    return Math.max(0, o3.saves);
  }

  /**
   * 危机合约 G4 资本冻结 — 休整期内的非基础资金收入延至下一休整期开始可用；不减少资金总额.
   * 终局突袭（第14回合）休整期的收入不冻结.
   *
   * 「基础资金」 is the round table's own income (`gd.income`), which travels with reason `'income'`; every other payer
   * — 出售 `'sell'`, 盟约/特质/策略 `'choice'`, 装备, 返款 — is a 非基础资金收入 and is the thing that defers.
   * @param {number} round
   * @param {string} reason the addFunds reason
   * @returns {boolean} true when this payment must wait for the next prep
   */
  crisisFundsDeferred(round, reason) {
    const fx = this.crisisFx;
    const g4 = fx && fx.G4;
    if (!g4 || typeof g4 !== 'object') return false;
    if (reason === 'income' || reason === 'test') return false; // 基础资金；test 是调试命令，不参与
    const until = Number.isFinite(g4.until) ? g4.until : 13;
    // 「终局突袭（第14回合）休整期的收入不冻结」 — the window is rounds 1..until
    return Number.isFinite(round) && round <= until;
  }

  /**
   * 危机合约 K1 编制上限 / K4 全队部署位额度 — 每名玩家同时在场干员上限被收窄.
   *
   * K1 is a per-player cap (7/6). K4 is a TEAM-wide quota of −6 to be shared freely, but "个人不能超过其原本上限",
   * and 「与K1同选时，每名玩家的上限取两者中较小的一个，K4不再额外扣减」 — so a player's own cap is its mode cap
   * whatever K4 says; K4's −6 is a team ledger the caller keeps, never a per-player subtraction. With both, the smaller
   * of the two wins and K4 is not applied again.
   * @param {number} cap the player's own cap (mode + bonuses)
   * @param {{ k4Spent?: number, seats?: number }} [team] K4's shared ledger, when the caller keeps one
   * @returns {number}
   */
  crisisDeployCap(cap, team = null) {
    const fx = this.crisisFx;
    let out = cap;
    const k1 = fx && fx.K1;
    if (k1 && typeof k1 === 'object' && Number.isFinite(k1.cap)) out = Math.min(out, k1.cap);
    const k4 = fx && fx.K4;
    // 「K4不再额外扣减」only when K1 is also chosen; alone, K4 keeps every player at its own cap and the −6 is the
    // team's shared budget, so there is nothing to subtract from an individual — which is exactly what this returns.
    // K4 has no per-player cap of its own (`{ cut: 6 }` is the team-wide deduction) — with K1 it is "取两者中较小的
    // 一个，K4不再额外扣减", i.e. K1's cap stands and K4 subtracts nothing more.
    return Math.max(1, out);
  }

  /**
   * 危机合约 K4 的全队总额度：原本 n 名玩家的部署位之和再减 6（不低于每名玩家 1 位）.
   * @param {number} sum the team's combined caps
   * @param {number} players how many players share it
   * @returns {number}
   */
  crisisTeamDeployBudget(sum, players) {
    const fx = this.crisisFx;
    const k4 = fx && fx.K4;
    if (!k4 || typeof k4 !== 'object' || !Number.isFinite(k4.cut)) return sum;
    const n = Number.isFinite(players) && players > 0 ? players : 1;
    return Math.max(n, sum - k4.cut);
  }

  /**
   * 危机合约 J1 装备配额 — 场上进阶（精锐）装备上限 {6|4|2}；基础装备不受限制.
   * @param {number} count how many advanced items are already carried on the board
   * @returns {number} the cap, or Infinity
   */
  crisisAdvancedItemCap(count) { // eslint-disable-line no-unused-vars
    const fx = this.crisisFx;
    const j1 = fx && fx.J1;
    if (!j1 || typeof j1 !== 'object' || !Number.isFinite(j1.cap)) return Infinity;
    return j1.cap;
  }

  /**
   * 危机合约 J3 精锐上限 — 场上精锐干员最多 {4|3} 名；允许继续合成并存放其他精锐（存于手牌，不违反此限）.
   * @returns {number} the cap, or Infinity
   */
  crisisEliteCap() {
    const fx = this.crisisFx;
    const j3 = fx && fx.J3;
    if (!j3 || typeof j3 !== 'object' || !Number.isFinite(j3.cap)) return Infinity;
    return j3.cap;
  }

  /**
   * 危机合约 H5 行动配额 — 每休整期主动购买/出售/使用消耗品合计上限 {30|22|16}；免费操作也计数.
   * @param {number} used how many actions this prep already made
   * @returns {number} the cap, or Infinity
   */
  crisisActionCap(used) { // eslint-disable-line no-unused-vars
    const fx = this.crisisFx;
    const h5 = fx && fx.H5;
    if (!h5 || typeof h5 !== 'object' || !Number.isFinite(h5.cap)) return Infinity;
    return h5.cap;
  }

  /**
   * 危机合约 I4 层数配额 — 每种盟约每休整期实际新增层数上限 {40|25|15}；战斗阶段叠层不限.
   *
   * ONLY the 休整 (prep) gains are capped — the official text says 战斗阶段叠层不限, so a caller in the battle phase
   * must not consult this.
   * @returns {number} the cap, or Infinity
   */
  crisisLayerGainCap() {
    const fx = this.crisisFx;
    const i4 = fx && fx.I4;
    if (!i4 || typeof i4 !== 'object' || !Number.isFinite(i4.cap)) return Infinity;
    return i4.cap;
  }

  /**
   * 危机合约 M1 手牌收缩 — 常规手牌区由 10 格降为 7 格.
   * @param {number} size the mode's hand size
   * @returns {number}
   */
  crisisHandSize(size) {
    const fx = this.crisisFx;
    const m1 = fx && fx.M1;
    if (!m1 || typeof m1 !== 'object' || !Number.isFinite(m1.hand)) return size;
    return Math.min(size, m1.hand);
  }

  /**
   * 危机合约 H1 频率限制 — 第4回合起，每回合主动刷新最多{12|9|6}次，免费刷新也计次.
   * @param {number} round
   * @returns {number} the cap, or Infinity without H1
   */
  crisisRefreshCap(round) {
    const fx = this.crisisFx;
    const h1 = fx && fx.H1;
    if (!h1 || typeof h1 !== 'object' || !Number.isFinite(h1.cap)) return Infinity;
    const from = Number.isFinite(h1.from) ? h1.from : 1;
    if (Number.isFinite(round) && round < from) return Infinity;
    return h1.cap;
  }

  /**
   * 危机合约 H2 升格管制 — 调度中心第 1 次升级不加价，第 2 次起每次额外消耗 2 资金.
   * @param {number} level the shop level BEFORE this upgrade
   * @param {number} price the mode's own upgrade price
   * @returns {number} the price the contract charges
   */
  crisisLevelUpPrice(level, price) {
    const fx = this.crisisFx;
    const h2 = fx && fx.H2;
    if (!h2 || typeof h2 !== 'object' || !Number.isFinite(h2.tax)) return price;
    const free = Number.isFinite(h2.free) ? h2.free : 1;
    // 「第1次升级不加价」: the shop starts at level 1, so the first upgrade leaves level 1 — anything above pays the tax
    const from = 1 + free;
    if (Number.isFinite(level) && level < from) return price;
    return price + h2.tax;
  }

  /**
   * 危机合约 G3 集中采购税 — 每回合前 3 次购买干员正常计价，第 4 次起每次额外消耗 1 资金.
   * @param {number} buys how many purchases this round has already made
   * @param {number} price the piece's own price
   * @returns {number}
   */
  crisisBuyPrice(buys, price) {
    const fx = this.crisisFx;
    const g3 = fx && fx.G3;
    if (!g3 || typeof g3 !== 'object' || !Number.isFinite(g3.tax)) return price;
    // `buys` is how many purchases this round ALREADY made, so 0..free-1 are the free ones — the first taxed purchase
    // is the (free+1)-th, i.e. `buys === free`.
    const free = Number.isFinite(g3.free) ? g3.free : 0;
    return Number.isFinite(buys) && buys >= free ? price + g3.tax : price;
  }

  /**
   * 危机合约 G2 延期拨款 — 第4—6回合每回合扣留 2 点基础资金，第 7 回合一次性返还（最多 6 点）.
   *
   * Returns what this round WITHHOLDS from the base income and what it gives BACK. The caller keeps the withheld total
   * on the player (it is that player's own contract state), so a re-entry into prep cannot double-pay.
   * @param {number} round
   * @param {number} income the base income BEFORE any withholding
   * @returns {{ withhold: number, back: number, cap: number }}
   */
  crisisIncomeHold(round, income) {
    const fx = this.crisisFx;
    const g2 = fx && fx.G2;
    if (!g2 || typeof g2 !== 'object' || !Number.isFinite(g2.hold)) return { withhold: 0, back: 0, cap: 0 };
    const [r0, r1] = Array.isArray(g2.rounds) ? g2.rounds : [4, 6];
    const backAt = Number.isFinite(g2.back) ? g2.back : r1 + 1;
    // "最多6点" is the ceiling of the whole withholding window, not a fixed payment: the caller returns what it actually
    // withheld (a player whose income was already 0 withheld nothing and must not be paid 6).
    const cap = g2.hold * (r1 - r0 + 1);
    if (Number.isFinite(round) && round >= r0 && round <= r1) {
      return { withhold: Math.min(g2.hold, Math.max(0, income)), back: 0, cap };
    }
    // `back` here is the SIGNAL only; the caller substitutes the amount it actually withheld (never above `cap`)
    if (Number.isFinite(round) && round === backAt) return { withhold: 0, back: 1, cap };
    return { withhold: 0, back: 0, cap };
  }
  get maxShopLevel() { return posIntOr(this.mode.maxShopLevel, DEFAULTS.maxShopLevel); }

  /**
   * The round table of round `r`. With 「额外 4 回合」 on, the rounds BEFORE the boss are unchanged and the boss / hidden
   * rounds are shifted up by `extraRounds`; the rounds between the old last round and the shifted boss are 普通回合 that
   * reuse the last ordinary round's own table (its battlefield template, prep time, timers) — deliberately not a new
   * generated table, so the inserted rounds are the game's own last normal round, and nothing else has to know they exist.
   */
  roundCfg(r) {
    const rounds = this.mode.rounds;
    if (!rounds || typeof rounds !== 'object') return null;
    const n = numOr(r, 0);
    const base = Number.isInteger(this.mode.lastRound) && this.mode.lastRound > 0 ? this.mode.lastRound : (this.modeId === 'mode_single_funny' ? 9 : 14);
    const shift = this.extraRounds;
    let key = n;
    if (shift > 0 && n >= base && n < base + shift) key = base - 1; // the inserted 普通回合: the last ordinary round's table
    else if (shift > 0 && n >= base + shift) key = n - shift;        // the boss / hidden rounds, moved up
    const rec = rounds[String(key)];
    return rec && typeof rec === 'object' ? rec : null;
  }

  spRounds() { return Array.isArray(this.mode.spRounds) ? this.mode.spRounds.filter((n) => Number.isInteger(n)) : []; }

  upgradePrices() {
    const arr = Array.isArray(this.mode.upgradePrices) ? this.mode.upgradePrices : DEFAULTS.upgradePrices;
    return arr.map((v) => Math.max(0, numOr(v, 99)));
  }

  /** Base price to go from `level` to level+1 (null at max). */
  upgradeBase(level) {
    if (level >= this.maxShopLevel) return null;
    const arr = this.upgradePrices();
    return arr[level - 1] ?? 99;
  }

  shopSlots(level) {
    const s = this.mode.shopSlots && this.mode.shopSlots[String(level)];
    const d = DEFAULTS.shopSlots[level] || DEFAULTS.shopSlots[6];
    if (!s || typeof s !== 'object') return { ...d };
    const chess = Number.isInteger(s.chess) && s.chess >= 0 ? s.chess : d.chess;
    const item = Number.isInteger(s.item) && s.item >= 0 ? s.item : d.item;
    return { chess: Math.min(chess, 8), item: Math.min(item, 4) };
  }

  /**
   * 商店保底 (requirement 4): the 阶 the FIRST 干员槽位 of `level` must be filled from, or null when the level carries no
   * floor. `modes[modeId].shopFloor = { [level]: { tiers: [t, …] } }` — the fork's 终极模拟 carries `{5: [5], 6: [5, 6]}`,
   * so from level 5 on the first slot is always a 5 阶 (level 6: 5 阶 or 6 阶) operator, every roll. The tiers are
   * filtered to 1…maxShopLevel and the level's own ceiling, so a malformed table can never ask for an impossible tier;
   * an empty result means no floor, i.e. the official behaviour. Every official mode has no `shopFloor` at all.
   *
   * `PlayerState._rollChessSlot(floor)` draws from `tiers` with the shop rng, so the pick is deterministic per seed like
   * every other shop roll, and it stays inside the pool's remaining copies (a tier with nothing left falls through to
   * the next listed tier, then to the ordinary draw).
   * @param {number} level the 调度中心 level
   * @returns {number[] | null} the allowed tiers, or null
   */
  shopFloor(level) {
    const f = this.mode.shopFloor && this.mode.shopFloor[String(level)];
    if (!f || typeof f !== 'object' || !Array.isArray(f.tiers)) return null;
    const tiers = f.tiers.filter((t) => Number.isInteger(t) && t >= 1 && t <= this.maxShopLevel && t <= level);
    return tiers.length ? tiers : null;
  }

  /** Real-second prep timer for round r (null = untimed). */
  prepTime(r) {
    const rc = this.roundCfg(r);
    if (!rc) return this.isSolo ? null : 90;
    const v = rc.prepTime;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }

  /** The round level's `maxPlayTime` (config rounds[r].combatTimeLimit) as data gives it — REAL seconds. */
  combatTimeLimitReal(r) {
    const rc = this.roundCfg(r);
    const v = rc ? rc.combatTimeLimit : undefined;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    const m = this.mode.combatTimeLimit && this.mode.combatTimeLimit[String(r)];
    return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 60;
  }

  /**
   * Combat time limit of round r in GAME seconds (what the Battle and 联防 use): maxPlayTime × the forced battle speed
   * (config.combatTimeScale, default COMBAT_TIME_SCALE 2). `maxPlayTime` counts real seconds of the 2× battle: read
   * as game seconds, the rounds' own spawn schedules would not fit (R2 spawns its last flyer at 43 s of a 45 s limit,
   * R3 at 62 s of 55 s — enemies that can never be killed, or never spawn), while × 2 every limit is ≈ the last spawn +
   * one flyer crossing (R2 43 + 44 ≈ 90, R3 62 + 44 ≈ 110, R5 38 + 67 ≈ 110). docs/BALANCE.md §2.1.
   */
  combatTimeLimit(r) {
    return this.combatTimeLimitReal(r) * this.combatTimeScale;
  }

  /** Game seconds per real second of a battle (config.combatTimeScale, default COMBAT_TIME_SCALE 2). */
  get combatTimeScale() {
    const k = numOr(this.config.combatTimeScale, COMBAT_TIME_SCALE);
    return k > 0 ? k : COMBAT_TIME_SCALE;
  }

  /**
   * The boss round level's `maxPlayTime` (config rounds[r].levelMaxPlayTime, 120) in REAL seconds — the countdown of
   * the Final Assault / Hidden Core. It is not a hard stop there ("计时结束后战斗仍然会继续", research 01 §10); null
   * when the data has none.
   */
  bossLevelTime(r) {
    const rc = this.roundCfg(r);
    const v = rc ? rc.levelMaxPlayTime : undefined;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }

  /**
   * Official enemy multipliers of round r (config enemyScale: the PRTS table + 终极 speed ×1.15 from R3). `supplyHpMul`
   * (only when ≠ 1: co-op 终极 R5–R15) = the share of hpMul from 补给线 / 补给线II (config `supplyHp`), effects whose
   * `enemy_exclude` leaves out the 14 器物 hit-count keys — they take hpMul / supplyHpMul (archetypes.js `times`).
   */
  baseEnemyScale(r) {
    const e = this.mode.enemyScale && this.mode.enemyScale[String(r)];
    if (!e || typeof e !== 'object') return { hpMul: 1, atkMul: 1, speedMul: 1 };
    const supply = numOr(e.supplyHp, 1);
    return {
      hpMul: Math.max(0.01, numOr(e.hp, 1)),
      atkMul: Math.max(0, numOr(e.atk, 1)),
      speedMul: Math.max(0.01, numOr(e.speed, 1)),
      ...(supply > 0 && supply !== 1 ? { supplyHpMul: supply } : {}),
    };
  }

  /**
   * Enemy multipliers of round r = the official table (baseEnemyScale) with the 房主配置「对局选项」folded in
   * (`enemyBuff`, HOST_ENEMY_KEYS `enemyHp` / `enemyAtk`).
   *
   * Folding them HERE is what makes the buffs apply to EVERY enemy of every mode in one place: this getter is read by
   * `waves.js` for ordinary spawns, 部位 and bounty adds, by `finalAssault.bossPoolHp` for the shared leader / hidden-core
   * pool, by `match/bossRounds.js` as the battle's `flags.enemyScale` (the leaders' mid-fight summons read it in
   * `sim/content/bosses.js summonMods`) and by the client, which builds its own spec from the same numbers.
   *
   * With no buff (`enemyBuff` null) this returns the same fresh object it returned before the option existed, so an
   * unbuffed match is byte-identical. DEF / RES are NOT here — the round table has no place for them, and they reach a
   * spawn through `waves.js roundMods` (`enemyBuffDefRes`).
   */
  enemyScale(r) {
    const s = this.baseEnemyScale(r);
    const b = this.enemyBuff;
    if (!b) return s;
    return { ...s, hpMul: s.hpMul * b.hp, atkMul: s.atkMul * b.atk };
  }

  /** The 房主配置「对局选项」DEF / RES multipliers for `waves.js roundMods`, or null when neither is buffed. */
  get enemyBuffDefRes() {
    const b = this.enemyBuff;
    if (!b || (b.def === 1 && b.res === 1)) return null;
    return { defMul: b.def, resMul: b.res };
  }

  /**
   * The MODE's own enemy adjustments (`modes[modeId].enemyAdjust`), or null — a fork-only extension of the official
   * table, so the official modes keep their numbers exactly. Shape:
   * `{ fromRound, normal: { hp }, leader: { hp, def, atk }, hidden: { hp, def, atk } }`, every value a multiplier
   * (1.2 = +20 %); a missing field means 1.
   */
  get enemyAdjust() {
    const a = this.mode.enemyAdjust;
    return a && typeof a === 'object' && !Array.isArray(a) ? a : null;
  }

  /** Whether the mode's round-based enemy adjustment applies in round r (round ≥ fromRound; fromRound defaults to 1). */
  enemyAdjustActive(r) {
    const a = this.enemyAdjust;
    if (!a) return false;
    const from = Number.isInteger(a.fromRound) && a.fromRound > 0 ? a.fromRound : 1;
    return (Number(r) || 0) >= from;
  }

  /** One adjustment class's multiplier for `key`, or 1 (also for a malformed entry). */
  _adjMul(cls, key) {
    return cls && Number.isFinite(cls[key]) && cls[key] > 0 ? cls[key] : 1;
  }

  /**
   * The spawn multipliers of round r that sit ON TOP of the official table, by spawn class:
   *   * `normalHp` — every ordinary spawn (leader escorts, bounty adds …), but never a 部位/part (`isPart`) and never
   *     the leader itself, whose HP is the shared pool;
   *   * `bossAtk` / `bossDef` — the leader (最终攻势) or the hidden core (隐秘核心), whichever round r is.
   * All three are 1 when the mode has no adjustment or r is before `fromRound`.
   */
  enemyExtras(r) {
    const one = { normalHp: 1, bossAtk: 1, bossDef: 1 };
    if (!this.enemyAdjustActive(r)) return one;
    const a = this.enemyAdjust;
    const kind = Number(r) === this.hiddenRound ? a.hidden : a.leader;
    return {
      normalHp: this._adjMul(a.normal, 'hp'),
      bossAtk: this._adjMul(kind, 'atk'),
      bossDef: this._adjMul(kind, 'def'),
    };
  }

  /**
   * HP multiplier of ONE boss's shared pool (the fork's 二.3 "领袖和隐秘核心分开计算"): a hidden core is a boss id
   * listed in `mode.hiddenBossWeights` (boss_8 … boss_10), anything else is a Final Assault leader. Its own
   * `bloodPoint[difficulty]` is multiplied by that class's factor — never one blanket multiplier over the pool, so a
   * change to the leader's number can never move the hidden core's (and vice versa).
   * @param {string} bossId
   * @returns {number} 1 without an adjustment (every official mode)
   */
  bossHpExtra(bossId) {
    const a = this.enemyAdjust;
    if (!a || typeof bossId !== 'string') return 1;
    // the boss rounds are always inside the adjustment window when one exists; gate anyway so `fromRound` is honoured
    if (!this.enemyAdjustActive(this.bossRound) && !this.enemyAdjustActive(this.hiddenRound)) return 1;
    const hw = this.mode.hiddenBossWeights;
    const hidden = !!(hw && typeof hw === 'object' && Object.hasOwn(hw, bossId));
    return this._adjMul(hidden ? a.hidden : a.leader, 'hp');
  }

  /** The mode's 机变 rules (`modes[modeId].spDraft`; fork 二.4), or null. */
  get spDraft() {
    const d = this.mode.spDraft;
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  }

  /**
   * The mode's 机变 draft rules, normalised: `{ untimed, parallel, randomFamilies }` — all off (and
   * `randomFamilies` null, i.e. no vote button) without an `spDraft` block, so every official mode is unchanged.
   * `randomFamilies` is the allow-list of card families the random allocation may hand out; a 悬赏 card is never
   * eligible even when listed (`Match.randomChoiceEligible`).
   *
   * THE MOD 开关 DECIDE, THEY DO NOT MERELY WIDEN (owner's bug report of 2026-10-13: 「无论开启还是关闭，在所有模式里机变阶段
   * 都是不限时的，开关没有生效」 and 「该 mod 功能在六人模式里无论开启还是关闭都不生效」). `spDraft` was 二.4's hard-coded
   * property of 终极模拟, and this getter used to OR it into the switch's answer
   * (`this.mods.untimedSp || d.untimed === true`, and `fams` preferred over the switch's list), so a switch could
   * only ever turn a rule ON — turning it OFF left the mode's own value in place and the control looked dead.
   * The mode's block is now the DEFAULT the switch overrides:
   *
   *   * `untimedSp` 机变不限时间 — on: no mode's 机变 runs on a clock. Off: the mode's own `untimed` decides, so
   *     终极模拟 keeps the untimed draft 二.4 gave it while every mode that never asked for one is timed again.
   *   * `randomSpVote` 机变随机分配 — on: the vote is offered everywhere, with the mode's own list when it has one
   *     and `MOD_RANDOM_SP_FAMILIES` otherwise. Off: only a mode that lists its own `randomVote.families` offers it,
   *     so 终极模拟 keeps 二.4's vote and every other mode offers nothing.
   *
   * `parallel` stays the mode's alone: no switch changes the turn order (三.4 restored it deliberately).
   */
  get spDraftRules() {
    const d = this.spDraft;
    const vote = d && d.randomVote && typeof d.randomVote === 'object' && !Array.isArray(d.randomVote) ? d.randomVote : null;
    const fams = vote && Array.isArray(vote.families) ? vote.families.filter((f) => typeof f === 'string') : [];
    const modeFamilies = fams.length ? fams : null;
    // on: the mode's own list, else the switch's default; off: only the mode's own list
    const randomFamilies = this.mods.randomSpVote ? (modeFamilies ?? [...MOD_RANDOM_SP_FAMILIES]) : modeFamilies;
    // on: untimed everywhere; off: whatever the mode asked for (no `spDraft` block ⇒ timed)
    const untimed = this.mods.untimedSp ? true : d != null && d.untimed === true;
    return { untimed, parallel: d != null && d.parallel === true, randomFamilies };
  }

  timer(key) {
    const t = this.config.timers && this.config.timers[key];
    return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : DEFAULTS.timers[key] ?? 10;
  }

  get lpCapPerRound() { return posIntOr(this.config.lpCapPerRound, DEFAULTS.lpCapPerRound); }
  /**
   * Boss overtime (`bossTurnHpReduceTime` 150 / 1 LP per second): a server turn timer of turnInfoDataDict like
   * prepPhaseTime, so REAL seconds on the same clock as the boss level's 120 s maxPlayTime (combat limits are real
   * seconds, docs/BALANCE.md §2.1) — the level countdown runs out first, the battle continues, and the merged team LP
   * drains 1 per real second from the 150 s mark (research 01 §10, 06 §11.7). Read as game seconds the drain would
   * start at 75 real s (45 s before the countdown ends) at 2 LP per real second.
   */
  get bossOvertimeAfterReal() { return Math.max(0, numOr(this.config.bossOvertimeAfter, DEFAULTS.bossOvertimeAfter)); }
  /** Team LP drained per REAL second of overtime. */
  get bossOvertimeDrainReal() { return Math.max(0, numOr(this.config.bossOvertimeDrainPerSec, DEFAULTS.bossOvertimeDrainPerSec)); }
  /** Overtime start in GAME seconds of a boss field clock (150 real s × the forced 2× = 300). */
  get bossOvertimeAfter() { return this.bossOvertimeAfterReal * this.combatTimeScale; }
  /** Team LP drained per GAME second of overtime (1 per real second = 0.5 per game second). */
  get bossOvertimeDrain() { return this.bossOvertimeDrainReal / this.combatTimeScale; }
  /**
   * Team LP the overtime drain has taken when a boss field clock reads `gt` game seconds: bossOvertimeDrainReal per
   * whole REAL second past bossOvertimeAfterReal (the first point at 151 real s).
   */
  bossOvertimeDue(gt, afterReal = this.bossOvertimeAfterReal) {
    const over = (Number(gt) || 0) / this.combatTimeScale - afterReal;
    return over >= 1 ? Math.floor(over) * this.bossOvertimeDrainReal : 0;
  }
  get dp() {
    const d = this.config.dp && typeof this.config.dp === 'object' ? this.config.dp : {};
    return { dpInit: numOr(d.init, 10), dpPerSec: numOr(d.perSec, 1), dpMax: numOr(d.max, 99) };
  }
  get unite() {
    const u = this.config.unite && typeof this.config.unite === 'object' ? this.config.unite : {};
    return {
      maxHelpers: posIntOr(u.maxHelpers, DEFAULTS.unite.maxHelpers),
      templates: u.templates && typeof u.templates === 'object' ? u.templates : DEFAULTS.unite.templates,
    };
  }
  get hiddenCore() {
    const h = this.config.hiddenCore && typeof this.config.hiddenCore === 'object' ? this.config.hiddenCore : {};
    return {
      single: numOr(h.single, DEFAULTS.hiddenCore.single),
      multi: numOr(h.multi, DEFAULTS.hiddenCore.multi),
      minTeamLpExclusive: numOr(h.minTeamLpExclusive, DEFAULTS.hiddenCore.minTeamLpExclusive),
      difficulties: Array.isArray(h.difficulties) ? h.difficulties : DEFAULTS.hiddenCore.difficulties,
    };
  }
  /**
   * Per-match ban counts of a difficulty: how many core / add-on bonds the seeded draw removes from play
   * (server/match/pool.js drawDisabledBonds). `config.bans` is difficulty-keyed, but a MODE may carry a table of its
   * own (`modes[modeId].bans`, the fork's 终极模拟 = `{ core: 0, addon: 0 }` — "此模式下所有盟约不会被禁用"), which
   * wins when present so a fork mode can switch the draw off without disturbing its difficulty's official numbers.
   * A mode table that leaves a field out means 0, never the difficulty's default.
   *
   * Mod 开关 `noBondBan` 关闭盟约禁用 overrides everything with `{ core: 0, addon: 0 }`: no 盟约 is drawn out of play in
   * ANY mode, which is the switch's whole point. The mode's static list is emptied with it (modeInactiveBonds).
   */
  /**
   * The fallback bond (协防干员, `config.economy.fallbackBondId`) — the bond a chess with no bond of its own falls back
   * to (server/match/pool.js forgeImport, records.js). ★ It is a CONTAINER-SIDE default, not a 盟约 the match ever
   * draws: the seeded ban draw must never remove it (server/match/player/diy.js:24 states the rule in so many words
   * — 「协防 (emptyShip) is never banned, so a prototype always stays」), because every 自选 prototype carries exactly
   * this bond, and banning it would wipe the whole DIY stock in one go (measured before this fix: emptyShip came up
   * in 670 of 2000 seeds, and each of those matches lost all ten prototype slots).
   * `null` when the config names no such bond.
   */
  get fallbackBondId() {
    const id = this.config.economy && this.config.economy.fallbackBondId;
    return typeof id === 'string' && this.bond(id) ? id : null;
  }
  bans(difficulty) {
    if (this.mods.noBondBan) return { core: 0, addon: 0 };
    const own = this.mode && typeof this.mode.bans === 'object' && this.mode.bans !== null && !Array.isArray(this.mode.bans) ? this.mode.bans : null;
    const b = own || (this.config.bans && this.config.bans[difficulty]);
    const d = own ? { core: 0, addon: 0 } : (DEFAULTS.bans[difficulty] || { core: 0, addon: 0 });
    if (!b || typeof b !== 'object') return { ...d };
    return { core: Number.isInteger(b.core) && b.core >= 0 ? b.core : d.core, addon: Number.isInteger(b.addon) && b.addon >= 0 ? b.addon : d.addon };
  }
  get bandDraft() {
    const b = this.config.bandDraft && typeof this.config.bandDraft === 'object' ? this.config.bandDraft : {};
    return {
      skipsPerPlayer: Number.isInteger(b.skipsPerPlayer) && b.skipsPerPlayer >= 0 ? b.skipsPerPlayer : DEFAULTS.bandDraft.skipsPerPlayer,
      timeoutBandId: typeof b.timeoutBandId === 'string' && this.band(b.timeoutBandId) ? b.timeoutBandId : this.defaultBandId,
    };
  }

  /** Bosses weights for the boss round / hidden round. */
  bossWeights(hidden = false) {
    const w = hidden ? this.mode.hiddenBossWeights : this.mode.bossWeights;
    return w && typeof w === 'object' ? Object.entries(w).filter(([id, v]) => this.boss(id) && Number(v) > 0) : [];
  }

  /** Band usable in this mode type. */
  bandAllowed(bandId) {
    const b = this.band(bandId);
    if (!b) return false;
    const list = Array.isArray(b.modeTypeList) ? b.modeTypeList : null;
    if (!list) return true;
    return list.includes(this.isSolo ? 'SINGLE' : 'MULTI');
  }

  bandIds() {
    const bands = this.raw.bands && typeof this.raw.bands === 'object' ? this.raw.bands : {};
    return Object.keys(bands).filter((id) => this.bandAllowed(id)).sort((a, b) => numOr(bands[a].sortId, 99) - numOr(bands[b].sortId, 99) || (a < b ? -1 : 1));
  }

  startLp(bandId) {
    const b = this.band(bandId);
    return b && Number.isInteger(b.totalHp) && b.totalHp > 0 ? b.totalHp : this.defaultStartLp;
  }

  /**
   * The bonds a strategy's mechanic is built around (DESIGN §21.26): bands.json `bondIds`, written at build time by
   * shared/bandBonds.js from the band's own text and blackboards (潘格尼尼 → 拉特兰, 克莱门莎 → 阿戈尔, 玛恩纳 → 卡西米尔 …) —
   * the field the strategy draft's 本局禁用 mark reads too. Known bond ids in data order; [] for an unknown band, one tied to
   * no bond (华法琳, 阿米娅 …) or data without the field. The bot never picks a strategy tied to a bond the mode switches
   * off (bot.js botPickBand).
   * @param {string} bandId
   * @returns {string[]}
   */
  bandBondIds(bandId) {
    if (this._bandBonds.has(bandId)) return this._bandBonds.get(bandId);
    const listed = this.band(bandId)?.bondIds;
    const set = new Set(Array.isArray(listed) ? listed : []);
    const out = Object.freeze(this.bondIds.filter((id) => set.has(id)));
    this._bandBonds.set(bandId, out);
    return out;
  }

  /**
   * Placeable (hand) tokens a chess sends to the hand when placed on the board: [{ tokenId, count }] — its manually
   * deployable summons (tokens.json `placeable`: 医疗探机, 诅咒娃娃, 海嗣, 狼群, 流形, 爬行号·防护单元; user playtest #6)
   * that the chess makes under `loadout` ({ skillIndex } from shared/protocol.js resolveLoadout; absent ⇒ its default
   * skill): the owner variant's `sources` (`bySkill[skillIndex]` for a non-default skill) name a talent or a skill —
   * 赫默 / 巫恋 on S1 make no drone / doll. `count` = the summon's deploy limit (PRTS 卫戍协议/帮助 "根据召唤物部署数量
   * 上限（非初始持有量），发送等量召唤物至手牌区": 凯瑟琳 2 of her 3 devices).
   */
  placeableTokens(chessId, loadout = null) {
    const c = this.chess(chessId);
    if (!c || !Array.isArray(c.tokens)) return [];
    const out = [];
    for (const tid of c.tokens) {
      const t = this.token(tid);
      if (!t || t.kind !== 'summon' || t.placeable !== true) continue;
      const vs = t.variants && typeof t.variants === 'object' ? t.variants : {};
      const v = vs[chessId] ?? vs[String(chessId).replace(/_b$/, '_a')] ?? null;
      if (v) {
        const alt = loadout && Number.isInteger(loadout.skillIndex) && v.bySkill ? v.bySkill[loadout.skillIndex] : null;
        const src = Array.isArray(alt?.sources) ? alt.sources : Array.isArray(v.sources) ? v.sources : [];
        if (!src.includes('talent') && !src.includes('skill')) continue;
      }
      const count = posIntOr(v?.stats?.deployLimit, posIntOr(t.deployLimit, 1));
      out.push({ tokenId: tid, count: Math.min(count, 9) });
    }
    return out;
  }
}
