// server/match/player/economy.js — PlayerState methods: the economy — funds, spending (onSpend), prep-side bond layer
// gains (clamped by layerGainRoom), the shop (onPrice prices, copy-weighted rolls from the shared pool plus the player's
// own 自选 stock — player/diy.js —, freeze) and its intents: g.buy, g.refresh, g.freeze, g.levelUp, g.sell.
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { ERR, PHASE, layerGainRoom } from '../../../shared/constants.js';
import { ruleOption } from '../../../shared/plugins/rules.js';
import { freeSlot } from '../board.js';
import { computeBonds } from '../bondsMeta.js';
import { OK, fail } from './common.js';
// 工坊 mod 层移植 (2026-10-16): the behaviour layer's shop bias. A pack declares `behaviour.shopBias`; with no such
// declaration `behaviourIsDefault` is true and this returns null, so a vanilla match is byte-identical.
import { behaviourIsDefault } from '../../../shared/behaviour.js';
import { bondBiasPreference } from '../pool.js';

/**
 * 工坊 mod 层 (behaviour `shopBias`): the bonds whose items the shop should favour, or null for the official roll.
 * A pack that declares no `shopBias` gets null — the shop's own pool.ts decides as before.
 * @param {any} ps
 * @returns {Set<string>|null}
 */
export function bondBiasBonds(ps) {
  if (behaviourIsDefault(ps.m.behaviour, 'shopBias')) return null;
  const active = activeBondIdsOf(ps);
  return active.size ? active : null;
}

/**
 * 这个玩家**已激活**的盟约 id（`ps.bonds[bondId].active`，由 `computeBonds` 每轮算出来），或空集。
 *
 * 为什么它单独一个函数而不是 `ps` 上的方法：`bondBiasBonds` 是本模块的自由函数，而玩家身上的盟约表就是
 * `ps.bonds` —— 读它不需要往 `PlayerState` 再挂一个方法（那会让「谁算盟约」变成两个入口）。
 * @param {any} ps
 * @returns {Set<string>}
 */
export function activeBondIdsOf(ps) {
  const out = new Set();
  const bonds = ps && ps.bonds;
  if (!bonds || typeof bonds !== 'object') return out;
  for (const [id, b] of Object.entries(bonds)) if (b && b.active) out.add(id);
  return out;
}

export class PlayerEconomy {
  /**
   * 作弊菜单 — apply one player's own cheats. Called by `Match.cheat` (g.cheat), which is the only caller and which has
   * already gated the message to PREP. Every effect is per player: `this` is the player who asked.
   *
   *   * `infiniteFunds` — while on, the player simply never runs out: `spend()` refuses nothing and `funds` is topped up
   *     on demand (see `_cheatTopUp`). Turning it OFF restores exactly the funds the player had when it was turned on
   *     (`cheatFundsSaved`), which is the owner's 「关闭后恢复为初始金币数量」 read as 「开启之前那一刻的金币数」.
   *   * `freeRefresh` (one shot) — `+CHEAT_FREE_REFRESH_STEP` free shop refreshes, the same counter a strategy's
   *     `grantFreeRefresh` bumps, so the shop bar shows it and `refresh()` consumes it like any other free refresh.
   *   * `bondLayers` (one shot) — `+CHEAT_BOND_LAYER_STEP` layers on every ACTIVE, stackable bond (`_cheatBondLayers`).
   *     Routed through `addLayers`, so the 999 ceiling, the onLayers handlers and the `m.layer` cue all still apply.
   *   * `enemyOneHp` — recorded only. The battle spec reads it (`Match._normalOpts`) and stamps `mods.hpMul` on the
   *     player's OWN normal field spawns; 联防 (`_uniteOpts`) never reads it, so the shared field is untouched.
   * @param {{ set?: Record<string, boolean>|null, freeRefresh?: boolean, bondLayers?: boolean }} msg the validated g.cheat payload
   * @returns {any} OK
   */
  cheat(msg = {}) {
    const set = msg.set && typeof msg.set === 'object' ? msg.set : null;
    if (set) {
      for (const [key, on] of Object.entries(set)) {
        if (!CHEAT_KEYS.includes(key)) continue;
        this._cheatSet(key, on === true);
      }
    }
    if (msg.freeRefresh === true) this.shop.freeRefreshes += CHEAT_FREE_REFRESH_STEP;
    if (msg.bondLayers === true) this._cheatBondLayers();
    this.dirty();
    return OK;
  }

