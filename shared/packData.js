// shared/packData.js — 内容包开关 gating for the ported content packs (shared/constants.js PACK_KEYS `packEnabled`).
//
// The ported packs add records to the fork's data files, and a record carries the pack it belongs to in its own `packId`.
// The committed data holds the ALL-PACKS-ON content — so `test/data.test.js` still checks a self-consistent data set
// (every 盟约 member lists its bond, every bond has an effect record) — and the switches STRIP what a room left off:
// with a pack's switch OFF its records are not merely unused, they are invisible, and a room created without it is the
// original content. One pure rule here, applied at both ends of the wire:
//
//   * the server filters the match's data when `GameData` is built (`filterRawData`), so every accessor — the shop
//     pool, the reels, the 盟约 lists, the detail cards, the client-result checks — sees only what the room contains;
//   * the client filters what it indexes (`public/js/data.js setPacks`), so the 干员调配 roster and every preview agree
//     with the server instead of listing a pack the host did not turn on.
//
// A pack may also contribute to a record that is NOT its own — 谬因 is an official operator, but 谬因·并入莱茵 makes her
// a member of 莱茵生命. That is `packBonds`: `{ <packKey>: [bondId, …] }` on the record, naming the contributions to
// take BACK OUT while that pack is off.
//
// Pure ESM, no Node APIs (the simulation and the browser share it), and no allocation when nothing is stripped: a room
// with every pack off (the default, every test, every golden scenario) gets the very same objects back.

import { packEnabled } from './constants.js';

/** The field a data record uses to name the pack it belongs to (`data/*.json`; absent = the original content). */
export const PACK_ID_FIELD = 'packId';
/** The field a record uses for content a pack contributes to it: `{ <packKey>: [bondId, …] }`. */
export const PACK_BONDS_FIELD = 'packBonds';
/**
 * The field a BOND uses for the chess a pack added to its member lists: `{ <packKey>: [chessId, …] }`.
 *
 * `packBonds` in reverse: a record names what a pack contributed TO it, here the record names what a pack added to its
 * own lists. Dropping a chess record does not drop what points at it, so without this a bond that outlives its ported
 * member would keep listing it and the 盟约 member list would draw a row for a piece this room does not contain.
 */
export const PACK_MEMBERS_FIELD = 'packMembers';
/**
 * The field a record uses for what a pack CHANGED on it: `{ <packKey>: { <field>: <value before the pack> } }`.
 *
 * `packBonds`/`packMembers` record what a pack ADDED to a record (a bond, a member). This records what it REPLACED —
 * 六.F's 莱茵生命 expansion re-tiers 白面鸮 and 塞雷娅 (V → III, with the status/price that implies) and swaps their
 * 特质, and the ported content is supposed to be invisible while `packRhine` is off. Without this the record keeps the
 * expansion's tier in a room that never turned the pack on, which is exactly the "off must equal the official mode"
 * guarantee. `filterFile` restores these when the pack is off.
 */
export const PACK_RESTORE_FIELD = 'packRestore';

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * `map` with every field a DISABLED pack replaced put back to the value it had before, or `map` itself when no record
 * loses anything (so an all-off room shares the original object).
 *
 * `packBonds` / `packMembers` are about LISTS a pack appended to; this is about VALUES it overwrote. 六.F's 莱茵生命
 * expansion re-tiers 白面鸮 (IV → III) and 塞雷娅 (V → III) — with the status and price that implies — and swaps their
 * 特质 for its own; it also rewrites a few item/effect descriptions and a garrison's bond list. Those are existing
 * OFFICIAL records, so dropping the pack's own records is not enough: the survivors must go back to their original
 * values or a room that never turned `packRhine` on still plays a III-cost 白面鸮.
 *
 * The pack records the originals itself (`{ packRhine: { tier: 4, price: 4, … } }`), the same way `packBonds` records
 * what it added, so this needs no cross-file knowledge. Returns the original object when there is nothing to restore.
 * @param {Record<string, boolean>|null|undefined} mods
 * @param {Record<string, any>|null|undefined} map
 */
