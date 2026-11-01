// 名片干员 (PR #643 split 6): the portrait on a doctor's seat card in the waiting room (screens/room.js) and on the
// strategy draft's name cards (screens/bandDraft.js) — the operator the player picked (room.card; everybody sees it as
// room.state seats[].card), else one of the 5★/6★ operators chosen by the player id, the same on every client — worn in
// the player's outfit (seatCardSkin, the maintainer's decision 4 of 2026-10-21). The rules are pure: the screen passes
// the chess records (ui/assetUrls.js chessPortraitUrl turns the operator into its portrait; without the art pack the
// card keeps its avatar frame). The pick itself lives in `cardStore` (a pref; ui/loadoutSync.js installCardSync sends it).
// [ASSUMED] The event's card shows the account's assistant (名片形象, display_meta_table avatarTypeData ASSISTANT): this
// remake has no accounts, so the pick is made on one's own seat card and kept in this browser (CARD_PREF 'room.card').
// [ASSUMED] With no pick, a 5★/6★ operator is chosen by hash32(playerId) — a remake rule, so that every card has art as in
// the event's room and every client draws the same one.

import { createStore, loadPref, savePref } from '../store.js';
import { ownerSkin } from './skins.js';
import { namecardOf } from './namecards.js';

/** 名片干员: the player's own pick (a localStorage pref, sent as room.card). */
export const CARD_PREF = 'room.card';

/** 特工工牌: a namecard id of kind 'badge' (namecards.js BADGES), '' = none. Replaces the operator portrait. */
export const BADGE_PREF = 'room.badge';

/** The store field of the pick (ui/loadoutSync.js installCardSync `key`) and its sync state field. */
export const CARD_KEY = 'card';
export const CARD_SYNC_KEY = 'cardSync';

/** A stored pick as the store holds it: a charId string, '' for none (默认). */
export function parseStoredCard(v) {
  return typeof v === 'string' ? v : '';
}

/** This browser's pick and its sync state (survives room / match resets like ui/skins.js' store). */
export const cardStore = createStore({ [CARD_KEY]: parseStoredCard(loadPref(CARD_PREF, '')), [CARD_SYNC_KEY]: 'idle' });

/**
 * Pick the 名片干员 ('' = 默认): persisted at once, the sync engine sends it.
 * @param {string} charId
 */
export function setCard(charId) {
  const next = parseStoredCard(charId);
  try { savePref(CARD_PREF, next); } catch { /* private mode: the session keeps it */ }
  // 特工工牌 replaces the portrait, so an operator pick clears it (the other half of the exclusion, setCardBadge).
  cardStore.set(next ? { [CARD_KEY]: next, badge: '' } : { [CARD_KEY]: next });
}

// ---- 名片其余字段 (名片底图 2026-11-01): 头像 / 底图 / 奖杯 / 两个外观 ---------------------------------------------
// 全部存在同一个 cardStore 里（`CARD_KEY` 仍是名片干员，其余字段各占一个 key），由 ui/loadoutSync.js 的
// installCardSync 一起作为 room.card 发出去。服务端只做范围校验，不改玩法（shared/protocol.js CARD_LIMITS）。

/** 头像: the operator whose official avatar stands for the player ('' = none: the strategy icon / the name's glyph). */
export const AVATAR_PREF = 'room.avatar';
/** The looks ('' 精二, 'e1' 精一, a skin id) of the 名片干员 and of the 头像 operator. */
export const CARD_LOOK_PREF = 'room.card.look';
export const AVATAR_LOOK_PREF = 'room.avatar.look';

const str = (v) => (typeof v === 'string' ? v : '');

/** A stored vertical position: an integer 0–100, else null. */
const storedY = (v) => (Number.isInteger(v) && v >= 0 && v <= 100 ? v : null);
const loadY = (key) => { try { return storedY(JSON.parse(loadPref(key, 'null'))); } catch { return null; } };
const saveY = (key, v) => { try { savePref(key, JSON.stringify(v)); } catch { /* private mode */ } };

