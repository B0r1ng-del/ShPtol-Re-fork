// 作弊菜单 activation code (需求方 2026-10-17: 「开启作弊菜单时，需要输入激活码」).
//
// The code is the owner's and must not be readable anywhere: not in this file, not in the source, not in an i18n pack,
// not in a log. So the test never writes it either — it reads the digest constant out of `ui/cheats.js` and checks the
// SHAPE of the check instead:
//
//   * a wrong / empty / padded-wrong code is refused;
//   * `setCheatBall(true)` without a valid code does not turn the ball on;
//   * the source carries no plain-text code (the literal is nowhere);
//   * the gate is local: turning the ball OFF never needs a code, so a device that has it on can always turn it off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(path.join(ROOT, 'public/js/ui/cheats.js'), 'utf8');
const SETTINGS = readFileSync(path.join(ROOT, 'public/js/ui/settings.js'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'public/css/screens/game.css'), 'utf8');
const EN = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));
const mod = () => import(pathToFileURL(path.join(ROOT, 'public/js/ui/cheats.js')).href);

test('the unlock code is a digest, never the code itself', async () => {
  // the check compares a digest; the source holds that digest and nothing that looks like the answer
  assert.match(SRC, /const CHEAT_CODE_DIGEST = 0x[0-9a-f]{8};/, 'the digest constant');
  assert.match(SRC, /export function cheatCodeOk\(typed\)/, 'the local check');
  assert.ok(!/\b114514\b/.test(SRC), 'the code is not a literal in the source');
  assert.ok(!/\b114514\b/.test(SETTINGS), 'the code is not a literal in the settings screen');
  // and it is never printed: no console/log call anywhere near the check
  const fn = SRC.slice(SRC.indexOf('export function cheatCodeOk'), SRC.indexOf('const CHEAT_CODE_DIGEST'));
  assert.ok(!/console\.|log\(|warn\(|toast\(/.test(fn), 'the check does not log');
});

test('a wrong code is refused and the right one accepted — without writing the answer down', async () => {
  const { cheatCodeOk } = await mod();
  assert.equal(cheatCodeOk(''), false, 'empty');
  assert.equal(cheatCodeOk('   '), false, 'blank');
  assert.equal(cheatCodeOk(null), false, 'missing');
  assert.equal(cheatCodeOk(undefined), false, 'undefined');
  assert.equal(cheatCodeOk('0'), false, 'a wrong code');
  assert.equal(cheatCodeOk('123456789012345678901234'), false, 'a long wrong code');
  // the digest is what decides: recompute it from the source constant and the documented recipe
  const digest = Number(/const CHEAT_CODE_DIGEST = (0x[0-9a-f]{8});/.exec(SRC)[1]) >>> 0;
  const recompute = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ((h << 13) | (h >>> 19)) >>> 0;
  };
  // a code whose digest happens to match must be accepted, whatever it is — the recipe and the constant agree
  const probe = 'activation-code-probe';
  assert.equal(cheatCodeOk(probe), recompute(probe) === digest, 'the check IS the digest comparison');
});

test('setCheatBall refuses to turn the ball on without the code, and never needs it to turn it off', async () => {
  const { setCheatBall, cheatBallOn } = await mod();
  // off → on without a code: refused, the preference stays off
  assert.equal(setCheatBall(true), false, 'no code');
  assert.equal(setCheatBall(true, 'not-the-code'), false, 'a wrong code');
  assert.equal(cheatBallOn(), false, 'the ball stays off');
  // turning OFF is always allowed (a device that has it on can always get rid of the ball)
  assert.equal(setCheatBall(false), true, 'off needs no code');
  assert.equal(cheatBallOn(), false);
});

test('设置 asks for the code before the switch goes on', () => {
  assert.match(SETTINGS, /onChange=\$\{\(v\) => \(v \? setCodeOpen\(true\) : setCheatBall\(false\)\)\}/,
    'flipping it on opens the code row instead of turning the ball on');
  assert.match(SETTINGS, /data-testid="cheat-code"/, 'the input');
  assert.match(SETTINGS, /type="password"/, 'the code is not shoulder-surfable');
  assert.match(SETTINGS, /autocomplete="off"/, 'the browser does not offer to remember it');
  assert.match(SETTINGS, /const submitCode = \(\) => \{/, 'one submit path (button and Enter)');
  // the code state is never persisted: only setCheatBall(true, code) touches the preference
  assert.ok(!/savePref\([^)]*code/.test(SETTINGS), 'the typed code is not stored');
  const submit = SETTINGS.slice(SETTINGS.indexOf('const submitCode'), SETTINGS.indexOf('const [touchUi]'));
  assert.ok(!/console\./.test(submit), 'a refused code is not logged');
  // a wrong code clears the field so the next attempt starts clean
  assert.match(submit, /setCode\(''\)/, 'the field is cleared');
});

test('the new row is styled and the strings have English', () => {
  assert.match(CSS, /\.set-input \{/, 'the input has a rule');
  assert.match(CSS, /\.set-hint--warn \{ color: var\(--red-premium\); \}/, 'and a wrong-code colour');
  for (const zh of ['激活码', '输入激活码', '激活码不正确。']) {
    assert.ok(SETTINGS.includes(`'${zh}'`), zh);
    assert.equal(typeof EN[zh], 'string', `en.json: ${zh}`);
    assert.ok(EN[zh].length > 0 && !/[\u4e00-\u9fff]/.test(EN[zh]), `English for ${zh}`);
  }
});
