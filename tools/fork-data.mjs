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
import { FORK_APPLIERS, FORK_MODE_ID } from './fork-overrides.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

/**
 * The fork's per-file appliers: the data file, a short description for the log, and the shape the file must have (a file
 * without it is left alone with an error, never patched blind). The functions themselves come from
 * `FORK_APPLIERS` — the same list `tools/build-data.mjs` applies to a fresh build, so a new fork feature cannot reach
 * one direction and miss the other (六.3 shipped exactly that bug).
 */
const LAYER = [
  { name: 'config', what: 'modes', needs: (j) => j.modes && typeof j.modes === 'object' },
  { name: 'choices', what: 'schedule', needs: (j) => j.schedule && typeof j.schedule === 'object' },
  // 二.8: the extra 自选编队 slot pairs (`…_diyN_a` / `…_diyN_b`). The file is keyed by chess id and the build writes
  // the keys in natural sort order, so `what` is only the log's word for the block the applier owns.
  // 六.3 then appends the ported 莱茵生命 盟约 to its members' `bonds` (a second, independent block on the same file).
  { name: 'chess', what: '自选 slots + 莱茵生命 members', needs: (j) => j.chess_char_5_diy1_a && j.chess_char_6_diy1_a },
  // 二.8: `diy.slots` — the slot metadata (tier, goldenId, shopLevel, requirement) the shop and the UI enumerate.
  // 六.3: 谬因 joins 莱茵生命 through a 自选 operator's own bond list (backups.diy.operators), same file.
  { name: 'backups', what: 'diy.slots + 谬因/莱茵生命', needs: (j) => j.diy && typeof j.diy === 'object' && j.diy.slots },
  // 六.3: the ported 莱茵生命 盟约 record itself (data/bonds.json is an id → record map like chess).
  { name: 'bonds', what: '莱茵生命 盟约', needs: (j) => j && typeof j === 'object' },
  // 2026-10-15 (owner): 六.C's 新干员包 is embedded, so it has no applier and no row here — its garrisons are ordinary
  // records. This list must match `FORK_APPLIERS` exactly (test/fork-data.test.js), so the row went with the applier.
  // 六.3: the 盟约's effect record (effectType BOND) — data.test.js requires every bond's effectId to resolve.
  { name: 'effects', what: '莱茵生命 盟约效果', needs: (j) => j && typeof j === 'object' },
  // 六.3: the ported 盟约's icon. `data/assets.json` is a build product of tools/fetch-assets.mjs (not of
  // build-data.mjs), and test/ui/assetUrls.test.js requires EVERY bond in data/bonds.json to resolve one.
  { name: 'assets', what: '莱茵生命盟约图标', needs: (j) => j && typeof j === 'object' },
];

let failed = false;
for (const { name, what, needs } of LAYER) {
  const file = join(ROOT, 'data', `${name}.json`);
  if (!existsSync(file)) {
    console.error(`fork-data: ${file} is missing — build the data first (node tools/build-data.mjs)`);
    failed = true;
    continue;
  }
  const before = readFileSync(file, 'utf8');
  const json = JSON.parse(before);
  if (!json || typeof json !== 'object' || Array.isArray(json) || !needs(json)) {
    console.error(`fork-data: data/${name}.json has no ${what} — refusing to patch`);
    failed = true;
    continue;
  }
  // `backups` 需要同一次生成的 `chess`：`applyForkPackAphris` 用它把「已经是棋手」的干员从 `diy.ownedPool` 里剔掉
  // （需求方 2026-10-23 的重复干员 bug —— 内容包的棋手在 build 那一刻还不在官方 roster 里，于是漏进了可选池）。
  // 读不到 chess 就退回单参数调用（不传 chess 时那段剔除不跑，缪因那半照旧）。
  const applyArgs = [json];
  if (name === 'backups') {
    try { applyArgs.push(JSON.parse(readFileSync(join(ROOT, 'data', 'chess.json'), 'utf8'))); } catch { /* optional */ }
  }
  const out = FORK_APPLIERS[name](...applyArgs);
  if (!out) {
    console.error(`fork-data: data/${name}.json has no ${what} — refusing to patch`);
    failed = true;
    continue;
  }
  // `data/assets.json` is written by tools/fetch-assets.mjs, which ends the file with a newline; every file
  // build-data.mjs writes does not. Keep whichever the file already had so a patch is a content diff and not a
  // one-byte whitespace churn on the file this CLI does not own.
  const text = JSON.stringify(out) + (before.endsWith('\n') ? '\n' : '');
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