  /**
   * 「盟约 +100」: +CHEAT_BOND_LAYER_STEP layers on every bond the player has ACTIVE and that can stack.
   *
   * 「可叠层」 is exactly `!noStack` — the four non-stackable bonds (调和, 绝技, 独行, 协防干员, data/bonds.json) have no
   * layers at all, so adding to them would be a number nothing reads. The bond set comes from `this.bonds` (what is
   * actually active for this player), never from the full bond list, so an unactivated 盟约 stays at 0.
   *
   * The gain goes through `addLayers` (not a direct `layers[]` write) so the 解除叠层上限 switch, the 999 ceiling, every
   * `onLayers` handler and the `m.layer` animation all behave exactly as for a normal gain. `recompute` must settle
   * before the next bond is read: raising 莱茵生命's layer count can change which devices are unlocked, and adding to a
   * bond a milestone pays per N layers (远见, 奇迹, 维多利亚 …) fires its own grant.
   */
  _cheatBondLayers() {
    for (const id of Object.keys(this.bonds)) {
      if (this.bonds[id]?.active !== true || this.gd.bond(id)?.noStack === true) continue;
      this.addLayers(id, CHEAT_BOND_LAYER_STEP, { reason: 'cheat' });
    }
  }

  /** Turn ONE cheat on or off, applying its own bookkeeping (see `cheat`). */
  _cheatSet(key, on) {
    if (this.cheats[key] === on) return;
    if (key === 'infiniteFunds') {
      if (on) {
        // remember what to restore; a second "on" (or a re-on while already on) must not overwrite the first save
        this.cheatFundsSaved = this.funds;
      } else if (this.cheatFundsSaved != null) {
        this.funds = this.cheatFundsSaved;
        this.cheatFundsSaved = null;
      }
    }
    this.cheats[key] = on;
  }

  /**
   * 「无限金币」 in one line: while the switch is on the player's funds never fall below `CHEAT_GOLD_FLOOR`. Every existing
   * payment path calls `spend()`, so topping up here covers buy / refresh / levelUp / reward / effect without touching
   * any of them — and nothing is invented while the switch is off.
   */
  _cheatTopUp() {
    if (this.cheats.infiniteFunds !== true) return;
    if (this.funds < CHEAT_GOLD_FLOOR) this.funds = CHEAT_GOLD_FLOOR;
  }

  addFunds(n, { reason = '' } = {}) {
    if (!Number.isFinite(n) || n === 0) return 0;
    const v = Math.trunc(n);
    const before = this.funds;
    this.funds = Math.max(0, this.funds + v);
    if (v > 0) this.stats.fundsGained += v;
    this.dirty();
    return this.funds - before;
  }

  spend(n) {
    const v = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
    this._cheatTopUp();
    if (v > this.funds) return false;
    this.funds -= v;
    this.stats.gold += v;
    this.round.spent += v;
    this.dirty();
    return true;
  }

  /** onSpend, dispatched once a payment's action is complete (buy / refresh / levelUp / reward / effect). */
  _afterSpend(amount, reason) {
    if (!(amount > 0)) return;
    this.m.dispatch(this, 'onSpend', { amount, reason, total: this.stats.gold });
  }

