// test/cheat-menu.test.js — 作弊菜单 (the floating cheat ball): the per-player cheats and their PREP gate.
//
// WHAT THIS PINS (owner request, three cheats):
//   无限金币        a switch  — while on the player cannot run out of funds; turning it off restores the funds they had
//                                when they turned it on
//   免费刷新 +5     a button  — one press adds 5 free shop refreshes
//   怪物血量降为1血  a switch  — every enemy of the player's OWN battles drops to 1 HP
//
// THE FOUR SCOPING RULES THE OWNER STATED, each measured here rather than assumed:
//   1. 只对开启的玩家生效        — the state lives on the player; a second player in the same room is untouched.
//   2. 怪物血量只对自身对局生效   — the enemy-HP switch is read only while building that player's own normal field, and
//                                the REAL sim is run to read the enemies' own `maxHp` (not a ratio recomputed here).
//   3. 联防阶段不生效            — 联防 builds its spec through `_uniteOpts`, which never reads the switch.
//   4. 只有在准备阶段生效        — `Match.cheat` refuses outside PREP and once the player is ready; the PROTOCOL layer
//                                refuses an unknown switch or a non-boolean value (the harness' `handle` bypasses it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch, give } from './match/harness.js';
import { createBattleFromSpec } from '../server/sim/spec.js';
import { normalizeEnemy } from '../server/sim/simdata.js';
import { validateC2S } from '../shared/protocol.js';
import {
  PHASE, CHEAT_KEYS, CHEAT_DEFAULTS, CHEAT_FREE_REFRESH_STEP, CHEAT_BOND_LAYER_STEP, CHEAT_ENEMY_HP, CHEAT_GOLD_FLOOR, MOD_KEYS,
} from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** The three min-3 莱茵生命 operators, used to activate a stackable 盟约 on the board. */
const MEMBERS = ['chess_rhine_astgenne_a', 'chess_rhine_dorothy_a', 'chess_rhine_mayer_a'];

/** A 2-human 同盟模拟 match sitting in round 1's PREP. `mods` turns content packs on for the bond tests. */
function prepMatch(mods = undefined) {
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, seed: 3, fake: true, mods }).start();
  h.toPrep(1);
  return h;
}

/** Run a field's battle options through the REAL sim and return the `maxHp` of every enemy it spawned. */
function spawnedHp(m, opts) {
  const battle = createBattleFromSpec({ ...opts, v: 1, battleId: 'probe' }, m.ds, { logger: () => {} });
  for (let i = 0; i < 240 && battle.time < 8; i++) battle.step(1 / 30);
  return [...battle.units.values()].filter((u) => u.side === 'enemy').map((u) => u.s.maxHp);
}

test('cheat menu — the switches exist, default OFF, and are their own list (not Mod 开关)', () => {
  assert.deepEqual([...CHEAT_KEYS], ['infiniteFunds', 'enemyOneHp']);
  assert.equal(CHEAT_DEFAULTS.infiniteFunds, false);
  assert.equal(CHEAT_DEFAULTS.enemyOneHp, false);
  assert.equal(CHEAT_FREE_REFRESH_STEP, 5);
  assert.equal(CHEAT_ENEMY_HP, 1);
  // a cheat must not be a Mod 开关: those are host-carried room rules, cheats are per player
  for (const k of CHEAT_KEYS) assert.ok(!MOD_KEYS.includes(k), `${k} must not be a MOD_KEY`);
});

test('cheat menu — 无限金币 lets a player spend without ever running out, and only that player', () => {
  const h = prepMatch();
  const a = h.ps('p_0');
  const b = h.ps('p_1');
  a.funds = 37;
  b.funds = 37;
  try {
    assert.equal(h.m.handle('p_0', { t: 'g.cheat', set: { infiniteFunds: true } }).ok, true);
    assert.equal(a.cheats.infiniteFunds, true);
    assert.equal(b.cheats.infiniteFunds, false, 'the other player is untouched');

    a._cheatTopUp();
    assert.ok(a.funds >= CHEAT_GOLD_FLOOR, `topped up to the floor (${a.funds})`);
    assert.equal(a.spend(5000), true, 'a huge purchase succeeds');
    a._cheatTopUp();
    assert.ok(a.funds >= CHEAT_GOLD_FLOOR, 'and it is topped up again');
    assert.equal(b.funds, 37, 'the other player never received any gold');
  } finally { h.m.dispose(); }
});

