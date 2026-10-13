// test/ui/cheat-menu.e2e.test.js — the 作弊菜单's rendered shape in headless Chrome, desktop and landscape phone.
//
// The source contract is pinned without a browser by test/ui/cheat-ui.test.js; this file measures the RESULT, because
// every one of the three fixes is a measurement:
//   1. the ball shows an SVG glyph (an <svg class="icon">), not a colour emoji;
//   2. the row's switch is proportional to its own label (and not the shared 44×24 the Mod menu keeps);
//   3. no label wraps onto a second line — at every 文字大小 step, on both device classes.
//
// The ball only renders once 设置 turned it on, and its store is built AT MODULE LOAD, so the preference has to be in
// localStorage before the app's scripts run: `evaluateOnNewDocument`, not a later `evaluate`.
//
//   SP_E2E=1 node --test test/ui/cheat-menu.e2e.test.js
//
// The solo flow is the one test/ui/real.e2e.test.js uses (独立模拟 → 标准模拟 → 开始独立模拟 → 开始模拟 → 准备就绪 →
// band pick), because the ball lives on the in-match screen and the mock harness does not mount it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The two device classes of the standing two-device rule (phone = LANDSCAPE; portrait shows 「请将设备横屏」). */
const DEVICES = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'phone', width: 844, height: 390, mobile: true },
];

