// test/lobby-host-config.test.js — 房主配置 (room.setHostConfig {key, on}; room.state.hostConfig): the four room options
// the host sets in the 准备房间 (shared/constants.js HOST_CONFIG_KEYS / HOST_CONFIG_DEFAULTS) — 共享卡池, 共享悬赏,
// 「AI 队友最后选择」 and 多同盟模式. Host-only, before the match, kept across the room's matches; the match gets them as
// opts (server/match/Match.js reads sharedPool / sharedBounty / multiAlliance; test/match/host-config.test.js plays them).
// The 私人房间 option of the same panel is out of scope (the user's call: 忽略私人房间的选项).
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, HOST_CONFIG_KEYS, HOST_CONFIG_DEFAULTS } from '../shared/constants.js';
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

test('protocol: room.setHostConfig takes a HOST_CONFIG_KEYS key and a boolean `on`', () => {
  for (const key of HOST_CONFIG_KEYS) {
    assert.equal(validateC2S({ t: 'room.setHostConfig', key, on: true }), null, key);
    assert.equal(validateC2S({ t: 'room.setHostConfig', key, on: false }), null, key);
  }
  // an unknown key is refused before the lobby sees it (the list is normative in shared/constants.js)
  for (const key of [undefined, null, '', 'shared', 'sharedPool ', 'privateRoom', 'SHAREDPOOL', 1, {}, []]) {
    assert.notEqual(validateC2S({ t: 'room.setHostConfig', key, on: true }), null, JSON.stringify(key));
  }
  for (const on of [undefined, null, 1, 0, 'true', 'yes', {}, []]) {
    assert.notEqual(validateC2S({ t: 'room.setHostConfig', key: 'sharedPool', on }), null, JSON.stringify(on));
  }
});

