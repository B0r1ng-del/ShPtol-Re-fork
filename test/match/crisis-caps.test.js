// 危机合约 · 数量/配额侧 (I/J/K/M 组) — every cap is measured, and every cap must be the identity without a contract.
import test from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../../server/match/gamedata.js';
import { crisisRules } from '../../shared/crisis.js';

const mk = (mode, tags) => {
  const gd = Object.create(GameData.prototype);
  gd._crisisFx = crisisRules({ mode, tags }).fx;
  return gd;
};

test('没有合约时全部配额都是恒等（普通局一个数都不动）', () => {
  const gd = mk('solo', []);
  assert.equal(gd.crisisDeployCap(8), 8);
  assert.equal(gd.crisisTeamDeployBudget(32, 4), 32);
  assert.equal(gd.crisisAdvancedItemCap(9), Infinity);
  assert.equal(gd.crisisEliteCap(), Infinity);
  assert.equal(gd.crisisActionCap(99), Infinity);
  assert.equal(gd.crisisLayerGainCap(), Infinity);
  assert.equal(gd.crisisHandSize(10), 10);
});

test('K1 编制上限 — 每名玩家在场干员上限 7/6', () => {
  assert.equal(mk('solo', ['K1-1']).crisisDeployCap(8), 7);
  assert.equal(mk('solo', ['K1-2']).crisisDeployCap(8), 6);
  // 上限只收窄不放宽：原本更低时保持低的那个
  assert.equal(mk('solo', ['K1-1']).crisisDeployCap(5), 5);
  assert.ok(mk('solo', ['K1-1']).crisisDeployCap(1) >= 1, '最低 1 位，不出 0');
});

test('K4 统筹部署 — 个人上限不变，全队额度 −6', () => {
  const gd = mk('quad', ['K4-1']);
  assert.equal(gd.crisisDeployCap(8), 8, '个人不能超过其原本上限');
  assert.equal(gd.crisisTeamDeployBudget(32, 4), 26, '四人共 32 位 → 26 位');
  assert.equal(gd.crisisTeamDeployBudget(8, 1), 2, '单人 8 位 → 2 位');
  assert.equal(gd.crisisTeamDeployBudget(2, 4), 4, '不低于每名玩家 1 位');
});

test('K1 与 K4 同选 — 上限取两者中较小的一个，K4 不再额外扣减', () => {
  const gd = mk('quad', ['K1-2', 'K4-1']);
  assert.equal(gd.crisisDeployCap(8), 6, '取 K1 的 6，不被 K4 再减 6');
});

test('J1 军备配给 — 场上进阶装备上限 6/4/2，基础装备不受限', () => {
  assert.equal(mk('solo', ['J1-1']).crisisAdvancedItemCap(0), 6);
  assert.equal(mk('solo', ['J1-2']).crisisAdvancedItemCap(0), 4);
  assert.equal(mk('solo', ['J1-3']).crisisAdvancedItemCap(0), 2);
});

test('J3 精锐限额 — 场上精锐干员最多 4/3 名', () => {
  assert.equal(mk('solo', ['J3-1']).crisisEliteCap(), 4);
  assert.equal(mk('solo', ['J3-2']).crisisEliteCap(), 3);
});

test('H5 流通审计 — 每休整期主动操作合计上限 30/22/16', () => {
  assert.equal(mk('solo', ['H5-1']).crisisActionCap(0), 30);
  assert.equal(mk('solo', ['H5-2']).crisisActionCap(0), 22);
  assert.equal(mk('solo', ['H5-3']).crisisActionCap(0), 16);
});

test('I4 整备层数限流 — 每种盟约每休整期新增上限 40/25/15', () => {
  assert.equal(mk('solo', ['I4-1']).crisisLayerGainCap(), 40);
  assert.equal(mk('solo', ['I4-2']).crisisLayerGainCap(), 25);
  assert.equal(mk('solo', ['I4-3']).crisisLayerGainCap(), 15);
});

test('M1 后备封存 — 常规手牌区 10 格降为 7 格', () => {
  assert.equal(mk('solo', ['M1-1']).crisisHandSize(10), 7);
  assert.equal(mk('solo', ['M1-1']).crisisHandSize(6), 6, '已更小时不放宽');
});
