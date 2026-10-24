// 房主配置 — the room screen's host-only option panel (public/js/screens/room.js hostConfigPanel / hostConfigOption,
// server room.setHostConfig): the rows of shared/constants.js HOST_CONFIG_KEYS in the panel's order, their official
// defaults when the server sends nothing, the host as the only editor, and a single-seat room (独立模拟) showing only
// the rows that share nothing between players (HOST_CONFIG_SOLO_KEYS, 装备可售卖). The texts go through N_()/t() with
// English in public/i18n/en.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HOST_CONFIG_KEYS, HOST_CONFIG_DEFAULTS, HOST_ENEMY_KEYS } from '../../shared/constants.js';

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
  // the mock of the request: 共享卡池 / 共享悬赏 on, then AI 队友最后选择 / 多策略模式 / 装备可售卖 off and 在线聊天 ON
  // (需求方 2026-10-17: onlineChat became the one non-official default)
  assert.deepEqual(rows.map((r) => r.on), [true, true, false, false, false, true]);
  assert.deepEqual(rows.map((r) => r.label), ['共享卡池', '共享悬赏', 'AI 队友最后选择', '多策略模式', '装备可售卖', '在线聊天']);
  for (const r of rows) assert.ok(r.tip && r.tip.length > 0, `${r.key} has an explanation`);
});

test('the panel is editable by the host alone; everybody else reads the same values', async () => {
  const { hostConfigPanel } = await mod();
  const cfg = { sharedPool: false, sharedBounty: true, aiPicksLast: true, multiAlliance: true, itemSell: true, onlineChat: true };
  const hostRows = hostConfigPanel(room({ hostConfig: cfg, aiPicksLast: true }), 'h');
  const guestRows = hostConfigPanel(room({ hostConfig: cfg, aiPicksLast: true }), 'g');
  assert.ok(hostRows.every((r) => r.editable), 'the host edits');
  assert.ok(guestRows.every((r) => !r.editable), 'the guest reads');
  assert.deepEqual(hostRows.map((r) => r.on), [false, true, true, true, true, true], 'both see the same values');
  assert.deepEqual(guestRows.map((r) => r.on), [false, true, true, true, true, true]);
  // no host yet (the room is closing): nobody edits
  assert.ok(hostConfigPanel(room({ hostId: null }), 'h').every((r) => !r.editable));
});

test('a single-seat room (独立模拟) shows the rows that share nothing between players; no room shows nothing', async () => {
  const { hostConfigPanel, hostConfigOption } = await mod();
  // 独立模拟 has nobody to share with: only HOST_CONFIG_SOLO_KEYS survives — 装备可售卖 (about one's own items) and
  // 在线聊天 (需求方 2026-10-17: excluding it made the option unusable in a solo room — the row was hidden AND the lobby
  // refused the write, which is exactly what the owner hit).
  assert.deepEqual(hostConfigPanel(room({ mode: 'solo' }), 'h').map((r) => r.key), ['itemSell', 'onlineChat']);
  assert.equal(hostConfigOption(room({ mode: 'solo' }), 'h', 'sharedPool'), null);
  assert.equal(hostConfigOption(room({ mode: 'solo' }), 'h', 'itemSell').on, false);
  assert.equal(hostConfigOption(room({ mode: 'solo' }), 'h', 'itemSell').editable, true, 'the solo host still edits it');
  assert.equal(hostConfigOption(room({ mode: 'solo' }), 'h', 'onlineChat').editable, true, 'and the chat window is usable there');
  assert.equal(hostConfigPanel(null, 'h'), null);
  // 同盟模拟 (4) and 终极模拟 (6) both show every row
  for (const mode of ['coop', 'ultimate']) assert.equal(hostConfigPanel(room({ mode }), 'h').length, HOST_CONFIG_KEYS.length, mode);
});