// 把其余字段并进同一个 store（上面的 createStore 已建好，这里补字段）
cardStore.set({
  avatar: str(loadPref(AVATAR_PREF, '')),
  bg: str(loadPref('room.namecard', '')),
  // 特工工牌 (需求方 2026-11-01): the badge REPLACES the operator portrait on the seat card (mutually exclusive with
  // charId — the picker clears the other). The server whitelists it by shape ('badge:*'), see server/lobby.js card().
  badge: str(loadPref(BADGE_PREF, '')),
  bgY: loadY('room.namecard.y'),
  look: str(loadPref(CARD_LOOK_PREF, '')),
  avatarLook: str(loadPref(AVATAR_LOOK_PREF, '')),
});

/** @param {string} charId '' = none */
export function setCardAvatar(charId) {
  const id = str(charId);
  if (id !== cardStore.get().avatar) setAvatarLook('');
  try { savePref(AVATAR_PREF, id); } catch { /* private mode */ }
  cardStore.set({ avatar: id });
}
/** @param {string} look '' 精二 / 'e1' 精一 / a skin id of the 名片干员 */
export function setCardLook(look) {
  const v = str(look);
  try { savePref(CARD_LOOK_PREF, v); } catch { /* private mode */ }
  cardStore.set({ look: v });
}
/** @param {string} look '' / 'e1' / a skin id of the 头像 operator */
export function setAvatarLook(look) {
  const v = str(look);
  try { savePref(AVATAR_LOOK_PREF, v); } catch { /* private mode */ }
  cardStore.set({ avatarLook: v });
}
/** @param {number|null} y the background's vertical position in percent; null = the card's default */
export function setCardBackgroundY(y) {
  const v = storedY(y);
  saveY('room.namecard.y', v);
  cardStore.set({ bgY: v });
}
/**
 * 特工工牌 (需求方 2026-11-01, 「工牌顶替立绘」): pick the plate that stands in for the operator portrait.
 * Mutual exclusion with 名片干员 — a seat card shows one or the other, so picking a badge clears the charId and
 * picking a charId (setCard) clears the badge. '' = back to the operator portrait (or the default one).
 * @param {string} id a `badge:*` namecard id, '' for none
 */
export function setCardBadge(id) {
  const v = namecardOf(id)?.kind === 'badge' ? id : '';
  try { savePref(BADGE_PREF, v); } catch { /* private mode: the session keeps it */ }
  cardStore.set(v ? { badge: v, [CARD_KEY]: '' } : { badge: '' });
}

/** @param {string} bg '' = none (another background starts at its default position) */
export function setCardBackground(bg) {
  const id = namecardOf(bg) ? bg : '';
  if (id !== cardStore.get().bg) setCardBackgroundY(null);
  try { savePref('room.namecard', id); } catch { /* private mode */ }
  cardStore.set({ bg: id });
}

/**
 * The room.card message of a card: empty fields as '' (the server drops them), trophies bounded.
 * @param {any} card cardStore's state
 */
export function cardMessage(card) {
  const trophies = Number.isSafeInteger(card?.trophies) ? Math.max(0, Math.min(1_000_000, card.trophies)) : 0;
  const charId = str(card?.[CARD_KEY]), avatar = str(card?.avatar);
  const bg = namecardOf(card?.bg) ? card.bg : '';
  // A background / avatar / trophy level stands on its own (a doctor may pick a plate before an operator), so only the
  // two LOOKS depend on their own target being set.
  // 特工工牌 stands in for the operator: the server whitelists it by shape (server/lobby.js card()), and a card
  // carries at most one of charId / badge.
  const badge = namecardOf(card?.badge)?.kind === 'badge' ? card.badge : '';
  return { charId: badge ? '' : charId, avatar, bg, badge,
    bgY: bg ? storedY(card?.bgY) ?? -1 : -1, trophies,
    look: !badge && charId ? str(card?.look) : '', avatarLook: avatar ? str(card?.avatarLook) : '' };
}

/** FNV-1a of a string (the default portrait: the same operator for a player on every client). */
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * The operators a seat card can show — the server's room.card whitelist (server/lobby.js chessCharIds): one record per
 * charId of the visible, non-自选 chess records (the elite form, for its E2 art), 6★ first, then by name.
 * @param {any[]} chessList chess.json records
 * @returns {any[]}
 */
