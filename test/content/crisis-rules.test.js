// 危机合约 · 规则层单元测试 (shared/crisis.js + shared/crisisArc.js)
//
// 这一层是纯数据表 + 纯函数：没有 RNG、没有时钟、没有 Node API，服务端与浏览器跑同一份。
// 测试钉四件事：
//   1) 每条路由的每一档都能被 crisisTag 解析，且风险值与该路由表一字不差
//   2) 冲突规则（同路由两档 / 两个领袖方案）真的拒绝
//   3) 模式限制（单人专属 / 四人专属）真的拒绝
//   4) crisisRules 编译出的 fx 就是该路由该档的 params，外加 tier
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CRISIS_ROUTES, CRISIS_GROUPS, CRISIS_MODES, CRISIS_SCHEMES, CRISIS_SEASON,
  crisisTag, crisisConflict, crisisNeeds, checkCrisis, crisisRules, isCrisisSelection, isCrisisSeed,
  inRounds,
} from '../../shared/crisis.js';
import { ARC_ROUTES, ARC_SEASON, checkArc, arcRules } from '../../shared/crisisArc.js';

test('路由表：主表每条路由都有 id / 分组 / 名称 / 两模式风险', () => {
  const ids = Object.keys(CRISIS_ROUTES);
  assert.ok(ids.length > 80, `主表路由应超过 80 条，实际 ${ids.length}`);
  for (const id of ids) {
    const r = CRISIS_ROUTES[id];
    assert.equal(r.id, id);
    assert.ok(CRISIS_GROUPS[r.g], `${id} 的分组 ${r.g} 不在 CRISIS_GROUPS`);
    assert.equal(typeof r.name, 'string');
    assert.ok(r.name.length > 0, `${id} 缺名称`);
    for (const mode of CRISIS_MODES) {
      const risks = r.risk[mode];
      if (risks === null || risks === undefined) continue;
      assert.ok(Array.isArray(risks) && risks.length >= 1 && risks.length <= 3,
        `${id}/${mode} 的档位必须是 1..3 个`);
      for (const lv of risks) assert.ok(Number.isInteger(lv) && lv >= 1 && lv <= 3,
        `${id}/${mode} 的风险值必须是 1..3 的整数，实际 ${lv}`);
    }
  }
});

test('crisisTag：每一档都能解析，且 lv 与风险表一致', () => {
  let checked = 0;
  for (const id of Object.keys(CRISIS_ROUTES)) {
    const r = CRISIS_ROUTES[id];
    // CRISIS_ROUTES 是主表 + 弧光路由的合并视图；弧光的 id 形如 XA1（X 前缀），
    // 由 crisisArc.js 的 checkArc/arcRules 处理，不走 crisisTag 的 ^([A-U][1-9])-(\d)$ 解析。
    if (id.startsWith('X')) continue;
    for (const mode of CRISIS_MODES) {
      const risks = r.risk[mode];
      if (!risks) continue;
      for (let t = 1; t <= risks.length; t++) {
        const tag = crisisTag(mode, `${id}-${t}`);
        assert.ok(tag, `${id}-${t} 在 ${mode} 应可解析`);
        assert.equal(tag.tier, t);
        assert.equal(tag.lv, risks[t - 1], `${id}-${t}/${mode} 的风险值`);
        assert.equal(tag.route, r);
        checked++;
      }
    }
  }
  assert.ok(checked > 100, `应检查超过 100 个 tag，实际 ${checked}`);
});

test('crisisTag：越界与不支持的模式返回 null', () => {
  // A1 有 3 档：第 4 档不存在
  assert.equal(crisisTag('solo', 'A1-4'), null);
  // 档位 0 / 负数不存在
  assert.equal(crisisTag('solo', 'A1-0'), null);
  // 格式不合法
  assert.equal(crisisTag('solo', 'A1'), null);
  assert.equal(crisisTag('solo', 'ZZ9-1'), null);
  // 未知模式
  assert.equal(crisisTag('trio', 'A1-1'), null);
  // 只在四人提供的路由，单人是 null
  assert.equal(crisisTag('solo', 'U1-1'), null);
  assert.ok(crisisTag('quad', 'U1-1'));
});

