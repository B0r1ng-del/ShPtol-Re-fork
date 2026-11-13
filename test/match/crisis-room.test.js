// 危机合约 · 房间层 (stage 2): the room mode, its seats, its difficulty and its state view.
//
// 这一层钉住的是「服务端自己守自己的门」：客户端的置灰只是装饰，真正拒绝的是这里。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Room } from '../../server/lobby.js';
import {
  ROOM_MODES, SEATS_BY_MODE, roomSeatCap, crisisSeatCap,
  CRISIS_ROOM_MODE, CRISIS_ROOM_DIFFICULTY, CRISIS_QUAD_SEATS,
} from '../../shared/constants.js';
import { checkCrisis, crisisRules } from '../../shared/crisis.js';

test('常量：crisis 是第四个房间模式，座位上限 4', () => {
  assert.ok(ROOM_MODES.includes('crisis'), 'crisis 应在 ROOM_MODES');
  assert.equal(ROOM_MODES.length, 4);
  assert.equal(SEATS_BY_MODE.crisis, CRISIS_QUAD_SEATS);
  assert.equal(roomSeatCap('crisis'), 4);
  assert.equal(CRISIS_ROOM_MODE, 'crisis');
  assert.equal(CRISIS_ROOM_DIFFICULTY, 'HARD');
});

test('crisisSeatCap：单人 1 座，四人 4 座，未知按 4 座', () => {
  assert.equal(crisisSeatCap('solo'), 1);
  assert.equal(crisisSeatCap('quad'), 4);
  assert.equal(crisisSeatCap(undefined), 4);
});

test('新房间默认没有合约，座位数按房间模式', () => {
  const r = new Room('AAAA', 'crisis', CRISIS_ROOM_DIFFICULTY, Date.now());
  assert.equal(r.crisis, null, '未设合约时必须是 null');
  assert.equal(r.seats.length, 4, '危机房默认 4 座（等人挑四人合约）');
});

test('普通房 room.state 不带 crisis 键（字节不变）', () => {
  for (const mode of ['solo', 'coop', 'ultimate']) {
    const r = new Room('BBBB', mode, 'HARD', Date.now());
    const st = r.toState(Date.now());
    assert.equal(Object.prototype.hasOwnProperty.call(st, 'crisis'), false, `${mode} 房不应带 crisis`);
  }
});

test('合约房 room.state 带完整 crisis：mode/tags/total/fx', () => {
  const sel = { mode: 'quad', tags: ['A1-1', 'B1-2'] };
  const checked = checkCrisis(sel);
  assert.ok(checked, 'A1-1 + B1-2 应是合法选择');
  const r = new Room('CCCC', 'crisis', CRISIS_ROOM_DIFFICULTY, Date.now());
  r.crisis = Object.freeze({ ...checked, tags: Object.freeze(checked.tags.slice()), fx: crisisRules(checked).fx });
  const st = r.toState(Date.now());
  assert.ok(st.crisis, '合约房必须带 crisis');
  assert.equal(st.crisis.mode, 'quad');
  assert.deepEqual(st.crisis.tags, ['A1-1', 'B1-2']);
  assert.equal(st.crisis.total, 3);
  // A1 的三档是 t3({hp:0.25},{hp:0.5},{hp:0.8})，第一档是 0.25
  assert.equal(st.crisis.fx.A1.hp, 0.25, 'A1 第一档 hp');
  assert.equal(st.crisis.fx.B1.atk, 0.3, 'B1 第二档 atk');
});

test('单人合约把座位收窄到 1 座（与 create 同一做法）', () => {
  const r = new Room('DDDD', 'crisis', CRISIS_ROOM_DIFFICULTY, Date.now());
  const sel = { mode: 'solo', tags: ['A1-1'] };
  const checked = checkCrisis(sel);
  r.crisis = Object.freeze({ ...checked, tags: Object.freeze(checked.tags.slice()), fx: crisisRules(checked).fx });
  // create() 对单人合约做的那一行
  if (checked.mode === 'solo') r.seats = new Array(1).fill(null);
  assert.equal(r.seats.length, 1);
  assert.equal(r.crisis.mode, 'solo');
});

test('fx 是 room.state 里那一份的同一个内容（面板与战斗不可能对不上）', () => {
  const sel = { mode: 'solo', tags: ['A1-3', 'B1-1', 'O1-1'] };
  const fx = crisisRules(sel).fx;
  const r = new Room('EEEE', 'crisis', CRISIS_ROOM_DIFFICULTY, Date.now());
  r.crisis = Object.freeze({ ...checkCrisis(sel), tags: Object.freeze(checkCrisis(sel).tags.slice()), fx });
  const st = r.toState(Date.now());
  assert.deepEqual(st.crisis.fx, fx, 'room.state 的 fx 必须就是编译出来那一份');
});