test('cheat menu — turning 无限金币 OFF restores the funds it was switched on with', () => {
  const h = prepMatch();
  const a = h.ps('p_0');
  try {
    a.funds = 37;
    h.m.handle('p_0', { t: 'g.cheat', set: { infiniteFunds: true } });
    assert.equal(a.cheatFundsSaved, 37, 'the funds it went on with are remembered');
    a._cheatTopUp();
    a.spend(10);

    h.m.handle('p_0', { t: 'g.cheat', set: { infiniteFunds: false } });
    assert.equal(a.cheats.infiniteFunds, false);
    assert.equal(a.funds, 37, 'restored to what it was, not to the floor');
    assert.equal(a.cheatFundsSaved, null, 'and the save is cleared');

    a.spend(1);
    assert.equal(a.funds, 36, 'with the switch off nothing is topped up');
  } finally { h.m.dispose(); }
});

test('cheat menu — one 「免费刷新 +5」 press grants 5 free refreshes, which the shop then consumes for free', () => {
  const h = prepMatch();
  const a = h.ps('p_0');
  const b = h.ps('p_1');
  try {
    const fr0 = a.shop.freeRefreshes;
    assert.equal(h.m.handle('p_0', { t: 'g.cheat', freeRefresh: true }).ok, true);
    assert.equal(a.shop.freeRefreshes, fr0 + CHEAT_FREE_REFRESH_STEP);
    assert.equal(b.shop.freeRefreshes, 0, 'the other player got nothing');

    a.funds = 100;
    a.refresh();
    assert.equal(a.funds, 100, 'a refresh on a free charge costs no gold');
    assert.equal(a.shop.freeRefreshes, fr0 + CHEAT_FREE_REFRESH_STEP - 1, 'and it consumed exactly one');
  } finally { h.m.dispose(); }
});

test('cheat menu — one 「盟约+100」 press adds 100 layers to every active stackable bond, to that player only', () => {
  const h = prepMatch({ packRhine: true });
  const a = h.ps('p_0');
  const b = h.ps('p_1');
  try {
    // Real board members, because recompute() derives `bonds` from what stands there: 3 members activate 莱茵生命
    // (and nothing else here), so it is the one stackable 盟约 that must move.
    for (const [i, id] of MEMBERS.entries()) give(h.m, a, id, 'board', [11, 3 + i]);
    a.recompute();
    assert.equal(a.bonds.rhineShip?.active, true, 'the members really activate 莱茵生命');
    assert.equal(a.layers.rhineShip ?? 0, 0, 'no layers yet');

    assert.equal(h.m.handle('p_0', { t: 'g.cheat', bondLayers: true }).ok, true);
    assert.equal(a.layers.rhineShip, CHEAT_BOND_LAYER_STEP);
    assert.equal(b.layers.rhineShip ?? 0, 0, 'the other player got nothing');

    // press again: one press = one +100, like the 免费刷新 button
    assert.equal(h.m.handle('p_0', { t: 'g.cheat', bondLayers: true }).ok, true);
    assert.equal(a.layers.rhineShip, 2 * CHEAT_BOND_LAYER_STEP, 'a second press adds another 100');

    // the cue the normal layer gains send, so the client shows the gain
    assert.ok(h.sent.some(([, m]) => m.t === 'm.layer' && m.bondId === 'rhineShip' && m.add === CHEAT_BOND_LAYER_STEP),
      'the gain rides the ordinary m.layer cue');
  } finally { h.m.dispose(); }
});

test('cheat menu — 盟约+100 skips inactive and non-stackable bonds', () => {
  const h = prepMatch({ packRhine: true });
  const a = h.ps('p_0');
  try {
    // 调和 (maniShip) is one of the four noStack 盟约: it has no layers at all, so adding to it would be a number
    // nothing reads. It must stay untouched even while active and counted.
    const mani = Object.values(h.m.gd._chess).find((c) => (c.bonds || []).includes('maniShip'));
    assert.ok(mani, 'the fixture data carries a 调和 operator');
    for (const [i, id] of MEMBERS.entries()) give(h.m, a, id, 'board', [11, 3 + i]);
    give(h.m, a, mani.chessId, 'board', [10, 3]);
    a.recompute();
    assert.equal(a.bonds.maniShip?.active, true, '调和 really is active here');
    const inactive = Object.entries(a.bonds).filter(([, v]) => v.active !== true).map(([k]) => k);

    h.m.handle('p_0', { t: 'g.cheat', bondLayers: true });
    assert.equal(a.layers.rhineShip, CHEAT_BOND_LAYER_STEP, 'the active stackable 莱茵生命 gained');
    assert.ok(!a.layers.maniShip, 'a noStack 盟约 gains nothing even while active');
    for (const id of inactive) assert.ok(!a.layers[id], `${id} is inactive and gained nothing`);
  } finally { h.m.dispose(); }
});

