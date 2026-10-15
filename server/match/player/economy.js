// server/match/player/economy.js — PlayerState methods: the economy — funds, spending (onSpend), prep-side bond layer
// gains (clamped by layerGainRoom), the shop (onPrice prices, copy-weighted rolls from the shared pool plus the player's
// own 自选 stock — player/diy.js —, freeze) and its intents: g.buy, g.refresh, g.freeze, g.levelUp, g.sell.
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { ERR, PHASE, layerGainRoom, CHEAT_KEYS, CHEAT_FREE_REFRESH_STEP, CHEAT_BOND_LAYER_STEP, CHEAT_GOLD_FLOOR, ITEM_SELL_PRICE } from '../../../shared/constants.js';
import { freeSlot } from '../board.js';
import { OK, fail } from './common.js';

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
    const id = this.m.pool.rollItem(this.m.rngShop, this.shop.level, this.m.itemPool);
    return id ? { kind: 'item', id, basePrice: this.gd.itemPrice(id), frozen: false, sold: false } : null;
  }

  /**
   * Reroll the shop. keepFrozen → frozen unsold slots survive (round start); otherwise everything is rerolled
   * (manual refresh). Slot counts follow the current level.
   */
  rollShop({ keepFrozen = false } = {}) {
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
   * The 调度中心's upgrade opens the new level's extra slots at once, each with a new card drawn at the new level; the
   * cards already shown stay where they are (chess slots keep their index, the item slot(s) stay after them).
   *
   * The owner's ruling of 2026-10-12, on a live report that the new slot looked broken: a fresh operator appears in the
   * new slot straight away. 0.2.0 drew one (item 19 of the community report of 2026-10-06, 「升级商店获得新的商店位时用新卡
   * 补上，而不是空着」); 0.2.2 §27.52 reverted that to a `null` slot on the strength of a second-hand reading of bilibili
   * BV1AXwuzdEys 1:39 (GitHub #332 / PR #333 by @2321Robin — the note itself says the frame rests on the reporter, not on
   * a watched video) and the fact that the texts only ever name the slots (the tutorial's 休整期 page 「升级后将出现更多的
   * 商品栏位」, PRTS 帮助 「增加刷新栏位」). The owner's experience wins over that: the slot is filled, and the 0.2.2 empty
   * slot is the documented deviation. [ASSUMED] the new card follows the freeze toggle, as a manual refresh's cards do.
   */
  _openLevelSlots() {
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const old = this.shop.slots;
    const layout = this.shop.layout || { chess: old.length, item: 0 };
    if (nChess <= layout.chess && nItem <= layout.item) return;
    const chess = old.slice(0, layout.chess);
    const items = old.slice(layout.chess);
    const fresh = (s) => { if (s) s.frozen = this.shop.frozen; return s; };
    // 商店保底 (requirement 4): the level's first 干员槽位 takes a floored card. Reaching level 5 or 6 keeps slot 0 where
    // it is (the slots already shown stay put), so this only matters when the upgrade opens the shop from nothing —
    // but the rule is stated for the first slot at that level, so it applies here too.
    const floor = this.gd.shopFloor(this.shop.level);
    while (chess.length < nChess) chess.push(fresh(this._rollChessSlot(chess.length === 0 ? floor : null)));
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
      if (!this.m.itemPool.canGain(slot.id)) return fail(ERR.SOLD_OUT);
      if (handFull) return fail(ERR.HAND_FULL);
      this.spend(price);
      slot.sold = true;
      piece = this.acquireItem(slot.id, { source: 'buy' });
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
    // its equipment returns to the hand (overflow temp): refuse rather than destroy it when there is no room
    // Removing the owner's summon stacks frees one slot per stack, regardless of its summon count.
    const freed = (x) => x == null || (x.kind === 'token' && x.ownerUid === piece.uid);
    const room = this.hand.filter(freed).length + this.temp.filter(freed).length + (loc.area === 'hand' || loc.area === 'temp' ? 1 : 0);
    if ((piece.items || []).length > room) return fail(ERR.HAND_FULL, 'no room for the equipment');
    this._detach(loc);
    this.removeTokensOf(piece.uid);
    for (const it of piece.items || []) {
      if (!this.stow(it, { allowTemp: true })) this.m.log.warn?.(`[match ${this.m.roomCode}] ${this.playerId}: item ${it.id} lost on sell (no space)`);
    }
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
