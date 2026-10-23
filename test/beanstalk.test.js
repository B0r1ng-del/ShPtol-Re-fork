// 二.1 地灵 (需求方 2026-10-23)。
//
// 数据事实（照 https://m.prts.wiki/w/地灵 与官方表核对过）：地灵的两条棋手记录 `chess_char_1_11_a/b` 早就在
// `data/chess.json` 里，盟约 `miraShip`（奇迹）+ `visiShip`（远见），特质 `garrison_25_a/b`，其中 `garrison_25_b`
// 的官方原文就是「<获得时>自身所属盟约层数+4（无需激活盟约）」。她缺的只是 `visible`（`charShopChessDatas` 标了
// isHidden）。所以这个"mod"= 把她放回池子，`packBeanstalk` 开关控制，关掉时由 `packRestore` 还原。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MOD_KEYS, PACK_KEYS, MOD_DEFAULTS, PACK_AUTHORS } from '../shared/constants.js';
import { filterRawData } from '../shared/packData.js';
import { GameData } from '../server/match/gamedata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));
const BONDS = JSON.parse(readFileSync(join(ROOT, 'data/bonds.json'), 'utf8'));
const GARRISONS = JSON.parse(readFileSync(join(ROOT, 'data/garrisons.json'), 'utf8'));
const BEANSTALK = ['chess_char_1_11_a', 'chess_char_1_11_b'];
const MIRA = 'miraShip';
const VISI = 'visiShip';

describe('二.1 地灵: 官方数据已存在，开关只负责把她放回池子', () => {
  test('the switch exists, defaults OFF, and travels with the other pack switches', () => {
    assert.ok(MOD_KEYS.includes('packBeanstalk'), 'in MOD_KEYS so it travels with room.create.mods');
    assert.ok(PACK_KEYS.includes('packBeanstalk'), 'in PACK_KEYS so the strip layer knows it');
    assert.equal(MOD_DEFAULTS.packBeanstalk, false, 'off by default: an unmodded room is unchanged');
    assert.equal(typeof PACK_AUTHORS.packBeanstalk, 'string', 'and it credits an author');
  });

  test('ON: 地灵 is visible and her two records keep the OFFICIAL bonds / 特质 (nothing is copied)', () => {
    const on = filterRawData({ packBeanstalk: true }, { chess: RAW }).chess;
    for (const id of BEANSTALK) {
      assert.equal(on[id].visible, true, `${id}: visible with the pack on`);
      assert.deepEqual(on[id].bonds, [MIRA, VISI], `${id}: 奇迹 + 远见, straight from the official table`);
    }
    // 每条记录挂的特质就是官方那条：普通 ↔ a（+2 层）/ 精锐 ↔ b（+4 层）
    assert.deepEqual(on[BEANSTALK[0]].garrisonIds, ['garrison_25_a']);
    assert.deepEqual(on[BEANSTALK[1]].garrisonIds, ['garrison_25_b']);
  });

  test('the 特质 really is the requested one: <获得时>层数+4，无需激活盟约', () => {
    const g = GARRISONS.garrison_25_b;
    assert.ok(g, 'garrison_25_b exists');
    assert.equal(g.eventType, 'SERVER_GAIN', '获得时');
    assert.equal(g.effectType, 'SERVER_ADD_BOND_CHESS_ALL', '自身所属盟约全部');
    assert.deepEqual(g.bb, { count: 4 }, '+4 层');
    assert.match(g.desc, /获得时/, 'the trigger is 获得时');
    assert.match(g.desc, /层数\+4/, 'and the amount is +4');
    assert.match(g.desc, /无需激活盟约/, 'and it does not require an active 盟约 — exactly the requirement');
    assert.ok(g.owners.includes('chess_char_1_11_b'), 'and 地灵 (elite) owns it');
  });

  test('OFF: 地灵 goes back to hidden and the pack leaves no trace', () => {
    const off = filterRawData({}, { chess: RAW }).chess;
    for (const id of BEANSTALK) {
      assert.equal(off[id].visible, false, `${id}: hidden again`);
      assert.equal('packRestore' in off[id], false, `${id}: no bookkeeping left behind`);
    }
    // 而且记录的其它字段一个字节都不动（她一直是官方记录，不是这个包"造"出来的）
    assert.deepEqual(off[BEANSTALK[0]].bonds, [MIRA, VISI]);
  });

  test('the pool: 地灵 is rollable with the switch on and absent with it off', () => {
    // ★ 传**原始全量数据 + mods**，不要自己先 filter：`GameData` 构造时自己会按 `this.mods` 再过滤一次
    //   （server/match/gamedata.js `this.raw = filterRawData(this.mods, data)`），先过滤一遍再传等于被还原成 all-off。
    const onGd = new GameData({ chess: RAW, bonds: BONDS }, 'mode_standard', { packBeanstalk: true });
    const offGd = new GameData({ chess: RAW, bonds: BONDS }, 'mode_standard', {});
    assert.ok(onGd.visibleChess.includes(BEANSTALK[0]), 'on: the shop may draw her');
    assert.ok(!offGd.visibleChess.includes(BEANSTALK[0]), 'off: it may not');
    assert.equal(onGd.visibleChess.length, offGd.visibleChess.length + 1, 'exactly one operator differs');
  });

  test('her 盟约 are the official ones and the switch does not invent a 盟约', () => {
    const onGd = new GameData({ chess: RAW, bonds: BONDS }, 'mode_standard', { packBeanstalk: true });
    const ids = onGd.chessBondIds(BEANSTALK[0]);
    assert.deepEqual([...ids].sort(), [MIRA, VISI].sort(), '奇迹 + 远见, no new bond');
  });
});