  /**
   * Bond layer gain (prep-side). `requireActive` = "使已激活的【X】层数+N". Returns layers added: at most the room left
   * under BOND_LAYER_CAP (999, shared/constants.js) — a gain at the cap adds 0 and dispatches nothing.
   */
  addLayers(bondId, n, { requireActive = false, reason = '' } = {}) {
    if (!this.gd.bond(bondId) || !Number.isFinite(n) || n <= 0) return 0;
    if (requireActive && !(this.bonds[bondId] && this.bonds[bondId].active)) return 0;
    const before = this.layers[bondId] || 0;
    const add = layerGainRoom(before, Math.floor(n), this.gd.layerCap);
    if (add <= 0) return 0;
    this.layers[bondId] = before + add;
    this.recompute();
    // A live prep gain, not a view delta: reconnects and combat-result backfill must not replay the cue.
    if ([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP].includes(this.m.phase)) {
      this.m.sendTo(this.playerId, { t: 'm.layer', playerId: this.playerId, bondId, add });
    }
    this.m.dispatch(this, 'onLayers', { bondId, from: before, to: before + add, reason });
    return add;
  }

  /** Effective price of a shop slot after onPrice modifiers (never negative). */
  priceOf(slot) {
    if (!slot) return 0;
    const ev = { slot, kind: slot.kind, id: slot.id, price: slot.basePrice };
    this.m.dispatch(this, 'onPrice', ev, { quiet: true });
    const p = Number(ev.price);
    return Number.isFinite(p) ? Math.max(0, Math.round(p)) : slot.basePrice;
  }

  /**
   * One 干员 card for the shop.
   *
   * `floor` is the 商店保底 of requirement 4 (GameData.shopFloor): the tiers the FIRST slot must be filled from, or null
   * for the ordinary draw. With a floor the tier is picked from `floor` with the shop rng (deterministic per seed like
   * every other roll) and the card comes from that exact tier; a listed tier with no copies left falls through to the
   * next one, and if none of them has anything the ordinary draw runs instead — a guarantee must never hand back an
   * empty slot. The 自选 pieces join either draw exactly as they do without a floor (their own shop level decides).
   * @param {number[] | null} [floor] tiers the first slot must come from, in order of preference
   */
  _rollChessSlot(floor = null) {
    // the slotted 自选 pieces join the draw once the 调度中心 reaches their slot's level (player/diy.js diyRollEntries);
    // 共享卡池 off rolls this player's own pool (PlayerState.stock)
    const extra = this.diyRollEntries();
    let id = null;
    if (Array.isArray(floor) && floor.length) {
      const tiers = this.m.rngShop.shuffle(floor.slice());
      for (const tier of tiers) {
        id = this.stock().roll(this.m.rngShop, { maxTier: this.shop.level, tier, extra });
        if (id) break;
      }
    }
    if (!id) id = this.stock().roll(this.m.rngShop, { maxTier: this.shop.level, extra });
    return id ? { kind: 'chess', id, basePrice: this.gd.chessPrice(id), frozen: false, sold: false } : null;
  }

  _rollItemSlot() {
    // startRound rolls the shop before recompute, so the cached this.bonds can be one round behind.
    // bondBias therefore calls computeBonds at the roll (no rng). The official rule passes null and
    // does not call it, so the shop's rng stays today's two draws.
    let bias = null;
    if (ruleOption(this.m?.rules, 'shopBias') === 'bondBias') {
      const bonds = computeBonds(this.gd, this);
      bias = new Set();
      for (const [id, st] of Object.entries(bonds)) if (st && st.active) bias.add(id);
    }
    const id = this.m.pool.rollItem(this.m.rngShop, this.shop.level, this.m.itemPool, bias);
    return id ? { kind: 'item', id, basePrice: this.gd.itemPrice(id), frozen: false, sold: false } : null;
  }

