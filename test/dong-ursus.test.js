// 二.3 东国 / 乌萨斯（移植自 Weedy-wendi/Dong-Ursus-Mod，需求方 2026-10-23；2026-10-24 拆成两个开关）。
//
// 上游那个 mod 是「注入即永久生效」（patch 包，写进官方 act 表）。本 fork 把它装进**两个**内容包，按**盟约**切分：
//   * `packDong`  —— 【东】`dongShip` 的 10 名干员、2 件装备、10 条特质；
//   * `packUrsus` —— 【乌萨斯】`ursusShip` 的 16 名干员、2 件装备、16 条特质。
// 关掉一个开关 = 那个包的内容完全剥离、它改过的官方记录逐字段还原，另一个包的照旧。
//
// ★ 需求方 2026-10-24：**5 条自制策略默认直接出现，无需开关** —— 它们不带 `packId`，两个开关全关也在。
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
const DONG = 'packDong';
const URSUS = 'packUrsus';
const PACK_BOND = { [DONG]: 'dongShip', [URSUS]: 'ursusShip' };
/** 移植过来的 5 条自制策略（`tools/dong-ursus-content.mjs` 的 BANDS）—— 它们**不带** packId。 */
const CUSTOM_BANDS = new Set(['band_palico', 'band_headbr', 'band_haruka', 'band_utage', 'band_ulika']);

const filt = (mods) => filterRawData(mods, DATA);
const only = (pack) => filt({ [pack]: true });
const none = () => filt({});
const both = () => filt({ [DONG]: true, [URSUS]: true });
const stamped = (data, pack) => Object.values(data.chess || {}).filter((r) => r && r.packId === pack);

