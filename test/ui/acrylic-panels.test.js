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
const COMPONENTS = readFileSync(path.join(ROOT, 'public/css/components.css'), 'utf8');
const GAME = readFileSync(path.join(ROOT, 'public/css/screens/game.css'), 'utf8');

/** The acrylic declaration pair, as the recipe spells it. */
const FILTER = /-webkit-backdrop-filter: blur\(\.12rem\) saturate\(1\.6\);\n {2}backdrop-filter: blur\(\.12rem\) saturate\(1\.6\);/;

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

// 需求方 2026-10-17（追加）：「给这些 UI 最底层的背景改为 Acrylic」—— 截图里的相位横幅（休整期 / 作战开始 / 第 N 回合）、
// 作战结束结果框，以及 HUD 的三块底板（等待胶囊 / 队友进度 / 费用框 / ‹ › 切换条）。
//
// 这四处都在 `.dpanel` 之外，所以它们此前还是各自的不透明底板；配方与上面两块**同一条**（css/chat.css 的
// blur(.12rem) saturate(1.6)），回退色同样走 `@supports`。

test('the phase banner is acrylic, and its blur fades with the plate', () => {
  const band = block(COMPONENTS, '.pbanner__band {');
  assert.match(band, /background:\n {4}repeating-linear-gradient\(0deg, rgba\(255, 255, 255, \.025\) 0 1px, transparent 1px 3px\),\n {4}linear-gradient\(90deg, transparent, rgba\(7, 10, 9, \.62\) 16%, rgba\(7, 10, 9, \.62\) 84%, transparent\)/, 'translucent band');
  assert.match(band, FILTER);
  // the blur must be masked to the same stops as the fill: unmasked it fogs a full-width stripe of the board, including
  // the two ends where the plate is invisible
  assert.match(band, /-webkit-mask-image: linear-gradient\(90deg, transparent, #000 16%, #000 84%, transparent\)/);
  assert.match(band, /mask-image: linear-gradient\(90deg, transparent, #000 16%, #000 84%, transparent\)/);
  // the opaque band is the fallback, not the default
  assert.match(COMPONENTS, /@supports not \(backdrop-filter: blur\(1px\)\) \{\n {2}\.pbanner__band \{/, 'a fallback exists');
  const fallback = COMPONENTS.slice(COMPONENTS.indexOf('@supports not (backdrop-filter: blur(1px)) {\n  .pbanner__band'));
  assert.match(fallback, /rgba\(7, 10, 9, \.93\) 16%/, 'and it is the near-opaque band it shipped with');
  // the frame, the glow and the animation are untouched — only the plate's material moved
  assert.match(COMPONENTS, /\.pbanner__band::before \{ top: 0; \}/);
  assert.match(COMPONENTS, /animation: pb-open var\(--t-med\) var\(--ease-out\) backwards;/);
});

test('the 作战结束 result box is the same material, keeping the tone frame and glow', () => {
  const box = block(COMPONENTS, '.rdialog__box {');
  assert.match(box, /linear-gradient\(180deg, rgba\(9, 13, 12, \.62\), rgba\(6, 9, 8, \.66\)\)/, 'translucent plate');
  assert.match(box, FILTER);
  assert.match(box, /border: 1px solid var\(--rd\)/, 'the tone frame is kept');
  assert.match(box, /box-shadow: 0 0 \.5rem var\(--rd-glow\), inset 0 0 \.7rem rgba\(0, 0, 0, \.8\)/, 'and so is its glow');
  assert.match(COMPONENTS, /@supports not \(backdrop-filter: blur\(1px\)\) \{\n {2}\.rdialog__box \{ background: linear-gradient\(180deg, rgba\(9, 13, 12, \.96\), rgba\(6, 9, 8, \.97\)\); \}/);
  // a plate is not a banner: the corner ticks and the tone variants stay exactly as they were
  assert.match(COMPONENTS, /\.rdialog__tick--tl \{ top: 8px; left: 8px; border-right: 0; border-bottom: 0; \}/);
  assert.match(COMPONENTS, /\.rdialog--red \{ --rd: var\(--red-premium\); --rd-glow: rgba\(255, 84, 84, \.38\); \}/);
});

test('the HUD plates (等待胶囊 / 队友进度 / 费用框 / ‹ › 切换条) share the material', () => {
  for (const [css, sel, fallback] of [
    [GAME, '.dpbox {', /\.dpbox \{ background: rgba\(8, 11, 10, \.88\); \}/],
    [GAME, '.chud__msg {', /\.chud__msg \{ background: rgba\(8, 11, 10, \.9\); \}/],
    [GAME, '.chud__prog {', /\.chud__prog \{ background: rgba\(8, 11, 10, \.82\); \}/],
    [GAME, '.vswitch {', /\.vswitch \{ background: rgba\(8, 11, 10, \.9\); \}/],
  ]) {
    assert.match(block(css, sel), FILTER, `${sel} is the acrylic recipe`);
    assert.match(css, fallback, `${sel} has the opaque fallback`);
    // and no near-opaque plate is left on the default rule
    assert.ok(!/background: rgba\(8, 11, 10, \.(8[0-9]|9[0-9])\)/.test(block(css, sel)), `${sel} is no longer near-opaque`);
  }
  // the borders/borders-left the HUD carries as identity are untouched
  assert.match(block(GAME, '.dpbox {'), /border-right: 3px solid var\(--mint-500\)/);
  assert.match(block(GAME, '.chud__msg {'), /border-radius: \.3rem/);
  assert.match(block(GAME, '.chud__prog {'), /border-left: 3px solid var\(--gold\)/);
});
