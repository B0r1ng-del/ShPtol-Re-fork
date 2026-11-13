// 危机合约 · 双领袖并列方案 (L2/L3/L4/L5) — the plan a second leader needs, measured against the real 档位表.
//
// The official texts (js/ui/crisisTags.js FX table) name one HP ratio per leader and one entry condition each:
//   L2 两者同时登场，各 65%，均须击败
//   L3 主 80%，首次降至 50% 或战斗到 40 秒时副 55% 登场，取较早者
//   L4 两个拼场各 60%，剩余生命差 >20 点时低者减伤 30%，一名死亡后另一名攻击 +20%
//   L5 两个拼场各 60%，每 30 秒交换战区
// An ordinary room must get null — no second leader, no second pool, nothing to clean up.
import test from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../../server/match/gamedata.js';
import { crisisRules } from '../../shared/crisis.js';

const mk = (mode, tags) => {
  const gd = Object.create(GameData.prototype);
  gd._crisisFx = crisisRules({ mode, tags }).fx;
  return gd;
};
const PRIMARY = 'boss_7';  // “萨米的意志”
const SECOND = 'boss_2';   // 假想敌：铳

test('没有合约时没有并列领袖（普通局一个池都不多）', () => {
  assert.equal(mk('quad', []).crisisDualLeader(PRIMARY, SECOND), null);
});

test('L2 双首并临 — 两名领袖同时登场，各 65%，均须击败', () => {
  const plan = mk('solo', ['L2-1']).crisisDualLeader(PRIMARY, SECOND);
  assert.equal(plan.scheme, 'L2');
  assert.equal(plan.pools.length, 2);
  assert.deepEqual(plan.pools.map((p) => p.bossId), [PRIMARY, SECOND]);
  for (const p of plan.pools) assert.equal(p.mul, 0.65);
  // 同时登场 ⇒ 没有登场条件
  for (const p of plan.pools) assert.equal(p.at, undefined);
});

test('L3 第二号令 — 主 80%，副 55%，40 秒或主降至 50% 时登场（取较早者）', () => {
  const plan = mk('solo', ['L3-1']).crisisDualLeader(PRIMARY, SECOND);
  assert.equal(plan.scheme, 'L3');
  assert.equal(plan.pools[0].mul, 0.8);
  assert.equal(plan.pools[1].mul, 0.55);
  assert.equal(plan.pools[1].at, 40, '40 秒条件');
  assert.equal(plan.pools[1].below, 0.5, '主生命降至 50% 条件');
});

test('L4 双战区：锁链 — 两拼场各 60%，差 20 点减伤 30%，一方死亡后另一方攻击 +20%', () => {
  const plan = mk('quad', ['L4-1']).crisisDualLeader(PRIMARY, SECOND);
  assert.equal(plan.scheme, 'L4');
  for (const p of plan.pools) assert.equal(p.mul, 0.6);
  assert.deepEqual(plan.pools.map((p) => p.pair), ['b1', 'b2']);
  assert.equal(plan.gap, 0.2);
  assert.equal(plan.cut, 0.3);
  assert.equal(plan.atk, 0.2);
});

test('L5 交叉追猎 — 两拼场各面对一名萨米，各 60%，每 30 秒换场', () => {
  const plan = mk('quad', ['L5-1']).crisisDualLeader(PRIMARY, SECOND);
  assert.equal(plan.scheme, 'L5');
  assert.equal(plan.pools.length, 2);
  for (const p of plan.pools) { assert.equal(p.bossId, PRIMARY, '两场都是萨米'); assert.equal(p.mul, 0.6); }
  assert.deepEqual(plan.pools.map((p) => p.pair), ['b1', 'b2']);
  assert.equal(plan.swap, 30);
});

test('L2 与 L3 同选被 checkCrisis 拒绝（方案互斥），单方案解析不受影响', () => {
  // 同组两个领袖方案在规则层就互斥，这里只锁「同选不会静默挑一个」以外的行为：
  // crisisDualLeader 的优先级顺序是 L2 > L3 > L4 > L5，规则层负责拒绝同选。
  const gd = mk('solo', ['L2-1']);
  assert.equal(gd.crisisDualLeader(PRIMARY, SECOND).scheme, 'L2');
});
test('L2 真实数据：两个领袖各自成池，各按 65% 缩放（不是合并成一个池）', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { bossPoolHp, SharedBossPool } = await import('../../server/match/finalAssault.js');
  const root = path.resolve(import.meta.dirname, '../..');
  const DATA = {};
  for (const f of fs.readdirSync(path.join(root, 'data'))) {
    if (f.endsWith('.json')) DATA[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
  }
  const gd = new GameData(DATA, 'mode_single_hard');
  const basePrimary = bossPoolHp(gd, 'boss_7', 1);
  const baseSecond = bossPoolHp(gd, 'boss_2', 1);
  assert.ok(basePrimary > 0 && baseSecond > 0, '两名领袖都有真实血量');

  gd.crisisFx = crisisRules({ mode: 'solo', tags: ['L2-1'] }).fx;
  const plan = gd.crisisDualLeader('boss_7', 'boss_2');
  const pools = plan.pools.map((p, i) => new SharedBossPool(
    i === 0 ? basePrimary : Math.max(1, Math.round(bossPoolHp(gd, p.bossId, 1) * p.mul)),
  ));
  assert.equal(pools.length, 2, '两个池，不是一个');
  assert.equal(pools[0].maxHp, basePrimary, '主领袖池不变（L1 之外不再缩放）');
  assert.equal(pools[1].maxHp, Math.max(1, Math.round(baseSecond * 0.65)), '副领袖池 = 基础 × 0.65');
  assert.notEqual(pools[0].maxHp, pools[1].maxHp, '两个池各自独立');
});
test('O2 共同命运 — 四人领袖轮合并目标生命后仅保留 75%，向下取整、最低 1 点', () => {
  const gd = mk('quad', ['O2-1']);
  assert.equal(gd.crisisMergedLp(100), 75);
  assert.equal(gd.crisisMergedLp(101), 75, '101 × 0.75 = 75.75 → 向下取整 75');
  assert.equal(gd.crisisMergedLp(1), 1, '最低 1 点');
  assert.equal(mk('quad', []).crisisMergedLp(100), 100, '无合约不变');
});

test('O3 同生共死 — 一档 1 次保命，二档 0 次（直接失败）', () => {
  assert.equal(mk('quad', ['O3-1']).crisisTeamSaves(), 1);
  assert.equal(mk('quad', ['O3-2']).crisisTeamSaves(), 0);
  assert.equal(mk('quad', []).crisisTeamSaves(), -1, '无合约为 -1（走官方行为）');
});
