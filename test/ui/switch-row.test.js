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
  // the on state is a mint track + a travelled knob (the visible state the owner asked for)
  assert.match(CSS, /\.sw\.is-on \{ background: var\(--mint-800\); border-color: var\(--mint-700\); \}/);
  assert.match(CSS, /\.sw\.is-on \.sw__knob \{ transform: translateX\(calc\(var\(--sw-w\) - var\(--sw-h\)\)\); background: var\(--mint-400\); \}/);
  assert.match(CSS, /\.sw:disabled \{ cursor: default; opacity: \.45; \}/);
  // the press feedback lives on the KNOB: a transform on `.sw` would make it the containing block for a fixed dialog
  assert.match(CSS, /\.sw:not\(:disabled\):active \.sw__knob \{ filter: brightness\(\.9\); \}/);
  assert.ok(!/\.sw:active[^{]*\{[^}]*transform/.test(CSS), 'no transform on the switch button itself');
});

test('both menus use it: the Mod submenu and 房主配置 render one SwitchRow per option', () => {
  /** The code with comments stripped: the old class names live on in the comments that explain the change. */
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [name, src, key] of [['ui/mods.js', MODS, 'MOD_ROWS'], ['screens/room.js', ROOM, 'HOST_CONFIG_ROWS']]) {
    assert.match(src, new RegExp(`<\\$\\{SwitchRow\\} key=\\$\\{r\\.key\\}`), `${name} renders SwitchRow rows`);
    assert.ok(src.includes(key), `${name} still drives them from ${key}`);
    // the old rectangular option and its printed explanation are gone from the CODE. (The DIFFICULTY picker in
    // room.js legitimately still uses `dpick__opt` — it is a segmented chooser, not a switch row — so only the
    // explanation-under-the-switch pattern is a hard no here.)
    assert.ok(!/__desc/.test(code(src)), `${name} no longer prints the explanation under the switch`);
  }
  assert.ok(!/dpick__opt/.test(code(MODS)), 'ui/mods.js no longer uses the dpick__opt option style');
  // every row of both menus carries a testid and an ⓘ testid the e2e suite selects on
  assert.match(MODS, /testid=\$\{`mod-\$\{r\.key\}`\} infoTestid=\$\{`mod-info-\$\{r\.key\}`\}/);
  assert.match(ROOM, /testid=\$\{`hostcfg-\$\{r\.key\}`\} infoTestid=\$\{`hostcfg-info-\$\{r\.key\}`\}/);
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

test('the switch row is documented where the client design lives', () => {
  const DESIGN = read('docs/design/client.md');
  assert.match(DESIGN, /SwitchRow/, 'docs/design/client.md names the shared component');
});
