// test/pack-switches.test.js — 内容包开关 (the Mod submenu's second column, shared/constants.js PACK_KEYS).
//
// The rule: a ported pack's records carry their own `packId` (and may contribute bonds through `packBonds`), and they
// are INVISIBLE until that pack's switch is on. With every switch off — the default, every room created without them,
// every golden scenario, every test — nothing is filtered and the game is the original content. With one on, that
// pack's operators / bonds / items reach the shop pool, the reels and every list, at BOTH ends of the wire:
//
//   * `shared/packData.js` is the one definition (filterFile / effectiveBonds / packEnabled);
//   * the server applies it once, when `GameData` is built, so every accessor sees only what the room contains;
//   * the client applies it to what it indexes (`public/js/data.js` `setPacks`), so a roster agrees with the server.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_KEYS, PACK_AUTHORS, MOD_KEYS, MOD_DEFAULTS, normalizeMods, packEnabled } from '../shared/constants.js';
import { filterFile, filterRawData, effectiveBonds, recordAvailable, PACK_ID_FIELD } from '../shared/packData.js';
import { GameData } from '../server/match/gamedata.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const OFF = normalizeMods(undefined);

describe('内容包开关: the switches themselves', () => {
  test('one switch per pack, all off by default, all in MOD_KEYS (so they travel with room.create.mods)', () => {
    assert.deepEqual([...PACK_KEYS], ['packRhine', 'packAphris', 'packRelic', 'packExtra6', 'packCustom']);
    for (const k of PACK_KEYS) {
      assert.ok(MOD_KEYS.includes(k), `${k} is a Mod key`);
      assert.equal(MOD_DEFAULTS[k], false, `${k} defaults off`);
      assert.equal(typeof MOD_DEFAULTS[k], 'boolean');
    }
    // every pack has the author its ⓘ credits
    for (const k of PACK_KEYS) assert.ok(PACK_AUTHORS[k] && typeof PACK_AUTHORS[k] === 'string', `${k} has an author`);
    assert.equal(PACK_AUTHORS.packRhine, 'YUYUYUYUYUYUYUTOUA');
    assert.equal(PACK_AUTHORS.packAphris, 'SrC204');
    assert.equal(PACK_AUTHORS.packRelic, 'UNDFFIO');
    assert.equal(PACK_AUTHORS.packExtra6, 'remember-4');
    assert.equal(PACK_AUTHORS.packCustom, 'Lunac1a');
    // the switches are no room-host options and no cheats
    assert.deepEqual(Object.keys(MOD_DEFAULTS).length, MOD_KEYS.length);
  });

  test('packEnabled: no packId = the original content; a pack is on only when === true', () => {
    assert.equal(packEnabled(OFF, null), true, 'a record of no pack is always available');
    assert.equal(packEnabled(OFF, undefined), true);
    assert.equal(packEnabled(OFF, ''), true, 'falsy = no pack');
    assert.equal(packEnabled(OFF, 'packRhine'), false);
    assert.equal(packEnabled({ packRhine: true }, 'packRhine'), true);
    assert.equal(packEnabled({ packRhine: 'yes' }, 'packRhine'), false, 'not === true ⇒ off');
    assert.equal(packEnabled({ packRhine: true }, 'packRelic'), false, 'one switch does not open another');
    assert.equal(packEnabled(undefined, 'packRhine'), false, 'no mods at all = all off');
    // an ARRAY of ids: a record two packs both contribute (rhineShip) is available while EITHER switch is on, so each
    // switch alone can bring its own bond with it
    assert.equal(packEnabled({ packAphris: true }, ['packRhine', 'packAphris']), true);
    assert.equal(packEnabled({ packRhine: true }, ['packRhine', 'packAphris']), true);
    assert.equal(packEnabled(OFF, ['packRhine', 'packAphris']), false);
    assert.equal(packEnabled({ packRelic: true }, ['packRhine', 'packAphris']), false, 'an unrelated switch does not open it');
    assert.equal(packEnabled(OFF, []), true, 'an empty list carries no pack = always available');
  });

  test('the Mod submenu is TWO columns and every pack row carries its author', () => {
    const src = read('public/js/ui/mods.js');
    assert.match(src, /col: 'rule'/, 'the rule switches carry a column');
    assert.match(src, /col: 'pack'/, 'the pack switches carry a column');
    assert.match(src, /export const MOD_COLS = Object.freeze\(\['rule', 'pack'\]\)/, 'two columns, in order');
    assert.match(src, /PACK_AUTHORS\[r\.key\]/, 'the tip names the pack author');
    assert.match(src, /原作者：\{author\}/, 'through the credited msgid');
    // the layout: two columns on a desktop, one on a phone (the two-device rule)
    const css = read('public/css/screens/lobby.css');
    assert.match(css, /\.mods__rows \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.mods__rows \{ grid-template-columns: minmax\(0, 1fr\)/);
    // every pack row is a real switch row with an ⓘ and a testid
    for (const k of PACK_KEYS) assert.ok(src.includes(`'${k}'`), `${k} has a row`);
  });
});

describe('内容包开关: the filter (shared/packData.js)', () => {
  const chess = {
    orig: { chessId: 'orig', bonds: ['yanShip'] },
    rhine: { chessId: 'rhine', packId: 'packRhine' },
    custom: { chessId: 'custom', packId: 'packCustom' },
  };

  test('data with no pack records at all: the very same objects come back', () => {
    // The committed data/*.json has no `packId` yet, and every test / golden scenario / default room runs this path.
    const plain = { orig: { chessId: 'orig' }, other: { chessId: 'other' } };
    assert.equal(filterFile(OFF, 'chess', plain), plain, 'filterFile is a no-op');
    const data = { chess: plain, bonds: { b: { bondId: 'b' } } };
    assert.equal(filterRawData(OFF, data), data, 'filterRawData returns the input object itself');
  });

  test('all off: a pack record is dropped (it is invisible, not merely unused)', () => {
    const out = filterFile(OFF, 'chess', chess);
    assert.deepEqual(Object.keys(out), ['orig'], 'both pack records are gone');
    assert.ok('custom' in chess && 'rhine' in chess, 'the input is never mutated');
    assert.equal(out.orig, chess.orig, 'the surviving record is the same object');
  });

  test('a switch off drops exactly that pack, and leaves the original content alone', () => {
    const withRhine = { ...OFF, packRhine: true };
    const out = filterFile(withRhine, 'chess', chess);
    assert.deepEqual(Object.keys(out).sort(), ['custom', 'orig', 'rhine'].filter((k) => k !== 'custom').sort(),
      'packCustom is still off');
    assert.ok(!('custom' in out));
    assert.ok('rhine' in out && 'orig' in out);
    // the input is never mutated
    assert.ok('custom' in chess);
  });

  test('a pack that adds no record changes nothing: an unknown packId drops the record', () => {
    assert.equal(recordAvailable(OFF, chess.orig), true);
    assert.equal(recordAvailable(OFF, chess.rhine), false);
    const unknown = filterFile(OFF, 'chess', { x: { packId: 'packGone' } });
    assert.deepEqual(Object.keys(unknown), [], 'a pack whose switch no longer exists stays off');
  });

  test('packBonds: a pack may make an EXISTING operator join a 盟约, and only while it is on', () => {
    // The committed record carries the contribution; a DISABLED pack takes it back out (see the file header).
    const aphris = { name: '谬因', bonds: ['emptyShip', 'rhineShip'], packBonds: { packAphris: ['rhineShip'] } };
    assert.deepEqual(effectiveBonds(OFF, aphris), ['emptyShip'], 'off = the original bonds');
    assert.deepEqual(effectiveBonds({ packAphris: true }, aphris), ['emptyShip', 'rhineShip']);
    assert.deepEqual(effectiveBonds({ packRhine: true }, aphris), ['emptyShip'], 'another switch does not carry it');
    assert.deepEqual(aphris.bonds, ['emptyShip', 'rhineShip'], 'the input array is never mutated');
    // a contribution the record does not even list is a no-op, and a record with nothing to drop keeps its own array
    assert.deepEqual(effectiveBonds(OFF, { bonds: ['x'], packBonds: { packAphris: ['nope'] } }), ['x']);
    const own = ['x'];
    assert.equal(effectiveBonds(OFF, { bonds: own }), own, 'the original array is returned as it is');
    assert.equal(effectiveBonds({ packAphris: true }, { bonds: own, packBonds: { packAphris: ['x'] } }), own);
  });

  test('packBonds on a chess: an existing operator joins a new 盟约 too, not just a 自选 pick', () => {
    const cards = {
      c1: { chessId: 'c1', bonds: ['emptyShip', 'rhineShip'], packBonds: { packAphris: ['rhineShip'] } },
      c2: { chessId: 'c2' },
    };
    assert.equal(filterFile({ packAphris: true }, 'chess', cards), cards, 'on = the same object, nothing to strip');
    const off = filterFile(OFF, 'chess', cards);
    assert.deepEqual(off.c1.bonds, ['emptyShip'], 'the contribution is taken back out');
    assert.equal(off.c2, cards.c2, 'a card that loses nothing is shared, not copied');
    assert.deepEqual(cards.c1.bonds, ['emptyShip', 'rhineShip'], 'the input is untouched');
  });

  test('backups.json: units and 自选 operators are filtered, their bonds resolved', () => {
    const data = {
      backups: {
        units: { u1: { charId: 'u1' }, u2: { charId: 'u2', packId: 'packExtra6' } },
        diy: { operators: { char_4229_aphris: { bonds: ['emptyShip', 'rhineShip'], packBonds: { packAphris: ['rhineShip'] } } }, slots: {} },
      },
    };
    const off = filterRawData(OFF, data);
    assert.deepEqual(Object.keys(off.backups.units), ['u1'], 'the pack unit is dropped');
    assert.deepEqual(off.backups.diy.operators.char_4229_aphris.bonds, ['emptyShip'], 'and its bond contribution taken back');
    assert.equal(off.backups.diy.slots, data.backups.diy.slots, 'untouched keys are shared, not copied');
    assert.ok('u2' in data.backups.units, 'the input is untouched');
    const on = filterRawData({ packExtra6: true, packAphris: true }, data);
    assert.ok('u2' in on.backups.units, 'the enabled pack stays');
    assert.deepEqual(on.backups.diy.operators.char_4229_aphris.bonds, ['emptyShip', 'rhineShip'], 'and the membership holds');
    assert.deepEqual(data.backups.diy.operators.char_4229_aphris.bonds, ['emptyShip', 'rhineShip'], 'the input is untouched');
    // with only one of the two on, the other's contribution is still taken back out
    const onlyExtra = filterRawData({ packExtra6: true }, data);
    assert.deepEqual(onlyExtra.backups.diy.operators.char_4229_aphris.bonds, ['emptyShip'], 'packAphris is off');
  });
});

describe('内容包开关: the server sees only what the room contains', () => {
  // A tiny raw data set shaped like data/*.json: one original chess, one of a pack, and a bond the pack contributes.
  const raw = {
    config: { modes: { mode_standard: { id: 'mode_standard' } }, economy: {} },
    chess: {
      chess_orig: { chessId: 'chess_orig', visible: true, isGolden: false, isDiy: false, isHidden: false, tier: 1, bonds: ['yanShip'] },
      chess_pack: { chessId: 'chess_pack', visible: true, isGolden: false, isDiy: false, isHidden: false, tier: 1, packId: 'packCustom', bonds: ['rhineShip'] },
    },
    bonds: {
      yanShip: { bondId: 'yanShip', name: '炎', activeCount: 2, thresholds: [2, 3] },
      rhineShip: { bondId: 'rhineShip', name: '莱茵生命', activeCount: 3, thresholds: [3, 6, 9], packId: ['packRhine', 'packAphris'] },
    },
    items: { item_pack: { itemId: 'item_pack', packId: 'packRelic', tier: 1 } },
    backups: { diy: { operators: { char_4229_aphris: { name: '谬因', bonds: ['emptyShip', 'rhineShip'], packBonds: { packAphris: ['rhineShip'] } } } } },
  };

  test('all off: the original chess and bond, none of the packs', () => {
    const gd = new GameData(raw, 'mode_standard', undefined);
    assert.deepEqual(gd.visibleChess, ['chess_orig'], 'the pack operator is not in the pool');
    assert.ok(!gd.chess('chess_pack'), 'and not even addressable');
    assert.deepEqual(gd.bondIds, ['yanShip'], 'the pack 盟约 does not exist');
    assert.ok(!gd.bond('rhineShip'));
    assert.deepEqual(gd.chessBondIds('chess_orig'), ['yanShip']);
    // the 自选 operator keeps its original bonds
    assert.equal(gd.mods.packAphris, false);
  });

  test('a pack on: its chess enters the pool and its 盟约 exists', () => {
    const gd = new GameData(raw, 'mode_standard', { packCustom: true, packRhine: true });
    assert.deepEqual(gd.visibleChess.sort(), ['chess_orig', 'chess_pack']);
    assert.ok(gd.chess('chess_pack'));
    assert.deepEqual(gd.bondIds.slice().sort(), ['rhineShip', 'yanShip']);
    assert.equal(gd.chessOfBond('rhineShip').length, 1, 'the pool knows the pack member');
    assert.equal(gd.chessOfBond('rhineShip')[0], 'chess_pack');
  });

  test('谬因 joins 莱茵 only with that pack on, and she is a normal member of it', () => {
    const off = new GameData(raw, 'mode_standard', undefined);
    const on = new GameData(raw, 'mode_standard', { packAphris: true, packRhine: true });
    // the server resolves the 自选 operator's bonds through the filter (shared/packData.js)
    const bondsOf = (gd) => gd.raw.backups.diy.operators.char_4229_aphris.bonds;
    assert.deepEqual(bondsOf(off), ['emptyShip'], 'off: the contribution is taken back out');
    assert.deepEqual(bondsOf(on), ['emptyShip', 'rhineShip'], 'on: she is a 莱茵生命 member');
    // and the 盟约 itself is listed only while its own switch is on
    assert.ok(!off.bond('rhineShip'));
    assert.ok(on.bond('rhineShip'));
  });

  test('the switch does NOT leak: a pack off is off for items too', () => {
    const gd = new GameData(raw, 'mode_standard', { packCustom: true });
    assert.ok(!gd.item('item_pack'), 'the relic pack item needs its own switch');
    const gd2 = new GameData(raw, 'mode_standard', { packRelic: true });
    assert.ok(gd2.item('item_pack'), 'and then it is there');
    // the bond two packs both carry appears while EITHER is on
    assert.ok(new GameData(raw, 'mode_standard', { packRhine: true }).bond('rhineShip'));
    assert.ok(new GameData(raw, 'mode_standard', { packAphris: true }).bond('rhineShip'));
    assert.ok(!new GameData(raw, 'mode_standard', { packRelic: true }).bond('rhineShip'));
  });

  test('the client filter follows the host (public/js/data.js setPacks)', () => {
    const src = read('public/js/data.js');
    assert.match(src, /import \{ filterFile \} from '\.\.\/\.\.\/shared\/packData\.js'/, 'one shared rule');
    assert.match(src, /import \{ PACK_KEYS \} from '\.\.\/\.\.\/shared\/constants\.js'/);
    assert.match(src, /setPacks\(mods\) \{/, 'the store offers setPacks');
    assert.match(src, /const on = PACK_KEYS\.filter\(\(k\) => mods\?\.\[k\] === true\)/, 'only PACK_KEYS matter');
    assert.match(src, /packs = on\.length \? \{ \.\.\.mods \} : null/, 'nothing on ⇒ no filtering at all');
    // and the app drives it from the room / match it is showing
    const main = read('public/js/main.js');
    assert.match(main, /data\.setPacks\(packs\)/);
    assert.match(main, /s\.match\?\.public\?\.mods \|\| s\.room\?\.mods/, 'the host\'s switches are the source');
  });

  test('the server applies it in ONE place (GameData), so no accessor can forget', () => {
    const src = read('server/match/gamedata.js');
    assert.match(src, /this\.raw = filterRawData\(this\.mods, /, 'the raw data is filtered at construction');
    assert.match(src, /const b = effectiveBonds\(this\.mods, own\(this\._chess, id\)\)/);
    // no second copy of the rule: every other consumer goes through `gd`, which is already filtered. Check the CODE —
    // comments in these files legitimately NAME the mechanism (`packId` …) while explaining why the file does not read
    // it (`server/match/pool.js` uses `gd.chessBondIds`, which is the filtered view), so a substring search over the
    // whole file would fail on the honest implementation.
    const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of ['server/match/pool.js', 'server/match/match/platform.js', 'server/match/match/views.js']) {
      const body = code(f);
      for (const re of [/rec(?:ord)?\.packId/, /\.packId\b(?!\s*:)/, /packEnabled\s*\(/, /filterRawData\s*\(/, /filterFile\s*\(/, /PACK_ID_FIELD/]) {
        assert.ok(!re.test(body), `${f} must not re-implement the pack filter (${re})`);
      }
    }
  });
});