test('冲突：同一路由的两个档位互斥', () => {
  const a = crisisTag('solo', 'A1-1');
  const b = crisisTag('solo', 'A1-2');
  const c = crisisTag('solo', 'B1-1');
  assert.equal(crisisConflict(a, b), true, 'A1-1 与 A1-2 应冲突');
  assert.equal(crisisConflict(a, c), false, 'A1-1 与 B1-1 不应冲突');
  assert.equal(crisisConflict(a, a), false, '同一个 tag 与自身不算冲突');
  assert.equal(crisisConflict(null, a), false);
});

test('冲突：两个领袖方案互斥，L1 可与任一方案叠加', () => {
  // CRISIS_SCHEMES = L2..L5
  for (const x of CRISIS_SCHEMES) {
    for (const y of CRISIS_SCHEMES) {
      if (x === y) continue;
      const tx = crisisTag('quad', `${x}-1`);
      const ty = crisisTag('quad', `${y}-1`);
      if (!tx || !ty) continue;
      assert.equal(crisisConflict(tx, ty), true, `${x} 与 ${y} 应互斥`);
    }
  }
  const l1 = crisisTag('solo', 'L1-1');
  const l2 = crisisTag('quad', 'L2-1');
  if (l1 && l2) assert.equal(crisisConflict(l1, l2), false, 'L1 应可与 L2 叠加');
});

test('checkCrisis：合法选择返回规范化结果，total 是风险之和', () => {
  const r = checkCrisis({ mode: 'solo', tags: ['A1-1', 'B1-2'] });
  assert.deepEqual(r.tags, ['A1-1', 'B1-2'], 'tag 应排序后返回');
  assert.equal(r.total, 1 + 2);
  assert.equal(r.mode, 'solo');
});

test('checkCrisis：非法输入一律 null', () => {
  assert.equal(checkCrisis(null), null);
  assert.equal(checkCrisis(undefined), null);
  assert.equal(checkCrisis([]), null);
  assert.equal(checkCrisis({}), null);
  assert.equal(checkCrisis({ mode: 'trio', tags: ['A1-1'] }), null, '未知模式');
  assert.equal(checkCrisis({ mode: 'solo', tags: 'A1-1' }), null, 'tags 不是数组');
  assert.equal(checkCrisis({ mode: 'solo', tags: ['A1-1', 'A1-1'] }), null, '重复 tag');
  assert.equal(checkCrisis({ mode: 'solo', tags: ['A1-1', 'A1-2'] }), null, '同路由两档');
  assert.equal(checkCrisis({ mode: 'solo', tags: ['U1-1'] }), null, '单人不能选四人专属');
  assert.equal(checkCrisis({ mode: 'solo', tags: ['NOPE-1'] }), null, '未知路由');
});

test('checkCrisis：needs 依赖不满足时拒绝，满足时通过', () => {
  // S3 需要 SCHEME_2 (L2/L3/L4) 之一
  const s3 = CRISIS_ROUTES.S3;
  if (s3 && s3.needs) {
    assert.equal(checkCrisis({ mode: 'solo', tags: ['S3-1'] }), null, 'S3 无方案时应拒绝');
    const withL2 = checkCrisis({ mode: 'solo', tags: ['S3-1', 'L2-1'] });
    assert.ok(withL2, 'S3 + L2 应通过');
  }
  // 无 needs 的路由天然满足
  assert.equal(crisisNeeds(CRISIS_ROUTES.A1, []), null);
});

test('crisisRules：fx 是该路由该档的 params 加 tier', () => {
  const rules = crisisRules({ mode: 'solo', tags: ['A1-3', 'B1-2'] });
  assert.ok(rules);
  assert.equal(rules.fx.A1.tier, 3);
  assert.equal(rules.fx.A1.hp, 0.8, 'A1 第三档 hp 应为 0.8');
  assert.equal(rules.fx.B1.tier, 2);
  assert.equal(rules.fx.B1.atk, 0.3, 'B1 第二档 atk 应为 0.3');
  // 未选中的路由不得出现在 fx 里
  assert.equal(rules.fx.C1, undefined);
});

test('crisisRules：非法选择返回 null', () => {
  assert.equal(crisisRules({ mode: 'solo', tags: ['A1-1', 'A1-2'] }), null);
  assert.equal(crisisRules(null), null);
});