test('cheat menu — 怪物血量降为1血 lands every enemy on exactly 1 HP in the REAL sim, for that player only', () => {
  const h = prepMatch();
  const a = h.ps('p_0');
  const b = h.ps('p_1');
  try {
    // the untouched field: official HP, and the number the sim itself will multiply
    const key = h.m._normalOpts(a).spawns[0].enemyKey;
    assert.equal(normalizeEnemy(key, h.m.gd.enemy(key)).maxHp, h.m.gd.enemy(key).stats.maxHp,
      'the sim reads the record\'s stats.maxHp — the same number the cheat divides by');
    const off = spawnedHp(h.m, h.m._normalOpts(a));
    assert.ok(off.length > 0, `enemies really spawned (${off.length})`);
    assert.ok(off.every((x) => x > 1), 'with the switch off every enemy keeps its official HP');

    h.m.handle('p_0', { t: 'g.cheat', set: { enemyOneHp: true } });
    const on = spawnedHp(h.m, h.m._normalOpts(a));
    assert.ok(on.length > 0, `enemies really spawned (${on.length})`);
    assert.ok(on.every((x) => x === CHEAT_ENEMY_HP), `every enemy is exactly ${CHEAT_ENEMY_HP} HP (got ${JSON.stringify([...new Set(on)])})`);

    const other = spawnedHp(h.m, h.m._normalOpts(b));
    assert.ok(other.every((x) => x > 1), 'the other player still fights official-HP enemies');
  } finally { h.m.dispose(); }
});

test('cheat menu — 联防 never reads the enemy-HP switch (its spec is built by _uniteOpts)', () => {
  const h = prepMatch();
  try {
    h.m.handle('p_0', { t: 'g.cheat', set: { enemyOneHp: true } });
    // the shared field is a different builder; it must not consult the cheat at all
    const src = read('server/match/match/unitePhase.js');
    assert.ok(!/_cheatSpawns|enemyOneHp|hpMul/.test(src), 'unitePhase.js never mentions the cheat or hpMul');
    // and the helper itself is a no-op for anyone without the switch (the OTHER player here)
    const b = h.ps('p_1');
    const list = [{ enemyKey: 'x', mods: { slot: 'N' } }];
    assert.equal(h.m._cheatSpawns(b, list), list, 'a player without the switch gets the list back untouched');
  } finally { h.m.dispose(); }
});

test('cheat menu — PREP only: refused in COMBAT and refused once the player is ready', () => {
  const h = prepMatch();
  const a = h.ps('p_0');
  try {
    assert.equal(h.m.phase, PHASE.PREP);
    assert.equal(h.m.handle('p_0', { t: 'g.cheat', set: { infiniteFunds: true } }).ok, true);

    a.ready = true;
    assert.equal(h.m.handle('p_0', { t: 'g.cheat', set: { enemyOneHp: true } }).error, 'WRONG_PHASE',
      'a player who has locked in cannot cheat');
    a.ready = false;

    h.drive(() => h.m.phase === PHASE.COMBAT);
    assert.equal(h.m.phase, PHASE.COMBAT);
    assert.equal(h.m.handle('p_0', { t: 'g.cheat', set: { infiniteFunds: true } }).error, 'WRONG_PHASE',
      'cheats are PREP only');
  } finally { h.m.dispose(); }
});

test('cheat menu — the protocol rejects an unknown switch and a non-boolean value', () => {
  assert.equal(validateC2S({ t: 'g.cheat', set: { infiniteFunds: true } }), null);
  assert.equal(validateC2S({ t: 'g.cheat', set: { enemyOneHp: false } }), null);
  assert.equal(validateC2S({ t: 'g.cheat', freeRefresh: true }), null);
  assert.equal(validateC2S({ t: 'g.cheat', bondLayers: true }), null, 'the 盟约+100 press is a legal one-shot');
  assert.ok(validateC2S({ t: 'g.cheat', bondLayers: 1 }) !== null, 'and takes no payload but true');
  assert.equal(validateC2S({ t: 'g.cheat' }), null, 'every field is optional');
  assert.ok(validateC2S({ t: 'g.cheat', set: { bogusKey: true } }) !== null, 'an unknown switch is refused');
  assert.ok(validateC2S({ t: 'g.cheat', set: { infiniteFunds: 'yes' } }) !== null, 'a non-boolean is refused');
  assert.ok(validateC2S({ t: 'g.cheat', set: [] }) !== null, 'an array is not a switch map');
});

test('cheat menu — a bot can never cheat', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 1, bots: 1, seed: 5, fake: true }).start();
  h.toPrep(1);
  try {
    const botId = [...h.m.players.keys()].find((id) => h.m.players.get(id).isBot);
    assert.ok(botId, 'the match has a bot seat');
    const bot = h.m.players.get(botId);
    assert.ok(bot.isBot, `${botId} is the bot seat`);
    // two independent layers: the dispatcher refuses a seat that is not a connected client at all
    // (test/match/connection.test.js pins the same rule), and `Match.cheat` refuses `isBot` on its own
    assert.equal(h.m.handle(botId, { t: 'g.cheat', set: { infiniteFunds: true } }).error, 'NOT_IN_ROOM');
    assert.equal(h.m.cheat(bot, { set: { infiniteFunds: true } }).error, 'BAD_MSG');
    assert.equal(bot.cheats.infiniteFunds, false);
  } finally { h.m.dispose(); }
});

