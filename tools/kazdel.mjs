// tools/kazdel.mjs — 卡兹戴尔扩展的数据层（内容包 `packKazdel`，默认关闭）。
//
// WHY THIS FILE EXISTS. The 卡兹戴尔 expansion adds records to `data/*.json` — 12 棋手 (`chess_kazdel_*_{a,b}`), the
// `kazdelShip` 盟约, its traits, effects, tokens and two 装备 — and it ALSO makes 10 existing operators members of that
// 盟约 (plus rewrites their `bonds` / `garrisons`). The whole content comes from `tools/kazdel-data.mjs`, the source
// expansion's own overlay, which compiles every record from the pinned client tables (`tools/kazdel-data-source.json`).
// This file adds the fork's half on top:
//
//   * call that overlay (so `npm run build-data` keeps the content), then
//   * stamp `packId: 'packKazdel'` on every record it ADDED, so `shared/packData.js recordAvailable` drops it again while
//     the switch is off — the pack's own records are invisible, not merely unused, and a room that never turned it on is
//     the original content, and
//   * list the ten 盟约 members it contributed on OTHER records as `packMembers`, because dropping a record does not drop
//     what points at it: `kazdelShip`'s `members` / `visibleMembers` name ten operators, so t he record names the pack's
//     additions and `withPackMembers` takes them back out.
//
// `tools/build-data.mjs` calls `applyKazdel` on a fresh build. `node tools/fork-data.mjs` does NOT: this overlay reads a
// 860 KB pinned table and compiles at six potential ranks, which is a build-time job rather than an in-place patch. The
// committed `data/*.json` therefore already carry the records, each tagged (`test/kazdel-data.test.js` guards it).
//
// `tools/extension-potential.mjs` (the source repo's shared six-rank helper) is NOT imported: this fork's
// `tools/rhine-data.mjs` keeps its own copy of that 20-line helper for the same reason, and `tools/kazdel-data.mjs`
// imports `./extension-potential.mjs` — so the two functions live here and are INJECTED through the module's `source`
// argument instead. That is the one deliberate edit to the ported file.

import { PACK_ID_FIELD, PACK_MEMBERS_FIELD, PACK_RESTORE_FIELD } from '../shared/packData.js';
import { PACK_KEYS } from '../shared/constants.js';
import { atRank, stripPotential, FULL_RANK } from '../shared/potential.js';
import { attachPotential } from './build-data.mjs';

/** The Mod / 内容包 switch this expansion belongs to (`shared/constants.js PACK_KEYS`). */
export const KAZDEL_PACK = 'packKazdel';
/** The ported 盟约 (`shared/kazdel.js KAZDEL_BOND`). */
export const KAZDEL_BOND = 'kazdelShip';

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** `files` at one potential rank: every annotated record stripped back to that rank's own values. */
function atPotential(files, rank) {
  const out = structuredClone(files);
  for (const [id, record] of Object.entries(out.chess)) out.chess[id] = stripPotential(atRank(record, rank));
  for (const unit of Object.values(out.backups?.units || {})) {
    for (const [key, form] of Object.entries(unit.forms)) unit.forms[key] = stripPotential(atRank(form, rank));
  }
  for (const table of [out.tokens, out.backups?.tokens]) {
    for (const token of Object.values(table || {})) {
      for (const [owner, variant] of Object.entries(token.variants || {})) token.variants[owner] = stripPotential(atRank(variant, rank));
    }
  }
  return out;
}

/**
 * The overlay's six-rank driver, mirroring `tools/rhine-data.mjs`'s own copy: build the records at every rank, then
 * annotate them with the same `attachPotential` the official roster uses, so `potDown` is the upstream format rather
 * than a second, extension-only shape.
 */
export async function applyPotentialOverlay(files, apply, source) {
  const passes = [];
  for (let rank = 0; rank <= FULL_RANK; rank++) {
    const current = atPotential(files, rank);
    await apply(current, { ...source, applyPotentialOverlay, potRank: rank });
    passes.push(current);
  }
  const errors = attachPotential(passes.map((p) => ({ chess: p.chess, tokens: p.tokens, backups: p.backups || { units: {}, tokens: {} } })));
  if (errors.length) throw new Error(errors.join('\n'));
  Object.assign(files, passes[FULL_RANK]);
  return files;
}

