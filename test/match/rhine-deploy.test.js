// test/match/rhine-deploy.test.js — 莱茵生命科研装置的部署 / 收回 (owner report 2026-10-15).
//
// THE BUG: with 莱茵生命 active, clicking a device in the 科研备牌区 and then a legal board tile answered 无效的目标
// (BAD_TARGET) and the device never left the reserve. Two independent gaps, both within one flow:
//
//   1. `PlayerPieces.find(uid)` scanned hand / temp / board (and items on those) but NOT the 科研位. A device lives in
//      `research.hand` (player/research.js), so `move()` returned BAD_TARGET before it ever reached
//      `_moveTokenToBoard` — the method that actually understands a device. `_detach` had the same hole: even with
//      find() fixed, moving would leave the old reserve slot occupied.
//   2. The PROTOCOL target() rejected `{ area: 'research' }`, so 收回 (RhineDock's `onRecall`, `g.move {to:{area:'research'}}`)
//      never reached the server at all and the client reported 无效的请求 (BAD_MSG).
//
// WHAT THIS PINS: the reserve is a first-class location — findable, detachable and addressable — and the whole
// deploy → recall → redeploy loop works, including its own refusal cases (capacity, locked laser, wrong area).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give } from './harness.js';
import { validateC2S } from '../../shared/protocol.js';
import { RHINE_BOND, RHINE_DEVICES } from '../../shared/rhineResearch.js';
import { tileKey } from '../../server/match/board.js';

/** The three min-3 莱茵生命 operators the pack carries (their bond membership grants the devices). */
const MEMBERS = ['chess_rhine_astgenne_a', 'chess_rhine_dorothy_a', 'chess_rhine_mayer_a'];

/**
 * A 1-human 同盟 match in PREP with 莱茵生命 active on real board members.
 *
 * The members must be REAL pieces on the board: `ps.recompute()` derives `ps.bonds` from what actually stands there and
 * `research._syncResearch()` pulls a device back off the board the moment its bond stops qualifying, so a bond object
 * written by hand would be undone by the first deploy.
 */
function rhinePrep(count = 3) {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 3, mods: { packRhine: true } }).start().toPrep();
  const ps = h.ps('p_0');
  MEMBERS.slice(0, count).forEach((id, i) => give(h.m, ps, id, 'board', [11, 3 + i]));
  ps.recompute();
  assert.equal(ps.bonds[RHINE_BOND]?.count, count, `the ${count} members must really activate ${RHINE_BOND}`);
  return { h, m: h.m, ps };
}

const devices = (ps) => ps.research.hand.filter(Boolean);

test('1. the reserve is findable: find() locates a 科研装置 in the 科研位', () => {
  const { m, ps } = rhinePrep();
  const dev = devices(ps)[0];
  assert.ok(dev, 'a 3-person 莱茵生命 grants the two min-3 devices');
  const loc = ps.find(dev.uid);
  assert.ok(loc, 'find() must reach the reserve — this is the gap that answered 无效的目标');
  assert.equal(loc.area, 'research');
  assert.equal(loc.piece, dev);
  assert.equal(m.gd.token(dev.id) && true, true, 'and it is a real token record');
});

test('2. deploy: a device moves from the 科研位 to the board, emptying its slot', () => {
  const { m, ps } = rhinePrep();
  const dev = devices(ps)[0];
  const before = devices(ps).length;
  const res = m.handle('p_0', { t: 'g.move', uid: dev.uid, to: { area: 'board', row: 12, col: 8 }, dir: 'RIGHT' });
  assert.deepEqual(res, { ok: true }, '部署 must succeed, not 无效的目标');
  assert.equal(ps.board.get(tileKey(12, 8))?.uid, dev.uid, 'the device stands on the tile');
  assert.equal(devices(ps).length, before - 1, '_detach emptied the reserve slot (else the fixed slot stays occupied)');
  assert.ok(ps.research.hand.every((p) => !p || p.uid !== dev.uid), 'and no copy is left behind');
});

