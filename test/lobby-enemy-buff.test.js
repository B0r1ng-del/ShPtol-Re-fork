// test/lobby-enemy-buff.test.js — 房主配置「对局选项」 (room.setEnemyBuff {key, steps}; room.state.enemyBuff): the four
// enemy buffs of a room (shared/constants.js HOST_ENEMY_KEYS / HOST_ENEMY_DEFAULTS / HOST_ENEMY_MAX_STEPS) — 怪物血量,
// 怪物攻击, 怪物防御, 怪物魔抗. Host-only, before the match, kept across the room's matches, and shown in EVERY mode
// (需求方 2026-10-15: 「确保该功能在所有模式中均通用」 — a buff on one's own enemies shares nothing with teammates, so
// 独立模拟 gets them too, unlike the 共享 hostConfig options).
//
// Where each one lands (the other half of this feature):
//   * `GameData.enemyScale` folds HP / ATK into the official round table, so every consumer of it — ordinary spawns,
//     部位, bounty adds, a leader's mid-fight summons (flags.enemyScale) and the client's own spec — inherits them;
//   * `GameData.enemyBuffDefRes` feeds DEF / RES into `waves.js roundMods` (they have no place in the round table);
//   * a leader's HP is the shared pool, so `GameData.bossPoolHp` / `finalAssault.bossPoolHp` apply `enemyBuff.hp` there.
// test/match/enemy-buff.test.js plays the numbers; this file is the lobby half.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, HOST_ENEMY_KEYS, HOST_ENEMY_DEFAULTS, HOST_ENEMY_MAX_STEPS, normalizeEnemyBuff, enemyBuffMul } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';

function clientPool(getUrl) {
  const open = new Set();
  return {
    async connect() { const c = await TestClient.connect(getUrl()); open.add(c); return c; },
    async player(name, token) {
      const c = await this.connect();
      const w = await c.hello(name, token);
      c.id = w.playerId;
      c.token = w.token;
      return c;
    },
    async closeAll() {
      await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
      open.clear();
    },
  };
}
const quietLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
const seatOf = (state, id) => state.seats.find((s) => s && s.playerId === id) || null;
async function createRoom(c, mode = 'coop') {
  await ok(c, { t: 'room.create', mode, difficulty: 'NORMAL' });
  return c.waitFor('room.state', (s) => s.hostId === c.id && s.mode === mode);
}
async function joinRoom(c, code) {
  await ok(c, { t: 'room.join', code });
  return c.waitFor('room.state', (s) => s.code === code && !!seatOf(s, c.id));
}

/** StubMatch that records the options each match was started with. */
const started = [];
class RecordingMatch extends StubMatch {
  constructor(opts) {
    super(opts);
    started.push(opts);
  }
}

test('constants: the four keys, their defaults, the 10 % step and the cap', () => {
  assert.deepEqual([...HOST_ENEMY_KEYS], ['enemyHp', 'enemyAtk', 'enemyDef', 'enemyRes']);
  assert.deepEqual({ ...HOST_ENEMY_DEFAULTS }, { enemyHp: 0, enemyAtk: 0, enemyDef: 0, enemyRes: 0 });
  assert.equal(HOST_ENEMY_MAX_STEPS, 10, '10 steps × 10 % = +100 %');
  // every mode may set them: the solo list is the whole list (they share nothing between players)
  assert.deepEqual([...HOST_ENEMY_KEYS], [...HOST_ENEMY_KEYS]);
});

