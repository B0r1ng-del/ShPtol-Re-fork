// The operator kit layout (server/sim/content/kits/README.md): every file of kits/ops/ is listed once in kits/index.js
// KIT_FILES, STANDIN_KIT_FILES or OPERATOR_KIT_FILES and nothing else is; a file `<chessId>-<codename>.js` registers
// exactly the kit of `<chessId>_a`, whose data record has that charId code name; a 补位 file `standin-<codename>.js`
// registers exactly the kit of the stand-in character whose charId has that code name (data/backups.json `units`); a
// 自选 file `op-<codename>.js` registers exactly the kit of the owned-6★ pick with that code name (data/backups.json
// `diy.ownedPool`) and writes every skill of the operator under `skills`; the registry is the tier groups in order, then
// the stand-ins, then the 自选 operators, then the version charId kits (`ver-<codename>.js`, one key) and the borrowed
// 自选 file `ver-diy.js` (the 24 DIY_BORROW_CHARS); content/index.js serves that object; KITTED_CHARS = the 预备干员 +
// every registered stand-in / operator charId + the borrowed 自选 charIds; no kit file imports a Node-only or
// server-only module or reads the clock / Math.random (the sim is deterministic and also runs in the browser, /sim/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT_FILES, TIER_KITS, KITS, STANDIN_KIT_FILES, STANDIN_KITS, OPERATOR_KIT_FILES, OPERATOR_KITS, GENERIC_KIT_CHARS, KITTED_CHARS, VERSION_KIT_FILES, VERSION_KITS, DIY_BORROW_KIT_FILES, DIY_BORROW_KITS, DIY_BORROW_CHARS } from '../../server/sim/content/kits/index.js';
import { KITS as CONTENT_KITS } from '../../server/sim/content/index.js';
import { diyRecord } from '../../shared/diy.js';
import { normalizeChess } from '../../server/sim/simdata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const KIT_DIR = join(ROOT, 'server/sim/content/kits');
const CHESS = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));
const BACKUPS = JSON.parse(readFileSync(join(ROOT, 'data/backups.json'), 'utf8'));
const jsIn = (dir) => readdirSync(join(KIT_DIR, dir)).filter((f) => f.endsWith('.js')).sort();

test('kits/index.js lists every kit file of kits/ops/ exactly once, and only those', () => {
  const listed = [...KIT_FILES.flat(), ...STANDIN_KIT_FILES, ...OPERATOR_KIT_FILES, ...VERSION_KIT_FILES, ...DIY_BORROW_KIT_FILES];
  assert.equal(new Set(listed).size, listed.length, 'a file listed twice');
  // The expansions' own chess keep their own registries, loaded by content/index.js rather than kits/index.js:
  // 六.F 莱茵生命 (kits/rhine.js), 八 卡兹戴尔 (kits/kazdel.js) and 九 雷姆必拓 (kits/rem.js). Their `ops/chess_<pack>_*`
  // files belong to those registries, so they are excluded here by prefix — never by "the listing happened to miss them".
  const PACK_KIT = /^chess_(rhine|kazdel|rem)_/;
  assert.deepEqual([...listed].sort(), jsIn('ops').filter((f) => !PACK_KIT.test(f)));
});

test('a stand-in kit file standin-<codename>.js registers the kit of that stand-in charId (data/backups.json units)', async () => {
  const units = Object.keys(BACKUPS.units);
  for (const file of STANDIN_KIT_FILES) {
    const m = /^standin-([a-z0-9]+)\.js$/.exec(file);
    assert.ok(m, `${file}: name`);
    const charId = units.find((id) => id.replace(/^char_\d+_/, '') === m[1]);
    assert.ok(charId, `${file}: no stand-in with the code name ${m[1]}`);
    const mod = await import(`../../server/sim/content/kits/ops/${file}`);
    assert.deepEqual(Object.keys(mod.default), [charId], `${file}: default export`);
    assert.equal(typeof mod.default[charId], 'function', `${file}: kit builder`);
    assert.equal(STANDIN_KITS[charId], mod.default[charId], `${file}: registered`);
    assert.equal(KITS[charId], mod.default[charId], `${file}: in the merged registry`);
  }
});

