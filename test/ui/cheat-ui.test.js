// test/ui/cheat-ui.test.js — the 作弊菜单's own look: the floating ball, the switch proportion and single-line labels.
//
// 2026-10-14, from the owner's report of the panel (图一 the ball, 图二/图三 the rows):
//   1. the ball showed a 🎮 COLOUR EMOJI while the whole game draws flat monochrome 24×24 SVG glyphs (`ICONS`), so it
//      read as a foreign object — it now draws `ICONS.gamepad` and takes the panels' own skin;
//   2. the switch was the shared `.sw` at ≥44×24 while the row's label shrinks with `--t`, so on a phone it measured
//      6.9× the 6.4 px label — the CHEAT ROWS now override the two custom properties to scale with `--t`;
//   3. 「免费刷新 +5」 and 「怪物血量降为 1 血」 wrapped onto a second line at the row's fixed 150 px width — every label
//      is `white-space: nowrap` and the panel is content-sized.
// This file pins the source contract; test/ui/cheat-menu.e2e.test.js measures the rendered result in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const CHEATS = read('public/js/ui/cheats.js');
const COMPONENTS = read('public/js/ui/components.js');
const CSS = read('public/css/screens/game-panels.css');
const SHARED = read('public/css/components.css');

/** game-panels.css without comments: the shared `.sw` rule lives on in the comments that explain the override. */
const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

test('1. the ball draws a game icon, not a colour emoji', () => {
  // no emoji anywhere in the component's source (it was 🎮 before)
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(CHEATS), 'no emoji left in ui/cheats.js');
  assert.match(CHEATS, /import \{ html, Icon \} from '\.\/components\.js';/, 'the icon component is imported');
  assert.match(CHEATS, /<\$\{Icon\} name="gamepad" class="cheatball__glyph" \/>/, 'the ball renders ICONS.gamepad');
  // and the glyph really exists in the shared icon set, in the same 24×24 box as the others
  assert.match(COMPONENTS, /gamepad: \{ d: 'M[^']+', eo: true \},/, 'ICONS.gamepad is defined (even-odd for its holes)');
  // the skin is the panels' own: mint border + a small radius, not a plain circle
  assert.match(code, /\.cheatball__btn \{[^}]*border: 1px solid var\(--mint-800\); border-radius: \.1rem;/, 'the ball takes the panel skin');
  assert.match(code, /\.cheatball__glyph \{ width: max\(\.24rem, 22px\); height: max\(\.24rem, 22px\); color: var\(--mint-400\); \}/);
});

test('2. the cheat rows scope the switch smaller, and the shared .sw is untouched', () => {
  // the shared switch keeps its own size — the Mod / 房主配置 menus and test/ui/switch-row.test.js depend on it
  assert.match(SHARED, /\.sw \{ --sw-w: max\(\.52rem, 44px\); --sw-h: max\(\.28rem, 24px\);/,
    'components.css .sw still holds the 44×24 shared size');
  assert.ok(!/\.sw \{ --sw-w: max\(calc/.test(SHARED), 'the shared rule was not retuned');
  // the override is scoped to the cheat rows and scales with --t, the same root the label uses
  const override = code.match(/\.cheatball__row \.sw \{ --sw-w: ([^;]+); --sw-h: ([^;]+);/);
  assert.ok(override, 'the cheat row overrides --sw-w/--sw-h');
  assert.match(override[1], /var\(--t\)/, 'the width scales with --t like its label');
  assert.match(override[2], /var\(--t\)/, 'the height scales with --t');
  assert.match(code, /\.cheatball__label \{[^}]*font-size: calc\(\.16 \* var\(--t\)\)/, 'the label is .16 * --t');
  // the track shrinks with the text but the POINTER target does not: an ::after overlay, held to the row's height
  assert.match(code, /\.cheatball__row \.sw::after \{ content: ''; position: absolute;[^}]*height: max\(100%, var\(--cheat-row-h\)\);/,
    'an invisible hit area keeps the touch target');
  assert.match(code, /\.cheatball__row \{ --cheat-row-h: max\(calc\(\.3 \* var\(--t\)\), 20px\);/, 'the row holds that height');
});

test('3. every label is one line and the panel sizes to its content', () => {
  assert.match(code, /\.cheatball__label \{[^}]*white-space: nowrap;/, 'labels cannot wrap');
  // content-sized, so the longest label sets the width instead of a fixed 150 px that forced a wrap
  assert.match(code, /\.cheatball__panel \{[^}]*width: max-content; min-width: max\(1\.5rem, 150px\);/,
    'the panel is max-content with a floor');
  assert.match(code, /\.cheatball__panel \{[^}]*max-width: min\(78vw, 6rem\);/, 'and stays on a phone screen');
});

test('the +5 button uses a size class that exists', () => {
  // `btn--small` is not defined by any stylesheet — the name is `btn--sm`; the typo left it at the full .btn height
  assert.ok(!/btn--small/.test(CHEATS), 'no undefined btn--small class');
  assert.match(CHEATS, /class="btn btn--sm cheatball__act"/, 'the row uses the real small-button class');
  // its visual shrinks with its own font (not the row's floor, which belongs to the switch's pointer target)...
  assert.match(code, /\.cheatball__row \.cheatball__act \{[^}]*height: max\(calc\(\.29 \* var\(--t\)\), 12px\);/,
    'the +5 height tracks the text root');
  // ...and its POINTER target is the row's height, through a ::before overlay. `::before`, because the base
  // `.btn::after` is the hover bracket corners.
  assert.match(code, /\.cheatball__row \.cheatball__act::before \{[^}]*height: max\(100%, var\(--cheat-row-h\)\);/,
    'the +5 keeps a full-row hit area');
});

test('the rows still drive the real cheats, and the panel is still PREP-gated', () => {
  // the four controls the owner asked for (server side: test/cheat-menu.test.js)
  for (const key of ['infiniteFunds', 'enemyOneHp']) {
    assert.ok(CHEATS.includes(`'${key}'`) || CHEATS.includes(key), `${key} is still a row`);
  }
  assert.match(CHEATS, /onSet && onSet\(r\.key, state\[r\.key\] !== true\)/, 'a switch flips through onSet');
  // both one-shot buttons (免费刷新 +5, 盟约+100) share one handler and name themselves by their row's `action`
  assert.match(CHEATS, /onClick=\$\{\(\) => canUse && onAction && onAction\(r\.action\)\}/, 'a one-shot press names its action');
  assert.match(CHEATS, /data-testid=\$\{`cheat-\$\{r\.action\}`\}/, 'and stays addressable by it');
  assert.match(CHEATS, /disabled=\$\{!canUse\}/, 'controls are disabled when the server would refuse');
  assert.match(CHEATS, /data-testid="cheat-hint"/, 'and the hint explains why');
});