test('3. recall: 收回 sends the device back to its own reserve slot', () => {
  const { m, ps } = rhinePrep();
  const dev = devices(ps)[0];
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: dev.uid, to: { area: 'board', row: 12, col: 8 }, dir: 'RIGHT' }), { ok: true });
  const res = m.handle('p_0', { t: 'g.move', uid: dev.uid, to: { area: 'research' } });
  assert.deepEqual(res, { ok: true }, '收回 must be accepted (it used to die in the protocol as 无效的请求)');
  assert.equal(ps.board.has(tileKey(12, 8)), false, 'the tile is free again');
  assert.ok(devices(ps).some((p) => p.uid === dev.uid), 'and the device is back in the reserve');
});

test('4. the deploy → recall → redeploy loop closes without leaking a uid or a slot', () => {
  const { m, ps } = rhinePrep();
  const dev = devices(ps)[0];
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: dev.uid, to: { area: 'board', row: 12, col: 8 }, dir: 'RIGHT' }), { ok: true }, `deploy #${i + 1}`);
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: dev.uid, to: { area: 'research' } }), { ok: true }, `recall #${i + 1}`);
  }
  assert.equal(ps.find(dev.uid)?.area, 'research', 'the uid still resolves, in the reserve');
  assert.equal(devices(ps).length, RHINE_DEVICES.filter((d) => d.minCount <= 3).length, 'the reserve holds exactly the unlocked devices');
});

test('5. the protocol accepts the reserve as a target, and still refuses nonsense', () => {
  assert.equal(validateC2S({ t: 'g.move', uid: 1, to: { area: 'research' }, rid: 1 }), null, 'area:research is a legal target');
  assert.equal(validateC2S({ t: 'g.move', uid: 1, to: { area: 'hand', idx: 0 }, rid: 1 }), null, 'hand unchanged');
  assert.equal(validateC2S({ t: 'g.move', uid: 1, to: { area: 'board', row: 1, col: 1 }, rid: 1 }), null, 'board unchanged');
  assert.match(String(validateC2S({ t: 'g.move', uid: 1, to: { area: 'nope' }, rid: 1 })), /to/, 'an unknown area is still BAD_MSG');
});

test('6. refusals keep their own reasons: capacity, the locked laser, and a foreign area', () => {
  const { m, ps } = rhinePrep(3);
  assert.equal(ps.research.hand[2], null, 'the laser (9 members) is not in the reserve at 3');
  const [a, b] = devices(ps);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: 12, col: 8 }, dir: 'RIGHT' }), { ok: true });

  // capacity 1 at 3 members: the second device is refused with its own error, not silently accepted
  const full = m.handle('p_0', { t: 'g.move', uid: b.uid, to: { area: 'board', row: 12, col: 9 }, dir: 'RIGHT' });
  assert.ok(!full.ok, 'the second device is refused while capacity is 1');
  assert.equal(full.error, 'BOARD_FULL');
  assert.equal(ps.board.has(tileKey(12, 9)), false, 'and it did not land');

  // a plain chess may not enter the reserve (its own message, from the client gate's counterpart on the server)
  const chess = ps.hand.find((p) => p && p.kind === 'chess') || ps.board.values().next().value;
  const wrong = m.handle('p_0', { t: 'g.move', uid: chess.uid, to: { area: 'research' } });
  assert.ok(!wrong.ok, 'a non-device cannot be parked in the 科研位');
  assert.equal(wrong.error, 'BAD_TARGET');
});

test('7. a device on the board still moves tile→tile like any token', () => {
  const { m, ps } = rhinePrep();
  const dev = devices(ps)[0];
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: dev.uid, to: { area: 'board', row: 12, col: 8 }, dir: 'RIGHT' }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: dev.uid, to: { area: 'board', row: 12, col: 7 }, dir: 'RIGHT' }), { ok: true });
  assert.equal(ps.board.get(tileKey(12, 7))?.uid, dev.uid, 'it really moved');
  assert.equal(ps.board.has(tileKey(12, 8)), false, 'and left the old tile');
});
