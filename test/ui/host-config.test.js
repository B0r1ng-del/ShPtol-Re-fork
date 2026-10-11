// 房主配置 — the room screen's host-only option panel (public/js/screens/room.js hostConfigPanel / hostConfigOption,
// server room.setHostConfig): the four rows of shared/constants.js HOST_CONFIG_KEYS in the panel's order, their official
// defaults when the server sends nothing, the host as the only editor, and the panel hidden in a single-seat room
// (独立模拟: nobody to share with). The texts go through N_()/t() with English in public/i18n/en.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HOST_CONFIG_KEYS, HOST_CONFIG_DEFAULTS } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'public/css/screens/room.css'), 'utf8');
const EN = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));
const mod = () => import(pathToFileURL(path.join(ROOT, 'public/js/screens/room.js')).href);

const room = (o = {}) => ({
  code: 'ABCD', hostId: 'h', mode: 'coop', difficulty: 'NORMAL', aiPicksLast: false,
  hostConfig: { ...HOST_CONFIG_DEFAULTS },
  seats: [{ seat: 0, playerId: 'h', name: 'Host', isBot: false, ready: false, connected: true }, { seat: 1, playerId: 'g', name: 'G', isBot: false, ready: false, connected: true }, null, null],
  ...o,
});

test('the panel lists exactly the four HOST_CONFIG_KEYS, in order, with their defaults', async () => {
  const { hostConfigPanel, HOST_CONFIG_ROWS } = await mod();
  assert.deepEqual(HOST_CONFIG_ROWS.map((r) => r.key), [...HOST_CONFIG_KEYS], 'the panel order is the normative key order');
  const rows = hostConfigPanel(room(), 'h');
  assert.deepEqual(rows.map((r) => r.key), [...HOST_CONFIG_KEYS]);
  for (const r of rows) assert.equal(r.on, HOST_CONFIG_DEFAULTS[r.key], `${r.key} default`);
  // the mock of the request: 共享卡池 / 共享悬赏 on, AI 队友最后选择 / 多同盟模式 off
  assert.deepEqual(rows.map((r) => r.on), [true, true, false, false]);
  assert.deepEqual(rows.map((r) => r.label), ['共享卡池', '共享悬赏', 'AI 队友最后选择', '多同盟模式']);
  for (const r of rows) assert.ok(r.tip && r.tip.length > 0, `${r.key} has an explanation`);
});

test('the panel is editable by the host alone; everybody else reads the same values', async () => {
  const { hostConfigPanel } = await mod();
  const cfg = { sharedPool: false, sharedBounty: true, aiPicksLast: true, multiAlliance: true };
  const hostRows = hostConfigPanel(room({ hostConfig: cfg, aiPicksLast: true }), 'h');
  const guestRows = hostConfigPanel(room({ hostConfig: cfg, aiPicksLast: true }), 'g');
  assert.ok(hostRows.every((r) => r.editable), 'the host edits');
  assert.ok(guestRows.every((r) => !r.editable), 'the guest reads');
  assert.deepEqual(hostRows.map((r) => r.on), [false, true, true, true], 'both see the same values');
  assert.deepEqual(guestRows.map((r) => r.on), [false, true, true, true]);
  // no host yet (the room is closing): nobody edits
  assert.ok(hostConfigPanel(room({ hostId: null }), 'h').every((r) => !r.editable));
});

test('the panel is hidden in a single-seat room (独立模拟) and absent for a missing room', async () => {
  const { hostConfigPanel, hostConfigOption } = await mod();
  assert.equal(hostConfigPanel(room({ mode: 'solo' }), 'h'), null);
  assert.equal(hostConfigOption(room({ mode: 'solo' }), 'h', 'sharedPool'), null);
  assert.equal(hostConfigPanel(null, 'h'), null);
  // 同盟模拟 (4) and 终极模拟 (6) both show it
  for (const mode of ['coop', 'ultimate']) assert.equal(hostConfigPanel(room({ mode }), 'h').length, 4, mode);
});

test('「AI 队友最后选择」 reads its own pre-existing room.state field, the other three read hostConfig', async () => {
  const { hostConfigOption } = await mod();
  // an older server that sends no hostConfig at all: the defaults stand, and aiPicksLast still works
  const legacy = room({ hostConfig: undefined, aiPicksLast: true });
  assert.equal(hostConfigOption(legacy, 'h', 'aiPicksLast').on, true);
  assert.equal(hostConfigOption(legacy, 'h', 'sharedPool').on, true, 'the default');
  assert.equal(hostConfigOption(legacy, 'h', 'multiAlliance').on, false, 'the default');
  // a hostConfig that names a value and an aiPicksLast that disagrees: the field's own message wins for its row
  const mixed = room({ hostConfig: { ...HOST_CONFIG_DEFAULTS, aiPicksLast: false }, aiPicksLast: true });
  assert.equal(hostConfigOption(mixed, 'h', 'aiPicksLast').on, true);
});

test('room.js sends room.setHostConfig { key, on } and opens the dialog from the ready bar', () => {
  assert.match(SRC, /net\.request\('room\.setHostConfig', \{ key, on \}\)/);
  // the panel is a dialog opened by a button in the ready bar (the 干员调配 pattern), not a band under the seats
  assert.match(SRC, /<[$]\{HostConfigDialog\} rows=[$]\{cfgRows\} open=[$]\{cfgOpen\}/, 'the dialog is rendered');
  assert.match(SRC, /<[$]\{HostConfigButton\} rows=[$]\{cfgRows\}/, 'the entry button is in the ready bar');
  assert.match(SRC, /const \[cfgOpen, setCfgOpen\] = useState\(false\)/);
  assert.match(SRC, /const cfgRows = hostConfigPanel\(room, me\.playerId\)/);
  assert.match(SRC, /<[$]\{Modal\} open=[$]\{open\}/, 'the dialog uses the shared Modal');
  assert.match(SRC, /role="switch"/);
  assert.match(SRC, /data-testid=[$]\{`hostcfg-[$]\{r\.key\}`\}/);
  assert.match(SRC, /data-testid="hostcfg-open"/);
  // the explanation is visible under each switch (the mock's layout), not hidden in a tooltip
  assert.match(SRC, /class="hostcfg__desc">[$]\{t\(r\.tip\)\}/);
  assert.match(CSS, /\.hostcfg__desc \{/);
  // the removed inline band left no dead rule behind
  assert.ok(!/\.hostcfg__head/.test(CSS), 'no stale inline-band rules');
  assert.ok(!/\.hostcfg__title/.test(CSS), 'no stale inline-band rules');
  // the labels and explanations are msgids with a real English translation
  for (const zh of ['房主配置', '共享卡池', '全同盟共用一个干员池', '共享悬赏', '全队共用一套悬赏决策牌，先选先得', '多同盟模式', '官方规则：每个策略只能由一位博士选择']) {
    assert.ok(SRC.includes(`N_('${zh}')`) || SRC.includes(`t('${zh}')`), zh);
    assert.equal(typeof EN[zh], 'string', `en.json: ${zh}`);
    assert.ok(EN[zh].length > 0 && !/[一-鿿]/.test(EN[zh]), `English for ${zh}`);
  }
  // the removed standalone switch left no dead style behind
  assert.ok(!/\.ailast/.test(CSS), 'no stale .ailast rules');
  assert.match(CSS, /\.hostcfg__opt/);
});
