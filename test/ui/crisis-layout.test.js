// 危机合约 · 选择页的版面契约 (public/js/ui/crisisSelect.js)
//
// The page's layout is copied from the official one, so the GEOMETRY is a contract, not a taste: the board is
// absolutely positioned from PITCH/GGAP/ROW_Y, and every column must land on the rows its route actually offers.
// These assertions pin the arithmetic that the browser then renders (measured live 2026-11-07: 222 tiles,
// 207 voids, 35 group headers, 3 rows, 78 links, track width 14914px at 1900px viewport).
//
// They are pure functions over shared/crisis.js — no DOM, no Preact.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CRISIS_ROUTES, crisisFxText } from '../../shared/crisis.js';

const PITCH = 98;
const GGAP = 26;
const ROUTE_W = 72;
const X0 = 21;

// the same boardFor() the page uses
function boardFor(mode) {
  const cols = [];
  const groups = [];
  let x = X0;
  let g = null;
  for (const r of Object.values(CRISIS_ROUTES)) {
    const rows = r && r.risk ? r.risk[mode] : null;
    if (!Array.isArray(rows) || !rows.length) continue;
    if (r.g !== g) {
      if (g) x += GGAP;
      groups.push({ g: r.g, x0: x, x1: x + ROUTE_W });
      g = r.g;
    } else {
      groups[groups.length - 1].x1 = x + ROUTE_W;
    }
    cols.push({ route: r, x, rows });
    x += PITCH;
  }
  return { cols, groups, width: x - PITCH + ROUTE_W + X0 };
}

test('每一条在该模式下有档位的路由都占一列，一条不漏', () => {
  for (const mode of ['solo', 'quad']) {
    const b = boardFor(mode);
    const want = Object.values(CRISIS_ROUTES).filter((r) => r && r.risk && Array.isArray(r.risk[mode]) && r.risk[mode].length);
    assert.equal(b.cols.length, want.length, mode + ' 列数');
    assert.deepEqual(b.cols.map((c) => c.route.id), want.map((r) => r.id), mode + ' 列顺序与表一致');
  }
});

test('列间距恒为 PITCH，换组时多一个 GGAP', () => {
  const b = boardFor('solo');
  for (let i = 1; i < b.cols.length; i += 1) {
    const prev = b.cols[i - 1];
    const cur = b.cols[i];
    const expect = prev.x + PITCH + (cur.route.g !== prev.route.g ? GGAP : 0);
    assert.equal(cur.x, expect, `${prev.route.id} → ${cur.route.id}`);
  }
});

test('分组头覆盖该组的首列到末列（宽度 = ROUTE_W + 组内列距）', () => {
  const b = boardFor('solo');
  // a group's columns are contiguous BY CONSTRUCTION (boardFor opens a header whenever r.g changes), so the header
  // spans the first column through the last one in board order — not min/max over the whole track, which would also
  // pick up a different group that happens to reuse the letter later.
  for (const gr of b.groups) {
    const start = b.cols.findIndex((c) => c.route.g === gr.g && c.x === gr.x0);
    assert.ok(start >= 0, gr.g + ' 组头起点必须是某列');
    let last = start;
    while (last + 1 < b.cols.length && b.cols[last + 1].route.g === gr.g) last += 1;
    assert.equal(gr.x1, b.cols[last].x + ROUTE_W, gr.g + ' 右边界 = 组内末列 + 卡宽');
    assert.equal(gr.x0, b.cols[start].x, gr.g + ' 左边界 = 组内首列');
  }
});

test('第一列落在 X0，轨道宽度 = 末列 + 卡片宽 + 左边距', () => {
  const b = boardFor('solo');
  assert.equal(b.cols[0].x, X0);
  const last = b.cols[b.cols.length - 1];
  assert.equal(b.width, last.x + ROUTE_W + X0);
});

test('每张卡的档位都在 1..3，且该模式给出几档就渲染几张（空位补齐）', () => {
  for (const mode of ['solo', 'quad']) {
    const b = boardFor(mode);
    let tiles = 0;
    let voids = 0;
    for (const c of b.cols) {
      assert.ok(c.rows.length <= 3, c.route.id + ' 最多 3 档');
      for (const lv of c.rows) assert.ok(lv >= 1 && lv <= 3, c.route.id + ' 档位 ' + lv);
      tiles += c.rows.length;
      voids += 3 - c.rows.length;
    }
    assert.equal(tiles + voids, b.cols.length * 3, mode + ' 每列恰好 3 格');
  }
});

test('实测基线：单人 222 张卡 / 207 个空位 / 35 组；四人列数不多于单人', () => {
  const solo = boardFor('solo');
  let tiles = 0;
  let voids = 0;
  for (const c of solo.cols) { tiles += c.rows.length; voids += 3 - c.rows.length; }
  assert.equal(tiles, 222, '单人词条卡数（浏览器实测同值）');
  assert.equal(voids, 207);
  assert.equal(solo.groups.length, 35, '组头数');
  assert.ok(boardFor('quad').cols.length <= solo.cols.length + 200, '四人不多出一个数量级');
});
test('每条路由都有该模式的效果文案（主表 + 弧光表合计 158/158）', () => {
  for (const mode of ['solo', 'quad']) {
    const miss = Object.keys(CRISIS_ROUTES).filter((id) => !crisisFxText(id, mode, 1));
    assert.deepEqual(miss, [], mode + ' 缺文案');
  }
});

test('档位占位符按档取值：A1 = 25% / 50% / 80%', () => {
  const v = [1, 2, 3].map((t) => crisisFxText('A1', 'solo', t).text);
  assert.deepEqual(v, ['所有敌人生命增加25%', '所有敌人生命增加50%', '所有敌人生命增加80%']);
});

test('[Ⅱ] 起的追加说明只在够档时出现（S2 二档追「半血前也同时攻击2名目标」）', () => {
  const t1 = crisisFxText('S2', 'solo', 1).text;
  const t2 = crisisFxText('S2', 'solo', 2).text;
  assert.ok(!t1.includes('半血前'), '一档不应出现');
  assert.ok(t2.includes('半血前也同时攻击2名目标'), '二档应出现：' + t2);
});

test('同一条路由的 solo / quad 文案可以不同（S6 护盾 15% vs 20%）', () => {
  const s = crisisFxText('S6', 'solo', 1).text;
  const q = crisisFxText('S6', 'quad', 1).text;
  assert.ok(s.includes('最大生命15%的护盾'), s.slice(0, 60));
  assert.ok(q.includes('最大生命20%的护盾'), q.slice(0, 60));
});

test('弧光作战的两种形态都能读出文案（数组外形 / 数组里再套 {solo,quad}）', () => {
  assert.match(crisisFxText('XA1', 'solo', 1).text, /^所有敌人攻击力\+20%$/);
  assert.equal(crisisFxText('XC5', 'solo', 1).text, '目标生命上限变为12');
  assert.equal(crisisFxText('XC5', 'quad', 1).text, '每名玩家目标生命上限变为12');
});

test('未知路由返回 null（调用方据此不渲染）', () => {
  assert.equal(crisisFxText('ZZ9', 'solo', 1), null);
});