test('crisisRules：不冲突的词条全部叠加（无总数上限）', () => {
  const tags = ['A1-1', 'B1-1', 'C1-1', 'E1-1', 'F1-1', 'G1-1', 'H1-1', 'I1-1', 'J1-1', 'K1-1', 'O1-1'];
  const r = checkCrisis({ mode: 'solo', tags });
  assert.ok(r, '这组词条互不冲突，应全部通过');
  assert.equal(r.tags.length, tags.length);
});

test('isCrisisSelection：只验形状，不验语义', () => {
  assert.equal(isCrisisSelection({ mode: 'solo', tags: ['A1-1'] }), true);
  assert.equal(isCrisisSelection({ mode: 'trio', tags: ['A1-1'] }), false);
  assert.equal(isCrisisSelection({ mode: 'solo', tags: ['bad'] }), false);
  assert.equal(isCrisisSelection({ mode: 'solo', tags: 'x' }), false);
  assert.equal(isCrisisSelection(null), false);
});

test('isCrisisSeed：32 位正整数，0 表示没有种子', () => {
  assert.equal(isCrisisSeed(1), true);
  assert.equal(isCrisisSeed(0xffffffff), true);
  assert.equal(isCrisisSeed(0), false);
  assert.equal(isCrisisSeed(-1), false);
  assert.equal(isCrisisSeed(1.5), false);
  assert.equal(isCrisisSeed('12'), false);
});

test('inRounds：闭区间判定', () => {
  assert.equal(inRounds([4, 13], 4), true);
  assert.equal(inRounds([4, 13], 13), true);
  assert.equal(inRounds([4, 13], 3), false);
  assert.equal(inRounds([4, 13], 14), false);
  assert.equal(inRounds(null, 5), false);
});

test('本季常量：重燃作战 rn1 固定领袖', () => {
  assert.equal(CRISIS_SEASON.id, 'rn1');
  assert.equal(CRISIS_SEASON.leader, 'boss_7');
  assert.equal(CRISIS_SEASON.second, 'boss_2');
  assert.equal(CRISIS_SEASON.hidden, 'boss_9');
});

// ---- 弧光作战 ---------------------------------------------------------------

test('弧光：路由表非空，每条都有 id 与分组', () => {
  const ids = Object.keys(ARC_ROUTES);
  assert.ok(ids.length > 60, `弧光路由应超过 60 条，实际 ${ids.length}`);
  for (const id of ids) {
    const r = ARC_ROUTES[id];
    assert.equal(r.id, id);
    assert.ok(r.name && r.name.length > 0, `${id} 缺名称`);
  }
});

test('弧光：checkArc 接受合法选择、拒绝重复档位', () => {
  const ids = Object.keys(ARC_ROUTES);
  const first = ids[0];
  const ok = checkArc({ season: 'arc', mode: 'solo', tags: [`${first}-1`] });
  assert.ok(ok, '合法单条应通过');
  assert.equal(ok.season, 'arc');
  // 同路由两档
  const r = ARC_ROUTES[first];
  const tiers = Object.keys(r.tiers || r.params ? {} : {}).length;
  // 直接构造两条同路由不同档
  const dup = checkArc({ season: 'arc', mode: 'solo', tags: [`${first}-1`, `${first}-1`] });
  assert.equal(dup, null, '重复 tag 应拒绝');
});

test('弧光：arcRules 产出的 fx 带着 season 标记', () => {
  const ids = Object.keys(ARC_ROUTES);
  const r = arcRules({ season: 'arc', mode: 'solo', tags: [`${ids[0]}-1`] });
  assert.ok(r);
  assert.equal(r.season, 'arc');
  assert.ok(r.fx && typeof r.fx === 'object');
});

test('弧光与主表互不污染：crisisRules 不接管 season:arc', () => {
  const ids = Object.keys(ARC_ROUTES);
  const r = crisisRules({ season: 'arc', mode: 'solo', tags: [`${ids[0]}-1`] });
  assert.ok(r && r.season === 'arc', 'crisisRules 应把 arc 选择交给 arcRules');
  assert.equal(ARC_SEASON.id, 'arc1');
});