export function withPackRestore(mods, map) {
  if (!isPlain(map)) return map;
  let out = null;
  for (const [id, rec] of Object.entries(map)) {
    if (!isPlain(rec) || !isPlain(rec[PACK_RESTORE_FIELD])) continue;
    let next = null;
    for (const [key, fields] of Object.entries(rec[PACK_RESTORE_FIELD])) {
      if (packEnabled(mods, key) || !isPlain(fields)) continue;
      // A fresh map on first use: deleting from `rec`'s own object would mutate the input.
      if (!next) next = { ...rec, [PACK_RESTORE_FIELD]: { ...rec[PACK_RESTORE_FIELD] } };
      for (const [field, value] of Object.entries(fields)) next[field] = value;
      // The pack's own bookkeeping leaves with it: a room that never turned the switch on carries no trace of it.
      delete next[PACK_RESTORE_FIELD][key];
    }
    if (next) {
      if (!Object.keys(next[PACK_RESTORE_FIELD]).length) delete next[PACK_RESTORE_FIELD];
      if (!out) out = { ...map };
      out[id] = next;
    }
  }
  return out ?? map;
}

/** Whether a data record may be used under these switches. A record with no pack is always available. */
export const recordAvailable = (mods, rec) => !isPlain(rec) || packEnabled(mods, rec[PACK_ID_FIELD]);

/**
 * `map` without the records of the packs these switches leave off, or `map` itself when nothing was dropped (so the
 * common all-off room shares the original object).
 * @param {Record<string, boolean>|null|undefined} mods
 * @param {Record<string, any>|null|undefined} map
 */
export function filterRecords(mods, map) {
  if (!isPlain(map)) return map;
  let out = null;
  for (const [id, rec] of Object.entries(map)) {
    if (recordAvailable(mods, rec)) continue;
    if (!out) out = { ...map };
    delete out[id];
  }
  return out ?? map;
}

/**
 * The bonds of a record under these switches: its own `bonds` minus what every DISABLED pack contributed through
 * `packBonds` (`{ packRhine: ['rhineShip'] }` = 谬因 is a 莱茵生命 member only while that pack is on). Never mutates
 * its input and returns the original array when there is nothing to take out, so an unmodded match is byte-identical.
 * @param {Record<string, boolean>|null|undefined} mods
 * @param {any} rec
 */
export function effectiveBonds(mods, rec) {
  const own = isPlain(rec) && Array.isArray(rec.bonds) ? rec.bonds : null;
  const extra = isPlain(rec) && isPlain(rec[PACK_BONDS_FIELD]) ? rec[PACK_BONDS_FIELD] : null;
  if (!own || !own.length || !extra) return own || [];
  let drop = null;
  for (const [key, ids] of Object.entries(extra)) {
    if (packEnabled(mods, key) || !Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id !== 'string' || !own.includes(id)) continue;
      (drop ||= new Set()).add(id);
    }
  }
  if (!drop) return own;
  return own.filter((id) => !drop.has(id));
}

/** The fields a bond record names its chess members in (tools/build-data.mjs buildBonds `members` / `visibleMembers`). */
const MEMBER_FIELDS = Object.freeze(['members', 'visibleMembers']);

/**
 * `map` with every member list cleared of the chess a DISABLED pack added to it, or `map` itself when nothing is
 * removed (so an all-off room shares the original object, not one copied record).
 *
 * `packBonds` (= what a pack contributed TO a record) is the other direction of the same idea; this is what a pack added
 * INSIDE a record of its own. A bond's `members` / `visibleMembers` name chess ids, and a dropped chess record does not
 * drop what points at it: a pack's operator leaves `chess.json`, but a bond that outlives it — an official 盟约 the
 * ported operator joins — would keep listing it, and the 盟约 member list would draw a row for a piece this room does
 * not contain. The switch makes a pack's content invisible; it must not leave a phantom in a list.
 *
 * The record names its own additions, so this needs no cross-file knowledge and no reference validation (that is
 * `test/data.test.js`'s job, against the committed all-packs-on data).
 * @param {Record<string, boolean>|null|undefined} mods
 * @param {Record<string, any>|null|undefined} map
 */