test('normalizeEnemyBuff: exactly four integers in range, anything malformed is 0', () => {
  assert.deepEqual(normalizeEnemyBuff(undefined), { ...HOST_ENEMY_DEFAULTS }, 'nothing = the official numbers');
  assert.deepEqual(normalizeEnemyBuff({ enemyHp: 3 }), { enemyHp: 3, enemyAtk: 0, enemyDef: 0, enemyRes: 0 }, 'a partial record fills the rest');
  // clamped, truncated, and never NaN
  assert.deepEqual(normalizeEnemyBuff({ enemyHp: 99 }).enemyHp, HOST_ENEMY_MAX_STEPS, 'above the cap');
  assert.deepEqual(normalizeEnemyBuff({ enemyHp: -4 }).enemyHp, 0, 'below zero');
  assert.deepEqual(normalizeEnemyBuff({ enemyHp: 2.7 }).enemyHp, 2, 'truncated');
  for (const bad of [null, 'x', 5, [], { enemyHp: 'x' }, { enemyHp: NaN }, { enemyHp: Infinity }, { bogus: 3 }]) {
    const b = normalizeEnemyBuff(bad);
    assert.deepEqual(b, { ...HOST_ENEMY_DEFAULTS }, JSON.stringify(bad));
  }
  // an unknown key is dropped, not carried
  assert.deepEqual(Object.keys(normalizeEnemyBuff({ bogus: 3 })), [...HOST_ENEMY_KEYS]);
});

test('enemyBuffMul: null when nothing is buffed (the byte-identical path), else the four multipliers', () => {
  assert.equal(enemyBuffMul(undefined), null, 'no buff ⇒ nothing allocated, no number changed');
  assert.equal(enemyBuffMul({ ...HOST_ENEMY_DEFAULTS }), null, 'all zero is the same as absent');
  assert.equal(enemyBuffMul({ enemyHp: 0, enemyAtk: 0, enemyDef: 0, enemyRes: 0 }), null);
  assert.deepEqual(enemyBuffMul({ enemyHp: 1 }), { hp: 1.1, atk: 1, def: 1, res: 1 });
  // +10 % is not exact in binary floating point, so compare with a tolerance
  const all = enemyBuffMul({ enemyHp: 10, enemyAtk: 5, enemyDef: 2, enemyRes: 7 });
  for (const [k, want] of Object.entries({ hp: 2, atk: 1.5, def: 1.2, res: 1.7 })) {
    assert.ok(Math.abs(all[k] - want) < 1e-9, `${k}: ${all[k]} vs ${want}`);
  }
});

test('protocol: room.setEnemyBuff takes a HOST_ENEMY_KEYS key and an integer step count', () => {
  for (const key of HOST_ENEMY_KEYS) {
    for (const steps of [0, 1, 5, HOST_ENEMY_MAX_STEPS]) {
      assert.equal(validateC2S({ t: 'room.setEnemyBuff', key, steps }), null, `${key} ${steps}`);
    }
  }
  // an unknown key is refused before the lobby sees it (the list is normative in shared/constants.js)
  for (const key of [undefined, null, '', 'enemy', 'enemyHp ', 'ENEMYHP', 'itemSell', 1, {}, []]) {
    assert.notEqual(validateC2S({ t: 'room.setEnemyBuff', key, steps: 1 }), null, JSON.stringify(key));
  }
  // the step count must be an integer inside [0, HOST_ENEMY_MAX_STEPS]
  for (const steps of [undefined, null, -1, HOST_ENEMY_MAX_STEPS + 1, 2.5, '3', 'x', NaN, {}, []]) {
    assert.notEqual(validateC2S({ t: 'room.setEnemyBuff', key: 'enemyHp', steps }), null, JSON.stringify(steps));
  }
});

