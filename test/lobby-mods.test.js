// test/lobby-mods.test.js — Mod 开关 at the lobby level: `room.create { mods }` (MOD_KEYS, shared/constants.js).
//
// The 模式界面's Mod submenu is a per-device preference (public/js/ui/mods.js, localStorage) that the creator carries
// into the room it makes; the room keeps the switches across its matches and hands them to the match as `opts.mods`,
// which is what GameData reads (test/fork-mod-switches.test.js plays the rules; this suite plays the wire).
//
// Two things matter here and nowhere else:
//   * a room created WITHOUT mods must be exactly the official room — the room state says all-off and the match is
//     handed all-off, so a client that never opens the submenu cannot change anybody's game;
//   * a joiner plays the host's rules: the switches are the creator's, and nobody may change them afterwards (there is
//     no message for it — they are fixed when the room is created).
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { MOD_KEYS, MOD_DEFAULTS, normalizeMods } from '../shared/constants.js';

/** What the server must store for a payload that names only some switches: every catalogue key, the named ones set. */
const modsOf = (named = {}) => normalizeMods(named);

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

/** StubMatch that records the options each match was started with. */
const started = [];
class RecordingMatch extends StubMatch {
  constructor(opts) {
    super(opts);
    started.push(opts);
  }
}

describe('room.create mods (lobby)', () => {
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

  test('a room created without mods is the official room: room.state says all-off', async () => {
    const host = await pool.player('Host');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
    assert.deepEqual(st.mods, { ...MOD_DEFAULTS }, 'no switch is on');
    for (const k of MOD_KEYS) assert.equal(st.mods[k], false, k);
  });

  test('the creator carries its switches in: room.state shows them to everybody, and they reach the match', async () => {
    const host = await pool.player('Host');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: { noBondBan: true, untimedSp: true } });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
    assert.deepEqual(st.mods, modsOf({ noBondBan: true, untimedSp: true }));
    // a joiner plays the host's rules and sees them
    const guest = await pool.player('Guest');
    await ok(guest, { t: 'room.join', code: st.code });
    const js = await guest.waitFor('room.state', (s) => s.code === st.code && !!seatOf(s, guest.id));
    assert.deepEqual(js.mods, modsOf({ noBondBan: true, untimedSp: true }));
    // and the match is handed exactly them
    await ok(host, { t: 'room.addBot' });
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    const n = started.length;
    await ok(host, { t: 'room.start' });
    await guest.waitFor('room.state', (s) => s.inMatch);
    assert.equal(started.length, n + 1);
    assert.deepEqual(started[n].mods, modsOf({ noBondBan: true, untimedSp: true }), 'opts.mods');
  });

  test('a partial payload is completed with the official defaults', async () => {
    const host = await pool.player('Host');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: { noBondBan: true } });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
    assert.deepEqual(st.mods, modsOf({ noBondBan: true }));
    await ok(host, { t: 'room.addBot' });
    const n = started.length;
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => s.inMatch);
    assert.deepEqual(started[n].mods, modsOf({ noBondBan: true }));
  });

  test('an unknown switch key is refused before the room exists (a version mismatch, not a silent drop)', async () => {
    const host = await pool.player('Host');
    await err(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: { bogus: true } }, 'BAD_MSG');
    // the refusal left no room behind: the next create succeeds normally
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
    assert.deepEqual(st.mods, { ...MOD_DEFAULTS });
  });

  // 2026-10-16 (owner): the switches moved out of the lobby's Mod submenu into 房主配置, so they are room options the
  // host can change in the room (room.setMods). Everything below is that message's own contract.
  describe('room.setMods (the switches are 房主配置 room options now)', () => {
    test('the host flips one switch; everybody sees the same value and the other humans are un-readied', async () => {
      const host = await pool.player('Host');
      await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
      const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
      assert.deepEqual(st.mods, { ...MOD_DEFAULTS }, 'all off at creation when the creator carried none');
      const guest = await pool.player('Guest');
      await ok(guest, { t: 'room.join', code: st.code });
      await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));
      await ok(guest, { t: 'room.ready', ready: true });
      await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
      await ok(host, { t: 'room.setMods', key: 'extraRounds', on: true });
      const both = await guest.waitFor('room.state', (s) => s.mods?.extraRounds === true);
      assert.deepEqual(both.mods, modsOf({ extraRounds: true }), 'the room keeps exactly that one switch');
      assert.equal(seatOf(both, guest.id)?.ready, false, 'a gameplay change un-readies the other humans');
      // the match is handed the room's current switches, not the creator's original ones
      await ok(host, { t: 'room.addBot' });
      await ok(guest, { t: 'room.ready', ready: true });
      await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
      const n = started.length;
      await ok(host, { t: 'room.start' });
      await guest.waitFor('room.state', (s) => s.inMatch);
      assert.deepEqual(started[n].mods, modsOf({ extraRounds: true }), 'opts.mods');
    });

    test('only the host may flip them, and only with a real MOD_KEYS switch', async () => {
      const host = await pool.player('Host');
      await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
      const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
      const guest = await pool.player('Guest');
      await ok(guest, { t: 'room.join', code: st.code });
      await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));
      await err(guest, { t: 'room.setMods', key: 'noBondBan', on: true }, 'NOT_HOST');
      await err(host, { t: 'room.setMods', key: 'packExtra6', on: true }, 'BAD_MSG');
      await err(host, { t: 'room.setMods', key: 'noBondBan', on: 1 }, 'BAD_MSG');
      // a room with a match running refuses it, like every other room option
      await ok(host, { t: 'room.addBot' });
      await ok(guest, { t: 'room.ready', ready: true });
      await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
      await ok(host, { t: 'room.start' });
      await guest.waitFor('room.state', (s) => s.inMatch);
      await err(host, { t: 'room.setMods', key: 'noBondBan', on: true }, 'ROOM_STARTED');
    });

    test('the switches survive host migration: they belong to the room, not to the host', async () => {
      const host = await pool.player('Host');
      await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
      const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
      const guest = await pool.player('Guest');
      await ok(guest, { t: 'room.join', code: st.code });
      await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));
      await ok(host, { t: 'room.setMods', key: 'uncapLayers', on: true });
      await guest.waitFor('room.state', (s) => s.mods?.uncapLayers === true);
      await ok(host, { t: 'room.leave' });
      const migrated = await guest.waitFor('room.state', (s) => s.hostId === guest.id);
      assert.deepEqual(migrated.mods, modsOf({ uncapLayers: true }));
      // and the new host may now flip them
      await ok(guest, { t: 'room.setMods', key: 'uncapLayers', on: false });
      const off = await guest.waitFor('room.state', (s) => s.mods?.uncapLayers === false);
      assert.deepEqual(off.mods, { ...MOD_DEFAULTS });
    });
  });

  test('the switches are fixed for the room: the match gets them again, and nothing changes them mid-room', async () => {
    const host = await pool.player('Host');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: { untimedSp: true } });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
    const guest = await pool.player('Guest');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));
    await ok(host, { t: 'room.addBot' });
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    const n = started.length;
    await ok(host, { t: 'room.start' });
    await guest.waitFor('room.state', (s) => s.inMatch);
    assert.deepEqual(started[n].mods, modsOf({ untimedSp: true }));
    // the stub match ends once every human confirmed the briefing → the room keeps the switches for the next match
    guest.clearInbox();
    await ok(host, { t: 'g.infoReady' });
    await ok(guest, { t: 'g.infoReady' });
    const back = await guest.waitFor('room.state', (s) => !s.inMatch);
    assert.deepEqual(back.mods, modsOf({ untimedSp: true }), 'kept across the room\'s matches');
    // a second match gets them again
    const n2 = started.length;
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    await ok(host, { t: 'room.start' });
    await guest.waitFor('room.state', (s) => s.inMatch);
    assert.deepEqual(started[n2].mods, modsOf({ untimedSp: true }));
  });

  test('host migration keeps the switches: they belong to the room, not to the creator', async () => {
    const host = await pool.player('Host');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: { noBondBan: true } });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
    const guest = await pool.player('Guest');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));
    await ok(host, { t: 'room.leave' });
    const migrated = await guest.waitFor('room.state', (s) => s.hostId === guest.id);
    assert.deepEqual(migrated.mods, modsOf({ noBondBan: true }));
  });

  test('normalizeMods is what the lobby stores: a non-boolean value never switches anything on', async () => {
    // the protocol refuses it first, but the room's own normalisation must not depend on that
    assert.deepEqual(normalizeMods({ noBondBan: 1 }), modsOf());
    const host = await pool.player('Host');
    await err(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: { noBondBan: 1 } }, 'BAD_MSG');
  });
});
