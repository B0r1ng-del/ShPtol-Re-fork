// server/match/player/items.js — PlayerState methods: items — g.equip (max 2, a 3rd replaces the one the player picks;
// consume-on-equip items), g.art (Arts on a tile, rotated by the facing) and g.destroy (hand / temp items; equipped
// ones are locked).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { ERR } from '../../../shared/constants.js';
import { tileKey, inField, parseDir, freeSlot } from '../board.js';
import { offsetTile } from '../../sim/dir.js';
import { itemKey } from '../gamedata.js';
import { OK, fail, TEMP_SIZE } from './common.js';
// 工坊 mod 层移植 (2026-10-16): the behaviour layer's `unequip` switch (a pack may allow taking an equipped item off).
import { behaviourIsDefault } from '../../../shared/behaviour.js';
// 装备位语义（第 7 段 · 工坊 mod 层移植 2026-10-17）：策略对象来自 `shared/morph.js`（**同一格开关 `morphPairing` 的另外半条**）。
// 缺省档拿到的 `OFFICIAL_SLOT_POLICY` 是共享的冻结单例，每一个方法都逐字是引擎今天那条算术 ⇒ 下面三处的缺省路径逐字节不变。
import { matchSlotPolicy } from '../../../shared/morph.js';

/**
 * 工坊 mod 层 (behaviour `unequip`): whether a pack lets an equipped item be taken off. False for a pack that declares
 * nothing — the official rule — so a vanilla match behaves exactly as before.
 * @param {any} decl the match's behaviour declaration
 * @returns {boolean}
 */
export function unequipAllowed(decl) {
  return !behaviourIsDefault(decl, 'unequip');
}

export class PlayerItems {
  /**
   * A copy that actually leaves the match repays shared-item debt first (#624). Equipping, selling a carrier
   * (the item returns to the hand) and a merge that keeps the golden do not call this.
   * @param {any} piece
   * @returns {number} copies repaid
   */
  releaseItemStock(piece) {
    if (!piece || piece.kind !== 'item' || !this.m?.itemPool) return 0;
    return this.m.itemPool.repay(piece.id, this.m.itemPool.need(piece.id));
  }

