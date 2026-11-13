// 危机合约 · G4/H3/H4 — the three routes that only needed wiring onto an existing seam.
import test from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../../server/match/gamedata.js';
import { crisisRules } from '../../shared/crisis.js';

const mk = (mode, tags) => {
  const gd = Object.create(GameData.prototype);
  gd._crisisFx = crisisRules({ mode, tags }).fx;
  return gd;
};

test('G4 资本冻结 — 第1–13回合的非基础收入延后，基础收入与第14回合不受影响', () => {
  const gd = mk('solo', ['G4-1']);
  for (const r of [1, 5, 13]) {
    assert.equal(gd.crisisFundsDeferred(r, 'sell'), true, 'R' + r + ' 出售延后');
    assert.equal(gd.crisisFundsDeferred(r, 'choice'), true, 'R' + r + ' 盟约/策略延后');
    assert.equal(gd.crisisFundsDeferred(r, 'income'), false, 'R' + r + ' 基础资金不延后');
  }
  assert.equal(gd.crisisFundsDeferred(14, 'sell'), false, '第14回合终局突袭休整期不冻结');
  assert.equal(mk('solo', []).crisisFundsDeferred(5, 'sell'), false, '无合约不冻结');
});

test('H3 授衔延误 — 合成奖励延至下一回合', () => {
  assert.equal(mk('solo', ['H3-1']).crisisDefersMergeReward(), true);
  assert.equal(mk('solo', []).crisisDefersMergeReward(), false, '无合约不延后');
});

test('H4 商店封存 — 主动刷新后最左侧干员格不可购买', () => {
  assert.equal(mk('solo', ['H4-1']).crisisSealsLeftmostShop(), true);
  assert.equal(mk('solo', []).crisisSealsLeftmostShop(), false, '无合约不封');
});
