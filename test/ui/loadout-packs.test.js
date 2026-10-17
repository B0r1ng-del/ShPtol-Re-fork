// 内容包干员 must reach 干员调配 (需求方 2026-10-17: 「开启卡兹戴尔 mod 和雷姆必拓 mod 时，干员调配界面没有出现相应的
// 干员」).
//
// The 干员调配 roster is `data.list('chess')` run through `rosterOf`, and `data/*.json` ships with every pack present (the
// strip semantics of shared/packData.js), so a pack switch does not ADD records — it stops REMOVING them. The bug was the
// re-render, not the data: `setPacks` changed which array `data.list` returns while `data.status('chess')` and the locale
// stayed the same, so the screen's `useMemo` never re-ran and the roster stayed the one built before the switch moved.
// The fix is two-sided — `setPacks` notifies and `data.packsSig()` is a memo key — so this test pins both sides AND the
// end result: the pack's operators are on the roster once the pack is on, and gone once it is off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_SRC = readFileSync(path.join(ROOT, 'public/js/data.js'), 'utf8');
const LOADOUT_SRC = readFileSync(path.join(ROOT, 'public/js/screens/loadout.js'), 'utf8');
const CHESS = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));

const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/** The operator slots a pack adds: what 干员调配 lists, not every record (the elite form and the DIY forms are not slots). */
const packSlots = (pack) => Object.values(CHESS)
  .filter((r) => r && r.packId === pack && !r.isGolden && r.visible !== false && !r.isHidden && !r.isDIY)
  .map((r) => r.chessId);

test('both packs really add 干员调配 slots (the data is there — this was never a data bug)', () => {
  const kazdel = packSlots('packKazdel');
  const rem = packSlots('packRem');
  assert.ok(kazdel.length > 0, `packKazdel adds slots: ${kazdel.length}`);
  assert.ok(rem.length > 0, `packRem adds slots: ${rem.length}`);
});

test('rosterOf lists them once the pack is on, and not before', async () => {
  const { filterFile } = await load('shared/packData.js');
  const { rosterOf } = await load('public/js/ui/loadoutModel.js');
  const slots = (mods) => new Set(rosterOf(Object.values(filterFile(mods, 'chess', CHESS))).map((c) => c.chessId));

  const off = slots({});
  const kazdel = slots({ packKazdel: true });
  const rem = slots({ packRem: true });

  for (const id of packSlots('packKazdel')) {
    assert.ok(!off.has(id), `${id} is hidden while packKazdel is off`);
    assert.ok(kazdel.has(id), `${id} is on the roster once packKazdel is on`);
  }
  for (const id of packSlots('packRem')) {
    assert.ok(!off.has(id), `${id} is hidden while packRem is off`);
    assert.ok(rem.has(id), `${id} is on the roster once packRem is on`);
  }
  assert.ok(kazdel.size > off.size && rem.size > off.size, 'both packs grow the roster');
});

test('setPacks notifies subscribers and exposes its signature', async () => {
  const { createDataStore } = await load('public/js/data.js');
  const store = createDataStore();
  const seen = [];
  store.subscribe((n) => seen.push(n));

  store.setPacks({ packKazdel: true });
  assert.deepEqual(seen, [null], 'a pack change notifies (null, so it is not mistaken for a file settling)');
  assert.equal(store.packsSig(), 'packKazdel', 'the signature names the pack');

  seen.length = 0;
  store.setPacks({ packKazdel: true });
  assert.equal(seen.length, 0, 'the same set does not notify again');

  store.setPacks({});
  assert.ok(seen.length > 0, 'turning it off notifies');
  assert.equal(store.packsSig(), '', 'the signature is empty again');
});

test('useData re-renders on a pack change, and the roster memo keys on it', () => {
  // useData: a null notification counts as a reason to re-render
  const hook = DATA_SRC.slice(DATA_SRC.indexOf('export function useData'), DATA_SRC.indexOf('return names.every'));
  assert.match(hook, /data\.subscribe\(\(n\) => \{ if \(alive && \(n === null \|\| names\.includes\(n\)\)\) force\(\); \}\)/,
    'useData listens for the pack notification');
  // the store exposes the signature so a caller can key a memo on it
  assert.match(DATA_SRC, /packsSig: \(\) => packsSig,/, 'the signature is readable');
  // loadout: the memo that builds the roster depends on it as well as on the file's own readiness and the locale
  assert.match(LOADOUT_SRC, /const packsSig = data\.packsSig\(\);/);
  assert.match(LOADOUT_SRC, /const roster = useMemo\(\(\) => rosterOf\(data\.list\('chess'\)\), \[ready, data\.locale\(\), packsSig\]\)/,
    'the roster memo re-runs when the pack set moves');
});