  /**
   * g.equip {itemUid, targetUid, replaceUid?}. A third item on a carrier with both slots used replaces the equipped item
   * the player picked in the replace dialog (`replaceUid`, research 09 §1.2 UseEquipUp.unloadInstId; absent ⇒ the
   * oldest); the replaced item is destroyed. A `replaceUid` that is not one of the target's equipped items is refused.
   * A consume-on-equip item replaces the same way before it resolves (GitHub #263): the carrier keeps a free slot, and a
   * target its effect refuses (博士投影 on an elite) gets the picked item back — nothing is destroyed.
   */
  equip(itemUid, targetUid, replaceUid = null) {
    const g = this._gate(); if (g) return g;
    const iloc = this.find(itemUid);
    if (!iloc || iloc.piece.kind !== 'item' || (iloc.area !== 'hand' && iloc.area !== 'temp')) return fail(ERR.BAD_TARGET);
    const rec = this.gd.item(iloc.piece.id);
    if (!rec || rec.itemType !== 'EQUIP') return fail(ERR.BAD_TARGET, 'not equipment');
    const tloc = this.find(targetUid);
    if (!tloc || tloc.piece.kind !== 'chess' || tloc.area === 'equipped') return fail(ERR.BAD_TARGET);
    const item = iloc.piece;
    const target = tloc.piece;
    const policy = matchSlotPolicy(this.m);
    if (policy.active) {
      const row = target.items || [];
      // `plus`：变形同构体每名干员最多一件（`OFFICIAL_SLOT_POLICY.active` 为假 ⇒ 这一条在缺省档一个字都不生效）
      if (policy.isSlotless(rec) && row.some((x) => policy.isSlotless(this.gd.item(x.id)))) {
        return fail(ERR.BAD_TARGET, 'one slotless item per carrier');
      }
      // `plus`：顶替只认**真正占格**的那一件（它不占位，所以既不是可顶替的对象，也不会被第三件顶掉）
      if (replaceUid != null && !(Number.isInteger(replaceUid) && row.some((x) => x.uid === replaceUid && !policy.isSlotless(this.gd.item(x.id))))) {
        return fail(ERR.BAD_TARGET, 'replace: not a slotted item of the target');
      }
    }
    if (replaceUid != null && !(Number.isInteger(replaceUid) && (target.items || []).some((x) => x.uid === replaceUid))) return fail(ERR.BAD_TARGET, 'replace: not equipped on the target');
    const consume = typeof rec.kind === 'string' && rec.kind.startsWith('consume_on_equip');
    if (consume) {
      const key = 'item:' + itemKey(item.id);
      if (!this.m.registry.has(key)) return fail(ERR.BAD_TARGET, 'effect not available');
      // a full carrier replaces first, consumables included (PRTS 卫戍协议/帮助 "达到上限强行佩戴会改为替换装备：指定一件已佩戴
      // 装备替换为将要佩戴的装备，并销毁被指定的装备"; GitHub #263): the pick (else the oldest) comes off before the effect —
      // which so sees the carrier without it (its bonds) — and is destroyed once the effect went through, leaving the slot
      // free (the normal 博士投影 then takes it: ev.keep, so it no longer pushes the oldest item out). A refusal puts it back.
      const off = this._takeReplaced(target, replaceUid);
      const ev = { item, target, golden: !!rec.isGolden, keep: false, error: null, consumed: true };
      this.m.dispatchItem(this, item, target, 'onEquip', ev);
      if (ev.error) {
        if (off) target.items.splice(Math.min(off.idx, target.items.length), 0, off.piece);
        return fail(ERR[ev.error] ? ev.error : ERR.BAD_TARGET, typeof ev.detail === 'string' ? ev.detail : undefined);
      }
      if (off) {
        this.m.dispatchItem(this, off.piece, target, 'onDestroy', { item: off.piece, holder: target, reason: 'replace' });
        this.releaseItemStock(off.piece);
      }
      // the handler may have destroyed the target (信标) — resolve the item again
      const again = this.find(item.uid);
      if (again && again.area !== 'equipped') this._detach(again);
      if (ev.keep) {
        const holder = this.find(target.uid);
        if (holder && holder.piece.kind === 'chess') this._attach(holder.piece, item);
      }
      // !ev.keep, or the carrier is gone: the consumed item left play. A kept item is on the carrier.
      if (!this.find(item.uid)) this.releaseItemStock(item);
      this.stats.itemsEquipped++;
      this.checkItemMerges();
      this.recompute();
      return OK;
    }
    this._detach(iloc);
    if (this.completesItemMerge(item.id)) {
      // an identical normal copy is already owned (equipped somewhere): merge instead of equipping — the golden
      // item goes to the hand (research 04 §2 "copies in hand and on operators both count")
      if (this._mergeItem(item.id, item)) { this.recompute(); return OK; }
      if (!this.find(item.uid)) this.stow(item, { allowTemp: true });
    }
    this._attach(target, item, replaceUid);
    this.stats.itemsEquipped++;
    this.m.dispatchItem(this, item, target, 'onEquip', { item, target, golden: !!rec.isGolden, consumed: false });
    this.checkItemMerges();
    this.recompute();
    return OK;
  }

