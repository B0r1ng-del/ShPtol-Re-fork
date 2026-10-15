// test/ui/rhine-toggle.e2e.test.js — 莱茵科技's rendered result in headless Chrome.
//
// The source contract is pinned without a browser by test/ui/rhine-toggle.test.js; this file measures the RESULT, because
// every part of the owner's request is a measurement (图 with the red/blue/green/yellow boxes):
//   1. the picker sits in the shop row's own slot (bottom-right, the blue box) — NOT the old bottom-left corner (red);
//   2. the 莱茵科技 button sits in the tools row to the LEFT of 冻结 (green), and only exists while 莱茵生命 is activated;
//   3. the picker's old 提示 line is gone (yellow), so nothing renders above the panel there;
//   4. the two boxes really are exclusive and 商店 is the default.
//
// The mock harness serves `?phase=PREP` with no research state, so the 莱茵生命 half is injected through the harness's own
// `__MOCK__.mutate` (the same hook the other mock-driven browser tests use) — the real server path is covered by
// test/match/rhine-deploy.test.js.
//
//   SP_E2E=1 node --test test/ui/rhine-toggle.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A 莱茵生命 active at 5 members: the two min-3 devices are unlocked, the 9-member laser is not. */
const RESEARCH = {
  unlocked: true, active: true, capacity: 2, layers: 5, hand: [null, null, null],
  devices: [
    { key: 'medical', tokenId: 'token_rhine_medical', uid: 901, points: 3, stage: 1, onBoard: false, locked: false, minCount: 3, maxStage: 2 },
    { key: 'energy', tokenId: 'token_rhine_energy', uid: 902, points: 0, stage: 0, onBoard: false, locked: false, minCount: 3, maxStage: 2 },
    { key: 'laser', tokenId: 'token_rhine_laser', uid: null, points: 0, stage: 0, onBoard: false, locked: true, minCount: 9, maxStage: 0 },
  ],
};

describe('莱茵科技 (the shop slot swap)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv, browser, base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  /** The mock screen at PREP with a fresh page per run, the debug sidebar hidden. */
  async function open({ w = 1920, h = 1080 } = {}) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewport({ width: w, height: h });
    await page.goto(`${base}/dev/game-mock.html?phase=PREP`, { waitUntil: 'networkidle0' });
    await sleep(700);
    await page.keyboard.press('Backquote');          // hide the mock harness's own sidebar
    await sleep(200);
    return { page, errors };
  }

  /** The one measurement every assertion reads: the three boxes, or null when absent (a 0×0 box reads as absent). */
  const measure = (page) => page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const hint = document.querySelector('.rhine-dock__hint, .rhine-dock > p');
    return { dock: box('[data-testid="rhine-dock"]'), toggle: box('[data-testid="rhine-toggle"]'), freeze: box('.toolbtn--ice'), row: box('.shopbar__row'), hint: hint ? hint.textContent.trim() : null, vw: innerWidth, vh: innerHeight };
  });

  const activate = (page) => page.evaluate((r) => globalThis.__MOCK__.mutate((S) => { S.priv.research = r; }), RESEARCH);

  test('with 莱茵生命 inactive: no picker, no button, the shop row as usual', async () => {
    const { page, errors } = await open();
    try {
      const m = await measure(page);
      assert.equal(m.dock, null, 'the picker does not exist while the 盟约 is off');
      assert.equal(m.toggle, null, 'and neither does its button');
      assert.ok(m.row, 'the shop row is the slot');
      assert.deepEqual(errors, [], 'and the page logged nothing');
    } finally { await page.close(); }
  });

  test('activated, 商店 is the default: only the shop row shows, with the button in the tools row', async () => {
    const { page, errors } = await open();
    try {
      await activate(page);
      await sleep(400);
      const m = await measure(page);
      assert.equal(m.dock, null, '商店 is the default — the picker is hidden');
      assert.ok(m.row, 'and the shop row is the one showing');
      assert.ok(m.toggle, 'the 莱茵科技 button appeared with the 盟约');
      assert.ok(m.freeze, 'and 冻结 is still there');
      // green box: the button sits LEFT of 冻结 on the same tools row
      assert.ok(m.toggle.right <= m.freeze.x + 2, `the button is left of 冻结 (${m.toggle.right} <= ${m.freeze.x})`);
      assert.ok(Math.abs(m.toggle.y - m.freeze.y) < 4, 'and on the same line as it');
      assert.deepEqual(errors, [], 'no console errors');
    } finally { await page.close(); }
  });

  test('the button swaps the slot both ways, exclusively, and the picker lands in the shop row’s place', async () => {
    const { page, errors } = await open();
    try {
      await activate(page);
      await sleep(400);
      const shop = await measure(page);

      await page.evaluate(() => document.querySelector('[data-testid="rhine-toggle"]').click());
      await sleep(400);
      const rhine = await measure(page);
      assert.ok(rhine.dock, 'the picker shows');
      assert.equal(rhine.row, null, 'and the shop row is gone — they are exclusive');
      assert.equal(rhine.hint, null, 'the old 提示 line is gone (yellow box)');
      // blue box: bottom-right, in the shop row's own slot
      assert.ok(rhine.dock.bottom > rhine.vh - 300, 'the picker sits along the bottom edge');
      assert.ok(rhine.dock.right > rhine.vw * 0.8, 'at the right-hand side, where the shop row was');
      assert.ok(rhine.dock.y >= shop.toggle.bottom - 4, 'and below the tools row, not over it');
      assert.equal(await page.$eval('[data-testid="rhine-toggle"]', (el) => el.getAttribute('aria-pressed')), 'true');

      await page.evaluate(() => document.querySelector('[data-testid="rhine-toggle"]').click());
      await sleep(400);
      const back = await measure(page);
      assert.equal(back.dock, null, 'a second click returns to 商店');
      assert.ok(back.row, 'the shop row is back');
      assert.equal(await page.$eval('[data-testid="rhine-toggle"]', (el) => el.getAttribute('aria-pressed')), 'false');
      assert.deepEqual(errors, [], 'no console errors through the swap');
    } finally { await page.close(); }
  });

  test('the picker stays inside the viewport on a landscape phone', async () => {
    const { page } = await open({ w: 844, h: 390 });
    try {
      await activate(page);
      await sleep(400);
      await page.evaluate(() => document.querySelector('[data-testid="rhine-toggle"]').click());
      await sleep(400);
      const m = await measure(page);
      assert.ok(m.dock, 'the picker renders on the phone too');
      assert.ok(m.dock.x >= 0, `its left edge is on screen (${m.dock.x})`);
      assert.ok(m.dock.right <= m.vw + 1, `and its right edge too (${m.dock.right} <= ${m.vw})`);
    } finally { await page.close(); }
  });
});
