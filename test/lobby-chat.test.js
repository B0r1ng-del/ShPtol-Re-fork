// test/lobby-chat.test.js — 在线聊天 (fork, 需求方 2026-10-16): the room option `onlineChat` and the `g.chat` / `m.chat`
// relay it gates.
//
// WHAT THIS SUITE PINS
//   1. the option is a normal 房主配置 room option (HOST_CONFIG_KEYS): OFF by default, host-only, and the match is handed
//      the same value — a room that never touches it behaves exactly as before (nothing is relayed at all);
//   2. the SERVER decides whether chat exists: a `g.chat` into a room with the option off is refused, so a client that
//      draws the window anyway cannot type into a room that has chat off;
//   3. the payload rules the protocol caps (CHAT_MAX_LEN, non-empty) and the one-a-second cooldown;
//   4. the line reaches the room carrying the SENDER's id — which is what the window resolves against room.state.seats
//      for the name and the avatar.
//
// The window's own rendering (ui/chat.js) is DOM; this suite is the wire, which is where the rules live.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { HOST_CONFIG_KEYS, HOST_CONFIG_DEFAULTS, CHAT_MAX_LEN, CHAT_COOLDOWN_MS } from '../shared/constants.js';

/** The options every match was constructed with (InstantMatch records them). */
const started = [];

function clientPool(getUrl) {
  const open = new Set();
  return {
    async connect() { const c = await TestClient.connect(getUrl()); open.add(c); return c; },
    async player(name) {
      const c = await this.connect();
      const w = await c.hello(name);
      c.id = w.playerId;
      return c;
    },
    async closeAll() { await Promise.all([...open].map((c) => c.terminate().catch(() => {}))); open.clear(); },
  };
}
const quietLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
const seatOf = (state, id) => state.seats.find((s) => s && s.playerId === id) || null;
/** Every frame of `type` the client has SEEN (the never-consumed log) — how a broadcast is counted here. */
const seen = (c, type) => c.log.filter((m) => m.t === type);

/** StubMatch that reaches PREP at once, so `g.chat` can be tried without a full lobby round trip. */
class InstantMatch extends StubMatch {
  constructor(opts) { super(opts); started.push(opts); }
  start() {
    if (this.disposed || this.ended) return;
    this.phase = 'PREP';
    this.broadcastFn(this.publicView());
    for (const p of this.players.values()) if (!p.isBot) this.sendFn(p.playerId, this.privateView(p));
  }
}

describe('在线聊天 (lobby option + g.chat relay)', () => {
  let server;
  let pool;

  before(async () => {
    const q = quietLog();
    server = await startServer({ port: 0, host: '127.0.0.1', log: q.log, MatchClass: InstantMatch, lobbyGraceMs: 60_000 });
    pool = clientPool(() => `ws://127.0.0.1:${server.port}/ws`);
  });
  after(async () => { await pool?.closeAll(); await server.close(); });

  /** Create a co-op room and return its `room.state`. */
  const roomOf = async (host, body = {}) => {
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', ...body });
    return host.waitFor('room.state', (s) => s.hostId === host.id);
  };

  test('the option is a HOST_CONFIG_KEYS row, OFF by default', () => {
    assert.ok(HOST_CONFIG_KEYS.includes('onlineChat'), 'onlineChat is a room option');
    assert.equal(HOST_CONFIG_DEFAULTS.onlineChat, false, 'and the official default is off');
  });

  test('a room that never touches it: room.state says off, and the match is handed off', async () => {
    const host = await pool.player('chatHostA');
    const st = await roomOf(host);
    assert.equal(st.hostConfig.onlineChat, false, 'off by default');
    await ok(host, { t: 'room.start' });
    assert.equal(started.at(-1).onlineChat, false, 'the match is handed the official value');
  });

  test('the host turns it on: everybody sees it, and the match gets it', async () => {
    const host = await pool.player('chatHostB');
    const st = await roomOf(host);
    const guest = await pool.player('chatGuestB');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));

    const next = guest.waitFor('room.state', (m) => m.hostConfig?.onlineChat === true);
    await ok(host, { t: 'room.setHostConfig', key: 'onlineChat', on: true });
    await next;   // the joiner sees the same value as the host

    await ok(guest, { t: 'room.ready', ready: true });   // every other human must be ready before 开始模拟
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    await ok(host, { t: 'room.start' });
    assert.equal(started.at(-1).onlineChat, true, 'and the match is handed it');
  });

  test('chat OFF: g.chat is refused, nothing is relayed', async () => {
    const host = await pool.player('chatHostC');
    const st = await roomOf(host);
    const guest = await pool.player('chatGuestC');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));
    await ok(guest, { t: 'room.ready', ready: true });   // every other human must be ready before 开始模拟
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    await ok(host, { t: 'room.start' });
    await guest.waitFor('m.public');
    guest.clearInbox();

    await err(guest, { t: 'g.chat', text: '有人吗' }, 'WRONG_PHASE');
    await guest.expectNone('m.chat', () => true, 120);
  });

  test('chat ON: the line reaches the room, tagged with the sender', async () => {
    const host = await pool.player('chatHostD');
    const st = await roomOf(host);
    const guest = await pool.player('chatGuestD');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));
    await ok(host, { t: 'room.setHostConfig', key: 'onlineChat', on: true });
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    await ok(host, { t: 'room.start' });
    await guest.waitFor('m.public');

    const onHost = host.waitFor('m.chat');
    const onGuest = guest.waitFor('m.chat');
    await ok(guest, { t: 'g.chat', text: '  集火左边  ' });

    const line = await onGuest;
    assert.equal(line.text, '集火左边', 'trimmed');
    assert.equal(line.playerId, guest.id, 'carries the sender, so the window can resolve the name + avatar');
    assert.equal(typeof line.seq, 'number', 'and a sequence number to order two lines');
    assert.equal((await onHost).playerId, guest.id, 'the host hears the same line, from the same sender');
  });

  test('the protocol caps: an empty message and an over-long one never leave the client', async () => {
    // this is the C2S table's own validator — what the server enforces before the match ever sees the message
    const { C2S } = await import('../shared/protocol.js');
    const check = C2S['g.chat'].text;
    assert.equal(check('hi'), true);
    assert.equal(check('   '), false, 'blank is refused');
    assert.equal(check('x'.repeat(CHAT_MAX_LEN)), true, 'exactly at the cap is fine');
    assert.equal(check('x'.repeat(CHAT_MAX_LEN + 1)), false, 'one over is not');
    assert.equal(check(''), false);
    assert.equal(check(undefined), false);
    assert.equal(check(42), false);
  });

  test('one message a second: a second send inside the cooldown is dropped', async () => {
    const host = await pool.player('chatHostE');
    await roomOf(host);
    await ok(host, { t: 'room.setHostConfig', key: 'onlineChat', on: true });
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public');
    host.clearInbox();

    await ok(host, { t: 'g.chat', text: '一' });
    await ok(host, { t: 'g.chat', text: '二' });     // inside CHAT_COOLDOWN_MS: dropped, not an error
    assert.equal(seen(host, 'm.chat').length, 1, 'only the first line was relayed');
    assert.equal(seen(host, 'm.chat')[0].text, '一');
    assert.ok(CHAT_COOLDOWN_MS > 0, 'the cooldown is a real window');
  });

  test('only the host may turn it on', async () => {
    const host = await pool.player('chatHostF');
    const st = await roomOf(host);
    const guest = await pool.player('chatGuestF');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));
    await err(guest, { t: 'room.setHostConfig', key: 'onlineChat', on: true }, 'NOT_HOST');
  });
});
