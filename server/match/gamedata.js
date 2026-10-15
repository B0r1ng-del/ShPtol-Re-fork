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
import { standInRecord } from '../../shared/standIn.js';
import { normalizeMods, MOD_RANDOM_SP_FAMILIES, MOD_EXTRA_ROUNDS, layerCapFor } from '../../shared/constants.js';
import { filterRawData, effectiveBonds } from '../../shared/packData.js';

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

export class GameData {
  /**
   * @param {Readonly<Record<string, any>>} data server/data.js getData() (may be partial)
   * @param {string} modeId e.g. 'mode_multi_hard'
   * @param {any} [mods] Mod 开关 (shared/constants.js MOD_KEYS, `room.create.mods`): the per-device gameplay switches the
   *   room creator carried in. Normalised here so an unknown / malformed value is the official default, and read by
   *   `modeInactiveBonds`, `bans()` and `spDraftRules` — the three rule seams the switches change. Absent = all off =
   *   the official mode, byte-identical to before (the golden scenarios, the tools and every test pass nothing).
   */
  constructor(data, modeId, mods) {
    /** Mod 开关 of this match (MOD_KEYS, all off by default). @type {Record<string, boolean>} */
    this.mods = normalizeMods(mods);
    // 内容包开关: the ported packs' records are dropped HERE, once, so every accessor below — the shop pool, the reels,
    // the 盟约 lists, the detail cards, the client-result bounds — sees only what this room actually contains. With
    // every pack off (the default, every golden scenario, every test) `filterRawData` returns `data` itself and this
    // constructor reads exactly what it read before the packs existed.
    this.raw = filterRawData(this.mods, data && typeof data === 'object' ? data : {});
    this.config = getConfig(this.raw) || {};
    this.modeId = modeId;
    this.mode = getMode(modeId, this.raw) || {};
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
     * 维式重锤 and 突变细胞 are never sold). Every "shop item" draw uses it: the shop item slot (pool.js), the 道具补给 /
     * 机密商店 cards (choices.js) and the shop-eligible item pools (Match.rollItemId).
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
    return Math.max(1, Math.round(base * this.bossPoolShare(aliveCount) * this.bossHpExtra(bossId)));
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
  wave(id) { return own(this.raw.waves, id); }
  stage(id) { return own(this.raw.stages, id); }
  boss(id) { return own(this.raw.bosses, id); }
  token(id) { return own(this.raw.tokens, id); }
  get choices() { return this.raw.choices && typeof this.raw.choices === 'object' ? this.raw.choices : {}; }
  get factions() { return this.raw.factions && typeof this.raw.factions === 'object' ? this.raw.factions : {}; }

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
    if (c && Number.isFinite(c.price) && c.price >= 0) return c.price;
    const tier = this.tierOf(id);
    const row = this.economy.chessPrice && this.economy.chessPrice[tier];
    const golden = c && c.isGolden;
    if (row && typeof row === 'object') return numOr(golden ? row.golden : row.normal, DEFAULTS.chessPrice[tier] ?? 3);
    return DEFAULTS.chessPrice[tier] ?? 3;
  }

  sellPrice(id) {
    const c = this.chess(id);
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
  get leftoverKeptBands() { return Array.isArray(this.economy.leftoverFundsKeptByBands) ? this.economy.leftoverFundsKeptByBands : DEFAULTS.leftoverFundsKeptByBands; }
  get defaultBandId() { return typeof this.economy.defaultBandId === 'string' ? this.economy.defaultBandId : DEFAULTS.defaultBandId; }
  get defaultStartLp() { return posIntOr(this.economy.defaultStartLp, DEFAULTS.defaultStartLp); }

  rewardOffer() {
    const r = this.economy.rewardOffer && typeof this.economy.rewardOffer === 'object' ? this.economy.rewardOffer : {};
    return {
      count: posIntOr(r.count, DEFAULTS.rewardOffer.count),
      tierOffset: Number.isInteger(r.tierOffset) ? r.tierOffset : DEFAULTS.rewardOffer.tierOffset,
      maxTier: posIntOr(r.maxTier, DEFAULTS.rewardOffer.maxTier),
      price: Math.max(0, numOr(r.price, 0)),
    };
  }

  /** Copies of a base chess in the shared pool. */
  poolCopies(baseId) {
    const ov = this.economy.poolCopiesOverrides;
    const tier = this.tierOf(baseId);
    const pc = this.economy.poolCopies;
    const v = ov && Number.isInteger(ov[baseId]) && ov[baseId] >= 0 ? ov[baseId] : pc?.[tier];
    const base = Number.isInteger(v) && v >= 0 ? v : (DEFAULTS.poolCopies[tier] ?? 10);
    // The measured doubled pool is shared by the whole co-op team, independent of team size. DIY is private stock.
    const multiplier = this.isSolo || this.chess(baseId)?.isDiy ? 1 : posIntOr(this.economy.coopPoolMultiplier, 1);
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

  /** Enemy multipliers of round r = the official table (baseEnemyScale; no custom multiplier). */
  enemyScale(r) {
    return this.baseEnemyScale(r);
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