test('cheat menu — the client ball is device-local, off by default, and only in the prep phase', () => {
  const ui = read('public/js/ui/cheats.js');
  const game = read('public/js/screens/game.js');
  const actions = read('public/js/ui/gameActions.js');
  const settings = read('public/js/ui/settings.js');

  assert.match(ui, /loadPref\(PREF_CHEATS, false\)/, 'the ball preference defaults to off');
  assert.match(ui, /if \(!enabled\) return null;/, 'and an off device renders nothing at all');
  assert.match(ui, /CHEAT_ROWS/, 'the cheats are one declared list');
  assert.match(ui, /role="switch"/, 'the switches use the shared switch role');

  assert.match(actions, /cheatSet: \(key, on\) => act\('g\.cheat'/);
  assert.match(actions, /cheatFreeRefresh: \(\) => act\('g\.cheat', \{ freeRefresh: true \}/);
  assert.match(actions, /cheatBondLayers: \(\) => act\('g\.cheat', \{ bondLayers: true \}/);
  assert.match(game, /CheatBall/, 'the game screen mounts the ball');
  assert.match(game, /canUse=\$\{phase === PHASE\.PREP && !priv\?\.ready && !spectator\}/,
    'and only enables it in PREP, not-ready, non-spectator — the same gate the server applies');
  assert.match(settings, /显示作弊菜单/, 'the ball is turned on from 设置');
});

// The three checks below pin bugs a REAL BROWSER found (the probe in the PR body). Each one was invisible to a
// source-reading test and to the server suite, and each had a concrete measured symptom.

test('cheat menu — the dragged ball stays a 40×40 box (a fixed element may not keep right/bottom)', () => {
  const ui = read('public/js/ui/cheats.js');
  const css = read('public/css/screens/game-panels.css');
  // the default corner comes from the stylesheet's right/bottom …
  assert.match(css, /\.cheatball \{[^}]*right:[^}]*bottom:[^}]*\}/, 'the stylesheet anchors the default corner');
  // … so the inline position MUST clear them: a `position: fixed` box given all four offsets stretches instead of
  // sitting at the point, and the -50%/-50% centring then throws it off screen (measured 40×40 @ (1346,846) became
  // 1092×688 @ (-252,-146) before this was fixed).
  const styleLine = ui.split('\n').find((l) => l.includes('left:${(pos.x * 100)'));
  assert.ok(styleLine, 'the inline position is built in one place');
  assert.match(styleLine, /right:auto/, 'and it clears `right`');
  assert.match(styleLine, /bottom:auto/, 'and it clears `bottom`');
});

test('cheat menu — the ball preference is stored as an object key, not a bare boolean', () => {
  const ui = read('public/js/ui/cheats.js');
  const store = read('public/js/store.js');
  // store.js `createStore` keeps an OBJECT and spreads its argument: `createStore(false)` becomes `{}`, which is truthy,
  // so the ball would have rendered for every player on a device that never enabled it.
  assert.match(store, /let state = \{ \.\.\.initial \};/, 'createStore spreads its initial value');
  assert.match(ui, /createStore\(\{ on: cheatBallOn\(\) \}\)/, 'so the flag lives under `on`');
  assert.match(ui, /useStore\(\(s\) => s\.on === true, Object\.is, cheatBallStore\)/, 'and the hook reads that key');
  assert.match(ui, /cheatBallStore\.set\(\{ on: on === true \}\)/, 'and set() merges an object patch');
});

test('cheat menu — the pointer listeners are attached once, so a fast tap is not lost (ui detail)', () => {
  const ui = read('public/js/ui/cheats.js');
  // A `useEffect(() => …, [drag])` attaches its window listeners AFTER the render that set `drag`, so the `pointerup` of
  // a normal click can arrive first and the tap is swallowed (measured: a real mouse click did not open the panel).
  // The property that matters is the dependency list: the drag effect must NOT depend on any state it sets itself.
  const effect = ui.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[([^\]]*)\]\);/);
  assert.ok(effect, 'the drag effect is present');
  assert.equal(effect[1].trim(), '', `the drag effect must have an empty dependency list (got [${effect[1]}])`);
  assert.match(ui, /const drag = useRef\(null\)/, 'the in-flight drag is a ref, readable in the same tick');
  assert.ok(!/setDrag\(/.test(ui), 'no state round-trip gates the drag');
});
