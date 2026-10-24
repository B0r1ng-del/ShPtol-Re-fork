// 局内 HUD + 聊天（需求方 2026-10-17）：六项界面改动的**源码级契约**。渲染结果由 e2e（SP_E2E=1）与
// dev/game-mock.html 量；这里钉的是「改了哪一个选择器、哪一条渲染分支」，跑在任何机器上都不需要浏览器。
//
//   1. 作战统计按钮从右下角搬进顶栏 `.gm__tools`（与 ⚙ / 📖 / ⛶ 同排），面板改挂在那一行**下面**
//   2. 盟约条 `.gm__bonds` 居中
//   3. 聊天窗里的表情面板不再被窗口裁掉、改为向上展开
//   4. 表情面板背景改 Acrylic
//   5. 聊天窗收起时「交流」按钮回到左下角
//   6. 聊天弹幕层（跟随表情菜单的「弹幕」开关）
//   7. 房间配置（原房主配置）+ 在线聊天默认开启
//   8. 对局选项上移到对话框顶部
//   9. 折叠的聊天窗与「交流」上下并列
//  10. 盟约居中：折叠箭头移出居中流
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHAT_BARRAGE_MS, CHAT_BARRAGE_KEEP, CHAT_BARRAGE_LANES } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const GAME = read('public/js/screens/game.js');
const GAME_CSS = read('public/css/screens/game.css');
const CHAT_CSS = read('public/css/chat.css');
const EMOTES_CSS = read('public/css/emotes.css');
const CHAT_JS = read('public/js/ui/chat.js');
const METRICS = read('public/js/ui/combatMetrics.js');
const METRICS_CSS = GAME_CSS;
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