describe('二.3 东国 / 乌萨斯: 两个开关，按盟约切分', () => {
  test('both switches exist, default OFF, and travel with room.create.mods', () => {
    for (const pack of [DONG, URSUS]) {
      assert.ok(MOD_KEYS.includes(pack), `${pack}: in MOD_KEYS so it travels with room.create.mods`);
      assert.ok(PACK_KEYS.includes(pack), `${pack}: in PACK_KEYS so the strip layer knows it`);
      assert.equal(MOD_DEFAULTS[pack], false, `${pack}: off by default`);
      assert.equal(PACK_AUTHORS[pack], 'Weedy-wendi', `${pack}: credits the upstream author`);
    }
    assert.equal(MOD_KEYS.includes('packDongUrsus'), false, 'the single old switch is gone');
  });

  test('each 盟约 lives in its own pack, is core, and carries members', () => {
    for (const [pack, bondId] of Object.entries(PACK_BOND)) {
      const b = only(pack).bonds[bondId];
      assert.ok(b, `${pack}: ${bondId} exists`);
      assert.equal(b.packId, pack, `${pack}: ${bondId} carries that pack`);
      assert.equal(b.isCore, true, `${pack}: ${bondId} is a core 盟约`);
      assert.ok(b.members.length > 0, `${pack}: ${bondId} has members`);
      assert.ok(b.thresholds.length >= 2, `${pack}: ${bondId} has 3/6 thresholds`);
    }
  });

  test('each pack strips to exactly its own operators (10 东国 / 16 乌萨斯 records = 5 / 8 operators)', () => {
    const dong = stamped(only(DONG), DONG);
    const ursus = stamped(only(URSUS), URSUS);
    assert.equal(dong.length, 10, '东国: 5 operators × (normal + elite)');
    assert.equal(ursus.length, 16, '乌萨斯: 8 operators × (normal + elite)');
    assert.equal(new Set(dong.map((c) => c.baseId)).size, 5, '东国: 5 distinct base ids');
    assert.equal(new Set(ursus.map((c) => c.baseId)).size, 8, '乌萨斯: 8 distinct base ids');
    // 交叉污染检查：开了「东」看不到乌萨斯的记录，反之亦然。
    assert.equal(stamped(only(DONG), URSUS).length, 0, '东国 does not bring 乌萨斯 records');
    assert.equal(stamped(only(URSUS), DONG).length, 0, '乌萨斯 does not bring 东国 records');
  });

  test('each pack carries its own two items and its own traits', () => {
    for (const pack of [DONG, URSUS]) {
      const g = only(pack);
      assert.equal(Object.values(g.items).filter((i) => i.packId === pack).length, 4, `${pack}: 2 items × (normal + elite)`);
      assert.ok(Object.values(g.garrisons).filter((x) => x.packId === pack).length > 0, `${pack}: has traits`);
    }
    // 每条特质归到它那名干员的盟约，不会两包都认领。
    const total = [DONG, URSUS].reduce((n, p) => n + Object.values(both().garrisons).filter((x) => x.packId === p).length, 0);
    assert.equal(total, 26, '26 custom traits in total across the two packs');
  });

  test('★ the 5 custom strategies need NO switch — they are always there', () => {
    for (const g of [none(), only(DONG), only(URSUS), both()]) {
      const custom = Object.values(g.bands).filter((b) => CUSTOM_BANDS.has(b.bandId));
      assert.equal(custom.length, 5, '5 custom strategies, whatever the switches');
      for (const b of custom) assert.equal('packId' in b, false, `${b.bandId}: carries no pack, so no switch strips it`);
    }
    // 且它们引用的效果记录在**两个开关全关**时也解析得到。
    const effects = JSON.parse(readFileSync(join(ROOT, 'data/effects.json'), 'utf8'));
    for (const b of Object.values(none().bands).filter((x) => CUSTOM_BANDS.has(x.bandId))) {
      assert.ok(effects[b.effectId], `${b.bandId}: effect ${b.effectId} resolves with every switch off`);
    }
  });

  test('every operator of either pack is visible, shop-eligible and has a kit', async () => {
    const { KITS } = await import('../server/sim/content/kits/index.js');
    for (const pack of [DONG, URSUS]) {
      const gd = new GameData(DATA, 'mode_standard', { [pack]: true });
      const bases = Object.values(gd.raw.chess).filter((c) => c.packId === pack && !c.isGolden);
      assert.ok(bases.length > 0, `${pack}: has operators`);
      for (const c of bases) {
        assert.ok(gd.visibleChess.includes(c.chessId), `${c.chessId}: rollable`);
        assert.equal(typeof KITS[c.chessId], 'function', `${c.chessId}: has a kit`);
      }
    }
  });

  test('OFF: each official record the injector edited goes back to its own pack, not both', () => {
    // 折桠 / 古米 只被【乌萨斯】改过 ⇒ 只开【东】时它们必须已经还原。
    for (const [baseId, want] of Object.entries({
      chess_char_2_17: ['steadShip', 'soloShip'], // 折桠
      chess_char_1_10: ['steadShip'],            // 古米
    })) {
      assert.deepEqual(only(DONG).chess[`${baseId}_a`].bonds, want, `${baseId}: restored while only 东国 is on`);
      assert.deepEqual(both().chess[`${baseId}_a`].bonds.includes('ursusShip'), true, `${baseId}: present with 乌萨斯 on`);
    }
    // 宴 / 风丸 / 水月 / 星熊 / 铃兰 只被【东】改过 ⇒ 只开【乌萨斯】时必须已经还原。
    for (const [baseId, want] of Object.entries({
      chess_char_1_18: ['raidShip'],                  // 宴
      chess_char_2_11: ['miraShip'],                  // 风丸
      chess_char_4_09: ['egirShip', 'soloShip'],      // 水月
      chess_char_4_17: ['yanShip'],                   // 星熊
      chess_char_5_10: ['siracusaShip', 'emptyShip'], // 铃兰
    })) {
      assert.deepEqual(only(URSUS).chess[`${baseId}_a`].bonds, want, `${baseId}: restored while only 乌萨斯 is on`);
      assert.deepEqual(both().chess[`${baseId}_a`].bonds.includes('dongShip'), true, `${baseId}: present with 东国 on`);
    }
  });

  test('OFF: zero trace of a pack anywhere in the filtered data', () => {
    for (const [pack, bondId] of Object.entries(PACK_BOND)) {
      const g = none();
      for (const [table, map] of Object.entries(g)) {
        // ★ 策略（bands）不参与这条检查：5 条策略**默认常驻**，其中「宴」按名字点名【东】、「凛冬」点名【乌萨斯】
        //   （`bbStr.bond`），所以关掉包之后它们仍然写着那条盟约名 —— 但 `rollBond()` 找不到成员时返回 null，
        //   这些策略只是**什么都不做**，不会把包的内容带回来。这正是需求方「策略无需开关」的代价，已确认接受。
        if (table === 'bands') continue;
        for (const [id, rec] of Object.entries(map || {})) {
          if (!rec || typeof rec !== 'object') continue;
          assert.notEqual(rec.packId, pack, `${table}.${id}: packId`);
          assert.equal(rec.packRestore && rec.packRestore[pack], undefined, `${table}.${id}: packRestore`);
          assert.equal(JSON.stringify(rec).includes(bondId), false, `${table}.${id}: no ${bondId} reference`);
        }
      }
    }
  });

  test('the bond weights are the mod-authored ones regardless of the two switches', () => {
    // ★ 权重覆盖动的是**官方**盟约（远见/奇迹/迅捷/精准/灵巧/协防），不属于东国或乌萨斯任何一包 ——
    //   把它挂在任一开关上都说不通（关「东」不该改远见的权重），所以它**不随开关变化**。
    for (const g of [none(), only(DONG), only(URSUS), both()]) {
      assert.equal(g.bonds.visiShip.weight, 2.5, 'visiShip');
      assert.equal(g.bonds.miraShip.weight, 2.5, 'miraShip');
      assert.equal(g.bonds.swiftShip.weight, 45, 'swiftShip');
      assert.equal(g.bonds.emptyShip.weight, 10, 'emptyShip');
    }
  });
});
