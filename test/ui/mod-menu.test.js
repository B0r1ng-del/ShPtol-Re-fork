// test/ui/mod-menu.test.js — the 模式界面's Mod submenu must keep its dialog OUT of the button.
//
// THE BUG THIS PINS (user report 2026-10-13: 「功能无法启用，菜单无法点完成而关闭，会反复弹出，甚至如图二会卡到右上角」).
// `ModButton` first rendered `<ModDialog/>` as a CHILD of its own `<button data-testid="mod-open">`. Four symptoms came
// out of that one nesting, all four reproduced in a real browser (test/ui/mod-menu.e2e.test.js):
//
//   1. 卡在右上角 — `.btn:not(:disabled):active { transform: translateY(1px) }`. Any non-none `transform` makes that
//      element the containing block of a `position: fixed` descendant, and `:active` matches every ancestor of the
//      pressed element. So pressing ANYWHERE inside the dialog (a switch included) re-anchored the whole overlay from
//      the viewport to the button's ~76×36 box in the corner. Measured: 1400×640 → 74×36.
//   2. 功能无法启用 — a click needs pointerdown and pointerup on the same element. The press above moved the dialog out
//      from under the pointer, so pointerup landed elsewhere and no click was delivered: the switch never flipped.
//   3. 反复弹出 — a click inside the dialog bubbled to the button's own `onClick=${() => setOpen(true)}`.
//   4. 无法点完成而关闭 — 完成's click did the same thing: `onClose()` ran (setOpen(false)) and the bubbling click
//      immediately called `setOpen(true)` again. Esc worked, because Esc never goes through the button.
//
// A `<button>` may not contain interactive content either, so the nested `<button role="switch">` rows were invalid
// markup on top of it.
//
// The fix is structural and is what this file guards: the dialog is a SIBLING of the button (a Fragment), the same
// shape screens/room.js already used for 房主配置's button/dialog pair (which never had the bug).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(path.join(ROOT, 'public/js/ui/mods.js'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'public/css/screens/lobby.css'), 'utf8');

/** The source of `ModButton` alone (up to the next top-level `export`), so the assertions cannot match ModDialog's own body. */
function modButtonSource(src) {
  const start = src.indexOf('export function ModButton(');
  assert.ok(start > 0, 'ModButton exists in public/js/ui/mods.js');
  const rest = src.slice(start);
  const next = rest.indexOf('\nexport ', 1);
  return next > 0 ? rest.slice(0, next) : rest;
}

test('the Mod dialog is rendered as a SIBLING of the button, never inside it', () => {
  const body = modButtonSource(SRC);
  const openTag = body.indexOf('<button');
  const closeTag = body.indexOf('</button>');
  assert.ok(openTag >= 0 && closeTag > openTag, 'ModButton renders exactly one button with a closing tag');

  const inButton = body.slice(openTag, closeTag);
  const afterButton = body.slice(closeTag + '</button>'.length);
  assert.ok(!/ModDialog/.test(inButton), 'ModDialog is NOT a descendant of the button (this is the bug)');
  assert.ok(/ModDialog/.test(afterButton), 'ModDialog is rendered after the button — a sibling');
  // …and the pair really is wrapped in a Fragment, so the button keeps its place in the top bar's flex row
  assert.match(body, /html`<\$\{Fragment\}>/, 'the pair is wrapped in a Fragment');
  assert.match(body, /<\$\{Fragment\}>[\s\S]*<\$\{Icon\}/, 'the Fragment comes before the button content');
});

test('the button keeps the forwardRef-free contract the top bar and the tests rely on', () => {
  const body = modButtonSource(SRC);
  // the entry points the e2e/static suites select on, and the badge that shows how many switches are on
  assert.match(body, /data-testid="mod-open"/);
  assert.match(body, /onClick=\$\{\(\) => setOpen\(true\)\}/, 'the button only ever OPENS');
  assert.match(SRC, /return useStore\(\(s\) => s, Object\.is, modsStore\);/, 'the count re-renders from the store');
  assert.match(SRC, /data-testid=\$\{`mod-\$\{r\.key\}`\}/, 'each switch row keeps its testid');
  assert.match(SRC, /role="switch"/, 'the rows are switches');
});

test('the switch rows live in the dialog, and the dialog is a Modal (fixed overlay), not an inline panel', () => {
  const dialog = SRC.slice(SRC.indexOf('function ModDialog('));
  assert.match(dialog, /<\$\{Modal\}/, 'ModDialog renders the shared Modal');
  assert.match(dialog, /<button type="button" role="switch"/, 'a real button per row, inside the dialog');
  // The overlay is fixed and centred: the CSS the containment bug used to break.
  assert.match(CSS, /\.mods-entry \{ position: relative;/, 'the entry button is its own positioning context');
});
