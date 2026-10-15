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

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

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
 * `packBonds` (`{ packAphris: ['rhineShip'] }` = 谬因 is a 莱茵生命 member only while that pack is on). Never mutates
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
    // chess / items / … : drop the packs' own records, then take back what a disabled pack contributed to the survivors.
    const kept = filterRecords(mods, json);
    return withPackBonds(mods, kept);
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

