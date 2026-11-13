// 危机合约 · 经济侧 (G/H group) — the base-income routes, asserted against GameData / a real PlayerState.
//
// The official texts (js/ui/crisisTags.js FX table) are the authority: G1 cuts the base income from round 7, G2
// withholds 2 for rounds 4–6 and pays it back at round 7. Both act on the BASE income only — "其他收入正常" — so a bond
// or item payment must be untouched. An ordinary room (crisisFx = null) must be byte-identical.
import test from 'node:test';
import assert from 'node:assert/strict';

import { GameData } from '../../server/match/gamedata.js';
import { crisisRules } from '../../shared/crisis.js';

const gdWith = (tags) => {
  const gd = Object.create(GameData.prototype);
  gd._crisisFx = tags ? crisisRules({ mode: 'solo', tags }).fx : null;
  return gd;
};

test('没有合约时两个经济帮手都是恒等（普通局一个数都不动）', () => {
  const gd = gdWith(null);
  for (const r of [1, 4, 7, 14]) {
    assert.equal(gd.crisisIncome(r, 5), 5, 'R' + r);
    assert.deepEqual(gd.crisisIncomeHold(r, 5), { withhold: 0, back: 0, cap: 0 }, 'R' + r);
  }
});

test('G1 预算削减 — 第7回合起每回合基础资金 −1/−2/−3，最低 0，之前不变', () => {
  const cases = { 'G1-1': 1, 'G1-2': 2, 'G1-3': 3 };
  for (const [tag, cut] of Object.entries(cases)) {
    const gd = gdWith([tag]);
    assert.equal(gd.crisisIncome(6, 5), 5, tag + ' 第6回合不动');
    assert.equal(gd.crisisIncome(7, 5), 5 - cut, tag + ' 第7回合生效');
    assert.equal(gd.crisisIncome(14, 5), 5 - cut, tag + ' 第14回合仍生效');
    assert.equal(gd.crisisIncome(7, 1), Math.max(0, 1 - cut), tag + ' 最低为 0，不出负数');
  }
});

test('G2 延期拨款 — 第4—6回合各扣留2点，第7回合一次性返还，窗口外不动', () => {
  const gd = gdWith(['G2-1']);
  assert.equal(gd.crisisIncomeHold(3, 5).withhold, 0, '第3回合不扣');
  for (const r of [4, 5, 6]) assert.equal(gd.crisisIncomeHold(r, 5).withhold, 2, '第' + r + '回合扣 2');
  const back = gd.crisisIncomeHold(7, 5);
  assert.equal(back.withhold, 0, '第7回合不再扣');
  assert.equal(back.back, 1, '第7回合发返还信号');
  assert.equal(back.cap, 6, '上限 6（3 回合 × 2）');
  assert.equal(gd.crisisIncomeHold(8, 5).back, 0, '第8回合不再发');
});

test('G2 收入本就不足时按实际扣（不虚报 6 点）', () => {
  const gd = gdWith(['G2-1']);
  assert.equal(gd.crisisIncomeHold(4, 1).withhold, 1, '只有 1 点就扣 1 点');
  assert.equal(gd.crisisIncomeHold(4, 0).withhold, 0, '0 点扣不动');
});

test('H1 频率限制 — 第4回合起每回合刷新上限 12/9/6，之前无上限', () => {
  const cases = { 'H1-1': 12, 'H1-2': 9, 'H1-3': 6 };
  for (const [tag, cap] of Object.entries(cases)) {
    const gd = gdWith([tag]);
    assert.equal(gd.crisisRefreshCap(3), Infinity, tag + ' 第3回合无上限');
    assert.equal(gd.crisisRefreshCap(4), cap, tag + ' 第4回合起生效');
    assert.equal(gd.crisisRefreshCap(14), cap, tag + ' 末回合仍生效');
  }
  assert.equal(gdWith(null).crisisRefreshCap(14), Infinity, '无合约无上限');
});

test('H2 升格管制 — 第1次升级不加价，第2次起每次 +2', () => {
  const gd = gdWith(['H2-1']);
  assert.equal(gd.crisisLevelUpPrice(1, 3), 3, '第1次升级：原价');
  assert.equal(gd.crisisLevelUpPrice(2, 3), 5, '第2次起：+2');
  assert.equal(gd.crisisLevelUpPrice(3, 3), 5, '第3次：仍 +2（每次加，不是累进）');
  assert.equal(gdWith(null).crisisLevelUpPrice(5, 3), 3, '无合约原价');
});

test('G3 集中采购税 — 每回合前3次购买原价，第4次起 +1', () => {
  const gd = gdWith(['G3-1']);
  for (const buys of [0, 1, 2]) assert.equal(gd.crisisBuyPrice(buys, 2), 2, '第' + (buys + 1) + '次原价');
  for (const buys of [3, 4, 9]) assert.equal(gd.crisisBuyPrice(buys, 2), 3, '第' + (buys + 1) + '次起 +1');
  assert.equal(gdWith(null).crisisBuyPrice(9, 2), 2, '无合约原价');
});

test('G1 与 G2 同选：先扣预算再扣留，互不覆盖', () => {
  const gd = gdWith(['G1-3', 'G2-1']);
  // 第5回合：只有 G2 生效
  assert.equal(gd.crisisIncome(5, 5), 5);
  assert.equal(gd.crisisIncomeHold(5, 5).withhold, 2);
  // 第7回合：G1 已生效
  assert.equal(gd.crisisIncome(7, 5), 2);
  assert.equal(gd.crisisIncomeHold(7, 5).back, 1, '第7回合同时发返还');
});