export function cardOperators(chessList) {
  const by = new Map();
  for (const c of Array.isArray(chessList) ? chessList : []) {
    if (!c || c.isDiy || c.visible === false || typeof c.charId !== 'string') continue;
    const prev = by.get(c.charId);
    if (!prev || (c.isGolden && !prev.isGolden)) by.set(c.charId, c);
  }
  return [...by.values()].sort((a, b) => ((b.rarity ?? 0) - (a.rarity ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh'));
}

/**
 * What the seat cards draw from: the pickable operators by charId and the default pool (5★/6★, by charId so every
 * client orders it the same).
 * @param {any[]} list cardOperators()
 */
export function cardContext(list) {
  return {
    byChar: new Map(list.map((c) => [c.charId, c])),
    pool: list.filter((c) => (c.rarity ?? 0) >= 5).sort((a, b) => (a.charId < b.charId ? -1 : a.charId > b.charId ? 1 : 0)),
  };
}

/**
 * The operator on a seat card: the player's pick (one's own seat shows the local pick at once, the others the server's
 * seats[].card), else one of the pool chosen by the player id [ASSUMED, see the header]. null for an empty seat, a bot,
 * or before the data loads.
 * @param {any} seat room.state seat
 * @param {{ byChar: Map<string, any>, pool: any[] }} ctx cardContext()
 * @param {{ myId?: any, myCard?: string }} [own]
 * @returns {{ chess: any, picked: boolean } | null}
 */
export function seatOperator(seat, { byChar, pool }, { myId, myCard } = {}) {
  if (!seat || seat.playerId == null || seat.isBot) return null;
  const pick = (seat.playerId === myId ? myCard : seat.card) || '';
  const rec = pick && byChar ? byChar.get(pick) : null;
  if (rec) return { chess: rec, picked: true };
  if (!Array.isArray(pool) || !pool.length) return null;
  return { chess: pool[hash32(seat.playerId) % pool.length], picked: false };
}

/**
 * The outfit a seat card's operator wears (docs/SKINS.md; the maintainer's decision 4 of 2026-10-21), by the rule of
 * every owner-aware card (ui/skins.js ownerSkin): one's own card wears this browser's choice at once (`localSkins`),
 * another doctor's the choice that seat published — `players` holds `{ playerId, skins }`: the room's seats
 * (room.state seats[].skins) or a match's public players — unless 「显示其他玩家的皮肤」 is off. null = the default art;
 * a skinId the local manifest does not hold (an appearance plugin this page lacks) also draws the default
 * (ui/assetUrls.js chessPortraitUrl falls back).
 * @param {any} seat a seat or player record (`playerId`, `isBot`)
 * @param {string | null | undefined} charId the operator the card shows (seatOperator)
 * @param {{ myId?: any, localSkins?: Record<string, string>, players?: any[], otherSkins?: boolean }} ctx
 * @returns {string | null}
 */
export function seatCardSkin(seat, charId, { myId = null, localSkins = {}, players = [], otherSkins = true } = {}) {
  if (!seat || seat.isBot || seat.playerId == null || !charId) return null;
  if (seat.playerId === myId) return ownerSkin(charId, { localSkins });
  return ownerSkin(charId, { ownerId: seat.playerId, myId, players: Array.isArray(players) ? players.filter(Boolean) : [], otherSkins });
}

/**
 * The picture a seat card draws: the first of `srcs` — the outfit's portrait, then the operator's default portrait — that
 * has not failed to load in this card (`failed`); null when none is left, and the card shows its avatar frame (§35.18's
 * leftover: an outfit file that failed went straight to the frame).
 * @param {(string | null | undefined)[]} srcs in order of preference
 * @param {readonly string[]} [failed]
 * @returns {string | null}
 */
export function seatArtSrc(srcs, failed = []) {
  for (const src of Array.isArray(srcs) ? srcs : []) if (src && !failed.includes(src)) return src;
  return null;
}
