// 物资调配处 deck（卡片视图）：干员调配 tab 的另一种排法。
//
// 来自旧 UI PR #643 的 keep 清单（`docs/history/0.3.1.md` §34.34 里「the 物资调配处 card view」）。#643 本身从未合并；
// 它的界面由维护者拆成 7 个 PR 进 0.3.1，卡片视图是留到最后的那块之一。
//
// 这里钉五件事：
//   1. 两个视图都在、可切换，选择记在本机（`loadout.view`）；
//   2. 卡片按 tier 分组，组头是罗马数字 + 数量；
//   3. 卡片上的技能 / 模组 / 潜能 / 替补标记来自与列表**同一套** handler 与数据；
//   4. 甄选干员卡只在 5 / 6 阶出现，且**筛选时不出现**（筛选后只剩真正命中的干员）；
//   5. 卡片视图不新增协议消息、不写服务端 —— 它只是同一份状态的另一种画法。
//
// Run: node --test test/ui/loadout-deck.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('两个视图都在，且选择记在本机', () => {
  const src = read('public/js/screens/loadout.js');
  assert.match(src, /const VIEW_PREF = 'loadout\.view'/);
  assert.match(src, /export const loadoutViewPref = \(\) => \(loadPref\(VIEW_PREF, 'deck'\) === 'list' \? 'list' : 'deck'\)/);
  // the deck branch holds two tabs: 干员 (DeckView) and 道具 (ItemCodex), and the bottom bar sits OUTSIDE `.lo-list`
  assert.match(src, /view === 'deck'\s*\n\s*\? \(deckTab === 'items'/);
  assert.match(src, /<\\?\$\{DeckView\}/);
  assert.match(src, /<\\?\$\{ItemCodex\}/, '道具 tab');
  assert.match(src, /<\\?\$\{DeckBar\}/, '底部阶位栏');
  assert.match(src, /<\\?\$\{RosterRow\}/);
  // ★ 需求方 2026-10-24: the 卡片 / 列表 toggle is gone — the deck is the only view offered
  assert.doesNotMatch(src, /class="lo-viewtoggle"/, '列表切换按钮已删除');
  // the bottom bar must be a SIBLING of `.lo-list` (which scrolls), or it hides below the fold
  const listClose = src.indexOf('</div>\n        ${null /* The bottom bar sits OUTSIDE');
  assert.ok(listClose > 0, '底栏在 .lo-list 之外');
});