  /**
   * Reroll the shop. keepFrozen → frozen unsold slots survive (round start); otherwise everything is rerolled
   * (manual refresh). Slot counts follow the current level.
   */
  rollShop({ keepFrozen = false } = {}) {
    if (this._consumeTestShop()) return;
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const old = this.shop.slots;
    const layout = this.shop.layout || { chess: old.length, item: 0 };
    const oldChess = old.slice(0, layout.chess);
    const oldItems = old.slice(layout.chess);
    const keep = (s, kind) => (keepFrozen && s && s.kind === kind && !s.sold && s.frozen ? { ...s } : null);
    // frozen slots keep their position; sold / empty / unfrozen positions are rerolled.
    // 商店保底 (requirement 4): the FIRST 干员槽位 is drawn from the level's floor — and only when it is actually being
    // rerolled. A frozen first slot keeps its card, exactly as every other slot keeps its own.
    const floor = this.gd.shopFloor(this.shop.level);
    const slots = [];
    for (let i = 0; i < nChess; i++) slots.push(keep(oldChess[i], 'chess') ?? this._rollChessSlot(i === 0 ? floor : null));
    for (let i = 0; i < nItem; i++) slots.push(keep(oldItems[i], 'item') ?? this._rollItemSlot());
    this.shop.slots = slots;
    this.shop.layout = { chess: nChess, item: nItem };
    for (const s of slots) if (s) s.frozen = this.shop.frozen;
    this.dirty();
  }

  /**
   * A test match's queued next shop (g.test shop) replaces this roll once and draws no rng. Queued layouts are validated by the command; level upgrades stay blocked until the roll consumes the queue.
   * The defensive fallback handles only corrupted internal state.
   * [ASSUMED] The queue replaces frozen slots too. Absent on a normal match, so this returns false immediately.
   * @returns {boolean} true when the queue was applied
   */
  _consumeTestShop() {
    const queued = this._testShopNext;
    if (this.m.test !== true || !queued) return false;
    this._testShopNext = null;
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const ok = Array.isArray(queued) && queued.length === nChess + nItem && queued.every((s, i) => {
      const kind = i < nChess ? 'chess' : 'item';
      return !!s && s.kind === kind && (kind === 'chess' ? !!this.gd.chess(s.id) : !!this.gd.item(s.id));
    });
    if (!ok) return false;
    const slots = queued.map((s) => ({
      kind: s.kind, id: s.id,
      basePrice: s.kind === 'chess' ? this.gd.chessPrice(s.id) : this.gd.itemPrice(s.id),
      frozen: false, sold: false,
    }));
    this.shop.slots = slots;
    this.shop.layout = { chess: nChess, item: nItem };
    for (const s of slots) if (s) s.frozen = this.shop.frozen;
    this.dirty();
    return true;
  }

  /**
   * The 调度中心's upgrade opens the new level's extra slots at once — EMPTY: no card is drawn into them (a `null` slot).
   * The next roll (a manual refresh or the round start) fills them with the other unfrozen slots; the cards already shown
   * stay where they are (chess slots keep their index, the item slot stays after them). Official: the footage of a 1→2
   * upgrade (bilibili BV1AXwuzdEys 1:39, GitHub #332 / PR #333 by @2321Robin) shows the new slot appear and stay empty, and
   * the texts only name the slots — the tutorial's 休整期 page 「升级后将出现更多的商品栏位」, PRTS 帮助 「增加刷新栏位」 —,
   * never a card that comes with them. 0.2.0 drew a card into each new slot instead (item 19 of the community report of
   * 2026-10-06, 「升级商店获得新的商店位时用新卡补上，而不是空着」, one uncorroborated remark; its follow-on, that the new card
   * follows the freeze toggle, was [ASSUMED]); until then the extra slots waited for the next roll as well.
   */
  _openLevelSlots() {
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const old = this.shop.slots;
    const layout = this.shop.layout || { chess: old.length, item: 0 };
    if (nChess <= layout.chess && nItem <= layout.item) return;
    const chess = old.slice(0, layout.chess);
    const items = old.slice(layout.chess);
    const fresh = (s) => { if (s) s.frozen = this.shop.frozen; return s; };
    // fork 三.5 (owner's ruling 2026-10-12): the new 干员槽位 a level-up opens is filled at once, not left empty as
    // upstream 0.3.0's `null` slot has it. 商店保底 (requirement 4) applies on top: the level's FIRST 干员槽位 takes a
    // floored card. Reaching level 5 or 6 keeps slot 0 where it is (the slots already shown stay put), so the floor only
    // matters when the upgrade opens the shop from nothing — but the rule is stated for the first slot at that level.
    const floor = this.gd.shopFloor(this.shop.level);
    while (chess.length < nChess) chess.push(fresh(this._rollChessSlot(chess.length === 0 ? floor : null))); // loop-cap: shopSlots chess max 8
    while (items.length < nItem) items.push(fresh(this._rollItemSlot()));
    this.shop.slots = [...chess, ...items];
    this.shop.layout = { chess: chess.length, item: items.length };
  }