test('a 自选 kit file op-<codename>.js registers the kit of that owned-6★ pick (data/backups.json diy.operators), every skill under `skills`', async () => {
  // The pick does not have to be in `diy.ownedPool`: build-data strips every operator who is already a chess piece from
  // it (tools/build-data.mjs, the 2026-10-23 same-operator-twice fix), and this fork fields 14 of these operators — 赫拉格,
  // 维什戴尔, 伊芙利特 … — as expansion chess. Their kit file still belongs to the 自选 registry (the four-form matrix
  // only exists at the 自选 slots, see test/helpers/diyPoolSource.js), so the code name is resolved against
  // `diy.operators` and the chess records as well; only an operator nobody knows is a failure.
  const pool = BACKUPS.diy.ownedPool;
  const known = new Set([...pool, ...Object.keys(BACKUPS.diy.operators ?? {}),
    ...Object.values(CHESS).map((c) => c && c.charId).filter(Boolean)]);
  for (const file of OPERATOR_KIT_FILES) {
    const m = /^op-([a-z0-9]+)\.js$/.exec(file);
    assert.ok(m, `${file}: name`);
    const charId = [...known].find((id) => id.replace(/^char_\d+_/, '') === m[1]);
    assert.ok(charId, `${file}: no operator with the code name ${m[1]}`);
    const mod = await import(`../../server/sim/content/kits/ops/${file}`);
    assert.deepEqual(Object.keys(mod.default), [charId], `${file}: default export`);
    assert.equal(typeof mod.default[charId], 'function', `${file}: kit builder`);
    assert.equal(OPERATOR_KITS[charId], mod.default[charId], `${file}: registered`);
    assert.equal(KITS[charId], mod.default[charId], `${file}: in the merged registry`);
    // every skill of every slot form is authored (a 自选 piece has no default skill: the pick chooses any), built from the
    // composed record and its def as the sim does (shared/diy.js diyRecord, simdata normalizeChess)
    // the shipped pool strips this operator when she is also a chess piece; compose the record as if she were picked
    const backups = { ...BACKUPS, diy: { ...BACKUPS.diy, ownedPool: [...BACKUPS.diy.ownedPool, charId] } };
    // A pick belongs to one tier: the owned 6★ picks fill a tier-6 slot, the fork's 4★ reserves (赫拉格 …) a tier-5 one.
    // Compose at the slot that owns this pick and at the two statuses the operator's own records carry.
    const slots = ['chess_char_5_diy1_a', 'chess_char_6_diy1_a'].filter((s) =>
      diyRecord(s, { charId, skillIndex: 0 }, { data: { chess: CHESS, backups } }));
    assert.ok(slots.length >= 1, `${file}: a legal pick of a 自选 tier`);
    for (const slot of slots) {
      for (const elite of [false, true]) {
        const rec = diyRecord(slot, { charId, skillIndex: 0 }, { elite, data: { chess: CHESS, backups } });
        assert.ok(rec, `${file}: a legal pick of ${slot}`);
        const kit = mod.default[charId](rec.skill.bb, rec, normalizeChess(rec));
        assert.deepEqual(Object.keys(kit.skills || {}).sort(), rec.skills.map((s) => s.skillId).sort(), `${file}@${slot}${elite ? ' elite' : ''}: skills`);
      }
    }
  }
  assert.deepEqual([...KITTED_CHARS].sort(), [...new Set([...GENERIC_KIT_CHARS, ...Object.keys(STANDIN_KITS), ...Object.keys(OPERATOR_KITS), ...DIY_BORROW_CHARS])].sort());
});

test('a kit file <chessId>-<codename>.js registers the kit of <chessId>_a (codename: its charId without char_<n>_)', async () => {
  for (const file of KIT_FILES.flat()) {
    const m = /^(chess_char_\w+?)-([a-z0-9]+)\.js$/.exec(file);
    assert.ok(m, `${file}: name`);
    const key = `${m[1]}_a`;
    const rec = CHESS[key];
    assert.ok(rec, `${file}: no data record ${key}`);
    assert.equal(String(rec.charId).replace(/^char_\d+_/, ''), m[2], `${file}: code name of ${rec.charId}`);
    const mod = await import(`../../server/sim/content/kits/ops/${file}`);
    assert.deepEqual(Object.keys(mod.default), [key], `${file}: default export`);
    assert.equal(typeof mod.default[key], 'function', `${file}: kit builder`);
    assert.equal(KITS[key], mod.default[key], `${file}: registered`);
  }
});

