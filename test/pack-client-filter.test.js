// test/pack-client-filter.test.js — 客户端真的把关闭的内容包剥掉了吗？
//
// 需求方 2026-10-17：「我已关闭莱茵生命 mod 选项，但开始游戏后仍然出现莱茵生命的盟约。」
//
// 根因（实证）：`data/*.json` 提交的是**全开真相**（strip 语义，见 shared/packData.js），所以「全部关闭」
// 必须**照样过滤**。但 `public/js/data.js` 里 `setPacks` 把全关映射成 `null`，`packFiltered` 又 `if (!packs)
// return value` 短路 ⇒ 客户端把未过滤的原始文件当成了原版内容，列出 12 张莱茵棋手与 `rhineShip`，而服务端
// 早已剥掉它们 —— 两端不一致。
//
// 这份测试不用源匹配：它建一个真的 store，喂真的 `data/*.json`，然后问 `list('bonds')` / `get('chess')`。
// 源匹配挡不住「改坏了但字符串还在」，行为测试挡得住。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A store on the repository's own data/*.json (the committed all-packs-ON truth). */
async function store() {
  const { createDataStore } = await import('../public/js/data.js');
  const s = createDataStore({
    fetch: async (url) => {
      const name = String(url).split('/').pop();
      try {
        const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
        return { ok: true, status: 200, json: async () => JSON.parse(body) };
      } catch {
        return { ok: false, status: 404, json: async () => ({}) };
      }
    },
  });
  await s.loadAll(['bonds', 'chess']);
  return s;
}

describe('内容包开关: the CLIENT strips a switched-off pack', () => {
  test('the committed data really does contain the pack (or this suite proves nothing)', async () => {
    const s = await store();
    s.setPacks({ packRhine: true, packRelic: true });
    assert.ok(s.list('bonds').some((b) => b.bondId === 'rhineShip'), 'rhineShip is in data/bonds.json');
    assert.ok(s.list('chess').some((c) => c.chessId.startsWith('chess_rhine_')), 'and its cards in data/chess.json');
  });

  test('莱茵生命 off: no 盟约 and no cards — even though the file on disk has both', async () => {
    const s = await store();
    // exactly what main.js hands over for a room whose host left every pack off
    s.setPacks({ noBondBan: false, packRhine: false, packRelic: false });
    assert.ok(!s.list('bonds').some((b) => b.bondId === 'rhineShip'), 'the 盟约 is gone');
    assert.ok(!s.list('chess').some((c) => c.chessId.startsWith('chess_rhine_')), 'and so are its 12 cards');
    // the official content is untouched: 23 bonds, and the official cards are all still listed
    assert.equal(s.list('bonds').length, 23);
    assert.ok(s.list('chess').length > 100, 'the rest of the roster is still there');
  });

  test('a room that never reported any mods at all (`null`) is the official content', async () => {
    const s = await store();
    s.setPacks(null);
    assert.ok(!s.list('bonds').some((b) => b.bondId === 'rhineShip'));
    assert.ok(!s.list('chess').some((c) => c.chessId.startsWith('chess_rhine_')));
  });

  test('turning 莱茵生命 back on brings its content back (the filter is not one-way)', async () => {
    const s = await store();
    s.setPacks({ packRhine: false, packRelic: false });
    assert.ok(!s.list('bonds').some((b) => b.bondId === 'rhineShip'));
    s.setPacks({ packRhine: true, packRelic: false });
    assert.ok(s.list('bonds').some((b) => b.bondId === 'rhineShip'), 'the 盟约 is listed again');
    assert.ok(s.list('chess').some((c) => c.chessId.startsWith('chess_rhine_')));
  });

  test('`get` (a WHOLE file: the roster, diyData, the detail cards) is filtered too', async () => {
    const s = await store();
    s.setPacks({ packRhine: false, packRelic: false });
    const chess = s.get('chess');
    const keys = Array.isArray(chess) ? chess.map((c) => c.chessId) : Object.keys(chess || {});
    assert.ok(!keys.some((k) => k.startsWith('chess_rhine_')), 'the 干员调配 roster cannot list a switched-off pack');
    s.setPacks({ packRhine: true, packRelic: false });
    const on = s.get('chess');
    const onKeys = Array.isArray(on) ? on.map((c) => c.chessId) : Object.keys(on || {});
    assert.ok(onKeys.some((k) => k.startsWith('chess_rhine_')), 'and lists it again when the switch is on');
  });

  test('the client and the server agree on the same room (one shared rule)', async () => {
    const s = await store();
    const mods = { packRhine: false, packRelic: false };
    s.setPacks(mods);
    const { GameData } = await import('../server/match/gamedata.js');
    const data = {};
    for (const n of ['chess', 'bonds', 'garrisons', 'items', 'tokens', 'effects', 'backups', 'config', 'choices']) {
      data[n] = JSON.parse(readFileSync(path.join(ROOT, 'data', `${n}.json`), 'utf8'));
    }
    const gd = new GameData(data, 'mode_multi_hard', mods);
    assert.deepEqual(
      s.list('bonds').map((b) => b.bondId).sort(),
      gd.bondIds.slice().sort(),
      'the same 盟约 list on both ends of the wire',
    );
  });
});
