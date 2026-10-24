// 成就统计（裁剪成纯本地版）：hub 左栏的「成就统计」入口卡 + 卫戍协议：盟约面板。
//
// 来自旧 UI PR #643 的 keep 清单。原版深度依赖账号体系（accounts / cloudStats / trophies / friends / namecards），
// 本 fork 没有那套服务，所以按需求方 2026-10-24 的决定「裁剪成纯本地版」：
// 数据源改成 ui/stats.js 的 loadStats()（与统计页同一份本机记录），账号相关的 UI 全部移除。
//
// 这里钉五件事：
//   1. 纯函数 achievementStats 仍按原口径统计（奖杯 / 局数 / 胜场 / 最高回合 / 盟约 / 策略）；
//   2. 数据源是 loadStats()，不是账号；
//   3. 账号依赖一个都不剩（没有 accounts / cloudStats / trophies / friends / namecards 的 import）；
//   4. 入口卡与面板都还在，且面板可以打开关闭；
//   5. 奖杯图标是本地组件（不再依赖 ui/trophies.js）。
//
// Run: node --test test/ui/achievements-local.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { achievementStats, bondOperators, HEX_TITLES } from '../../public/js/ui/achievements.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** A minimal record shaped the way ui/stats.js normalises one (`selfRowOf` reads `players[]`, not a `self` field). */
const rec = (o = {}) => ({
  id: o.id || 'r', v: 2, t: 1, roomMode: o.roomMode || 'solo', difficulty: o.difficulty || 'NORMAL',
  selfId: 'me',
  players: [{ playerId: 'me', name: '博士', isBot: false, victory: !!o.win, reward: o.reward ?? 100, trophies: o.trophies ?? 2,
    roundsPassed: o.rounds ?? 5, bandId: o.bandId || null, title: o.title || null,
    stats: o.stats || {}, bonds: o.bonds || [] }],
});

test('achievementStats: 奖杯 / 局数 / 胜场 / 最高回合', () => {
  const s = achievementStats([
    rec({ win: true, trophies: 3, rounds: 9 }),
    rec({ win: false, trophies: 1, rounds: 12 }),
    rec({ win: true, trophies: 2, rounds: 4, roomMode: 'coop' }),
  ]);
  assert.equal(s.trophies, 6, '奖杯累加');
  assert.equal(s.modes.solo.games, 2);
  assert.equal(s.modes.solo.wins, 1);
  assert.equal(s.modes.coop.games, 1);
  assert.equal(s.modes.coop.wins, 1);
  assert.equal(s.bestRound, 12, '最高回合取最大');
});

test('achievementStats: 绝境突破只算 绝境 / 终极', () => {
  const s = achievementStats([
    rec({ win: true, difficulty: 'HARD' }),
    rec({ win: true, difficulty: 'ABYSS' }),
    rec({ win: true, difficulty: 'NORMAL' }),
  ]);
  assert.equal(s.modes.solo.hard, 2, 'HARD + ABYSS 各算一次，NORMAL 不算');
});

test('achievementStats: 盟约与策略的 top-3、战果纪录、特殊标识', () => {
  const s = achievementStats([
    rec({ win: true, difficulty: 'HARD', bandId: 'b1', bonds: [{ bondId: 'x', active: true, layers: 6 }, { bondId: 'y', active: true, layers: 2 }] }),
    rec({ win: true, difficulty: 'NORMAL', bandId: 'b1', bonds: [{ bondId: 'x', active: true, layers: 4 }] }),
    rec({ win: false, bandId: 'b2', bonds: [{ bondId: 'y', active: true, layers: 1 }] }),
  ]);
  assert.deepEqual(s.topBonds.map((b) => b.bondId), ['x', 'y']);
  assert.equal(s.topBonds[0].games, 2);
  assert.deepEqual(s.topBands.map((b) => b.bandId), ['b1', 'b2']);
  assert.deepEqual(s.markedBands, ['b1'], '只有绝境/终极胜利的策略带标识');
  assert.equal(s.best.bondId, 'x');
  assert.equal(s.best.layers, 6, '战果纪录取叠加最高的一局');
});

test('achievementStats: 空输入不炸', () => {
  const s = achievementStats([]);
  assert.equal(s.trophies, 0);
  assert.deepEqual(s.topBonds, []);
  assert.equal(s.best, null);
  assert.equal(achievementStats(null).trophies, 0);
});

test('bondOperators: 按阶位排序，每个干员一条，排除隐藏 / 精锐 / 自选', () => {
  const list = [
    { chessId: 'a', charId: 'ca', tier: 3, bonds: ['x'] },
    { chessId: 'b', charId: 'cb', tier: 1, bonds: ['x'] },
    { chessId: 'a2', charId: 'ca', tier: 3, bonds: ['x'], isGolden: true },
    { chessId: 'h', charId: 'ch', tier: 1, bonds: ['x'], isHidden: true },
    { chessId: 'z', charId: 'cz', tier: 1, bonds: ['y'] },
  ];
  assert.deepEqual(bondOperators(list, 'x').map((c) => c.chessId), ['b', 'a'], '低阶在前，同一干员只留一条');
});

test('★ 数据源是本机记录，不是账号', () => {
  const src = read('public/js/ui/achievements.js');
  assert.match(src, /import \{ loadStats, countsTowardStats, selfRowOf, roundsOf \} from '\.\/stats\.js'/, 'loadStats 来自 ui/stats.js');
  assert.match(src, /loadStats\(\)\.records/, '从本机记录取数');
  // 账号相关的 import 一个都不许有
  for (const bad of ['./accounts.js', './cloudStats.js', './trophies.js', './friends.js', './namecards.js']) {
    assert.ok(!src.includes(`from '${bad}'`), `不该再 import ${bad}`);
  }
  // 账号相关的调用也不该有
  for (const bad of ['useCurrentAccount', 'openAccountPanel', 'useRecords', 'loadFriendRecords', 'importDeviceRecords', 'NameCardLayer']) {
    assert.ok(!src.includes(bad), `不该再调用 ${bad}`);
  }
});

test('入口卡与面板都在，奖杯图标是本地组件', () => {
  const src = read('public/js/ui/achievements.js');
  assert.match(src, /export function AchievementEntry\(\{ onOpen \}\)/);
  assert.match(src, /export function AchievementPanel\(\{ me, onClose \}\)/);
  assert.match(src, /function TrophyBadge\(\{ count \}\)/, '本地奖杯组件');
  assert.match(src, /class="hub-ach"/, '入口卡');
  // 面板的脚注说明数据在本机
  assert.match(src, /本机记录 · 保存在这台设备的浏览器里 · 每局结束后更新/);
});

test('HEX_TITLES: 六条评语，官方顺序', () => {
  assert.deepEqual(HEX_TITLES, ['comment_4', 'comment_5', 'comment_6', 'comment_1', 'comment_2', 'comment_3']);
});

test('大厅左栏接上了入口卡，点开是面板', () => {
  const lobby = read('public/js/screens/lobby.js');
  assert.match(lobby, /import \{ AchievementEntry, AchievementPanel \} from '\.\.\/ui\/achievements\.js'/);
  assert.match(lobby, /<\$\{AchievementEntry\} onOpen=\$\{\(\) => setAchOpen\(true\)\}/);
  assert.match(lobby, /achOpen \? html`<\$\{Modal\}[^`]*<\$\{AchievementPanel\}/s);
});