test('1: 作战统计 button rides in the top bar row, and its panel hangs BELOW that row', async () => {
  // the button is rendered inside `.gm__tools` (the same `.gm__gear` square as ⚙ / 📖 / ⛶), not in `.gm__corner`
  const tools = GAME.slice(GAME.indexOf('class="gm__tools"'), GAME.indexOf('room=${modRoom} />'));
  assert.match(tools, /gm__gear gm__metrics/, 'the metrics button is a .gm__gear in the tool row');
  assert.ok(tools.includes('<${CombatMetricsPanel}'), 'and its panel is mounted with it, so the two share an ancestor');
  const corner = GAME.slice(GAME.indexOf('class="gm__corner"'), GAME.indexOf('chatOn && !chatOpen'));
  assert.doesNotMatch(corner, /gm__metrics/, 'the corner no longer holds the button');
  // the panel opens downwards from the row's bottom edge; the old rule anchored it above the corner (bottom: 100%)
  assert.match(METRICS_CSS, /\.combat-metrics \{\n {2}--bk-c: var\(--mint-500\);\n {2}position: absolute; left: \.26rem; top: calc\(100% \+ max\(\.1rem, 8px\)\); z-index: 12;/);
  assert.doesNotMatch(METRICS_CSS, /--combat-corner-height/, 'the removed corner metric is gone');
  // the height cap is the JS-measured space below the row, with a CSS fallback for the first frame
  assert.match(METRICS_CSS, /var\(--combat-available-height, calc\(100vh - var\(--combat-anchor-bottom, 0px\)/);
  assert.match(METRICS, /--combat-anchor-bottom/, 'and combatMetrics.js publishes it');
  // the layout helper now measures the row whose BOTTOM the panel hangs from
  const { combatMetricsLayout } = await mod('public/js/ui/combatMetricsLayout.js');
  const full = combatMetricsLayout({ cornerBottom: 100, viewportHeight: 900, rem: 40 });
  assert.ok(Math.abs(full.availableHeight - (900 - 100 - 8)) < 1e-9, 'the space below the row, minus the gap');
  const tight = combatMetricsLayout({ cornerBottom: 200, viewportHeight: 300, rem: 40 });
  assert.ok(tight.availableHeight >= 0, 'never negative on a very short window');
  assert.equal(combatMetricsLayout({ cornerBottom: 0, viewportHeight: 0, rem: 40 }).availableHeight, 0);
});

test('2: 盟约条 is centred without a transform', () => {
  assert.match(GAME_CSS, /\.gm__bonds \{ position: absolute; left: 0; top: 1\.36rem; right: 0; pointer-events: none;\n {2}display: flex; align-items: flex-start; justify-content: center; gap: max\(\.1rem, 8px\); \}/);
  // no transform: it would make the strip the containing block of the position:fixed tooltip layer
  const block = GAME_CSS.slice(GAME_CSS.indexOf('.gm__bonds {'), GAME_CSS.indexOf('}', GAME_CSS.indexOf('.gm__bonds {')));
  assert.doesNotMatch(block, /transform/, 'centring uses flex, never translate');
  // the old left-aligned offset and the small-screen right inset (which would pull the centre off) are gone. Checked on
  // the COMMENT-STRIPPED sheet: the note that explains why the rule went away is allowed to quote it.
  const rules = GAME_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /\.gm__bonds \{ right: 4\.6rem; \}/);
  assert.doesNotMatch(rules, /@media \(max-aspect-ratio:[\s\S]{0,200}?\.gm__bonds \{ right:/);
});

test('3: the chat window no longer clips the emote panel, which opens upwards again', () => {
  const chat = CHAT_CSS.slice(CHAT_CSS.indexOf('.chat {'), CHAT_CSS.indexOf('.chat::before'));
  assert.match(chat, /overflow: visible;/, 'the window does not clip its own popovers');
  assert.doesNotMatch(chat, /overflow: hidden;/, 'the clipping that cut the panel in half is gone');
  assert.match(CHAT_CSS, /\.chat__body \.ewheel__panel \{ left: 0; \}/, 'the panel keeps the base rule\'s upward anchor');
  assert.doesNotMatch(CHAT_CSS, /\.chat__body \.ewheel__panel \{ bottom: auto; top: 100%; left: 0; \}/);
  // the log keeps its own scroll, so the window gaining visible overflow does not leak rows
  assert.match(CHAT_CSS, /\.chat__log \{[^}]*overflow-y: auto;/);
});

test('4: the emote panel plate is the acrylic recipe, with the opaque fallback', () => {
  // the sprite background of the plate is no longer painted; the CELLS keep their own sprite
  assert.match(EMOTES_CSS, /\.ewheel__panel\.has-sprite \{ background: none; \}/);
  assert.match(EMOTES_CSS, /\.ewheel__panel\.has-cell \.ewheel__item \{ background: var\(--ewheel-cell\)/);
  for (const sel of ['.ewheel__panel::before', '.ewheel__panel::after']) {
    const i = EMOTES_CSS.indexOf(sel);
    assert.ok(i > 0, sel);
    const block = EMOTES_CSS.slice(i, EMOTES_CSS.indexOf('}', i));
    assert.match(block, /background: rgba\(14, 19, 17, \.62\)/, `${sel}: translucent acrylic fill`);
    assert.match(block, /backdrop-filter: blur\(\.12rem\) saturate\(1\.6\)/, `${sel}: frosted glass`);
  }
  assert.match(EMOTES_CSS, /@supports not \(backdrop-filter: blur\(1px\)\) \{\n {2}\.ewheel__panel::before, \.ewheel__panel::after \{ background: rgba\(14, 19, 17, \.94\); \}/);
});

test('5: with the chat window folded, the 交流 wheel is rendered in the corner again', () => {
  // exactly one home at a time: the corner copy is gated on the fold state…
  assert.ok(GAME.includes('chatOn && !chatOpen ? html`<${EmoteWheel}'), 'the corner copy is gated on the fold state');
  // …and the window only receives one while it is open, so the two can never both be on screen
  assert.ok(GAME.includes('emote=${spectator ? null : html`<${EmoteWheel}'));
  assert.doesNotMatch(GAME, /emote=\$\{spectator \|\| !chatOpen/, 'the wheel is not hidden by the fold state');
  // the panel state survives a fold (one shared `emoteOpen`), so reopening the window does not lose it
  assert.ok(GAME.includes("const [emoteOpen, setEmoteOpen] = useState(false)"));
});

test('6: 聊天弹幕 — deterministic lanes, the sender\'s name, and a line is dropped when its flight ends', async () => {
  const { barrageTrack, speaker } = await mod('public/js/ui/chat.js');
  // the lane is drawn from the line's own seq: a re-render cannot make a crossing strip jump
  const a = barrageTrack(7);
  assert.deepEqual(barrageTrack(7), a, 'the same seq always lays out the same way');
  assert.equal(a.lane, 7 % CHAT_BARRAGE_LANES);
  assert.ok(a.lane >= 0 && a.lane < CHAT_BARRAGE_LANES);
  assert.ok(a.sec > 0);
  // the strip carries the same name the window shows (room seats, else 观战者)
  assert.equal(speaker({ seats: [{ playerId: 'p', name: '博士A', seat: 1 }] }, 'p', 'me').name, '博士A');
  assert.equal(speaker({ seats: [], spectators: [{ playerId: 'p' }] }, 'p', 'me').name, '观战者');
  // the layer renders name + text and is off unless the setting is on
  assert.match(CHAT_JS, /export function ChatBarrage\(\{ lines = \[\], room, myId, on = false \}\)/);
  assert.match(CHAT_JS, /if \(!on \|\| !live\.length\) return null;/);
  assert.match(CHAT_JS, /cbarrage__name">\$\{who\.name\}<\/b><span class="cbarrage__text">\$\{l\.text\}/);
  // an item is dropped once its own flight has run out (`forwards` would park it at the left edge for good)
  assert.match(CHAT_JS, /now - \(Number\.isFinite\(l\.at\) \? l\.at : now\) < CHAT_BARRAGE_MS/);
  assert.match(CHAT_JS, /\.slice\(-CHAT_BARRAGE_KEEP\)/);
  assert.equal(CHAT_BARRAGE_KEEP, 12);
  assert.equal(CHAT_BARRAGE_MS, 11000);
  // the layer is mounted only with the room option on, and follows the setting
  assert.ok(GAME.includes('chatOn ? html`<${ChatBarrage} lines=${chatLines} room=${chatRoom} myId=${myId} on=${chatBarrage} />` : null}'));
  // the animation crosses right-to-left and fades at both ends
  assert.match(CHAT_CSS, /@keyframes chat-cross/);
  assert.match(CHAT_CSS, /100% \{ transform: translateX\(calc\(-100vw - 100%\)\); opacity: 0; \}/);
  assert.match(CHAT_CSS, /\.cbarrage \{ position: absolute; left: 0; right: 0;[^}]*pointer-events: none; \}/);
});

test('6b: 聊天弹幕 has NO switch of its own — it follows the emote panel\'s 「弹幕」 switch', async () => {
  const { DEFAULT_SETTINGS } = await mod('public/js/ui/gameLogic/settings.js');
  assert.equal('chatBarrage' in DEFAULT_SETTINGS, false, 'the 设置 row that duplicated the control is gone');
  const settings = read('public/js/ui/settings.js');
  assert.doesNotMatch(settings, /聊天弹幕/, 'and no orphaned Toggle/set-hint is left behind');
  // the layer reads the emote pref store, the same value the falling emote layer uses
  assert.ok(GAME.includes('const chatBarrage = barrage;'), 'the layer follows emotePrefsStore');
  assert.ok(GAME.includes('const barrage = useStore((s) => s.barrage, Object.is, emotePrefsStore)'));
  // the 弹幕 switch's own tooltip now names both layers
  const emotes = read('public/js/ui/emotes.js');
  assert.match(emotes, /t\('弹幕：表情像雪花一样从屏幕上方飘落，房间内所有人可见；聊天窗口的发言也会以弹幕横穿屏幕'\)/);
});

test('7: 房间配置 (was 房主配置), 在线聊天 on by default', async () => {
  const { HOST_CONFIG_DEFAULTS } = await mod('shared/constants.js');
  assert.equal(HOST_CONFIG_DEFAULTS.onlineChat, true, 'the owner turned the default on (2026-10-17)');
  const room = read('public/js/screens/room.js');
  assert.match(room, /title=\$\{t\('房间配置'\)\} micro="HOST CONFIG"/);
  // 需求方 2026-10-24 (图五→图七): 房间配置搬进底栏小齿轮、左下角那个按钮（HostConfigButton）已删，所以里层
  // 入口的 title 不再是「房间配置 · 只有房主可以修改」—— 齿轮自己的 title/aria 就是「房间配置」。
  // 这里改为钉住「齿轮带 hostcfg-open 这个 testid」，那才是 e2e 与玩家真正点的那一格。
  assert.match(room, /data-testid="hostcfg-open"/);
  assert.ok(!room.includes("t('房主配置')"), 'no panel label still says 房主配置');
  // the row's own `on` mirrors the constant, so an absent hostConfig still shows it on
  assert.match(room, /\{ key: 'onlineChat', label: N_\('在线聊天'\)[\s\S]{0,200}?on: true, solo: true \}/);
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    for (const id of ['房间配置', '房间配置 · 只有房主可以修改', '扩展模拟', '扩展模拟固定难度']) {
      assert.equal(typeof pack[id], 'string', `${lang}: ${id}`);
      assert.ok(pack[id].length > 0, `${lang}: ${id} is not empty`);
    }
  }
});

test('8: 对局选项 opens the 房间配置 dialog, above the switch rows', () => {
  const src = read('public/js/screens/room.js');
  const body = src.slice(src.indexOf('function HostConfigDialog('), src.indexOf('/** The ready bar'));
  assert.ok(body.includes('MatchOptionSection'), 'the section is still rendered by its own component');
  assert.ok(body.indexOf('MatchOptionSection') < body.indexOf('hostcfg__rows'), 'and now comes FIRST');
  // the block's top separator would draw a stray rule under the dialog title
  assert.match(read('public/css/screens/room.css'), /\.hostcfg > \.ebuff:first-child \{ padding-top: 0; border-top: 0; \}/);
});

test('9: 上下并列 — the corner 交流 wheel clears the folded chat window', () => {
  assert.match(GAME, /class=\$\{`gm__corner\$\{chatOn && !chatOpen \? ' is-chat-folded' : ''\}`\}/,
    'the corner flags the folded state the wheel is rendered in');
  const chat = read('public/css/chat.css');
  assert.match(chat, /\.gm__corner\.is-chat-folded \{ bottom: calc\(\.24rem \+ \.34rem \+ \.06rem\); \}/);
  assert.match(chat, /\.gm__corner\.is-chat-folded \{ bottom: calc\(\.2rem \+ max\(\.34rem, 34px\) \+ \.06rem\); \}/);
});

test('10: 盟约居中 — the toggle hangs outside the centred box', () => {
  // the strip's own centre is what `justify-content: center` centres, so the 44 px arrow must not be a flex sibling
  assert.match(GAME, /<div class=\$\{`gm__bond-box\$\{bondsCollapsed \? ' is-collapsed' : ''\}`\}>/);
  const box = GAME.slice(GAME.indexOf('gm__bond-box'), GAME.indexOf('id="match-bond-strip"'));
  assert.ok(box.includes('class="bonds-toggle"'), 'the arrow lives inside the box (which is position: relative)');
  const css = read('public/css/screens/game.css');
  assert.match(css, /\.gm__bond-box \{ position: relative; display: flex; align-items: flex-start; min-width: 0; \}/);
  const toggle = css.slice(css.indexOf('.gm__bonds .bonds-toggle {'), css.indexOf('.bonds-toggle .icon'));
  assert.match(toggle, /position: absolute; right: 100%; top: 0;/, 'and is taken out of the centring');
  assert.match(toggle, /min-width: 44px; min-height: 44px;/, 'the touch target stays');
  // 折叠时盒子宽度归零，此时箭头是唯一可见控件，改成自己居中（实测 938 vs 960 就是漏了这条）
  assert.match(css, /\.gm__bond-box\.is-collapsed \.bonds-toggle \{ right: auto; left: 50%; transform: translateX\(-50%\); \}/);
});

test('the new strings are in every language pack (docs/I18N.md: no bare Chinese in the UI)', () => {
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    // 需求方 2026-10-17: the mode's own name, the renamed panel and the 弹幕 tooltip that now covers both layers
    for (const id of ['扩展模拟', '扩展模拟固定难度', '房间配置', '房间配置 · 只有房主可以修改',
      '弹幕：表情像雪花一样从屏幕上方飘落，房间内所有人可见；聊天窗口的发言也会以弹幕横穿屏幕']) {
      assert.equal(typeof pack[id], 'string', `${lang}: ${id}`);
      assert.ok(pack[id].length > 0, `${lang}: ${id} is not empty`);
    }
  }
});
