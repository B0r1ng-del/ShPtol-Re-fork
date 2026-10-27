// test/ui/switch-row.test.js — the shared <SwitchRow/> of ui/components.js, asserted without a browser.
//
// 2026-10-13 (图一): 「左边是功能名字，右边有开关」，and the explanation moves behind an ⓘ after the name (hover on a
// desktop, long press on a phone). Both menus that look like this use the ONE component — the 模式界面's Mod submenu
// and 房主配置 — so this file pins the contract they share. The rendered shape (alignment, tap targets, the real
// long-press / hover behaviour) is measured in a browser by test/ui/menu-switch-rows.e2e.test.js; here we check the
// source-level contract and the message ids, which run everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const COMPONENTS = read('public/js/ui/components.js');
const CSS = read('public/css/components.css');
const MODS = read('public/js/ui/mods.js');
const ROOM = read('public/js/screens/room.js');
const EN = JSON.parse(read('public/i18n/en.json'));

/** The SwitchRow's own source. */
const SRC = COMPONENTS.slice(COMPONENTS.indexOf('export function SwitchRow('), COMPONENTS.indexOf('// ---- ProgressBar'));

test('SwitchRow is one shared component: name left, ⓘ, then the switch on the right', () => {
  assert.ok(SRC.length > 200, 'SwitchRow exists in ui/components.js');
  // the three parts, in document order
  const label = SRC.indexOf('class="swrow__label"');
  const info = SRC.indexOf('class="swrow__info"');
  const sw = SRC.indexOf('class=${`sw${on');
  assert.ok(label > 0, 'the name is rendered');
  assert.ok(info > label, 'the ⓘ comes after the name');
  assert.ok(sw > info, 'and the switch comes last, so it is the rightmost part of the row');
  // a real switch, not a coloured row: role/aria + a disabled state for a read-only row
  assert.match(SRC, /role="switch" aria-checked=\$\{on \? 'true' : 'false'\}/);
  assert.match(SRC, /disabled=\$\{!editable\}/, 'a row without onChange (or busy) is read-only');
  assert.match(SRC, /const editable = typeof onChange === 'function' && !disabled;/);
  // the explanation is the tooltip's text — the same Tooltip that gives desktop hover + touch long-press
  assert.match(SRC, /<\$\{Tooltip\} text=\$\{tip\}>/, 'the tip is a Tooltip');
  assert.match(SRC, /<button type="button" class="swrow__info"/, 'the ⓘ is a focusable button of its own');
  // a tap on the ⓘ must not submit/scroll/navigate the dialog
  assert.match(SRC, /onClick=\$\{\(e\) => e\.preventDefault\(\)\}/);
  // the knob is a child, so no transform ever lands on `.sw` itself (that would re-anchor a fixed dialog)
  assert.match(SRC, /<span class="sw__knob" aria-hidden="true"><\/span>/);
});