  /** Combat start: unfrozen slots are emptied (research 01 A1). */
  clearUnfrozenShop() {
    this.shop.slots = this.shop.slots.map((s) => (s && s.frozen && !s.sold ? s : null));
    this.dirty();
  }

  /**
   * g.buy {slot}. A full regular hand refuses every purchase, also one whose copy would complete a merge at once (PRTS
   * 卫戍协议/帮助 §手牌区 "当常规手牌区全满无空位时，玩家将无法执行使手牌溢出的操作" — "例如招募/购入等通常情况下会增加手牌的
   * 操作"; BWIKI 盟约 "当整备区达到上限后将无法进行涉及到整备区的操作（购买、撤回等）"; GitHub #82: the reporter's first-hand
   * check in the official game, "哪怕是已经有了两个相同干员情况"). Until 0.1.3 such a purchase was let through.
   */
  buy(slotIdx) {
    const g = this._gate(); if (g) return g;
    if (!Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx >= this.shop.slots.length) return fail(ERR.BAD_TARGET);
    const slot = this.shop.slots[slotIdx];
    if (!slot) return fail(ERR.BAD_TARGET);
    if (slot.sold) return fail(ERR.SOLD_OUT);
    const price = this.priceOf(slot);
    if (this.funds < price) return fail(ERR.NO_FUNDS);
    const handFull = freeSlot(this.hand) < 0;
    let piece;
    if (slot.kind === 'chess') {
      const rec = this.gd.chess(slot.id);
      // a DIY slot sells only as this player's own 自选 piece (a slotted slot's record carries `diyFor`)
      if (!rec || (rec.isDiy && !rec.diyFor)) return fail(ERR.BAD_TARGET);
      // Already displayed operators stay purchasable after stock runs out (#498; 路标月报#2,
      // BV1eLXXBqEgF 2:50–2:57: nine owned + four shop offers => thirteen owned).
      // acquireChess records every copy, including the deficit; future rolls still exclude empty stock.
      if (handFull) return fail(ERR.HAND_FULL);
      this.spend(price);
      slot.sold = true;
      piece = this.acquireChess(slot.id, { source: 'buy' });
    } else {
      if (!this.gd.item(slot.id)) return fail(ERR.BAD_TARGET);
      // Already displayed equipment stays purchasable after stock runs out (#624, maintainer 2026-10-14).
      // acquireItem records the debt. Future rolls still exclude empty stock. SOLD_OUT is only this slot, already sold.
      if (handFull) return fail(ERR.HAND_FULL);
      this.spend(price);
      slot.sold = true;
      piece = this.acquireItem(slot.id, { source: 'buy', displayed: true });
    }
    this.stats.buys++;
    this.round.buys++;
    this.m.dispatch(this, 'onBuy', { piece, slot, price, kind: slot.kind });
    this._afterSpend(price, 'buy');
    this.recompute();
    return OK;
  }

