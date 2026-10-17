// interp.rawAt：这一帧画的那个快照的**原始对象**（字段级、不插值的东西读它）。
//
// 为什么需要这条测试：render/app.js 的 syncBattle 每帧调 `interp.rawAt(t)?.kazdel`（卡兹戴尔众魂大炮的预警圈）。
// 这个方法一度**根本不存在** —— 一抛 TypeError 就中断了整帧，于是 sample() 之后那段「按快照建 / 更新单位视图」
// 一次都没跑过：局内所有干员与敌人都不显示、特效只进队列不释放、场上一个伤害数字也没有。
// 单测跑引擎时看不到，因为它只在浏览器渲染循环里发生。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer } from '../../public/js/render/interp.js';

/** A raw snapshot as the server sends it: one unit tuple plus a field-level `kazdel` block. */
const snap = (gt, cannonId) => ({ t: 'b.snap', gt, units: [[1, 0, 0, 10, 10, 0, 0, 0, 0]], kazdel: { cannons: [{ id: cannonId }] } });

test('rawAt：没有任何快照时是 null（首帧还没收到 b.snap）', () => {
  const b = new SnapshotBuffer();
  assert.equal(b.rawAt(0), null);
  assert.equal(b.rawAt(1.5), null);
});

test('rawAt：返回 renderT 所在那一格的原始快照，字段原样可达', () => {
  const b = new SnapshotBuffer();
  b.push(snap(1, 'c1'), 1.0);
  b.push(snap(2, 'c2'), 1.1);
  b.push(snap(3, 'c3'), 1.2);
  assert.equal(b.rawAt(1.5).kazdel.cannons[0].id, 'c1', '1.5 落在 t=1 与 t=2 之间 ⇒ 取旧的一端，与 sample() 同一条 clamp');
  assert.equal(b.rawAt(2.5).kazdel.cannons[0].id, 'c2');
  assert.deepEqual(b.rawAt(1.5).units[0], [1, 0, 0, 10, 10, 0, 0, 0, 0], '单位元组也还是原样（不插值）');
});

test('rawAt：超出两端时钳到最近的一格，永远不返回 undefined', () => {
  const b = new SnapshotBuffer();
  b.push(snap(1, 'c1'), 1.0);
  b.push(snap(2, 'c2'), 1.1);
  assert.equal(b.rawAt(0).kazdel.cannons[0].id, 'c1', '早于第一格 ⇒ 最旧的一格');
  assert.equal(b.rawAt(99).kazdel.cannons[0].id, 'c2', '晚于最后一格 ⇒ 最新的一格');
});

test('rawAt：时间不是有限数时给 null（不抛、不猜）', () => {
  const b = new SnapshotBuffer();
  b.push(snap(1, 'c1'), 1.0);
  // `undefined` deliberately absent: it is the default-parameter case (falls back to renderT), not a bad argument.
  for (const t of [NaN, Infinity, -Infinity, null, 'x']) assert.equal(b.rawAt(t), null, String(t));
});

test('rawAt：没有 kazdel 的快照照样能用（普通对局的每一帧都是这种）', () => {
  const b = new SnapshotBuffer();
  b.push({ t: 'b.snap', gt: 1, units: [[1, 0, 0, 10, 10, 0, 0, 0, 0]] }, 1.0);
  const raw = b.rawAt(1.2);
  assert.ok(raw, 'raw 对象本身要在');
  assert.equal(raw.kazdel, undefined, '缺这个字段 ⇒ 调用方拿到 undefined，不会抛');
  assert.equal(b.rawAt(1.2)?.kazdel, undefined, 'render/app.js 那一行就是可选链写法');
});
