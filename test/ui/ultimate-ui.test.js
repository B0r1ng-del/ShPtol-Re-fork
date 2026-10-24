// 扩展模拟（终极难度）的两条界面约束（需求方 2026-10-24）：
//   1. 大厅里「扩展模拟」的字是红色 —— 它是最难的模式，与终极难度卡的红色一致；
//   2. 进到「选择模拟协议」页后**只显示 AC-4**，不再列出其余三个难度 —— 这个模式被服务端固定为终极难度，
//      列出来会让人以为能改。
//
// Run: node --test test/ui/ultimate-ui.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('扩展模拟的入口卡是红色 tone，且有对应样式', () => {
  const src = read('public/js/screens/lobby.js');
  assert.match(src, /card\.id === 'ultimate' \? 'red'/,
    'ultimate 走 hub-entry--red');
  const css = read('public/css/screens/lobby.css');
  assert.match(css, /\.hub-entry--red \.hub-entry__name \{ color: var\(--red-premium\)/,
    '红色的名字');
  assert.match(css, /\.hub-entry--red \.hub-entry__en \{ color: var\(--red-premium\)/, '英文行同色');
});

test('★ 扩展模拟页只列 AC-4，不列其他难度', () => {
  const src = read('public/js/screens/lobby.js');
  // 难度列表按模式取：ultimate 只有 [ULTIMATE_DIFFICULTY]，其余才是 DIFFICULTIES
  assert.match(src, /\(roomMode === 'ultimate' \? \[ULTIMATE_DIFFICULTY\] : DIFFICULTIES\)/,
    'ultimate 只给一个难度');
  // 难度选择对 ultimate 是禁止的（服务端固定）
  assert.match(src, /if \(protoOpen !== 'ultimate'\) pickDifficulty\(d\)/,
    'ultimate 下点难度不改状态');
  // 传进去的难度本身也被钉成 ULTIMATE_DIFFICULTY
  assert.match(src, /difficulty=\$\{protoOpen === 'ultimate' \? ULTIMATE_DIFFICULTY : difficulty\}/);
});
