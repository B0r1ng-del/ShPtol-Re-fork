// `room.card`（名片干员）：房间座位卡上**这名博士展示的干员立绘**。
//
// 与 `room.skins` / `room.appearance` 同一类：纯外观、**公开**（队友看得见）、比赛中也接受。
// 但它比皮肤更小 —— 只有一个 charId，`''` 表示「默认」（座位卡按博士编号哈希挑一个，每个客户端算出同一个）。
//
// 这里钉四件事：
//   1. 形状：一个 charId 或 `''`，别的一律 BAD_MSG；
//   2. 跨客户端可见（变更即广播到 `room.state` 的 seat，以及 `m.public` 的 player）；
//   3. 未知干员被拒，且**不改动已有选择**；
//   4. 没选过的座位**不带这个键** —— 房间字节不因这个功能而变。
//
// Run: node --test test/lobby-card.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer } from '../server/index.js';
import { C2S, validateC2S } from '../shared/protocol.js';
import { TestClient } from './helpers/wsClient.js';

// ---------------------------------------------------------------------------------------------------
// 一、形状（纯函数，不起服务器）
// ---------------------------------------------------------------------------------------------------

describe('room.card：形状判据', () => {
  test('接受：一个 charId，或空串（默认）', () => {
    assert.equal(validateC2S({ t: 'room.card', charId: 'char_498_inside' }), null);
    assert.equal(validateC2S({ t: 'room.card', charId: '' }), null, '空串 = 清掉选择，回落到按编号自动分配');
  });

  test('拒绝：缺字段 / 非字符串 / 不像 charId / 太长的 id', () => {
    for (const bad of [
      { t: 'room.card' },
      { t: 'room.card', charId: 7 },
      { t: 'room.card', charId: null },
      { t: 'room.card', charId: 'chess_1_01' },
      { t: 'room.card', charId: 'nope' },
      { t: 'room.card', charId: `char_1_${'x'.repeat(200)}` },
    ]) {
      assert.ok(validateC2S(bad), `${JSON.stringify(bad)} 应当被拒`);
    }
  });

  test('进了 C2S 表（不是走 default 分支）', () => {
    assert.ok(Object.hasOwn(C2S, 'room.card'));
  });
});

// ---------------------------------------------------------------------------------------------------
// 二、真服务器端到端（两个真人同房：名片必须跨客户端可见，这是它存在的理由）
// ---------------------------------------------------------------------------------------------------

let srv;
const open = new Set();

const player = async (name) => {
  const c = await TestClient.connect(`${srv.url.replace(/^http/, 'ws')}/ws`);
  open.add(c);
  const w = await c.hello(name);
  c.id = w.playerId;
  c.token = w.token;
  c.roomState = null;
  return c;
};

const refresh = async (c, ms = 2000) => {
  let latest = null;
  for (;;) {
    try { latest = await c.waitFor('room.state', () => true, 0); } catch { break; }
  }
  if (latest) c.roomState = latest;
  if (latest) return latest;
  c.roomState = await c.waitFor('room.state', () => true, ms);
  return c.roomState;
};

const until = async (viewer, pred, ms = 2000) => {
  const end = Date.now() + ms;
  for (;;) {
    try { await refresh(viewer, Math.max(0, Math.min(150, end - Date.now()))); } catch { /* 超时 */ }
    if (pred(viewer.roomState)) return true;
    if (Date.now() >= end) return false;
  }
};

const pair = async () => {
  const host = await player('房主');
  const created = host.waitFor('room.state', (s) => s.hostId === host.id && s.code);
  assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
  host.roomState = await created;

  const guest = await player('客人');
  const joined = guest.waitFor('room.state', (s) => s.code === host.roomState.code && s.seats.some((x) => x && x.playerId === guest.id));
  assert.equal((await guest.request({ t: 'room.join', code: host.roomState.code })).t, 'ok');
  guest.roomState = await joined;
  host.roomState = await host.waitFor('room.state', (s) => s.seats.filter(Boolean).length === 2);
  return { host, guest };
};