  refresh() {
    const g = this._gate(); if (g) return g;
    const free = this.shop.freeRefreshes > 0;
    const price = free ? 0 : this.gd.refreshPrice;
    if (!free && this.funds < price) return fail(ERR.NO_FUNDS);
    if (free) this.shop.freeRefreshes--;
    else this.spend(price);
    // A manual refresh cancels the freeze: the new cards are not frozen (official, the owner's play of 2026-10-14;
    // GitHub #584, DESIGN §32.14.7). A refresh that fails (funds, phase) returns above and leaves the freeze on.
    this.shop.frozen = false;
    this.rollShop({ keepFrozen: false });
    this.stats.refreshes++;
    this.round.refreshes++;
    this.m.dispatch(this, 'onRefresh', { slots: this.shop.slots, free, price });
    this._afterSpend(price, 'refresh');
    this.dirty();
    return OK;
  }

  freeze() {
    const g = this._gate(); if (g) return g;
    this.shop.frozen = !this.shop.frozen;
    for (const s of this.shop.slots) if (s && !s.sold) s.frozen = this.shop.frozen;
    this.dirty();
    return OK;
  }

  levelUp() {
    if (this.m.test === true && this._testShopNext) return fail(ERR.WRONG_PHASE);
    const g = this._gate(); if (g) return g;
    if (this.shop.level >= this.gd.maxShopLevel) return fail(ERR.MAX_LEVEL);
    const price = Math.max(0, this.shop.upgradePrice);
    if (this.funds < price) return fail(ERR.NO_FUNDS);
    this.spend(price);
    this.shop.level++;
    this.shop.upgradePrice = this.gd.upgradeBase(this.shop.level) ?? 0;
    this._openLevelSlots();
    this.m.tickerFor('SHOP_LEVEL', [this.name, String(this.shop.level)], { playerId: this.playerId, param: String(this.shop.level) });
    this.m.dispatch(this, 'onLevelUp', { level: this.shop.level, price });
    this._afterSpend(price, 'levelUp');
    this.dirty();
    return OK;
  }

  sell(uid) {
    const g = this._gate(); if (g) return g;
    const loc = this.find(uid);
    if (!loc) return fail(ERR.BAD_TARGET);
    // 房主配置 装备可售卖 (HOST_CONFIG_KEYS `itemSell`, default OFF = the official rule): an item follows 销毁's own gate
    // — hand / temp only, an equipped one is locked (PlayerItems.destroy) — and pays ITEM_SELL_PRICE instead of being
    // destroyed. Off, the old refusal stands ('items cannot be sold'). The funds go through the 销毁 path, so a trap
    // item's own onDestroy (神秘顾客) still resolves: the item leaves the same way, it just pays for it.
    if (loc.piece.kind === 'item') {
      if (!this.m.itemSell) return fail(ERR.BAD_TARGET, 'items cannot be sold');
      const res = this.destroy(uid); // its own gate: hand / temp only (an equipped item is locked)
      if (!res || !res.ok) return res;
      this.addFunds(ITEM_SELL_PRICE, { reason: 'sell' });
      this.stats.sells++;
      this.round.sells++;
      return OK;
    }
    if (loc.piece.kind !== 'chess') return fail(ERR.BAD_TARGET, 'tokens cannot be sold');
    const piece = loc.piece;
    // Returned equipment can always wait in the overflow queue, even when all fifteen visible slots are occupied.
    this._detach(loc);
    this.removeTokensOf(piece.uid);
    for (const it of piece.items || []) this.stow(it, { allowTemp: true });
    piece.items = [];
    this.returnCopies(piece);
    const ev = { piece, gain: this.gd.sellPrice(piece.id) };
    this.m.dispatch(this, 'onSold', ev);
    const gain = Number.isFinite(ev.gain) ? Math.max(0, Math.trunc(ev.gain)) : 1;
    this.addFunds(gain, { reason: 'sell' });
    this.stats.sells++;
    this.round.sells++;
    this.checkItemMerges();
    this.recompute();
    return OK;
  }
}