describe('作弊菜单 (the floating cheat ball)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
  });
  after(async () => { await srv?.close(); });

  /** The browser-side half of a run: everything that touches the DOM, kept out of Node. */
  const pageFns = {
    clickText: (sel, re) => {
      const el = [...document.querySelectorAll(sel)].find((x) => new RegExp(re).test(x.textContent || ''));
      if (!el) return false;
      el.click();
      return true;
    },
    openBall: () => {
      const b = document.querySelector('[data-testid="cheat-ball-btn"]');
      if (!b) return false;
      const r = b.getBoundingClientRect();
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return true;
    },
    /** Everything the three fixes are asserted on, measured from the live DOM. */
    measure: () => {
      const ball = document.querySelector('.cheatball__btn');
      const panel = document.querySelector('[data-testid="cheat-panel"]');
      if (!ball || !panel) return null;
      const cs = getComputedStyle(ball);
      const svg = ball.querySelector('svg.icon, svg');
      const rows = [...document.querySelectorAll('.cheatball__row')].map((row) => {
        const label = row.querySelector('.cheatball__label');
        const control = row.querySelector('.sw') || row.querySelector('.btn');
        const lcs = getComputedStyle(label);
        const lb = label.getBoundingClientRect();
        const cb = control.getBoundingClientRect();
        const lineH = parseFloat(lcs.lineHeight);
        return {
          text: label.textContent.trim(),
          isSwitch: control.classList.contains('sw'),
          fontSize: parseFloat(lcs.fontSize),
          whiteSpace: lcs.whiteSpace,
          labelW: lb.width,
          controlW: cb.width,
          controlH: cb.height,
          lines: Math.round(lb.height / lineH),
          wrapped: lb.height > lineH * 1.6,
          clipped: label.scrollWidth > label.clientWidth + 1,
          ratio: cb.width / parseFloat(lcs.fontSize),
        };
      });
      return {
        // 1. the ball
        ballEmoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(ball.textContent || ''),
        ballHasSvg: !!svg,
        ballSvgW: svg ? svg.getBoundingClientRect().width : 0,
        ballRadius: cs.borderRadius,
        ballBorder: cs.borderColor,
        // 2 + 3. the rows
        rows,
        panelW: panel.getBoundingClientRect().width,
        panelLeft: panel.getBoundingClientRect().left,
        panelRight: panel.getBoundingClientRect().right,
        viewportW: innerWidth,
        hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    },
  };

  /**
   * Drive a fresh client to PREP with the ball enabled, on one device class, at one 文字大小 step.
   * @param {{name:string,width:number,height:number,mobile:boolean}} device
   * @param {string|null} textSize one of TEXT_SIZES, or null for the default
   */
  async function prepWithBall(device, textSize) {
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling'] });
    const page = await browser.newPage();
    await page.setViewport({ width: device.width, height: device.height, isMobile: device.mobile, hasTouch: device.mobile, deviceScaleFactor: 1 });
    // BEFORE any app script: the ball's store reads this pref at module load
    await page.evaluateOnNewDocument((size) => {
      localStorage.setItem('sp.pref.cheatBall', 'true');
      if (size) localStorage.setItem('sp.pref.settings', JSON.stringify({ textSize: size }));
    }, textSize);
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });

    const click = (sel, re) => page.evaluate(([s, r]) => {
      const el = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent || ''));
      if (!el) return false;
      el.click();
      return true;
    }, [sel, re]);

    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.title-login input', { timeout: 20000 });
    await page.click('.title-login input');
    await page.keyboard.type('测试博士');
    await click('.title-login button', '开始');
    await sleep(1400);
    await click('.mode-card', '独立模拟');
    await sleep(500);
    await click('.diff-card', '标准模拟');
    await sleep(400);
    await click('button', '开始独立模拟|创建');
    await sleep(2400);
    await click('.room-bar__right button', '开始模拟');
    await sleep(2200);
    await click('button', '准备就绪|确认');
    await sleep(1600);
    // BAND_DRAFT: the confirm button only enables after a pick, so retry until the phase moves on
    for (let i = 0; i < 8; i++) {
      const ph = await page.evaluate(() => globalThis.__SP__?.store?.get?.()?.match?.public?.phase);
      if (ph && ph !== 'BAND_DRAFT') break;
      await click('.band-card, .draft-card, [data-testid="band-card"], button', '标准|策略|阵型|选择');
      await sleep(1000);
    }
    await page.waitForFunction(() => globalThis.__SP__?.store?.get?.()?.match?.public?.phase === 'PREP', { timeout: 45000 }).catch(() => {});
    await sleep(1200);
    assert.ok(await page.$('[data-testid="cheat-ball-btn"]'), `${device.name}: the ball renders at PREP (the pref was on)`);
    await page.evaluate(pageFns.openBall);
    await sleep(500);
    return { browser, page, problems };
  }

  test('the ball draws an SVG glyph — no emoji — in the game\'s own skin, both devices', { timeout: 5 * 60 * 1000 }, async () => {
    for (const device of DEVICES) {
      const { browser, page, problems } = await prepWithBall(device, null);
      try {
        const m = await page.evaluate(pageFns.measure);
        assert.ok(m, `${device.name}: the panel is open`);
        // 1. an SVG glyph, never the colour emoji
        assert.equal(m.ballEmoji, false, `${device.name}: the ball shows no emoji`);
        assert.ok(m.ballHasSvg, `${device.name}: the ball draws an <svg> icon`);
        assert.ok(m.ballSvgW >= 12, `${device.name}: the glyph is a readable size (${m.ballSvgW}px)`);
        // the panels' skin: a mint border and a small radius (it was a plain circle before)
        assert.match(m.ballRadius, /^[\d.]+px$/, `${device.name}: a set corner radius, not 50%`);
        assert.ok(!/50%/.test(m.ballRadius), `${device.name}: no longer a plain circle`);
        assert.equal(problems.length, 0, `${device.name}: no page/console errors — ${problems.join('; ')}`);
      } finally { await browser.close(); }
    }
  });

  test('the switch is proportional to its label, and stays a real pointer target', { timeout: 5 * 60 * 1000 }, async () => {
    for (const device of DEVICES) {
      const { browser, page } = await prepWithBall(device, null);
      try {
        const m = await page.evaluate(pageFns.measure);
        const switches = m.rows.filter((r) => r.isSwitch);
        assert.equal(switches.length, 2, `${device.name}: the two switch rows measure as switches`);
        for (const r of switches) {
          // the fixed 44×24 track was 3.7× (desktop) and 6.9× (phone) its label; the proportional one is < 3.2×
          assert.ok(r.ratio <= 3.2, `${device.name}: "${r.text}" switch/label ratio ${r.ratio.toFixed(2)} (want ≤ 3.2)`);
          // and the visual never collapses below a usable size
          assert.ok(r.controlH >= 8, `${device.name}: "${r.text}" switch is ${r.controlH}px tall`);
          assert.ok(r.controlW >= 16, `${device.name}: "${r.text}" switch is ${r.controlW}px wide`);
        }
        // the +5 button is a labelled text button, so its box is inherently wider than a switch track; what must hold is
        // that it is not the full-height .btn the undefined `btn--small` left it at (58.6×37.5 beside a 12px label)
        for (const r of m.rows.filter((x) => !x.isSwitch)) {
          assert.ok(r.controlH <= r.fontSize * 2.2, `${device.name}: "${r.text}" button is not oversized (${r.controlH}px at ${r.fontSize}px)`);
        }
        // the invisible hit area keeps the touch target up even where the track is small
        const hit = await page.evaluate(() => {
          const sw = document.querySelector('.cheatball__row .sw');
          const after = getComputedStyle(sw, '::after');
          const r = sw.getBoundingClientRect();
          // a point 3px outside the track must still resolve to the switch (or its knob), i.e. the overlay works
          const el = document.elementFromPoint(r.x + r.width / 2, r.y - 3);
          return { afterH: after.height, afterContent: after.content, onSwitch: !!(el && (el === sw || sw.contains(el))) };
        });
        assert.equal(hit.afterContent, '""', `${device.name}: the hit-area overlay exists`);
        assert.notEqual(hit.afterH, 'auto', `${device.name}: it has a height`);
        assert.ok(hit.onSwitch, `${device.name}: a tap just outside the track still hits the switch`);
      } finally { await browser.close(); }
    }
  });

  test('no label wraps or clips at any 文字大小 step, on both devices', { timeout: 12 * 60 * 1000 }, async () => {
    for (const textSize of [null, 'md', 'lg', 'xl']) {
      for (const device of DEVICES) {
        const { browser, page } = await prepWithBall(device, textSize);
        try {
          const m = await page.evaluate(pageFns.measure);
          const at = `${device.name}/${textSize || 'default'}`;
          // 3. every label is ONE line, never clipped
          for (const r of m.rows) {
            assert.equal(r.whiteSpace, 'nowrap', `${at}: "${r.text}" is nowrap`);
            assert.equal(r.wrapped, false, `${at}: "${r.text}" does not wrap`);
            assert.equal(r.lines, 1, `${at}: "${r.text}" is one line (measured ${r.lines})`);
            assert.equal(r.clipped, false, `${at}: "${r.text}" is not clipped`);
          }
          // the wider panel must still fit the phone's landscape viewport
          assert.ok(m.panelLeft >= -0.5 && m.panelRight <= m.viewportW + 0.5,
            `${at}: the panel stays on screen (${m.panelLeft.toFixed(1)}…${m.panelRight.toFixed(1)} of ${m.viewportW})`);
          assert.equal(m.hOverflow, false, `${at}: no horizontal page overflow`);
        } finally { await browser.close(); }
      }
    }
  });
});