test('卡片按 tier 分组，组头是罗马数字 + 数量', () => {
  const src = read('public/js/screens/loadout.js');
  assert.match(src, /const TIERS = \[1, 2, 3, 4, 5, 6\]/);
  assert.match(src, /TIERS\.map\(\(tier\) => \(\{ tier, items: list\.filter\(\(c\) => c\.tier === tier\) \}\)\)/);
  assert.match(src, /lo-tmark__n">\$\{ROMAN\[g\.tier\]\}/, '组头的罗马数字');
  assert.match(src, /lo-tmark__cnt num">\$\{g\.items\.length\}/, '组头的数量');
  assert.match(src, /data-tier=\$\{g\.tier\}/);
});

test('卡片与列表用同一套 handler 与数据（技能 / 模组 / 潜能 / 替补）', () => {
  const src = read('public/js/screens/loadout.js');
  const i = src.indexOf('export function OpCard(');
  assert.ok(i > 0, 'OpCard 在');
  const body = src.slice(i, src.indexOf('function DiyDeckCard(', i));
  // 同一套解析函数
  assert.match(body, /const choice = effectiveChoice\(entries, chess, golden\)/);
  assert.match(body, /const opt = chessOptions\(chess, golden\)/);
  assert.match(body, /const cv = cultivationView\(chess\.charId, ops\)/);
  // 技能 / 模组 / 潜能 / 替补
  assert.match(body, /<\\?\$\{SkillIcon\} m=\$\{m\} rec=\$\{skRec\}/);
  assert.match(body, /<\\?\$\{ModuleGlyph\} m=\$\{m\} rec=\$\{mod\?\.rec\}/);
  assert.match(body, /<\\?\$\{PotPips\} n=\$\{cv\.potential\}/);
  assert.match(body, /notOwned \? html`<span class="lo-op__ribbon"/);
  // 已调整的标记与列表同源
  assert.match(body, /const changed = choice\.changed \|\| cv\.changed/);
  // 点卡片 = 选中（与列表同一个 pick）
  assert.match(body, /onClick=\$\{\(\) => onPick\(chess\.chessId\)\}/);
});

test('甄选干员卡只在 5 / 6 阶，筛选时不出现', () => {
  const src = read('public/js/screens/loadout.js');
  const i = src.indexOf('function DiyDeckCard(');
  const body = src.slice(i, src.indexOf('function useDragScroll(', i));
  assert.match(body, /const mine = slots\.filter\(\(s\) => s\.tier === tier\)/, '按阶位取名额');
  assert.match(body, /if \(!mine\.length\) return null/, '没有名额就不画');
  // 组过滤：筛选后只留真正有干员的组，且不补甄选卡
  assert.match(src, /\.filter\(\(g\) => g\.items\.length \|\| \(!filtered && diySlots\.some\(\(s\) => s\.tier === g\.tier\)\)\)/);
  assert.match(src, /\$\{!filtered \? html`<\\?\$\{DiyDeckCard\}/);
});

test('道具图鉴：只列可买的装备，按阶位分组，点开看基础 / 进阶效果', async () => {
  const { codexItems } = await import('../../public/js/screens/loadout.js');
  const items = {
    a: { id: 'a', itemType: 'EQUIP', tier: 1, price: 2, name: 'A' },
    hidden: { id: 'hidden', itemType: 'EQUIP', tier: 1, hideInShop: true },
    golden: { id: 'golden', itemType: 'EQUIP', tier: 2, isGolden: true },
    consume: { id: 'consume', itemType: 'CONSUME', tier: 1 },
    b: { id: 'b', itemType: 'EQUIP', tier: 2, price: 4, name: 'B' },
  };
  assert.deepEqual(codexItems(items).map((x) => x.id), ['a', 'b'], '只留可买的装备，按阶位排序');
  assert.deepEqual(codexItems(null), [], '没有数据时是空列表');

  const src = read('public/js/screens/loadout.js');
  const i = src.indexOf('function ItemCodex(');
  const body = src.slice(i, src.indexOf('function ItemDetail(', i));
  assert.match(body, /TIERS\.map\(\(tier\) => \(\{ tier, items: items\.filter\(\(x\) => x\.tier === tier\) \}\)\)/, '按阶位分组');
  assert.match(body, /onClick=\$\{\(\) => onOpen\(idx\)\}/, '点开详情');
  const d = src.indexOf('function ItemDetail(');
  const detail = src.slice(d, src.indexOf('function DeckBar(', d));
  assert.match(detail, /基础 & 进阶效果|基础效果/, '基础效果标题');
  assert.match(detail, /进阶效果/, '进阶效果');
  assert.match(detail, /it\.goldenId \? all\?\.\[it\.goldenId\]/, '进阶形态按 goldenId 取');
});

test('底部阶位栏：干员 / 道具切换 + 跳阶位', () => {
  const src = read('public/js/screens/loadout.js');
  const i = src.indexOf('function DeckBar(');
  const body = src.slice(i, src.indexOf('// ---- detail', i));
  assert.match(body, /role="tablist"/, '两个 tab');
  assert.match(body, /onDeckTab\('ops'\)/);
  assert.match(body, /onDeckTab\('items'\)/);
  assert.match(body, /disabled=\$\{!counts\[tier\]\}/, '空阶位不可跳');
  assert.match(body, /onClick=\$\{\(\) => onJump\(tier\)\}/);
});

test('★ 卡片视图不碰服务端：没有新协议消息，也不发请求', () => {  const src = read('public/js/screens/loadout.js');
  const i = src.indexOf('// ---- 物资调配处 deck');
  assert.ok(i > 0, 'deck 段在');
  const deck = src.slice(i, src.indexOf('// ---- detail', i));
  assert.doesNotMatch(deck, /net\.request|msgType|'room\./, '卡片视图只是另一种画法，不新增消息');
  assert.doesNotMatch(deck, /fetch\(/, '不发请求');
});

test('★ 底部阶位栏：点了真的滚到那个阶位（不是只改状态）', () => {
  const src = read('public/js/screens/loadout.js');
  // DeckBar 的 onJump 走 jumpTier（写入 { tier, seq }），DeckView 用 jumpTo 触发滚动
  assert.match(src, /const jumpTier = \(tier\) => \{ setDeckTier\(tier\); setJumpTo\(\(j\) => \(\{ tier, seq: \(j\?\.seq \|\| 0\) \+ 1 \}\)\); \}/);
  assert.match(src, /onJump=\$\{jumpTier\}/, '底栏接的是 jumpTier 而不是裸 setState');
  assert.match(src, /jumpTo=\$\{jumpTo\}/, 'DeckView 收到 jumpTo');
  const i = src.indexOf('function DeckView(');
  const body = src.slice(i, src.indexOf('function DiyDeckCard(', i) > 0 ? src.indexOf('function DiyDeckCard(', i) : i + 4000);
  // offsets are measured against the scroller with getBoundingClientRect: `offsetLeft` is relative to the
  // `offsetParent` (which IS `.lo-deck` because it is position: relative), so its own padding skewed the target.
  assert.match(body, /sec\.getBoundingClientRect\(\)\.left - el\.getBoundingClientRect\(\)\.left \+ el\.scrollLeft/,
    '按滚动容器量偏移');
  assert.match(body, /el\.scrollTo\(\{ left: Math\.max\(0, left - 12\)/, '真的滚动容器');
  assert.match(body, /data-tier="\$\{jumpTo\.tier\}"/, '按阶位找 section');
});
