// tools/fork-data.mjs — apply the fork's data layer (tools/fork-overrides.mjs) to the committed data files.
//
// `npm run build-data` (tools/build-data.mjs) rebuilds every data/*.json from the official tables and preserves the fork
// layer by calling the appliers before writing. This CLI is the other direction: it patches the COMMITTED files in place,
// so a fork change stays a small, reviewable diff instead of a full regeneration that would re-encode megabytes of
// untouched data.
//
// Idempotent: running it twice writes the same bytes (the second run only reports that each file is up to date).
// Usage: node tools/fork-data.mjs [--check]   (--check exits 1 when a file is stale, for CI)
//
// Files written: every entry of LAYER below — data/config.json and data/choices.json (the 终极模拟 mode and its 机变
// schedule), data/chess.json / data/backups.json (the extra 自选编队 slots, 二.8) and, since 六.3, data/bonds.json /
// data/effects.json / data/assets.json (the ported 莱茵生命 盟约). Compact JSON, exactly like build-data.mjs writes them.
//
// data/assets.json is the one file build-data.mjs does NOT own (tools/fetch-assets.mjs writes it), so this CLI is the only
// thing that puts the ported bond's icon in — and test/ui/assetUrls.test.js needs every bond to resolve one.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyForkOverrides, applyForkChoices, applyForkChess, applyForkBackups, FORK_MODE_ID,
  applyForkBonds, applyForkEffects, applyForkPackMembers, applyForkPackAphris, applyForkAssets,
} from './fork-overrides.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

/**
 * The fork's per-file appliers: the data file, the function that returns the patched object (or null when the file does
 * not have the shape it needs — then the file is left alone with an error), and a short description for the log.
 */
const LAYER = [
  {
    name: 'config',
    what: 'modes',
    apply: (json) => {
      if (!json || typeof json !== 'object' || !json.modes || typeof json.modes !== 'object') return null;
      return applyForkOverrides(json);
    },
  },
  {
    name: 'choices',
    what: 'schedule',
    apply: (json) => {
      if (!json || typeof json !== 'object' || !json.schedule || typeof json.schedule !== 'object') return null;
      return applyForkChoices(json);
    },
  },
  {
    // 二.8: the extra 自选编队 slot pairs (`…_diyN_a` / `…_diyN_b`). The file is keyed by chess id and the build writes
    // the keys in natural sort order, so `what` is only the log's word for the block the applier owns.
    // 六.3 then appends the ported 莱茵生命 盟约 to its members' `bonds` (a second, independent block on the same file).
    name: 'chess',
    what: '自选 slots + 莱茵生命 members',
    apply: (json) => {
      if (!json || typeof json !== 'object' || !json.chess_char_5_diy1_a || !json.chess_char_6_diy1_a) return null;
      return applyForkPackMembers(applyForkChess(json));
    },
  },
  {
    // 二.8: `diy.slots` — the slot metadata (tier, goldenId, shopLevel, requirement) the shop and the UI enumerate.
    // 六.3: 谬因 joins 莱茵生命 through a 自选 operator's own bond list (backups.diy.operators), same file.
    name: 'backups',
    what: 'diy.slots + 谬因/莱茵生命',
    apply: (json) => {
      if (!json || typeof json !== 'object' || !json.diy || typeof json.diy !== 'object' || !json.diy.slots) return null;
      return applyForkPackAphris(applyForkBackups(json));
    },
  },
  {
    // 六.3: the ported 莱茵生命 盟约 record itself (data/bonds.json is an id → record map like chess).
    name: 'bonds',
    what: '莱茵生命 盟约',
    apply: (json) => (json && typeof json === 'object' && !Array.isArray(json) ? applyForkBonds(json) : null),
  },
  {
    // 六.3: the 盟约's effect record (effectType BOND) — data.test.js requires every bond's effectId to resolve.
    name: 'effects',
    what: '莱茵生命 盟约效果',
    apply: (json) => (json && typeof json === 'object' && !Array.isArray(json) ? applyForkEffects(json) : null),
  },
  {
    // 六.3: the ported 盟约's icon. `data/assets.json` is a build product of tools/fetch-assets.mjs (not of
    // build-data.mjs), and test/ui/assetUrls.test.js requires EVERY bond in data/bonds.json to resolve one.
    name: 'assets',
    what: '莱茵生命盟约图标',
    apply: (json) => (json && typeof json === 'object' && !Array.isArray(json) ? applyForkAssets(json) : null),
  },
];

let failed = false;
for (const { name, what, apply } of LAYER) {
  const file = join(ROOT, 'data', `${name}.json`);
  if (!existsSync(file)) {
    console.error(`fork-data: ${file} is missing — build the data first (node tools/build-data.mjs)`);
    failed = true;
    continue;
  }
  const before = readFileSync(file, 'utf8');
  const out = apply(JSON.parse(before));
  if (!out) {
    console.error(`fork-data: data/${name}.json has no ${what} — refusing to patch`);
    failed = true;
    continue;
  }
  const text = JSON.stringify(out);
  if (text === before) {
    console.log(`fork-data: data/${name}.json is up to date (${FORK_MODE_ID})`);
  } else if (check) {
    console.error(`fork-data: data/${name}.json is stale — run: node tools/fork-data.mjs`);
    failed = true;
  } else {
    // Atomic like build-data: a crash mid-write never leaves a truncated JSON behind.
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, text);
    renameSync(tmp, file);
    console.log(`fork-data: data/${name}.json updated (${FORK_MODE_ID}); ${text.length - before.length >= 0 ? '+' : ''}${text.length - before.length} bytes`);
  }
}
if (failed) process.exitCode = 1;