test('the CSS keeps the parts aligned as a column and gives both controls a real tap target', () => {
  // a fixed grid, so every row of a menu shares the ⓘ's and the switch's x whatever the label's length is
  assert.match(CSS, /\.swrow__head \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto auto;/);
  assert.match(CSS, /\.swrow__label \{ min-width: 0;/);
  // the ⓘ and the switch are held at a real hit area with max(), so a phone's smaller --t cannot shrink them
  assert.match(CSS, /\.swrow__info \{[^}]*width: max\(\.34rem, 24px\); height: max\(\.34rem, 24px\);/);
  assert.match(CSS, /\.sw \{ --sw-w: max\(\.52rem, 44px\); --sw-h: max\(\.28rem, 24px\);/);
  // 2026-10-26 (owner, 第二次): 「直接把设置里那个按钮取下来，把开启和关闭两个字去掉」 — the control is now the
  // 设置 menu's `.set-toggle` geometry without its label: a bordered BOX (.sw) around a TRACK (.sw::before) with a
  // SQUARE knob inside. So `.sw` carries the border and the box background, the track is the pseudo-element.
  assert.match(CSS, /\.sw::before \{[^}]*background: var\(--bg-3\)/, 'the track is the ::before');
  assert.match(CSS, /\.sw\.is-on \{ border-color: var\(--mint-700\); \}/, 'on: the box border turns mint');
  assert.match(CSS, /\.sw\.is-on::before \{ background: var\(--mint-800\); \}/, 'on: the track turns mint');
  // a SQUARE knob slides the track's inner width minus its own — the same figure `.set-toggle i::after` uses (.22/46)
  assert.match(CSS, /\.sw\.is-on \.sw__knob \{ transform: translateX\(calc\(var\(--sw-w\) - var\(--sw-h\)\)\); background: var\(--mint-400\); \}/);
  assert.match(CSS, /\.sw:disabled \{ cursor: default; opacity: \.45; \}/);
  // the press feedback lives on the KNOB: a transform on `.sw` would make it the containing block for a fixed dialog
  assert.match(CSS, /\.sw:not\(:disabled\):active \.sw__knob \{ filter: brightness\(\.9\); \}/);
  assert.ok(!/\.sw:active[^{]*\{[^}]*transform/.test(CSS), 'no transform on the switch button itself');
});

test('the knob is centred inside the box\'s track', () => {
  // An absolutely positioned child is laid out against the PADDING box, so `top: var(--sw-p)` double-counts the 1px
  // border: the knob then sits `--sw-p + 1px` from the track's top/left but `--sw-p - 1px` from its bottom/right. On the
  // 44×24 pill that is a 3px / 1px gap — the owner's report of 2026-10-15 (「所有开关按钮位置都有偏移，对不齐，且手机和
  // 电脑端表现不一致」; measured in a browser across desktop + phone). The border width is named so the two cannot drift.
  assert.match(CSS, /\.sw \{ [^}]*--sw-b: 1px;/, 'the border width has a name');
  assert.match(CSS, /\.sw \{ [^}]*border: var\(--sw-b\) solid var\(--line-2\)/, 'and the border uses it');
  // the knob is laid out against the BOX, so its inset is the box padding plus the track padding — the border is
  // already outside both, so it no longer takes part (the old `- var(--sw-b)` term is gone with the pill).
  assert.match(CSS, /\.sw__knob \{ position: absolute; top: calc\(var\(--sw-box\) \+ var\(--sw-p\)\); left: calc\(var\(--sw-box\) \+ var\(--sw-p\)\);/,
    'the knob sits inside the box padding plus the track padding');
  assert.match(CSS, /\.sw\.is-on \.sw__knob \{ transform: translateX\(calc\(var\(--sw-w\) - var\(--sw-h\)\)\)/);
});

test('both switch menus use it: 房主配置\'s own options and its Mod 开关 section', () => {
  /** The code with comments stripped: the old class names live on in the comments that explain the change. */
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // 2026-10-16: the lobby's Mod submenu moved into 房主配置, so screens/room.js is now the ONE screen with two switch
  // menus — its own rows (HOST_CONFIG_ROWS) and the Mod 开关 section (MOD_ROWS). Both render the shared SwitchRow and
  // both keep driving their rows from their own table.
  for (const [name, src, key] of [['screens/room.js', ROOM, 'HOST_CONFIG_ROWS'], ['ui/mods.js', MODS, 'MOD_ROWS']]) {
    assert.ok(src.includes(key), `${name} still drives them from ${key}`);
  }
  assert.match(ROOM, /<\$\{SwitchRow\} key=\$\{r\.key\}/, 'room.js renders SwitchRow rows');
  assert.ok(!/__desc/.test(code(ROOM)), 'screens/room.js no longer prints the explanation under the switch');
  assert.ok(!/dpick__opt/.test(code(MODS)), 'ui/mods.js no longer uses the dpick__opt option style');
  // every row of both menus carries a testid and an ⓘ testid the e2e suite selects on. The Mod rows are the panel's
  // second menu now, so they are namespaced `hostcfg-mod-…` to keep one selector space per dialog.
  // 图一 (2026-10-17): the two menus became ONE list dealt into two columns, so each row carries its testid on its own
  // (HostConfigDialog sets it, MatchOptionSection reads it) and the ⓘ's is that testid plus `-info`.
  assert.match(ROOM, /testid: `hostcfg-\$\{r\.key\}`/, 'the host options keep `hostcfg-<key>`');
  assert.match(ROOM, /testid: `hostcfg-mod-\$\{r\.key\}`/, 'the Mod rules keep `hostcfg-mod-<key>`');
  assert.match(ROOM, /testid=\$\{r\.testid\} infoTestid=\$\{`\$\{r\.testid\}-info`\}/, 'SwitchRow renders both');
  // 房主配置 keeps its read-only shape for a non-host: the switch renders disabled
  assert.match(ROOM, /disabled=\$\{!r\.editable \|\| !!busy\}/);
});

test('the labels, tips and the ⓘ\'s accessible name all have four-language entries', () => {
  // the ⓘ is icon-only, so its aria-label is the only text a screen reader gets
  assert.match(SRC, /aria-label=\$\{t\('长按或悬停查看说明'\)\}/);
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    assert.equal(typeof pack['长按或悬停查看说明'], 'string', `${lang}: the ⓘ label`);
  }
  assert.ok(EN['长按或悬停查看说明'].length > 0 && !/[\u4e00-\u9fff]/.test(EN['长按或悬停查看说明']), 'a real English string');
  // the switch's own aria-label is the row's label (so the control is not an unnamed switch)
  assert.match(SRC, /aria-label=\$\{label\}/);
});

test('the ⓘ is never the INITIAL focus of a dialog: opening a panel must not show the first tip', () => {
  // 需求方 2026-10-17: 「无论打开 mod 菜单还是房主配置，都会莫名显示第一项选择的解释」. The ⓘ is the first tabbable element of
  // every settings-style dialog, and `<Modal>` focused it on open — a PROGRAMMATIC focus is indistinguishable from a
  // keyboard focus, so `Tooltip.onFocusIn` showed that row's tip immediately. Modal's own focusFirst must skip the
  // explanation anchors (`.tt-anchor`, what `<Tooltip>` renders); the ⓘ stays Tab-reachable.
  const MODAL = COMPONENTS.slice(COMPONENTS.indexOf('export function Modal('), COMPONENTS.indexOf('let dialogSeq'));
  assert.match(MODAL, /const focusFirst = \(\) => \{/, 'focusFirst picks a target, it does not blindly take tabbable()[0]');
  assert.match(MODAL, /!el\.closest\('\.tt-anchor'\)/, 'and it skips the explanation anchor');
  // the ⓘ itself is still a real tab stop — only the INITIAL focus changed
  assert.match(SRC, /class="swrow__info"/);
  assert.ok(!/tabIndex=\$\{-1\}/.test(SRC), 'the ⓘ stays in the tab order');
});

test('the switch row is documented where the client design lives', () => {
  const DESIGN = read('docs/design/client.md');
  assert.match(DESIGN, /SwitchRow/, 'docs/design/client.md names the shared component');
});