const seatOf = (viewer, ownerId) => (viewer.roomState?.seats || []).find((s) => s && s.playerId === ownerId);

before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true }); });
after(async () => {
  await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
  open.clear();
  await srv?.close();
});

describe('room.card：真服务器端到端', () => {
  test('选定后**同房的人都看得到**，且没选的座位不带这个键', async () => {
    const { host, guest } = await pair();
    assert.equal((host.roomState.seats || []).every((s) => !s || s.card === undefined), true,
      '没选时座位不带 card 键 —— 房间字节不因这个功能而变');

    // 一个这台服务器真认识的干员（data/chess.json 里真实存在的 charId）
    const pick = 'char_498_inside';
    assert.equal((await host.request({ t: 'room.card', charId: pick })).t, 'ok', '已知干员必须被接受');
    assert.ok(await until(guest, () => seatOf(guest, host.id)?.card), '客人等到了房主的名片干员');
    assert.equal(seatOf(guest, host.id).card, pick);
    assert.equal(seatOf(host, guest.id).card, undefined, '客人没选 ⇒ 他那一席不带这个键');
  });

  test('清掉选择（空串）后座位重新不带这个键', async () => {
    const { host, guest } = await pair();
    const pick = 'char_498_inside';
    assert.equal((await host.request({ t: 'room.card', charId: pick })).t, 'ok');
    assert.ok(await until(guest, () => seatOf(guest, host.id)?.card === pick));

    assert.equal((await host.request({ t: 'room.card', charId: '' })).t, 'ok');
    assert.ok(await until(guest, () => seatOf(guest, host.id)?.card === undefined), '清掉后键消失，不是空串');
  });

  test('未知干员被拒，且**不改动已有选择**', async () => {
    const { host, guest } = await pair();
    const pick = 'char_498_inside';
    assert.equal((await host.request({ t: 'room.card', charId: pick })).t, 'ok');
    assert.ok(await until(guest, () => seatOf(guest, host.id)?.card === pick));

    const bad = await host.request({ t: 'room.card', charId: 'char_999_ghost' });
    assert.equal(bad.t, 'error');
    assert.equal(bad.code, 'BAD_MSG');
    assert.equal(seatOf(guest, host.id).card, pick, '一个坏消息不该把已经选好的清掉');
  });

  test('不在房间里发 ⇒ 不崩（不是 INTERNAL）', async () => {
    const c = await player('路人');
    const r = await c.request({ t: 'room.card', charId: 'char_498_inside' });
    assert.notEqual(r.code, 'INTERNAL', `不该是内部错误：${JSON.stringify(r)}`);
  });
});

// ---------------------------------------------------------------------------------------------------
// 三、与 room.skins 同口径（读源码钉住设计）
// ---------------------------------------------------------------------------------------------------

describe('room.card：与 room.skins 同口径', () => {
  test('比赛中也接受：处理器里没有 ROOM_STARTED 闸门（只有 match 不支持时才回那句话）', () => {
    const src = readFileSync(new URL('../server/lobby.js', import.meta.url), 'utf8');
    const i = src.indexOf('card(session, { charId })');
    assert.ok(i > 0, '处理器在');
    const body = src.slice(i, i + 900);
    assert.ok(!/if \(room\.match\) return fail\(ERR\.ROOM_STARTED/.test(body), '名片不因对局进行中而被拒 —— 它只改显示');
    assert.match(body, /seat\.card = kept/, '存到座位上');
  });

  test('客户端按「服务器认不认这条消息」决定是否同步（CARD_SYNC）', () => {
    const room = readFileSync(new URL('../public/js/screens/room.js', import.meta.url), 'utf8');
    assert.match(room, /export const CARD_SYNC = Object\.hasOwn\(C2S, 'room\.card'\)/);
    assert.match(room, /net\.request\('room\.card', \{ charId: myCard \|\| '' \}\)/);
  });
});
