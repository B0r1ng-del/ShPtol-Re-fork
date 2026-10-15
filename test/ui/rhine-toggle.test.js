// 莱茵科技 — the 科研装置 picker and the shop's operator row share ONE slot, and the button that swaps them
// (owner request 2026-10-15, 图 with the red/blue/green/yellow boxes):
//
//   1. the picker moved out of its own absolute box at the screen's bottom-LEFT into the shop row's slot (bottom-right),
//      so it is a flex child of `.shopbar` and the tools row (剩余可放置角色 / 莱茵科技 / 冻结 / 刷新) stays above whichever
//      of the two shows;
//   2. a 「莱茵科技」 button in that tools row swaps the slot: the two are MUTUALLY EXCLUSIVE (CSS, not a conditional
//      render, so the shop's two-tap arming state survives a swap), 商店 is the default (the `rhineOpen` state starts
//      false), and the button only exists while 莱茵生命 is activated (the picker itself renders null otherwise);
//   3. the picker's old 提示 line (`.rhine-dock__hint`) is gone — the same information is on the cards.
//
// This file pins the source contract; the rendered result is measured by test/ui/rhine-toggle.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const SHOP = read('public/js/ui/shopBar.js');
const GAME = read('public/js/screens/game.js');
const DOCK = read('public/js/ui/rhineDock.js');
const CSS = read('public/css/screens/rhine.css');
/** rhine.css without comments: the explanations above name selectors the rules no longer contain. */
const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const EN = JSON.parse(read('public/i18n/en.json'));

test('1. the picker is a flex child of the shop bar, no longer an absolutely positioned box', () => {
  // it is rendered through ShopBar's own prop, not as a sibling in the screen
  assert.match(SHOP, /rhineDock = null, rhineOpen = false, onRhineToggle = null/, 'the bar takes the picker as a prop');
  assert.match(SHOP, /\$\{rhineDock\}/, 'and renders it inside its own <section>');
  assert.ok(!/\.rhine-dock\s*\{[^}]*position:\s*absolute/.test(code), 'the picker is not absolutely positioned any more');
  assert.ok(!/\.rhine-dock\s*\{[^}]*\bbottom:/.test(code), 'and no longer pins itself to the viewport edge');
  // game.js passes it in; the screen has no standalone RhineDock render site left
  assert.match(GAME, /rhineDock=\$\{/, 'the screen hands the picker to the shop bar');
  assert.ok(!/html`<\$\{RhineDock\}/.test(GAME.replace(/rhineDock=\$\{[^`]*`<\$\{RhineDock\}/, '')),
    'RhineDock is not rendered outside the bar');
});

test('2. the 莱茵科技 button swaps the slot, and 商店 is the default', () => {
  // the state lives in the screen and starts on the shop
  assert.match(GAME, /const \[rhineOpen, setRhineOpen\] = useState\(false\)/, 'rhineOpen starts false → 商店 is the default');
  assert.match(GAME, /rhineOpen=\$\{rhineOpen\} onRhineToggle=\$\{setRhineOpen\}/, 'the screen owns the state and the bar the button');
  // the button is a shop toolbtn (same skin as 冻结/刷新), labelled 莱茵科技, and only on while 莱茵生命 is activated
  assert.match(SHOP, /const rhine = !!rhineDock;/, 'the button follows the picker’s own presence, so an inactive room never offers it');
  assert.match(SHOP, /<button type="button" class=\$\{cx\('toolbtn', 'toolbtn--rhine', rhineOpen && 'is-on'\)\}/, 'it is a themed shop toolbtn');
  assert.match(SHOP, /data-testid="rhine-toggle"/, 'and addressable by a test id');
  assert.match(SHOP, /aria-pressed=\$\{rhineOpen \? 'true' : 'false'\}/, 'its pressed state is exposed');
  assert.match(SHOP, /<span>\$\{t\('莱茵科技'\)\}<\/span>/, 'the label is 莱茵科技');
  assert.match(SHOP, /onClick=\$\{\(\) => onRhineToggle\?\.\(!rhineOpen\)\}/, 'a click flips the slot');
  // the swap itself is CSS so the shop's armed card survives it, and the two really are exclusive
  assert.match(SHOP, /class=\$\{cx\('shopbar',[^)]*rhine && rhineOpen && 'has-rhine'\)\}/, 'only the SHOWN picker takes has-rhine');
  // the rules are written without spaces around the braces, like the rest of this stylesheet
  assert.match(code, /\.shopbar\.has-rhine \.shopbar__row\{display:none\}/, 'the picker hides the shop row');
  assert.match(code, /\.shopbar:not\(\.has-rhine\) \.rhine-dock\{display:none\}/, 'and the shop hides the picker');  // the button keeps its own colour so it reads as a third tool beside 冻结 (ice) / 刷新 (amber)
  assert.match(code, /\.toolbtn--rhine\{--tb:var\(--mint-500\)\}/, 'the button colours itself with the shop’s mint');
  assert.match(code, /\.toolbtn--rhine\.is-on\{background:var\(--mint-500\);color:#06231a\}/, 'and reads as on while the picker shows');
});

test('3. the 提示 line is gone (yellow box)', () => {
  assert.ok(!DOCK.includes('rhine-dock__hint'), 'the component renders no hint line');
  assert.ok(!code.includes('rhine-dock__hint'), 'and no rule styles one');
  assert.ok(!DOCK.includes('3人可部署1台，6人可部署2台，9人可部署3台'), 'its long text left the panel');
  assert.ok(!DOCK.includes('点击高亮格或拖动到棋盘部署'), 'and so did the placing hint');
});

test('4. the three new strings are translatable', () => {
  for (const k of ['莱茵科技', '查看莱茵生命科研装置', '返回商店干员表']) {
    assert.equal(typeof EN[k], 'string', `${k} has an English translation`);
    assert.ok(EN[k].length > 0, `${k} is not empty`);
  }
});