/**
 * Stamp `packId` on the records the overlay ADDED, record what it CHANGED on official ones (`packRestore`), name its
 * 盟约 additions (`packMembers`), and put back the two global tables it must not touch.
 *
 * `before` is the file set as it was BEFORE the overlay ran. The three cases the measurement found:
 *
 *   * ADDED — a `chess_kazdel_*` / `garrison_kazdel_*` / the `kazdelShip` 盟约 and its effect / the two 装备. `packId`
 *     makes them invisible while the switch is off.
 *   * EDITED — the overlay rewrites TEN existing operators (`bonds` / `garrisonIds`, and for 芬 it also UNHIDES her:
 *     `isHidden` false, `visible` true) and appends them to 7 official 盟约 member lists, plus rewrites 8 traits' `owners`
 *     and the `desc` of two official effects / items. Those records are the official content, so the values they had
 *     before go into `packRestore` and `shared/packData.js withPackRestore` puts them back.
 *   * GLOBAL — `config.modes[].activeBondIds` and `config.bans` are not per-record at all. The former is restored here
 *     (one array edit); the latter is a deliberate fork deviation (see below).
 *
 * @param {Record<string, any>} before the file set before the overlay
 * @param {Record<string, any>} files the same object, mutated by the overlay
 */
export function stampKazdelPack(before, files) {
  if (!isPlain(files)) return files;
  for (const table of ['chess', 'bonds', 'garrisons', 'tokens', 'effects', 'items']) {
    const now = files[table], was = isPlain(before?.[table]) ? before[table] : {};
    if (!isPlain(now)) continue;
    for (const [id, rec] of Object.entries(now)) {
      if (!isPlain(rec)) continue;
      const prev = was[id];
      if (!prev) {                                  // ADDED
        if (!rec[PACK_ID_FIELD]) rec[PACK_ID_FIELD] = KAZDEL_PACK;
        continue;
      }
      if (JSON.stringify(prev) === JSON.stringify(rec)) continue;
      // EDITED: the values the pack replaced, per field, so the strip can put them back — EXCEPT a field another pack
      // already recorded (`packRestore.packRhine`). Two packs can edit the same field, and `withPackRestore` puts a
      // SECOND record's value back over the first's, so a field only one pack's restore can carry has to keep the value
      // recorded FIRST (the earlier pack is the one whose off-state is the deeper fallback). 卡兹戴尔 hits this on the
      // two official 变形同构体 descriptions, where 莱茵's mapping sentence is already appended.
      const ours = isPlain(prev[PACK_RESTORE_FIELD]) ? prev[PACK_RESTORE_FIELD] : {};
      const restore = {};
      for (const [field, value] of Object.entries(prev)) {
        if (field === PACK_ID_FIELD || field === PACK_RESTORE_FIELD) continue;
        if (JSON.stringify(value) === JSON.stringify(rec[field])) continue;
        if (Object.values(ours).some((r) => isPlain(r) && field in r)) continue;   // an earlier pack owns the fallback
        restore[field] = value;
      }
      // A restorable field we deliberately did NOT record leaves nothing to take back out; if that is all the pack
      // changed on this record, there must be no marker at all — an empty one would look like a strip target.
      const changedOwnFields = Object.keys(restore).length
        || Object.entries(prev).some(([f, v]) => f !== PACK_RESTORE_FIELD && JSON.stringify(v) !== JSON.stringify(rec[f]));
      if (!changedOwnFields) continue;
      if (Object.keys(restore).length) {
        rec[PACK_RESTORE_FIELD] = { ...(isPlain(rec[PACK_RESTORE_FIELD]) ? rec[PACK_RESTORE_FIELD] : {}), [KAZDEL_PACK]: restore };
      }
    }
  }
  // The 盟约: a NEW record (built from `bonds.yanShip`), tagged above — but it is the one every added chess names in
  // `bonds`, so it is the record the 盟约 view draws. Its own member list is this pack's, so the ten names it lists go
  // into `packMembers`: without that, a bond that survived its members would draw a row per dropped operator. (Both
  // happen here, so the premise of the field — "a bond that outlives its member" — is met by the switch order in
  // `shared/packData.js filterFile`, which drops records before clearing lists.)
  const bond = files.bonds?.[KAZDEL_BOND];
  if (isPlain(bond)) {
    if (!bond[PACK_ID_FIELD]) bond[PACK_ID_FIELD] = KAZDEL_PACK;
    for (const field of ['members', 'visibleMembers']) {
      const list = Array.isArray(bond[field]) ? bond[field] : null;
      if (!list || !list.length) continue;
      bond[PACK_MEMBERS_FIELD] = { ...(isPlain(bond[PACK_MEMBERS_FIELD]) ? bond[PACK_MEMBERS_FIELD] : {}), [KAZDEL_PACK]: [...list] };
    }
  }
  for (const [bondId, rec] of Object.entries(isPlain(files.bonds) ? files.bonds : {})) {
    if (bondId === KAZDEL_BOND || !isPlain(rec)) continue;
    const prev = before.bonds?.[bondId];
    if (!prev) continue;
    for (const field of ['members', 'visibleMembers']) {
      const now = Array.isArray(rec[field]) ? rec[field] : null;
      const was = Array.isArray(prev[field]) ? prev[field] : null;
      if (!now || !was) continue;
      const added = now.filter((id) => !was.includes(id));
      if (!added.length) continue;
      rec[PACK_MEMBERS_FIELD] = { ...(isPlain(rec[PACK_MEMBERS_FIELD]) ? rec[PACK_MEMBERS_FIELD] : {}), [KAZDEL_PACK]: added };
    }
  }
  // `config.modes[].activeBondIds` is a MODE rule, not a record: the overlay pushes `kazdelShip` into all ten modes, and
  // nothing reads that list at runtime (server/match/gamedata.js reads `inactiveBondIds`; the client's 盟约 view reads
  // the bond records). Left in, every mode would name a bond an all-off room does not contain — `test/data.test.js`
  // asserts `activeBondIds ∪ inactiveBondIds` are real bonds — so the list goes back exactly as it was.
  for (const [modeId, mode] of Object.entries(isPlain(files.config?.modes) ? files.config.modes : {})) {
    const prev = before.config?.modes?.[modeId];
    if (isPlain(prev) && Array.isArray(prev.activeBondIds)) mode.activeBondIds = [...prev.activeBondIds];
  }
  // `config.bans` (the per-difficulty core / add-on bond count the per-match draw removes) is a FORK TABLE with a
  // deliberate deviation from the source's `applyKazdelOpeningBans` call: the fork's own values are
  // `{ FUNNY: 0/1, NORMAL-HARD-ABYSS: 3/4 }` (`tools/fork-overrides.mjs`), the source's are `{ FUNNY: 2, NORMAL-HARD-ABYSS:
  // 5 }`. Those are a balance decision the port must not silently make, and the extra banned cores are what the 「关闭盟约
  // 禁用」 Mod 开关 exists for — so the table is restored and the deviation is reported rather than applied.
  if (isPlain(before.config?.bans) && isPlain(files.config)) files.config.bans = structuredClone(before.config.bans);
  // `tools/build-data.mjs` writes `chess` / `garrisons` / `items` in natural key order and `test/fork-data.test.js`
  // pins it. The overlay can only APPEND, so without this the twelve ported operators land after the albedo set instead
  // of among them. Only the insertion order of the object's keys changes — no value is touched.
  for (const name of ['chess', 'garrisons', 'items']) {
    const table = files[name];
    if (isPlain(table)) files[name] = Object.fromEntries(Object.keys(table).sort(naturalCmp).map((k) => [k, table[k]]));
  }
  return files;
}

/** `tools/build-data.mjs naturalCmp` — the sort its own tables are written in. */
const naturalCmp = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

/**
 * Run the 卡兹戴尔 overlay over a freshly built file set and tag what it added. Idempotent: a second call re-derives
 * the same records and the `if (rec[PACK_ID_FIELD]) continue` guard leaves the tags alone.
 * @param {Record<string, any>} files the builder's file set
 */
export async function applyKazdel(files) {
  const { applyKazdelData } = await import('./kazdel-data.mjs');
  const before = structuredClone(files);
  await applyKazdelData(files, { applyPotentialOverlay });
  stampKazdelPack(before, files);
  return files;
}

/** The pack switch this expansion needs; asserted at import so a rename of the key is loud rather than silent. */
if (!PACK_KEYS.includes(KAZDEL_PACK)) throw new Error(`${KAZDEL_PACK} is not in PACK_KEYS`);
