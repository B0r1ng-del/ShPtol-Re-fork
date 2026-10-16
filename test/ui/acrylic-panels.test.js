// 需求方 2026-10-17（图四）：作弊菜单与详情卡的背景改 Acrylic。**源码级契约**：钉住毛玻璃配方、回退色与「谁被改了」。
// 渲染结果要浏览器（SP_E2E=1 / dev/game-mock.html）；这里保证配方没有在后续改动里被换回不透明色。
//
// 范围（需求方原话）：作弊菜单背景、干员、道具、地形装置、敌方入口、保护目标的详细背景 —— 游戏内所有详情卡都走
// `.dpanel` 这一个容器（ui/detailPanel.js DetailPanel 按 detail.type 切换内容，外壳不变），所以一处配方即覆盖全部六类。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PANELS = readFileSync(path.join(ROOT, 'public/css/screens/game-panels.css'), 'utf8');
const CHAT = readFileSync(path.join(ROOT, 'public/css/chat.css'), 'utf8');

/** The declaration block of one selector (first match). */
function block(css, sel) {
  const i = css.indexOf(sel);
  assert.ok(i > 0, `${sel} exists`);
  return css.slice(i, css.indexOf('}', i));
}

test('the detail card is the acrylic recipe, with the opaque fallback', () => {
  const dpanel = block(PANELS, '.dpanel {');
  assert.match(dpanel, /background: rgba\(14, 19, 17, \.62\)/, 'translucent fill');
  assert.match(dpanel, /-webkit-backdrop-filter: blur\(\.12rem\) saturate\(1\.6\)/, 'prefixed for Safari');
  assert.match(dpanel, /backdrop-filter: blur\(\.12rem\) saturate\(1\.6\)/);
  // the recipe is the SAME one the 在线聊天 window and the 表情面板 use (css/chat.css), not a new invention
  assert.ok(CHAT.includes('backdrop-filter: blur(.12rem) saturate(1.6)'), 'shared recipe');
  assert.match(PANELS, /@supports not \(backdrop-filter: blur\(1px\)\) \{\n {2}\.dpanel \{ background: rgba\(14, 19, 17, \.94\); \}/);
  // the frame and the shadow are unchanged: only the plate's material moved
  assert.match(dpanel, /border: 1px solid var\(--line-2\); box-shadow: 0 \.14rem \.4rem rgba\(0, 0, 0, \.65\)/);
});

test('the cheat menu is the same material, and keeps its mint frame', () => {
  const cheat = block(PANELS, '.cheatball__panel {');
  assert.match(cheat, /background: rgba\(10, 16, 14, \.62\)/, 'translucent fill');
  assert.match(cheat, /backdrop-filter: blur\(\.12rem\) saturate\(1\.6\)/);
  assert.match(PANELS, /@supports not \(backdrop-filter: blur\(1px\)\) \{\n {2}\.cheatball__panel \{ background: rgba\(10, 16, 14, \.95\); \}/);
  // 3 号修复（面板按内容定宽、绝不换行）仍然成立
  assert.match(cheat, /width: max-content; min-width: max\(1\.5rem, 150px\); max-width: min\(78vw, 6rem\);/);
  assert.match(cheat, /border: 1px solid var\(--mint-800\); border-radius: \.08rem;/);
});

test('one container covers all six detail kinds', () => {
  // DetailPanel draws ONE `.dpanel` shell and fills it by `detail.type` — so the six backgrounds the owner listed are
  // this single plate. If a kind ever grows its own opaque shell, this assertion is where it should be caught.
  const card = readFileSync(path.join(ROOT, 'public/js/ui/detailPanel.js'), 'utf8');
  for (const kind of ['chess', 'item', 'terrain', 'device', 'enemy', 'token']) {
    assert.ok(card.includes(`detail.type === '${kind}'`), `detail.type === '${kind}' is rendered`);
  }
  assert.equal((card.match(/class=\$\{cx\('dpanel'/g) || []).length, 1, 'and exactly one panel shell draws them all');
});

test('no opaque plate is left behind on either surface', () => {
  for (const gone of ['.97', '.95']) {
    const dpanel = block(PANELS, '.dpanel {');
    if (gone === '.97') assert.ok(!dpanel.includes(gone), `the old .97 plate is gone from .dpanel`);
    const cheat = block(PANELS, '.cheatball__panel {');
    if (gone === '.95') assert.ok(!/background: rgba\(10, 16, 14, \.95\)/.test(cheat), 'the old .95 plate is gone from the panel');
  }
});
