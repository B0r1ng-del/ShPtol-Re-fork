// test/helpers/diyPoolSource.js — a sim data source whose 自选 pool ALSO lists one chosen operator.
//
// Why this exists (2026-10-24): `tools/fork-overrides.mjs ownedPoolOf` removes every operator who is already a chess
// piece from `data/backups.json diy.ownedPool` — the 2026-10-23 fix for 「同一位干员能被上两次、局内卡池概率异常」.
// The `op_*.test.js` content tests are KIT tests: they pin a kit's numbers at the 自选 slot statuses, which is the only
// place the four-form matrix exists (tier 5 carries a module at stage 1, tier 6 at stage 3). A chess record only ever
// has the two statuses its own `_a` / `_b` records name, so fielding the kit as the chess piece would lose the stage-3
// half of the matrix. The kit is unaffected by the pool decision; only the pool is. So the kit test supplies the pool
// entry itself and the PRODUCT DATA IS UNTOUCHED — nothing here is written to `data/`.
//
// The operator is NOT in the shipped pool: `test/diy.test.js` pins that, and `test/diyPoolOverlap.test.js` pins the
// strip. Only `diy.ownedPool` (the id) and `diy.operators[charId].bonds` (the pick-side bond record) are supplied —
// the two things the pool used to provide. Forms are NOT synthesized: a status no record of that operator carries
// stays absent, and a test may only assert forms its file really has.
import { readFileSync } from 'node:fs';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';

const BACKUPS = JSON.parse(readFileSync(new URL('../../data/backups.json', import.meta.url), 'utf8'));

/**
 * The real game data with `charId` put back into the 自选 pool.
 * @param {string} charId
 * @param {{ bonds?: string[], raw?: Record<string, any> }} [opts] `bonds` = the pick-side bond record the generated
 *   `diy.operators[charId]` used to carry; `raw` = extra raw tables of the test's own fixtures (`{ enemies }`)
 * @returns {DataSource}
 */
export function diyPoolSource(charId, { bonds = null, raw = {} } = {}) {
  const operators = bonds ? { ...BACKUPS.diy.operators, [charId]: { ...(BACKUPS.diy.operators[charId] ?? {}), bonds } } : BACKUPS.diy.operators;
  return new DataSource({ ...raw, backups: { ...BACKUPS, diy: { ...BACKUPS.diy, ownedPool: [...BACKUPS.diy.ownedPool, charId], operators } } }, getDefaultSource());
}

/** The shipped 自选 pool — for a test that asserts the pool does NOT offer an operator. */
export const shippedPool = Object.freeze([...BACKUPS.diy.ownedPool]);
