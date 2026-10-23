// 二.3 东国 / 乌萨斯（移植自 Weedy-wendi/Dong-Ursus-Mod，需求方 2026-10-23）。
//
// 上游那个 mod 是「注入即永久生效」（patch 包，写进官方 act 表），本 fork 把它装进内容包 `packDongUrsus`：
// 开 = 上游的完整内容，关 = 完全剥离（官方记录也要还原，因为注入器改了 7 名干员的 bonds、2 条特质的文案与
// 3 条盟约的抽取权重）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MOD_KEYS, PACK_KEYS, MOD_DEFAULTS, PACK_AUTHORS } from '../shared/constants.js';
import { filterRawData } from '../shared/packData.js';
import { GameData } from '../server/match/gamedata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (n) => JSON.parse(readFileSync(join(ROOT, `data/${n}.json`), 'utf8'));
const DATA = { chess: load('chess'), bonds: load('bonds'), garrisons: load('garrisons'), bands: load('bands'), items: load('items') };
const PACK = 'packDongUrsus';

const on = (extra = {}) => filterRawData({ [PACK]: true, ...extra }, DATA);
const off = (extra = {}) => filterRawData({}, DATA);

describe('二.3 东国 / 乌萨斯: 内容包装配', () => {
  test('the switch exists, defaults OFF, and is in MOD_KEYS / PACK_KEYS / PACK_AUTHORS', () => {
    assert.ok(MOD_KEYS.includes(PACK), 'in MOD_KEYS so it travels with room.create.mods');
    assert.ok(PACK_KEYS.includes(PACK), 'in PACK_KEYS so the strip layer knows it');
    assert.equal(MOD_DEFAULTS[PACK], false, 'off by default');
    assert.equal(PACK_AUTHORS[PACK], 'Weedy-wendi', 'and it credits the upstream author');
  });

  test('ON: the two 盟约 are there, are core, and carry members', () => {
    const g = on();
    for (const id of ['dongShip', 'ursusShip']) {
      const b = g.bonds[id];
      assert.ok(b, `${id} exists`);
      assert.equal(b.packId, PACK, `${id}: carries the pack`);
      assert.equal(b.isCore, true, `${id}: a core 盟约`);
      assert.ok(Array.isArray(b.members) && b.members.length > 0, `${id}: has members`);
      assert.ok(b.thresholds.length >= 2, `${id}: 3/6 thresholds`);
    }
  });

  test('ON: 13 operators, 4 items, 5 strategies, 26 traits', () => {
    const g = on();
    const chess = Object.values(g.chess).filter((c) => c.packId === PACK);
    assert.equal(chess.length, 26, '13 operators × (normal + elite)');
    assert.equal(new Set(chess.map((c) => c.baseId)).size, 13, '13 distinct base ids');
    assert.equal(Object.values(g.items).filter((i) => i.packId === PACK).length, 8, '4 items × (normal + elite)');
    assert.equal(Object.values(g.bands).filter((b) => b.packId === PACK).length, 5, '5 custom strategies');
    assert.equal(Object.values(g.garrisons).filter((x) => x.packId === PACK).length, 26, '26 custom traits');
  });

  test('ON: every operator is visible / shop-eligible and has a kit', async () => {
    const gd = new GameData(DATA, 'mode_standard', { [PACK]: true });
    const bases = Object.values(gd.raw.chess).filter((c) => c.packId === PACK && !c.isGolden);
    assert.equal(bases.length, 13);
    for (const c of bases) assert.ok(gd.visibleChess.includes(c.chessId), `${c.chessId}: rollable`);
    // tier kits 的 key 是 **chessId**（`registeredKit()` 按 [baseId, id, bare] 查），不是 charId ——
    // charId 那条约定属于 OPERATOR_KIT_FILES（op-*.js）。13 个东/乌萨斯 kit 挂在 KIT_FILES 里，所以用 chessId。
    const { KITS } = await import('../server/sim/content/kits/index.js');
    for (const c of bases) assert.equal(typeof KITS[c.chessId], 'function', `${c.chessId}: has a kit`);
  });

  test('OFF: the pack is gone — no 盟约, no operators, no items, no strategies', () => {
    const g = off();
    assert.equal(g.bonds.dongShip, undefined, 'dongShip stripped');
    assert.equal(g.bonds.ursusShip, undefined, 'ursusShip stripped');
    assert.equal(Object.values(g.chess).filter((c) => c.packId === PACK).length, 0, 'no chess');
    assert.equal(Object.values(g.items).filter((i) => i.packId === PACK).length, 0, 'no items');
    assert.equal(Object.values(g.bands).filter((b) => b.packId === PACK).length, 0, 'no strategies');
    assert.equal(Object.values(g.garrisons).filter((x) => x.packId === PACK).length, 0, 'no traits');
  });

  test('OFF: the OFFICIAL records the injector edited are put back (packRestore)', () => {
    const g = off();
    // 7 名官方干员被补了 dongShip / ursusShip 的归属 —— 关包后必须一个都不剩
    for (const [baseId, want] of Object.entries({
      chess_char_2_17: ['steadShip', 'soloShip'],      // 折桠
      chess_char_1_10: ['steadShip'],                  // 古米
      chess_char_1_18: ['raidShip'],                   // 宴
      chess_char_2_11: ['miraShip'],                   // 风丸
      chess_char_4_09: ['egirShip', 'soloShip'],       // 水月
      chess_char_4_17: ['yanShip'],                    // 星熊
      chess_char_5_10: ['siracusaShip', 'emptyShip'], // 铃兰
    })) {
      const rec = g.chess[`${baseId}_a`];
      assert.ok(rec, `${baseId}_a exists`);
      assert.deepEqual(rec.bonds, want, `${baseId}: bonds restored`);
      assert.equal('packRestore' in rec, false, `${baseId}: no bookkeeping left behind`);
    }
    // 水月的特质文案 / bbStr 也要回到「只有【阿戈尔】」
    for (const id of ['garrison_07_a', 'garrison_07_b']) {
      const gj = g.garrisons[id];
      assert.doesNotMatch(gj.desc, /东/, `${id}: desc restored`);
      assert.doesNotMatch(gj.descRaw, /东/, `${id}: descRaw restored`);
      assert.equal(gj.bbStr.bond_id, 'egirShip', `${id}: bbStr.bond_id restored`);
    }
    // 三条盟约的抽取权重回到官方值（远见/奇迹 10，迅捷 10，协防 0）
    assert.equal(g.bonds.visiShip.weight, 10, 'visiShip weight restored');
    assert.equal(g.bonds.swiftShip.weight, 10, 'swiftShip weight restored');
    assert.equal(g.bonds.emptyShip.weight, 0, 'emptyShip weight restored (官方 0 = 永不被禁)');
  });

  test('OFF: zero trace of the pack anywhere in the filtered data', () => {
    const g = off();
    for (const [table, map] of Object.entries(g)) {
      for (const [id, rec] of Object.entries(map || {})) {
        if (!rec || typeof rec !== 'object') continue;
        assert.notEqual(rec.packId, PACK, `${table}.${id}: packId`);
        assert.equal(rec.packRestore && rec.packRestore[PACK], undefined, `${table}.${id}: packRestore`);
        const j = JSON.stringify(rec);
        assert.equal(j.includes('dongShip'), false, `${table}.${id}: no dongShip reference`);
        assert.equal(j.includes('ursusShip'), false, `${table}.${id}: no ursusShip reference`);
      }
    }
  });

  test('the 5 custom strategies each resolve their effect record', () => {
    const g = on();
    const effects = JSON.parse(readFileSync(join(ROOT, 'data/effects.json'), 'utf8'));
    const bands = Object.values(g.bands).filter((b) => b.packId === PACK);
    assert.equal(bands.length, 5);
    for (const b of bands) assert.ok(effects[b.effectId], `${b.bandId}: effect ${b.effectId} resolves`);
  });
});