describe('room.setHostConfig (lobby)', () => {
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

  test('room.state carries every option at its official default, and the panel is host-only editable', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    assert.deepEqual(st.hostConfig, { ...HOST_CONFIG_DEFAULTS }, '共享卡池/共享悬赏 on, AI 队友最后选择/多同盟模式 off');
    assert.equal(st.hostConfig.sharedPool, true);
    assert.equal(st.hostConfig.sharedBounty, true);
    assert.equal(st.hostConfig.aiPicksLast, false);
    assert.equal(st.hostConfig.multiAlliance, false);
    const guest = await pool.player('Guest');
    const js = await joinRoom(guest, st.code);
    assert.deepEqual(js.hostConfig, { ...HOST_CONFIG_DEFAULTS });
    // only the host may change one — the guest sees the same values, read-only
    await err(guest, { t: 'room.setHostConfig', key: 'sharedPool', on: false }, ERR.NOT_HOST);
    await err(guest, { t: 'room.setHostConfig', key: 'multiAlliance', on: true }, ERR.NOT_HOST);
  });

  test('a change un-readies the other humans like a difficulty change, and every seat sees it', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    const guest = await pool.player('Guest');
    await joinRoom(guest, st.code);
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    await ok(host, { t: 'room.setHostConfig', key: 'multiAlliance', on: true });
    const on = await guest.waitFor('room.state', (s) => s.hostConfig.multiAlliance === true);
    assert.equal(on.hostConfig.sharedPool, true, 'the other options are untouched');
    assert.equal(seatOf(on, guest.id).ready, false, 'the rules changed: the guest confirms again');
    // the same value again changes nothing (still ok)
    await ok(host, { t: 'room.setHostConfig', key: 'multiAlliance', on: true });
    await ok(host, { t: 'room.setHostConfig', key: 'multiAlliance', on: false });
    await guest.waitFor('room.state', (s) => s.hostConfig.multiAlliance === false);
  });

  test('「AI 队友最后选择」 is one of the four: both messages set the same option', async () => {
    const host = await pool.player('Host');
    await createRoom(host);
    await ok(host, { t: 'room.setHostConfig', key: 'aiPicksLast', on: true });
    const viaPanel = await host.waitFor('room.state', (s) => s.hostConfig.aiPicksLast === true);
    assert.equal(viaPanel.aiPicksLast, true, 'the pre-existing room.state field follows the panel');
    // GitHub #338's own message still works and stays in step (the field's clients send it)
    await ok(host, { t: 'room.setAiPicksLast', on: false });
    const viaOld = await host.waitFor('room.state', (s) => s.hostConfig.aiPicksLast === false);
    assert.equal(viaOld.aiPicksLast, false, 'the panel follows room.setAiPicksLast too');
  });

  test('a solo room has nothing to share: the sharing options are refused and stay at their official values', async () => {
    const host = await pool.player('Solo');
    const st = await createRoom(host, 'solo');
    assert.deepEqual(st.hostConfig, { ...HOST_CONFIG_DEFAULTS });
    for (const key of ['sharedPool', 'sharedBounty', 'multiAlliance']) {
      await err(host, { t: 'room.setHostConfig', key, on: key !== 'multiAlliance' }, ERR.BAD_TARGET);
    }
    const after = await host.request({ t: 'room.setHostConfig', key: 'sharedPool', on: false });
    assert.equal(after.t, 'error');
    // room.setAiPicksLast keeps its own (older) diagnostic in a solo room
    await err(host, { t: 'room.setAiPicksLast', on: true }, ERR.BAD_TARGET);
  });

  test('the match gets every option at the start; they cannot change during it; the room keeps them for the next match and a new host', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    const guest = await pool.player('Guest');
    await joinRoom(guest, st.code);
    await ok(host, { t: 'room.addBot' });
    await ok(host, { t: 'room.setHostConfig', key: 'sharedPool', on: false });
    await ok(host, { t: 'room.setHostConfig', key: 'multiAlliance', on: true });
    await ok(host, { t: 'room.setHostConfig', key: 'aiPicksLast', on: true });
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => s.hostConfig.sharedPool === false && seatOf(s, guest.id)?.ready);
    const n = started.length;
    await ok(host, { t: 'room.start' });
    await guest.waitFor('room.state', (s) => s.inMatch);
    assert.equal(started.length, n + 1);
    assert.equal(started[n].sharedPool, false, 'opts.sharedPool');
    assert.equal(started[n].sharedBounty, true, 'opts.sharedBounty (untouched)');
    assert.equal(started[n].multiAlliance, true, 'opts.multiAlliance');
    assert.equal(started[n].aiPicksLast, true, 'opts.aiPicksLast');
    await err(host, { t: 'room.setHostConfig', key: 'sharedPool', on: true }, ERR.ROOM_STARTED);
    await err(guest, { t: 'room.setHostConfig', key: 'sharedPool', on: true }, ERR.NOT_HOST);
    // the stub match ends once every human confirmed the briefing → back in the lobby with the options kept
    guest.clearInbox();
    await ok(host, { t: 'g.infoReady' });
    await ok(guest, { t: 'g.infoReady' });
    const back = await guest.waitFor('room.state', (s) => !s.inMatch);
    assert.deepEqual(back.hostConfig, { sharedPool: false, sharedBounty: true, aiPicksLast: true, multiAlliance: true });
    // host migration keeps the room's settings
    await ok(host, { t: 'room.leave' });
    const migrated = await guest.waitFor('room.state', (s) => s.hostId === guest.id);
    assert.equal(migrated.hostConfig.multiAlliance, true);
    await ok(guest, { t: 'room.setHostConfig', key: 'multiAlliance', on: false });
    await guest.waitFor('room.state', (s) => s.hostConfig.multiAlliance === false);
  });

  test('without the panel the match gets the official values', async () => {
    const host = await pool.player('Host');
    await createRoom(host);
    await ok(host, { t: 'room.addBot' });
    const n = started.length;
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => s.inMatch);
    assert.equal(started[n].sharedPool, true);
    assert.equal(started[n].sharedBounty, true);
    assert.equal(started[n].multiAlliance, false);
    assert.equal(started[n].aiPicksLast, false);
  });
});
