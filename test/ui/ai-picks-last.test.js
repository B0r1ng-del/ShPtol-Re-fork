// The room screen's 「AI 队友最后选择」 row (GitHub #338; server: room.setAiPicksLast / room.setHostConfig, room.state):
// co-op rooms only, the host toggles it, everybody else sees its state read-only. It is one of the four 房主配置 rows
// (test/ui/host-config.test.js covers the panel as a whole); the texts go through t() with English in public/i18n/en.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
const EN = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));
const mod = () => import(pathToFileURL(path.join(ROOT, 'public/js/screens/room.js')).href);

const room = (o = {}) => ({
  code: 'ABCD', hostId: 'h', mode: 'coop', difficulty: 'NORMAL', aiPicksLast: false,
  seats: [{ seat: 0, playerId: 'h', name: 'Host', isBot: false, ready: false, connected: true }, { seat: 1, playerId: 'g', name: 'G', isBot: false, ready: false, connected: true }, null, null],
  ...o,
});

test('the 「AI 队友最后选择」 row: hidden in solo, editable by the host only, the state from room.state (off when absent)', async () => {
  const { hostConfigOption } = await mod();
  const row = (r, me) => hostConfigOption(r, me, 'aiPicksLast');
  assert.equal(row(room({ mode: 'solo' }), 'h'), null, 'solo: no AI teammates, no panel');
  assert.equal(row(room(), 'h').on, false);
  assert.equal(row(room(), 'h').editable, true);
  assert.equal(row(room({ aiPicksLast: true }), 'h').on, true);
  assert.equal(row(room({ aiPicksLast: true }), 'g').on, true);
  assert.equal(row(room({ aiPicksLast: true }), 'g').editable, false, 'the guest reads it only');
  assert.equal(row(room({ aiPicksLast: undefined }), 'g').on, false, 'an older server');
  assert.equal(hostConfigOption(null, 'h', 'aiPicksLast'), null);
  assert.equal(hostConfigOption(room(), 'h', 'nope'), null, 'an unknown key');
});

test('room.js sends the option through room.setHostConfig and shows it through t(); en.json has the English', () => {
  assert.match(SRC, /net\.request\('room\.setHostConfig', \{ key, on \}\)/);
  for (const zh of ['AI 队友最后选择', '策略与机变轮选时，所有博士先于 AI 队友选择', '由创建者设置：只有房主可以修改这些选项。']) {
    assert.ok(SRC.includes(`N_('${zh}')`) || SRC.includes(`t('${zh}')`), zh);
    assert.equal(typeof EN[zh], 'string', `en.json: ${zh}`);
    assert.ok(EN[zh].length > 0 && !/[一-鿿]/.test(EN[zh]), `English for ${zh}`);
  }
});