test('a version kit file ver-<codename>.js registers that charId; ver-diy.js registers exactly DIY_BORROW_CHARS', async () => {
  for (const file of VERSION_KIT_FILES) {
    const m = /^ver-([a-z0-9]+)\.js$/.exec(file);
    assert.ok(m, `${file}: name`);
    const mod = await import(`../../server/sim/content/kits/ops/${file}`);
    const keys = Object.keys(mod.default);
    assert.equal(keys.length, 1, `${file}: one charId`);
    assert.ok(keys[0].endsWith(`_${m[1]}`), `${file}: ${keys[0]}`);
    assert.equal(typeof mod.default[keys[0]], 'function', `${file}: kit builder`);
    assert.equal(VERSION_KITS[keys[0]], mod.default[keys[0]], `${file}: registered`);
    assert.equal(KITS[keys[0]], mod.default[keys[0]], `${file}: in the merged registry`);
    assert.ok(!KITTED_CHARS.includes(keys[0]), `${file}: a shop kit, not a 自选 pick`);
  }
  assert.deepEqual(DIY_BORROW_KIT_FILES, ['ver-diy.js']);
  const diy = await import('../../server/sim/content/kits/ops/ver-diy.js');
  assert.deepEqual(Object.keys(diy.default), [...DIY_BORROW_CHARS]);
  for (const charId of DIY_BORROW_CHARS) {
    assert.equal(typeof diy.default[charId], 'function', charId);
    assert.equal(DIY_BORROW_KITS[charId], diy.default[charId], charId);
    assert.equal(KITS[charId], diy.default[charId], charId);
    assert.ok(KITTED_CHARS.includes(charId), charId);
  }
});

test('the registry is the tier groups, then the stand-ins, then the 自选 operators, then the version kits, then the borrowed 自选 charIds; content/index.js serves the same object', () => {
  assert.deepEqual(Object.keys(KITS), [
    ...TIER_KITS.flatMap((t) => Object.keys(t)), ...Object.keys(STANDIN_KITS), ...Object.keys(OPERATOR_KITS),
    ...Object.keys(VERSION_KITS), ...Object.keys(DIY_BORROW_KITS),
  ]);
  // ver-diy.js is one file and 24 keys; every other kit file is one key
  assert.equal(Object.keys(KITS).length, KIT_FILES.flat().length + STANDIN_KIT_FILES.length + OPERATOR_KIT_FILES.length + VERSION_KIT_FILES.length + DIY_BORROW_CHARS.length);
  // content/index.js merges the expansion registries (kazdel / rhine / rem) on top of this one, so it is a superset
  // and a different object — the identity that has to hold is per key, the other groups must not be shadowed
  for (const key of Object.keys(KITS)) assert.equal(CONTENT_KITS[key], KITS[key], `content/index.js KITS[${key}]`);
});

test('kit files stay browser-safe and deterministic: no Node-only or server-only import, no clock, no Math.random', () => {
  for (const f of ['index.js', ...['shared', 'ops'].flatMap((d) => jsIn(d).map((x) => `${d}/${x}`))]) {
    const src = readFileSync(join(KIT_DIR, f), 'utf8');
    assert.ok(!/from\s+['"]node:|import\(\s*['"]node:|\brequire\(|nodeData\.js/.test(src), `${f}: Node-only import`);
    const specifiers = [...src.matchAll(/^(?:import|export)\s[^;]*?\sfrom\s+['"]([^'"]+)['"]/gm), ...src.matchAll(/\bimport\(\s*['"`]([^'"`]+)['"`]/g)];
    for (const [, p] of specifiers) {
      assert.ok(p.startsWith('.'), `${f}: bare import ${p}`);
      // never server / client code, never an index module (content/index.js, kits/index.js: an import cycle)
      assert.ok(!/(^|\/)(match|net|public)\/|(^|\/)index\.js$/.test(p), `${f}: imports ${p}`);
    }
    assert.ok(!/Math\.random|Date\.now|performance\.now|setTimeout|setInterval/.test(src), `${f}: clock / Math.random (use battle.rng, battle.after / every)`);
  }
});