export function withPackMembers(mods, map) {
  if (!isPlain(map)) return map;
  let out = null;
  for (const [id, rec] of Object.entries(map)) {
    if (!isPlain(rec) || !isPlain(rec[PACK_MEMBERS_FIELD])) continue;
    let next = null;
    // Which packs contributed to this record is itself pack bookkeeping: while a pack is off its entry leaves with it,
    // so the stripped record carries no trace of a switch the room never turned on.
    const contributions = Object.entries(rec[PACK_MEMBERS_FIELD]).filter(([key]) => packEnabled(mods, key));
    if (contributions.length !== Object.keys(rec[PACK_MEMBERS_FIELD]).length) {
      next = { ...rec, [PACK_MEMBERS_FIELD]: Object.fromEntries(contributions) };
      if (!contributions.length) delete next[PACK_MEMBERS_FIELD];
    }
    for (const field of MEMBER_FIELDS) {
      const list = rec[field];
      if (!Array.isArray(list) || !list.length) continue;
      const drop = new Set();
      for (const [key, ids] of Object.entries(rec[PACK_MEMBERS_FIELD])) {
        if (packEnabled(mods, key) || !Array.isArray(ids)) continue;
        for (const x of ids) if (typeof x === 'string') drop.add(x);
      }
      const trimmed = drop.size ? list.filter((m) => !drop.has(m)) : list;
      if (trimmed.length === list.length) continue;
      if (!next) next = { ...rec };
      next[field] = trimmed;
    }
    if (next) { if (!out) out = { ...map }; out[id] = next; }
  }
  return out ?? map;
}

/**
 * One data FILE of `data/*.json` without the content the switches leave off. `backups.json` is the only file whose
 * records are nested (its `units` are 补位 bodies and its `diy.operators` are 自选 picks, and a pack may make one of
 * those EXISTING operators join a new 盟约 through `packBonds`); every other file is an id → record map.
 *
 * Returns `json` itself when nothing is dropped, so the all-off room (the default, every test, every golden scenario)
 * holds the very same object.
 * @param {Record<string, boolean>|null|undefined} mods
 * @param {string} name the file's data name ('chess', 'bonds', …, or a path-less basename)
 * @param {any} json
 */
export function filterFile(mods, name, json) {
  if (!isPlain(json)) return json;
  if (name !== 'backups') {
    // chess / items / bonds / … : drop the packs' own records, then put back any VALUE a disabled pack replaced
    // (packRestore — 六.F's re-tiered 白面鸮 / 塞雷娅), and only THEN take back what a disabled pack contributed to the
    // survivors (packBonds) and clear its additions out of their lists (packMembers). Restore must come first: the
    // value it puts back is the all-packs-on one, so a `rhineShip` inside it still has to be stripped afterwards.
    const kept = withPackRestore(mods, filterRecords(mods, json));
    return withPackMembers(mods, withPackBonds(mods, kept));
  }
  const units = withPackBonds(mods, filterRecords(mods, json.units));
  const diy = json.diy;
  const operators = diy && isPlain(diy.operators) ? withPackBonds(mods, filterRecords(mods, diy.operators)) : null;
  if (units === json.units && operators === diy?.operators) return json;
  return { ...json, units, ...(operators ? { diy: { ...diy, operators } } : {}) };
}

/**
 * `map` with each record's `bonds` replaced by `effectiveBonds` where a DISABLED pack contributed one, or `map` itself
 * when no record loses anything (so an all-off room shares the original object and does not copy a single record).
 * @param {Record<string, boolean>|null|undefined} mods
 * @param {Record<string, any>|null|undefined} map
 */
export function withPackBonds(mods, map) {
  if (!isPlain(map)) return map;
  let out = null;
  for (const [id, rec] of Object.entries(map)) {
    if (!isPlain(rec) || !isPlain(rec[PACK_BONDS_FIELD])) continue;
    const bonds = effectiveBonds(mods, rec);
    if (bonds === rec.bonds) continue;
    if (!out) out = { ...map };
    out[id] = { ...rec, bonds };
  }
  return out ?? map;
}

/**
 * A whole loaded data set (`{ chess, bonds, …, backups }`) without the content the switches leave off — what the server
 * builds `GameData` from; the client calls `filterFile` per file instead.
 * @param {Record<string, boolean>|null|undefined} mods
 * @param {Record<string, any>|null|undefined} data
 */
export function filterRawData(mods, data) {
  if (!isPlain(data)) return data;
  let out = null;
  for (const [name, json] of Object.entries(data)) {
    const filtered = filterFile(mods, name, json);
    if (filtered === json) continue;
    if (!out) out = { ...data };
    out[name] = filtered;
  }
  return out ?? data;
}

