// ACRYLIC 背景 (需求方 2026-10-17: 「将 UI 控件的最底层背景替换为 Acrylic 材质」).
//
// Every surface here already shares ONE recipe in this codebase (css/chat.css is the origin): a translucent plate plus
// `backdrop-filter: blur(.12rem) saturate(1.6)`, with `@supports not (backdrop-filter: …)` keeping an opaque colour for a
// browser that cannot blur. The test pins the recipe on each control the owner named, and pins the FALLBACK too — a
// translucent plate without its fallback is unreadable text on an old browser, which is the failure this guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = (rel) => readFileSync(path.join(ROOT, 'public/css', rel), 'utf8');
const GAME = css('screens/game.css');
const SHOP = css('screens/game-shop.css');
const PANELS = css('screens/game-panels.css');

/** The body of a top-level rule `selector { … }`, or null. */
const rule = (src, selector) => {
  const m = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(src);
  return m ? m[1] : null;
};

/** The `@supports not (backdrop-filter: …)` block(s) of a file. */
const fallbacks = (src) => src.slice(src.indexOf('@supports not (backdrop-filter: blur(1px))'));

const ACRYLIC = /-webkit-backdrop-filter: blur\(\.12rem\) saturate\(1\.6\); backdrop-filter: blur\(\.12rem\) saturate\(1\.6\);/;

test('图二 准备就绪: the ready pill is a frosted plate, with its opaque fallback', () => {
  const b = rule(GAME, '.readybtn');
  assert.ok(b, 'the rule exists');
  assert.match(b, ACRYLIC, 'blur + saturation');
  assert.match(b, /background: rgba\(10, 14, 12, \.55\);/, 'a translucent fill (was .9)');
  assert.match(fallbacks(GAME), /\.readybtn \{ background: rgba\(10, 14, 12, \.9\); \}/, 'the opaque fallback survives');
  // the refusal line above it is a plate of its own
  assert.match(rule(GAME, '.readywrap__why'), ACRYLIC);
  assert.match(fallbacks(GAME), /\.readywrap__why \{ background: rgba\(40, 6, 6, \.88\); \}/);
});

test('图三 商店栏: the bar that WRAPS the cards is frosted — the cards themselves are untouched', () => {
  const row = rule(SHOP, '.shopbar__row');
  assert.ok(row, 'the bar');
  assert.match(row, ACRYLIC, 'the wrapper blurs what is behind it');
  assert.match(row, /background: linear-gradient\(180deg, rgba\(14, 19, 17, \.58\), rgba\(8, 11, 10, \.62\)\)/, 'translucent');
  assert.match(fallbacks(SHOP), /\.shopbar__row \{ background: linear-gradient\(180deg, rgba\(14, 19, 17, \.94\), rgba\(8, 11, 10, \.97\)\); \}/);
  // 需求方: 「干员卡牌本身不要改动」 — the cards keep their own opaque faces
  assert.match(rule(SHOP, '.scard'), /background: #151a18;/, 'the operator card keeps its own background');
  assert.match(rule(SHOP, '.lvcard'), /background: linear-gradient\(180deg, #5fe0b9, #36b690\);/, 'the LEVEL card keeps its own');
  assert.ok(!/\.scard[^,{]*\{[^}]*backdrop-filter/.test(SHOP), 'no card blurs anything');
});

test('图五 冻结 / 刷新: both tool buttons are frosted, the 剩余可放置角色 plate too', () => {
  const b = rule(SHOP, '.toolbtn');
  assert.ok(b);
  assert.match(b, ACRYLIC);
  assert.match(b, /background: rgba\(8, 11, 10, \.55\);/, 'translucent (was .9)');
  assert.match(b, /border: 2px solid var\(--tb\);/, 'the ice / amber border is unchanged');
  assert.match(rule(SHOP, '.shopbar__remain'), ACRYLIC, 'the counter above them matches');
  assert.match(fallbacks(SHOP), /\.toolbtn \{ background: rgba\(8, 11, 10, \.9\); \}/);
  assert.match(fallbacks(SHOP), /\.shopbar__remain \{ background: rgba\(8, 11, 10, \.78\); \}/);
  // the ON state of 冻结 keeps its own solid ice fill (a state, not the base layer)
  assert.match(SHOP, /\.toolbtn--ice\.is-on \{ background: var\(--ice\); color: #0b1822; \}/);
});

test('局内盟约详细界面 (.bpop) is frosted, with its fallback', () => {
  const b = rule(PANELS, '.bpop');
  assert.ok(b, 'the bond popup');
  assert.match(b, ACRYLIC, 'blur + saturation');
  assert.match(b, /background: rgba\(11, 15, 13, \.66\);/, 'translucent (was .97)');
  assert.match(fallbacks(PANELS), /\.bpop \{ background: rgba\(11, 15, 13, \.97\); \}/, 'opaque where blur is unavailable');
  // docked over the detail card it stays denser, but still see-through
  assert.match(PANELS, /\.bpop\.is-over \{ z-index: 10; background: rgba\(11, 15, 13, \.88\); \}/);
});
