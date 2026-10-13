// test/ui/in-match-spectate.test.js — 全模式战斗观战 (owner request, 2026-10-13):
// 「原版游戏中，作战时无法观战队友。改为：全模式（单人、同盟、终极模拟）都可以在战斗中观看队友视角。
//   要求：不改变原有战斗逻辑，只增加观战入口/切换功能。」
//
// WHAT WAS WRONG. The server always allowed it: `server/match/match/watch.js watch()` refuses only the OTHER pair's
// boss / hidden field, so a living player has been able to `g.watch` a teammate's ordinary field mid-battle all along
// (proved at the wire level by test/match/combat.test.js: 「switch to the teammate's field」 → `{ ok: true }` while
// their own battle still runs). The ENTRY POINT was gated on client-side combat: `screens/game.js` passed
// `observe=${cc ? {…} : null}`, and the fork runs server-run combat (`views.js` → `combatMode: 'server'`), so `cc` was
// always false → `TeamPanel` got `observe: null`, and `team__back` (「返回战场」) needs `observe.observing`, so an
// observing player had no way back to their own field either.
//
// This file pins the CLIENT decision that was fixed, plus the invariant that the battle logic itself was not touched:
// the server-run click watches at once and reports as observing; the client-run shape (canObserve) still opens
// 「前往查看」 first and never watches on a bare click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { teammateClickWatches, observeCanConfirm, teammateFieldShown } from '../../public/js/ui/teamPanel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PANEL = readFileSync(path.join(ROOT, 'public/js/ui/teamPanel.js'), 'utf8');
const GAME = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
const WATCH = readFileSync(path.join(ROOT, 'public/js/ui/gameLogic/watch.js'), 'utf8');
const SERVER_WATCH = readFileSync(path.join(ROOT, 'server/match/match/watch.js'), 'utf8');

/** A m.public teammate row as the panel sees it. */
const mate = { playerId: 'p_1', fieldId: 'n:p_1', name: '队友' };
/** The two `observe` shapes: client combat can ask (canObserve), server-run combat cannot. */
const CLIENT_OBSERVE = { canObserve: (p) => ({ fieldId: p.fieldId }), observing: false, onBack: () => {} };
const SERVER_OBSERVE = { observing: false, onBack: () => {} };

test('server-run combat: a teammate click watches at once, and only once', () => {
  // the fork's shape — the click is the entry point the owner asked for
  assert.equal(teammateClickWatches({ observe: SERVER_OBSERVE, watching: null, player: mate }), true,
    'a living player can open a teammate field mid-battle');
  assert.equal(teammateClickWatches({ observe: SERVER_OBSERVE, watching: 'n:p_1', player: mate }), false,
    'already on their field: do not re-request it');
  assert.equal(teammateClickWatches({ observe: SERVER_OBSERVE, watching: null, player: mate, askedRecently: true }), false,
    'the second click of a double-click must not fire twice');
  // …and still works when the panel was handed no observe at all (the pre-existing shape)
  assert.equal(teammateClickWatches({ observe: null, watching: null, player: mate }), true);
  assert.equal(teammateClickWatches({ watching: null, player: null }), false, 'no row, nothing to watch');
});

test('client-run combat keeps its confirm step: a bare click never watches', () => {
  assert.equal(observeCanConfirm(CLIENT_OBSERVE), true, 'canObserve marks the asking shape');
  assert.equal(observeCanConfirm(SERVER_OBSERVE), false, 'server-run combat cannot ask');
  assert.equal(observeCanConfirm(null), false);
  assert.equal(observeCanConfirm({ canObserve: 'not a function' }), false, 'a malformed descriptor cannot ask');
  // the client path opens 前往查看 instead — unchanged behaviour
  assert.equal(teammateClickWatches({ observe: CLIENT_OBSERVE, watching: null, player: mate }), false,
    'client combat opens 「前往查看」, it does not watch on click');
});

test('game.js hands the panel an observe in BOTH combat modes, so 返回战场 exists while watching', () => {
  // server-run combat: no canObserve, but `observing` + `onBack` — that is what renders the way home
  assert.match(GAME, /observe=\$\{cc\s*\?\s*\{ canObserve:/, 'client combat still asks through canObserve');
  assert.match(GAME, /:\s*\{ observing: watchingOther, onBack: backHome \}\}/, 'server-run combat reports observing + onBack');
  // …and the panel decides the click from that shape rather than from "is observe present"
  assert.match(PANEL, /const canObserve = observeCanConfirm\(observe\) \? observe\.canObserve : null;/);
  assert.match(PANEL, /const back = !!observe && self && observe\.observing;/);
  assert.match(PANEL, /\$\{t\('返回战场'\)\}/);
});

test('the battle logic itself is untouched: only the "own battle running" refusals were removed', () => {
  // the server keeps its one existing restriction, and gains no new one
  assert.match(SERVER_WATCH, /if \(\(f\.kind === 'boss' \|\| f\.kind === 'hidden'\) && own && own !== f\.fieldId\) return fail\(ERR\.BAD_TARGET, 'other group hidden'\)/);
  assert.ok(!/作战中无法查看队友/.test(SERVER_WATCH), 'the server never refuses a living player a teammate');
  // watchTarget (the server-run client path) has no "your own battle is still running" guard either — it mirrors the server
  assert.ok(!/own\.live !== false|作战中无法查看队友/.test(WATCH), 'watchTarget keeps mirroring the server');
  // the client-side-combat path HAD that guard (`battle/observe.js`); the owner's requirement of 2026-10-13 removed it so
  // 「全模式战斗中都可以观看其他玩家视角」 works in the browser, where client-run combat is the default
  const OBSERVE_JS = readFileSync(path.join(ROOT, 'public/js/battle/observe.js'), 'utf8');
  assert.ok(!/return \{ reason: t\('作战中无法查看/.test(OBSERVE_JS),
    'the client-side-combat guard is gone — a live own battle no longer refuses a teammate');
  assert.ok(!/own\.live !== false/.test(OBSERVE_JS), 'and no other copy of it is left behind');
  // what must NOT have been touched: the other pair's boss/hidden field is still hidden from a living player
  assert.match(OBSERVE_JS, /target\.kind === 'boss' \|\| target\.kind === 'hidden'/, 'the official boss-pair rule stays');
  // the server's client path keeps the same restriction (its "own battle running" refusal is gone, the boss one is not).
  // The check looks for the actual `fail(...)` call, not the prose: the doc comment above `_watchClient` quotes the removed
  // diagnostic on purpose, so a bare string search would match its own explanation.
  const CLIENT_WATCH = SERVER_WATCH.slice(SERVER_WATCH.indexOf('_watchClient'));
  assert.match(CLIENT_WATCH, /return fail\(ERR\.BAD_TARGET, 'other group hidden'\)/, 'the client path still hides the other pair\'s boss field');
  assert.ok(!/fail\(ERR\.WRONG_PHASE, 'own battle running'\)/.test(CLIENT_WATCH), 'and no longer refuses a live own battle');
});

test('单人 (solo) has nobody to watch, so the entry is inert there by construction', () => {
  // a solo room has exactly one human: the own row is the only row, and clicking it goes home rather than watching.
  // The panel keys every decision off the row list, so nothing is added for solo.
  assert.match(PANEL, /const players = sortedPlayers\(pub\);[\s\S]{0,80}if \(!players\.length\) return null;/);
  assert.match(PANEL, /if \(self\) \{ if \(observe\?\.observing\) observe\.onBack\(\); setOpenPid\(null\); return; \}/,
    'the own row always goes home; a teammate row is what watches');
});