test('the 对局选项 sliders: the four HOST_ENEMY_KEYS in order, at 0 by default, host-editable in EVERY mode', async () => {
  const { enemyBuffPanel, enemyBuffTotal, HOST_ENEMY_ROWS } = await mod();
  assert.deepEqual(HOST_ENEMY_ROWS.map((r) => r.key), [...HOST_ENEMY_KEYS], 'the panel order is the normative key order');
  // a room that never touched them: all four at 0, and no total to warn about
  const rows = enemyBuffPanel(room(), 'h');
  assert.deepEqual(rows.map((r) => r.key), [...HOST_ENEMY_KEYS]);
  assert.deepEqual(rows.map((r) => r.steps), [0, 0, 0, 0]);
  assert.equal(enemyBuffTotal(rows), 0, 'no warning line at 0');
  assert.ok(rows.every((r) => r.editable), 'the host moves them');
  assert.ok(rows.every((r) => r.label && r.icon && r.tip), 'each row has a label, an icon and an explanation');
  // the values come from room.state.enemyBuff, and the total is their sum in percent
  const set = enemyBuffPanel(room({ enemyBuff: { enemyHp: 5, enemyAtk: 3, enemyDef: 0, enemyRes: 1 } }), 'h');
  assert.deepEqual(set.map((r) => r.steps), [5, 3, 0, 1]);
  assert.equal(enemyBuffTotal(set), 90, '5 + 3 + 0 + 1 steps = 90 %');
  // a guest reads the same values and may not move them
  const guest = enemyBuffPanel(room({ enemyBuff: { enemyHp: 5 } }), 'g');
  assert.deepEqual(guest.map((r) => r.steps), [5, 0, 0, 0], 'the guest sees what the host set');
  assert.ok(guest.every((r) => !r.editable), 'but only reads it');
  // no host yet (the room is closing): nobody edits
  assert.ok(enemyBuffPanel(room({ hostId: null }), 'h').every((r) => !r.editable));
  // EVERY mode shows all four — a buff on one's own enemies shares nothing with teammates (需求方: 所有模式通用)
  for (const mode of ['solo', 'coop', 'ultimate']) {
    const m = enemyBuffPanel(room({ mode }), 'h');
    assert.deepEqual(m.map((r) => r.key), [...HOST_ENEMY_KEYS], mode);
    assert.ok(m.every((r) => r.editable), `${mode}: the host edits them`);
  }
  // a legacy server sending nothing at all still yields the four rows at 0
  assert.deepEqual(enemyBuffPanel(room({ enemyBuff: undefined }), 'h').map((r) => r.steps), [0, 0, 0, 0]);
  assert.equal(enemyBuffPanel(null, 'h'), null, 'no room, no panel');
});