  /**
   * Attach an item. With both slots used the item `replaceUid` names (the player's pick) is replaced, else the oldest;
   * the replaced item is destroyed. 「满没满」与「顶掉哪一件」都走这一局的装备位策略
   * （`plus`：变形同构体不占位、也不会被顶掉）；缺省档下策略就是官方那一条，循环体与从前同一批算术。
   */
  _attach(target, item, replaceUid = null) {
    target.items = target.items || [];
    const policy = matchSlotPolicy(this.m);
    const used = () => policy.slotsUsed(target.items, (id) => this.gd.item(id));
    while (used() >= this.gd.equipPerChess) { // loop-cap: splices one item each pass
      const i = policy.replacedIndex(target.items, replaceUid, (id) => this.gd.item(id));
      const [old] = target.items.splice(i >= 0 ? i : 0, 1);
      replaceUid = null;
      this.m.dispatchItem(this, old, target, 'onDestroy', { item: old, holder: target, reason: 'replace' });
      this.releaseItemStock(old);
    }
    target.items.push(item);
  }

  /**
   * A consume-on-equip item on a full carrier: take the item `replaceUid` names (else the oldest) off `target` — not yet
   * destroyed — and return { piece, idx } (null while a slot is free). 「满」与「挑哪一件」都走这一局的装备位策略
   * （`plus`：变形同构体既不占位、也不会被挑走）；缺省档逐字是 `items.length < equipPerChess` 与「找不到 ⇒ 0」。
   */
  _takeReplaced(target, replaceUid = null) {
    target.items = target.items || [];
    const policy = matchSlotPolicy(this.m);
    if (policy.slotsUsed(target.items, (id) => this.gd.item(id)) < this.gd.equipPerChess) return null;
    const idx = policy.replacedIndex(target.items, replaceUid, (id) => this.gd.item(id));
    const [piece] = target.items.splice(idx >= 0 ? idx : 0, 1);
    return { piece, idx: idx >= 0 ? idx : 0 };
  }

  /** g.art {itemUid, row, col, dir?}: the Art's range grid is rotated by `dir` (absent ⇒ RIGHT). */
  useArt(itemUid, row, col, dir) {
    const g = this._gate(); if (g) return g;
    const d = parseDir(dir);
    if (!d) return fail(ERR.BAD_TARGET, 'bad dir');
    const loc = this.find(itemUid);
    if (!loc || loc.piece.kind !== 'item' || (loc.area !== 'hand' && loc.area !== 'temp')) return fail(ERR.BAD_TARGET);
    const rec = this.gd.item(loc.piece.id);
    if (!rec || rec.itemType !== 'MAGIC') return fail(ERR.BAD_TARGET, 'not an art');
    if (!inField(row, col)) return fail(ERR.BAD_TILE);
    if (this.round.arts >= this.gd.maxArtsPerRound) return fail(ERR.BAD_TARGET, 'art limit');
    const key = 'item:' + itemKey(loc.piece.id);
    if (!this.m.registry.has(key)) return fail(ERR.BAD_TARGET, 'effect not available');
    const grid = Array.isArray(rec.rangeGrid) && rec.rangeGrid.length ? rec.rangeGrid : [[0, 0]];
    const targets = [];
    for (const [dr, dc] of grid) {
      const [tr, tc] = offsetTile(row, col, dr, dc, d);
      const p = this.board.get(tileKey(tr, tc));
      if (p) targets.push(p);
    }
    const ev = { item: loc.piece, row, col, dir: d, targets, error: null, used: true };
    this.m.dispatchItem(this, loc.piece, null, 'onArt', ev);
    if (ev.error) return fail(ERR[ev.error] ? ev.error : ERR.BAD_TARGET, typeof ev.detail === 'string' ? ev.detail : undefined);
    if (ev.used !== false) {
      const again = this.find(itemUid);
      if (again) this._detach(again);
      this.releaseItemStock(loc.piece);
      this.round.arts++;
    }
    this.recompute();
    return OK;
  }

