// test/ui/mod-menu.e2e.test.js — the Mod submenu of the 模式界面, in a real browser (opt-in, ~15 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/mod-menu.e2e.test.js
//
// The user report of 2026-10-13 — 「功能无法启用，菜单无法点完成而关闭，会反复弹出，甚至如图二会卡到右上角」 — was one
// structural mistake with four symptoms. `ModButton` rendered `<ModDialog/>` as a CHILD of its own
// `<button data-testid="mod-open">`, so:
//
//   * `.btn:not(:disabled):active { transform: translateY(1px) }` made the button the containing block of the
//     `position: fixed` overlay while ANY ancestor was `:active` (i.e. while pressing anywhere inside the dialog), so
//     the overlay collapsed from the viewport onto the button's ~76×36 box in the top-right corner;
//   * a real tap is pointerdown + pointerup on the SAME element, and the press above moved the dialog out from under
//     the pointer, so the switch's click never fired at all;
//   * a click inside the dialog bubbled to the button's `onClick=${() => setOpen(true)}` (反复弹出), and 完成 did the
//     same thing — `onClose()` ran and the bubbling click re-opened it (无法点完成而关闭).
//
// These assertions are written against the MEASURED behaviour, not the source, so they fail on the old shape and pass
// on the fixed one (test/ui/mod-menu.test.js is the fast structural guard that runs everywhere). Every interaction
// below uses real mouse events on purpose: `element.click()` bypasses hit-testing and would have passed even when the
// dialog was collapsing under the pointer.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('the Mod submenu of 模式界面', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv, browser, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  /** A lobby page with a fresh mods preference (localStorage cleared, so the switches start all-off). */
  async function lobby() {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.setViewport({ width: 1400, height: 800 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(`${base}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('input', { timeout: 15000 });
    await page.evaluate(() => localStorage.removeItem('sp.pref.mods'));
    await page.type('input', '测试博士');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent))?.click());
    await page.waitForSelector('.lobby-screen', { timeout: 15000 });
    await sleep(600);
    return { page, problems };
  }

  /** The centre of `selector` in viewport coordinates. */
  const centre = (page, selector) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, selector);

  const rect = (page, selector) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, selector);

  /** Click with real mouse events (hit-tested), never a synthetic .click(). */
  async function realClick(page, selector) {
    const pt = await centre(page, selector);
    assert.ok(pt, `${selector} is on screen`);
    await page.mouse.move(pt[0], pt[1]);
    await page.mouse.down();
    await sleep(80);
    await page.mouse.up();
    await sleep(350);
  }

  test('opens as a full-viewport overlay, survives a press, and its switches actually flip', async () => {
    const { page } = await lobby();
    try {
      assert.equal(await page.$('.modal'), null, 'closed until asked');

      await realClick(page, '.lobby-screen [data-testid="mod-open"]');
      assert.ok(await page.$('.modal'), 'the button opens the submenu');

      const viewport = await page.evaluate(() => [innerWidth, innerHeight]);
      const opened = await rect(page, '.modal');
      // 卡在右上角 guard: the overlay covers the viewport, not a corner box
      assert.ok(Math.abs(opened.w - viewport[0]) <= 2 && Math.abs(opened.h - viewport[1]) <= 2,
        `the overlay covers the viewport, got ${opened.w}×${opened.h} of ${viewport[0]}×${viewport[1]}`);
      // …and it is NOT a descendant of the button that opened it
      assert.equal(await page.evaluate(() => document.querySelector('[data-testid="mod-open"]').contains(document.querySelector('.modal'))), false,
        'the dialog is a sibling of the button, not a child');

      // Press and HOLD on a switch: the overlay must not collapse while an ancestor is :active.
      const sw = await centre(page, '.modal [data-testid="mod-noBondBan"]');
      await page.mouse.move(sw[0], sw[1]);
      await page.mouse.down();
      await sleep(200);
      const held = await rect(page, '.modal');
      assert.ok(Math.abs(held.w - viewport[0]) <= 2 && Math.abs(held.h - viewport[1]) <= 2,
        `the overlay stays full-viewport while pressed, got ${held.w}×${held.h}`);
      await page.mouse.up();
      await sleep(350);

      // 功能无法启用 guard: the REAL tap flipped the switch and persisted it for this device
      assert.equal(await page.evaluate(() => document.querySelector('.modal [data-testid="mod-noBondBan"]').getAttribute('aria-checked')), 'true',
        'the switch reads as on');
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.mods') || 'null')),
        { noBondBan: true, untimedSp: false, randomSpVote: false }, 'and it is saved for this device');
      // the badge on the entry button followed
      assert.match(await page.$eval('.lobby-screen [data-testid="mod-open"]', (b) => b.textContent), /1/, 'the badge counts one switch');
    } finally { await page.close(); }
  });

  test('完成 closes it and it stays closed; Esc and the backdrop do too', async () => {
    const { page } = await lobby();
    try {
      await realClick(page, '.lobby-screen [data-testid="mod-open"]');
      assert.ok(await page.$('.modal'), 'open');

      // 无法点完成而关闭 / 反复弹出 guard: a real tap on 完成 must close it, and it must STAY closed.
      const donePt = await page.evaluate(() => {
        const done = [...document.querySelectorAll('.modal button')].find((b) => /完成/.test(b.textContent));
        if (!done) return null;
        const r = done.getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2];
      });
      assert.ok(donePt, 'the dialog has a 完成 button');
      await page.mouse.click(donePt[0], donePt[1]);
      await sleep(400);
      assert.equal(await page.$('.modal'), null, '完成 closed it');
      await sleep(500);
      assert.equal(await page.$('.modal'), null, 'and it did not bounce back open');

      // Esc still closes it
      await realClick(page, '.lobby-screen [data-testid="mod-open"]');
      assert.ok(await page.$('.modal'), 're-opened');
      await page.keyboard.press('Escape');
      await sleep(300);
      assert.equal(await page.$('.modal'), null, 'Esc closes it');

      // …and so does a click on the backdrop (outside the box)
      await realClick(page, '.lobby-screen [data-testid="mod-open"]');
      assert.ok(await page.$('.modal'), 're-opened again');
      await page.mouse.click(30, Math.round(800 / 2));
      await sleep(350);
      assert.equal(await page.$('.modal'), null, 'the backdrop closes it');
    } finally { await page.close(); }
  });

  test('the lobby reports no page errors from the submenu, and the room is still usable after', async () => {
    const { page, problems } = await lobby();
    try {
      await realClick(page, '.lobby-screen [data-testid="mod-open"]');
      await realClick(page, '.modal [data-testid="mod-untimedSp"]');
      await page.keyboard.press('Escape');
      await sleep(300);
      assert.equal(await page.$('.modal'), null, 'closed');
      assert.deepEqual(problems.filter((p) => p.startsWith('pageerror:')), [], 'no uncaught page errors');
      // the page is still interactive: 创建同盟 still works
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /创建同盟/.test(b.textContent))?.click());
      await page.waitForSelector('.room-screen', { timeout: 15000 });
    } finally { await page.close(); }
  });
});