test('the 对局选项 markup: one slider per row, wired to room.setEnemyBuff, with the total in a warning line', async () => {
  const { HOST_ENEMY_ROWS } = await mod();
  const { splitByLength } = await import(pathToFileURL(path.join(ROOT, 'public/js/ui/mods.js')).href);
  // the four sliders reuse 设置's own control (.set-row / .set-range) so they look and drag the same
  assert.match(SRC, /class="set-row ebuff__row" key=\$\{r\.key\}/, 'the settings slider row');
  assert.match(SRC, /class="set-range" type="range" min="0" max=\$\{HOST_ENEMY_MAX_STEPS\} step="1"/);
  assert.match(SRC, /data-testid=\$\{`ebuff-\$\{r\.key\}`\}/, 'every slider has a testid the e2e suite can select');
  assert.match(SRC, /onInput=\$\{\(e\) => r\.editable && onEnemy\(r\.key, Number\(e\.currentTarget\.value\)\)\}/, 'only the host writes');
  // a slider is a CONTINUOUS control: it is NOT disabled while a round trip is in flight (that would freeze all four
  // for every step of a drag), so the SLIDER's own disabled attribute is `!r.editable` and never `busy`
  const section = SRC.slice(SRC.indexOf('function MatchOptionSection('), SRC.indexOf("/** The panel's Mod-开关 rows"));
  assert.match(section, /disabled=\$\{!r\.editable\}/, 'a non-host gets a disabled slider');
  assert.match(section, /class="set-range"/, 'the sliders are in this section');
  assert.ok(!/set-range[\s\S]{0,200}busy/.test(section), 'and a drag is never blocked by an in-flight request');
  // it goes through its own one-shot request, not run() (whose inFlight guard would drop every step after the first)
  assert.match(SRC, /net\.request\('room\.setEnemyBuff', \{ key, steps \}\)\.catch\(toastError\)/);
  // the header, the rule above the sliders and the total's warning line (the owner's screenshot)
  assert.match(SRC, /class="ebuff__title"><\$\{Icon\} name="sliders" \/>\$\{t\('对局选项'\)\}/);
  assert.match(SRC, /t\('每格 \+10%，最高 \+100% · 加强本局全部敌人（含首领与联防）'\)/);
  assert.match(SRC, /t\('本局敌人已获得强化（合计 \{n\}%），请谨慎调整', \{ n: total \}\)/);
  // the warning only renders once something is actually buffed
  assert.match(SRC, /\$\{total > 0 \? html`<p class="ebuff__warn">/);
  // the ready bar's badge counts the buffed sliders too, not just the switch rows
  assert.match(SRC, /\(enemyRows \|\| \[\]\)\.filter\(\(r\) => r\.steps !== 0\)\.length/);
  // the dialog's order (需求方 2026-10-17: 「把四个滑块功能放到最底下，有单独开关的往上放」):
  // 对局选项 switches → the four sliders last (the switches are ONE list now — 图一, see the bottom of this test)
  const dialog = SRC.slice(SRC.indexOf('function HostConfigDialog('), SRC.indexOf('/** The ready bar'));
  assert.ok(dialog.includes('MatchOptionSection'), 'rendered by its own component');
  const at = (s) => dialog.indexOf(s);
  assert.ok(at('MatchOptionSection') < at('EnemyBuffSection'), 'the sliders are the dialog tail');
  // the two halves are separate components, each with its own message
  assert.ok(!/function MatchOptionSection\(\{[^}]*enemyRows/.test(SRC), 'the switches no longer take enemyRows');
  // 2026-10-16 (owner): the five game-rule Mod 开关 join the sliders under 「对局选项」, so one component draws both.
  // SwitchRow renders the attribute itself, so the prop here is `testid` (not `data-testid`).
  assert.match(SRC, /testid: `hostcfg-mod-\$\{r\.key\}`/, 'the rule switches keep their testid');
  assert.match(SRC, /splitByLength\(switchRows\)\.map\(/, 'and are dealt into two columns by label length');
  // every label and explanation is a msgid with a real English translation
  for (const zh of ['对局选项', '怪物血量', '怪物攻击', '怪物防御', '怪物魔抗', '每格 +10%，最高 +100% · 加强本局全部敌人（含首领与联防）', '本局敌人已获得强化（合计 {n}%），请谨慎调整']) {
    // the warning's msgid carries a {n} param, so match the literal alone
    assert.ok(SRC.includes(`'${zh}'`), zh);
    assert.equal(typeof EN[zh], 'string', `en.json: ${zh}`);
    assert.ok(EN[zh].length > 0 && !/[一-鿿]/.test(EN[zh]), `English for ${zh}`);
  }
  for (const r of HOST_ENEMY_ROWS) assert.equal(typeof EN[r.tip], 'string', `en.json: ${r.tip}`);
  // and the block's own styles exist
  assert.match(CSS, /\.ebuff \{/);
  assert.match(CSS, /\.ebuff__rows \{/);
  assert.match(CSS, /\.ebuff__warn \{/);
  // 图一 (2026-10-17, 需求方 「将可开关的功能分成两列；如果可以，再按字数长短排列整齐」): the dialog now hands ONE list —
  // the Mod rules AND the host options — to `MatchOptionSection`, which deals it into two columns long-label-first. So
  // `.mods--hostcfg` keeps the submenu's two-column grid (no one-column override any more) and `.hostcfg__rows` is gone.
  assert.ok(!/\.mods--hostcfg \.mods__rows \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(CSS), 'two columns again');
  assert.ok(!/^\.hostcfg__rows \{/m.test(CSS), 'the separate host-option block is gone');
  assert.match(SRC, /splitByLength\(switchRows\)\.map\(/, 'the rows are split by label length');
  // the splitter itself: longer labels first, cut in half, no row lost
  const cols = splitByLength(MOD_ROW_LABELS.map((label) => ({ label })));
  assert.equal(cols.length, 2, 'two columns');
  assert.equal(cols.flat().length, MOD_ROW_LABELS.length, 'every row lands somewhere');
  const lens = cols.map((c) => c.map((r) => r.label.length));
  for (const l of lens) for (let i = 1; i < l.length; i++) assert.ok(l[i - 1] >= l[i], 'long labels first');
  assert.ok(Math.abs(lens[0].length - lens[1].length) <= 1, 'balanced halves');
});

/** Every label the 房间配置 dialog can show, as the msgid its length is measured on. */
const MOD_ROW_LABELS = [
  '关闭盟约禁用', '机变不限时间', '机变随机分配', '额外 4 回合', '定向甄选', '解除叠层上限',
  '共享卡池', '共享悬赏', 'AI 队友最后选择', '多策略模式', '装备可售卖', '在线聊天',
];

test('「AI 队友最后选择」 reads its own pre-existing room.state field, every other row reads hostConfig', async () => {
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
  assert.match(SRC, /<[$]\{HostConfigDialog\} rows=[$]\{cfgRows\} enemyRows=[$]\{enemyRows\} modRows=[$]\{modRows\} open=[$]\{cfgOpen\}/, 'the dialog is rendered');
  // 2026-10-16: the dialog carries the Mod 开关 block too (the lobby's submenu moved in), so its rows are passed along.
  // LATER THE SAME DAY (owner): only the 对局选项 half (col 'rule') stays here — the 内容包 switches left for the lobby's
  // own 「Mod 菜单」 dialog (screens/mods.js), so this panel filters them out and its badge counts only what it shows.
  assert.match(SRC, /const modRows = \(modPanel\(room, me\.playerId\) \|\| \[\]\)\.filter\(\(r\) => MOD_RULE_ROWS\.some\(\(k\) => k\.key === r\.key\)\)/, 'the Mod rows come from the panel, minus the 内容包 half');
  // 需求方 2026-10-24 (图五→图七): 房间配置 moved from the ready bar's standalone button into the ⚙ popover of the
  // bottom pill, so the entry is the gear and the body is the shared RoomConfigBody (one implementation, two callers).
  assert.match(SRC, /function RoomConfigBody\(/, 'the panel body is its own component');
  assert.match(SRC, /data-testid="hostcfg-open"/, 'the ⚙ carries the entry testid the e2e opens it by');
  assert.match(SRC, /<[$]\{RoomConfigBody\} rows=[$]\{cfgRows\}/, 'the ⚙ popover renders the shared body');
  assert.match(SRC, /const \[cfgOpen, setCfgOpen\] = useState\(false\)/);
  assert.match(SRC, /const cfgRows = hostConfigPanel\(room, me\.playerId\)/);
  assert.match(SRC, /<[$]\{Modal\} open=[$]\{open\}/, 'the dialog uses the shared Modal');
  assert.match(SRC, /<[$]\{RoomConfigBody\} rows=[$]\{rows\}/, 'the dialog renders the same body');
  // 2026-10-13 (图二): the row is the shared <SwitchRow/> — the name on the left, the pill switch on the right, and the
  // explanation BEHIND the ⓘ (hover on a desktop / long press on a phone, ui/components.js + the Tooltip), not printed
  // under the switch. The owner's report: 「原样式通过点击功能标题来启用/禁用，开关状态不明显」.
  assert.match(SRC, /<[$]\{SwitchRow\} key=[$]\{r\.key\}/, 'the row is the shared SwitchRow');
  assert.match(SRC, /disabled=\${!r\.editable \|\| !!busy}/, 'a non-host (or a busy room) gets a disabled switch');
  assert.match(SRC, /onChange=\${\(v\) => r\.editable && r\.onChange\(v\)}/, 'only the host writes');
  assert.ok(!/hostcfg__desc/.test(SRC), 'the explanation is no longer printed under the switch');
  const COMPONENTS = readFileSync(path.join(ROOT, 'public/js/ui/components.js'), 'utf8');
  assert.match(COMPONENTS, /export function SwitchRow\(\{ label, tip, on, onChange, disabled = false, testid, infoTestid \}\)/);
  assert.match(COMPONENTS, /role="switch" aria-checked=\$\{on \? 'true' : 'false'\}/);
  assert.match(COMPONENTS, /class="swrow__label">\$\{label\}/, 'the name is plain text on the left');
  assert.match(COMPONENTS, /<\$\{Tooltip\} text=\$\{tip\}>/, 'the explanation is a tooltip behind the ⓘ');
  // the removed inline band left no dead rule behind
  assert.ok(!/\.hostcfg__head/.test(CSS), 'no stale inline-band rules');
  assert.ok(!/\.hostcfg__title/.test(CSS), 'no stale inline-band rules');
  // the labels and explanations are msgids with a real English translation
  for (const zh of ['房间配置', '共享卡池', '全同盟共用一个干员池', '共享悬赏', '全队共用一套悬赏决策牌，先选先得', '多策略模式', '开启后同一份策略可被多位博士各选一次；关闭时官方规则：每个策略只能由一位博士选择', '装备可售卖', '开启后装备可以出售，售价 1 块钱；关闭时装备只能销毁']) {
    assert.ok(SRC.includes(`N_('${zh}')`) || SRC.includes(`t('${zh}')`), zh);
    assert.equal(typeof EN[zh], 'string', `en.json: ${zh}`);
    assert.ok(EN[zh].length > 0 && !/[一-鿿]/.test(EN[zh]), `English for ${zh}`);
  }
  // the removed standalone switch and the old rectangular option left no dead style behind
  assert.ok(!/\.ailast/.test(CSS), 'no stale .ailast rules');
  assert.ok(!/\.hostcfg__opt/.test(CSS), 'the rectangular option style is gone (the pill switch replaced it)');
  assert.match(CSS, /\.hostcfg__note \{/, 'the read-only note keeps its style');
});