  /**
   * g.destroy {uid}: an item in the hand / temp (Arts included). Equipped items are locked (research 04 §2 / addendum:
   * they leave the operator only on promotion, merge or sale); replacing one is g.equip's `replaceUid`.
   */
  destroy(uid) {
    const g = this._gate(); if (g) return g;
    const loc = this.find(uid);
    if (!loc || loc.piece.kind !== 'item') return fail(ERR.BAD_TARGET, 'only items can be destroyed');
    if (loc.area === 'equipped') return fail(ERR.BAD_TARGET, 'equipped items are locked');
    this._detach(loc);
    this.releaseItemStock(loc.piece);
    this.m.dispatchItem(this, loc.piece, loc.holder || null, 'onDestroy', { item: loc.piece, holder: loc.holder || null, reason: 'player' });
    this.recompute();
    return OK;
  }

  /**
   * g.unequip {itemUid} (behaviour `unequip`, DESIGN §34.43.2 / 投稿 `79de9ff03518`): take one EQUIPPED item off its
   * operator and stow it — the hand right-to-left first, then the temporary slots. Same `_gate()` as `destroy`.
   *
   * WITH THE SWITCH OFF (the default) this is byte-for-byte `destroy`'s refusal: `BAD_TARGET` +
   * `'equipped items are locked'`, the SAME string, and nothing moves. A room that declares nothing therefore behaves
   * exactly as if this intent did not exist, and no golden scenario moves.
   *
   * ATOMICITY (the place this is easiest to get wrong): `stow(piece, { allowTemp: true })` can still return `null` when
   * both the hand and the temp row are full. The piece goes back at its ORIGINAL index and `HAND_FULL` is returned —
   * without that rollback the item would vanish into thin air. `HAND_FULL` rather than `BAD_TARGET` because "there is
   * nowhere to put it" is an independent, actionable error.
   *
   * The shared-item pool is untouched: the item only moves from an EQUIPMENT SLOT into the hand / temp, so `piece` and
   * `uid` are unchanged and `SharedItemPool.held()` still counts it. There is no "give back" here (unlike `destroy` /
   * sell, which really do remove one from the pool). Deliberately no content hook: none of the 19 `HOOKS` fits (it is
   * neither `onDestroy` nor `onEquip`) and no pack needs it today — a decision, not an omission.
   * @param {number} itemUid
   */
  unequip(itemUid) {
    const g = this._gate(); if (g) return g;
    if (!unequipAllowed(this.m && this.m.behaviour)) return fail(ERR.BAD_TARGET, 'equipped items are locked');
    const loc = this.find(itemUid);
    if (!loc || loc.piece.kind !== 'item' || loc.area !== 'equipped') return fail(ERR.BAD_TARGET, 'not equipped on an operator');
    const holder = loc.holder;
    const idx = holder && Array.isArray(holder.items) ? holder.items.findIndex((x) => x && x.uid === itemUid) : -1;
    if (!holder || idx < 0) return fail(ERR.BAD_TARGET, 'not equipped on an operator');
    // Capacity FIRST, before anything moves (DESIGN §34.43.2: 「手牌与临时整备区都满 ⇒ 整件事原子拒绝」).
    // This check is deliberately local to this intent and does NOT go through `stow`: `stow` treats the temp area as an
    // UNBOUNDED queue behind the five visible slots (pieces.js "Five visible slots are a window, not a capacity limit" —
    // that is why every other gain can never fail), so it never returns null and HAND_FULL would be unreachable. This
    // one intent's own contract is that a full hand + a full temporary row refuses the action outright, which keeps the
    // rollback below meaningful. Nothing is detached yet, so the item cannot be lost either way.
    if (freeSlot(this.hand) < 0 && !(this.temp.length <= TEMP_SIZE && freeSlot(this.temp) >= 0)) return fail(ERR.HAND_FULL);
    const [piece] = holder.items.splice(idx, 1);
    const where = this.stow(piece, { allowTemp: true });
    if (where === null) {
      holder.items.splice(idx, 0, piece);   // roll back at the ORIGINAL index: the item must not disappear
      return fail(ERR.HAND_FULL);
    }
    this.recompute();
    return OK;
  }
}