describe('room.setEnemyBuff (lobby)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: RecordingMatch, lobbyGraceMs: 60_000 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => {
    await srv?.close();
    assert.deepEqual(cap.errors, [], 'no server errors logged');
  });

  test('room.state carries all four at 0, and only the host may move one', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    assert.deepEqual(st.enemyBuff, { ...HOST_ENEMY_DEFAULTS }, 'every slider starts at the official numbers');
    const guest = await pool.player('Guest');
    const js = await joinRoom(guest, st.code);
    assert.deepEqual(js.enemyBuff, { ...HOST_ENEMY_DEFAULTS }, 'everybody sees the same values');
    await err(guest, { t: 'room.setEnemyBuff', key: 'enemyHp', steps: 3 }, ERR.NOT_HOST);
    await err(guest, { t: 'room.setEnemyBuff', key: 'enemyRes', steps: 10 }, ERR.NOT_HOST);
  });

  test('a change un-readies the other humans and is broadcast to every seat', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    const guest = await pool.player('Guest');
    await joinRoom(guest, st.code);
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    await ok(host, { t: 'room.setEnemyBuff', key: 'enemyHp', steps: 5 });
    const seen = await guest.waitFor('room.state', (s) => s.enemyBuff.enemyHp === 5);
    assert.equal(seen.enemyBuff.enemyAtk, 0, 'the other sliders are untouched');
    assert.equal(seatOf(seen, guest.id).ready, false, 'what they are about to fight changed: they confirm again');
    // the same value again changes nothing (still ok, no extra state frame needed)
    await ok(host, { t: 'room.setEnemyBuff', key: 'enemyHp', steps: 5 });
    await ok(host, { t: 'room.setEnemyBuff', key: 'enemyHp', steps: 0 });
    await guest.waitFor('room.state', (s) => s.enemyBuff.enemyHp === 0);
  });

  test('a single-seat room (独立模拟) may set them too — unlike the 共享 options', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host, 'solo');
    assert.deepEqual(st.enemyBuff, { ...HOST_ENEMY_DEFAULTS });
    // the 共享 option is refused in a solo room …
    await err(host, { t: 'room.setHostConfig', key: 'sharedPool', on: false }, ERR.BAD_TARGET);
    // … and every 对局选项 is not (no solo gate: a buff on one's own enemies shares nothing)
    for (const key of HOST_ENEMY_KEYS) {
      await ok(host, { t: 'room.setEnemyBuff', key, steps: 4 });
      const s = await host.waitFor('room.state', (v) => v.enemyBuff[key] === 4);
      assert.equal(s.enemyBuff[key], 4, `${key} in a solo room`);
    }
  });

  test('the match gets the values as opts.enemyBuff and the room keeps them across its matches', async () => {
    started.length = 0;
    const host = await pool.player('Host');
    await createRoom(host);
    await ok(host, { t: 'room.setEnemyBuff', key: 'enemyHp', steps: 8 });
    await host.waitFor('room.state', (s) => s.enemyBuff.enemyHp === 8);
    const n = started.length;
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => !!s.inMatch);
    assert.deepEqual(started[n].enemyBuff, { enemyHp: 8, enemyAtk: 0, enemyDef: 0, enemyRes: 0 }, 'opts.enemyBuff');
    // the match is running: the sliders are fixed for it, exactly like the switch rows
    await err(host, { t: 'room.setEnemyBuff', key: 'enemyHp', steps: 2 }, ERR.ROOM_STARTED);
    // the stub match ends once every human confirmed the briefing → back in the lobby with the values kept
    host.clearInbox();
    await ok(host, { t: 'g.infoReady' });
    const back = await host.waitFor('room.state', (s) => !s.inMatch);
    assert.deepEqual(back.enemyBuff, { enemyHp: 8, enemyAtk: 0, enemyDef: 0, enemyRes: 0 }, 'kept across the room\'s matches');
    // a second match gets the same value without re-setting it
    const m = started.length;
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => !!s.inMatch);
    assert.deepEqual(started[m].enemyBuff, { enemyHp: 8, enemyAtk: 0, enemyDef: 0, enemyRes: 0 });
  });

  test('a room created without them passes all-zero opts (the byte-identical path)', async () => {
    started.length = 0;
    const host = await pool.player('Host');
    await createRoom(host);
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => !!s.inMatch);
    assert.deepEqual(started[started.length - 1].enemyBuff, { ...HOST_ENEMY_DEFAULTS }, 'no switch, no number changed');
  });
});
