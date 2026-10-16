// test/ui/menu-switch-rows.e2e.test.js — the 图一 switch row (2026-10-13) in a real browser, on both device classes:
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/menu-switch-rows.e2e.test.js
//
// The owner's request: 「功能开关状态不明显，做成如图一效果，左边是功能名字，右边有开关，额外要求：在功能名字右边加感叹号
// 图标，长按才显示功能介绍 … 以上菜单修改要求也对房主配置菜单生效」.
//
// So each row of BOTH menus (the 模式界面's Mod submenu and 房主配置) is: the name on the LEFT, a pill switch on the
// RIGHT, and an ⓘ after the name whose one-line explanation appears on hover (desktop) or long-press (touch) — and
// NOTHING ELSE. Everything below is measured from the live DOM, because the point of the change is the rendered shape:
// a source-only assertion cannot tell a 14 px tap target from a 44 px one, and it cannot tell an aligned column from a
// ragged one.
//
// The rows used to be `dpick__opt` buttons whose check icon went 25 % → 100 % opacity — the 「状态不明显」 in the
// report. The old shape also printed the explanation under every switch; the new one hides it behind the ⓘ on purpose.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A tap target the design asks for: the switch is a pill and the ⓘ is the only way to read the tip on a phone. */
const MIN_TAP = 24;
const MIN_SWITCH_W = 44;

describe('图一 switch rows (Mod 开关 / 房主配置)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
  });
  after(async () => { await srv?.close(); });

  /**
   * A page driven to the 房主配置 dialog, on a given device class. 2026-10-16: the lobby's Mod submenu moved in here, so
 * the dialog now holds BOTH switch menus — its own rows and the Mod 开关 section — and this file measures both. `mobile`
 * implies LANDSCAPE: the game shows
   * 「请将设备横屏」 in portrait, so a portrait viewport never renders the menus at all.
   * @param {'mod'|'hostcfg'} which  which of the dialog's two switch sections to measure
   */
  async function openMenu(which, { width, height, mobile }) {
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.emulate({
      viewport: { width, height, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile },
      userAgent: await browser.userAgent(),
    });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(`${base}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('input', { timeout: 15000 });
    await page.evaluate(() => localStorage.removeItem('sp.pref.mods'));
    await page.type('input', '测试博士');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent))?.click());
    await page.waitForSelector('.lobby-screen', { timeout: 20000 });
    await sleep(600);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /创建同盟/.test(b.textContent))?.click());
    await page.waitForSelector('.room-screen [data-testid="hostcfg-open"]', { timeout: 20000 });
    await sleep(600);
    await page.evaluate(() => document.querySelector('[data-testid="hostcfg-open"]').click());
    await sleep(600);
    assert.ok(await page.$('.modal .swrow'), `${which}: the menu shows switch rows`);
    return { browser, page, problems };
  }

  const box = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }, sel);
  const centre = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, sel);
  const tip = (page) => page.evaluate(() => {
    const t = document.querySelector('.tooltip');
    return t ? t.innerText.replace(/\s+/g, ' ').trim() : null;
  });
  const checked = (page, sel) => page.evaluate((s) => document.querySelector(s).getAttribute('aria-checked'), sel);
  /** The rows of the section `which`: the dialog's own options, or its Mod 开关 block. */
  const sectionSel = (which) => (which === 'mod' ? '.mods--hostcfg' : '.hostcfg__rows');
  /** The row-level geometry every device class must satisfy, for the menu the page has open. */
  const layout = (page, which) => page.evaluate((sel) => {
    const rows = [...document.querySelectorAll(`${sel} .swrow`)];
    return rows.map((w) => {
      const lab = w.querySelector('.swrow__label');
      const inf = w.querySelector('.swrow__info');
      const sw = w.querySelector('.sw');
      const L = lab.getBoundingClientRect(), I = inf.getBoundingClientRect(), S = sw.getBoundingClientRect(), R = w.getBoundingClientRect();
      return {
        label: lab.textContent,
        labelLeftOfSwitch: L.right <= S.left + 1,
        infoBetween: I.left >= L.right - 1 && I.right <= S.left + 1,
        switchRightAligned: Math.round(R.right - S.right) <= 34,
        infoW: Math.round(I.width), infoH: Math.round(I.height),
        swW: Math.round(S.width), swH: Math.round(S.height),
        infoL: Math.round(I.left), swL: Math.round(S.left),
        role: sw.getAttribute('role'), aria: sw.getAttribute('aria-checked'),
      };
    });
  }, sectionSel(which));

  // 2026-10-16: ONE dialog now holds both switch menus, so the two cases measure its two SECTIONS instead of two
  // different screens: 房主配置's own options and the Mod 开关 block that moved in from the lobby.
  for (const which of ['hostcfg', 'mod']) {
    describe(which === 'mod' ? '房主配置 · Mod 开关 section' : '房主配置 · its own options', () => {
      test('desktop: name left, ⓘ then the switch right, every row in one column, hover shows the tip', async () => {
        const { browser, page, problems } = await openMenu(which, { width: 1400, height: 900 });
        try {
          const rows = await layout(page, which);
          assert.ok(rows.length >= 3, `a row per option (${rows.length})`);
          for (const r of rows) {
            assert.ok(r.labelLeftOfSwitch, `${r.label}: the name sits left of the switch`);
            assert.ok(r.infoBetween, `${r.label}: the ⓘ sits between the name and the switch`);
            assert.equal(r.role, 'switch', `${r.label}: role=switch`);
            assert.ok(r.aria === 'true' || r.aria === 'false', `${r.label}: aria-checked is a real state`);
            assert.ok(r.swW >= MIN_SWITCH_W && r.swH >= MIN_TAP, `${r.label}: the switch is ≥ ${MIN_SWITCH_W}×${MIN_TAP} (${r.swW}×${r.swH})`);
            assert.ok(r.infoW >= MIN_TAP && r.infoH >= MIN_TAP, `${r.label}: the ⓘ button is ≥ ${MIN_TAP} px (${r.infoW}×${r.infoH})`);
          }
          // the switch column is ONE column: same x on every row, whatever the label width
          assert.equal(new Set(rows.map((r) => r.swL)).size, 1, `every row's switch shares one x (${rows.map((r) => r.swL)})`);
          assert.equal(new Set(rows.map((r) => r.infoL)).size, 1, `every row's ⓘ shares one x (${rows.map((r) => r.infoL)})`);

          // hover shows the row's own explanation
          const key = which === 'mod' ? 'hostcfg-mod-info-untimedSp' : 'hostcfg-info-sharedPool';
          const pt = await centre(page, `.modal [data-testid="${key}"]`);
          await page.mouse.move(pt[0], pt[1]);
          await sleep(500);
          const shown = await tip(page);
          assert.ok(shown && shown.length > 4, `hovering the ⓘ shows the explanation, got ${JSON.stringify(shown)}`);
          await page.mouse.move(10, 300);
          await sleep(400);
          assert.equal(await tip(page), null, 'and it goes away when the pointer leaves');

          // a real click flips the switch (never a synthetic .click(): hit-testing is the point)
          const swSel = which === 'mod' ? 'hostcfg-mod-untimedSp' : 'hostcfg-sharedPool';
          const sw = await centre(page, `.modal [data-testid="${swSel}"]`);
          const before = await checked(page, `.modal [data-testid="${swSel}"]`);
          await page.mouse.click(sw[0], sw[1]);
          await sleep(400);
          assert.notEqual(await checked(page, `.modal [data-testid="${swSel}"]`), before, 'a click on the switch flips it');
          await page.mouse.click(sw[0], sw[1]);
          await sleep(400);
          assert.equal(await checked(page, `.modal [data-testid="${swSel}"]`), before, 'and again');
          assert.deepEqual(problems, [], 'no uncaught page errors');
        } finally { await page.close(); await browser.close(); }
      });

      test('touch (landscape): a long press on the ⓘ shows the tip without flipping the switch; a tap shows nothing', async () => {
        const { browser, page, problems } = await openMenu(which, { width: 844, height: 390, mobile: true });
        try {
          const rows = await layout(page, which);
          for (const r of rows) {
            assert.ok(r.infoW >= MIN_TAP && r.infoH >= MIN_TAP, `${r.label}: the ⓘ button is ≥ ${MIN_TAP} px on a phone (${r.infoW}×${r.infoH})`);
            assert.ok(r.swW >= MIN_SWITCH_W, `${r.label}: the switch is ≥ ${MIN_SWITCH_W} wide on a phone (${r.swW})`);
            assert.ok(r.infoBetween, `${r.label}: the ⓘ is still between the name and the switch`);
          }
          assert.equal(new Set(rows.map((r) => r.swL)).size, 1, 'one switch column on a phone too');

          const key = which === 'mod' ? 'hostcfg-mod-info-untimedSp' : 'hostcfg-info-sharedPool';
          const swSel = which === 'mod' ? 'hostcfg-mod-untimedSp' : 'hostcfg-sharedPool';
          const pt = await centre(page, `.modal [data-testid="${key}"]`);
          const before = await checked(page, `.modal [data-testid="${swSel}"]`);
          // long press (≥ the tooltip's 450 ms) — the mobile path the owner asked for
          await page.touchscreen.touchStart(pt[0], pt[1]);
          await sleep(800);
          const shown = await tip(page);
          assert.ok(shown && shown.length > 4, `a long press shows the explanation, got ${JSON.stringify(shown)}`);
          await page.touchscreen.touchEnd();
          await sleep(300);
          assert.equal(await checked(page, `.modal [data-testid="${swSel}"]`), before, 'the long press did not flip the switch');
          // a plain tap must NOT show it
          await sleep(1200);
          await page.touchscreen.tap(pt[0], pt[1]);
          await sleep(250);
          assert.equal(await tip(page), null, 'a plain tap does not show the explanation');
          // …but a tap on the SWITCH works
          const sw = await centre(page, `.modal [data-testid="${swSel}"]`);
          await page.touchscreen.tap(sw[0], sw[1]);
          await sleep(400);
          assert.notEqual(await checked(page, `.modal [data-testid="${swSel}"]`), before, 'a tap on the switch flips it');
          assert.deepEqual(problems, [], 'no uncaught page errors');
        } finally { await page.close(); await browser.close(); }
      });
    });
  }

  test('the row is not one big button: the label is plain text, so a tap on it flips nothing', async () => {
    const { browser, page } = await openMenu('mod', { width: 1400, height: 900 });
    try {
      const label = await page.evaluate(() => {
        const l = document.querySelector('.modal .swrow__label');
        return { tag: l.tagName, closestButton: !!l.closest('button') };
      });
      assert.equal(label.tag, 'SPAN', 'the name is a span');
      assert.equal(label.closestButton, false, 'and it is not inside a button');
      const sel = 'mod-noBondBan';
      const before = await checked(page, `.modal [data-testid="${sel}"]`);
      const pt = await centre(page, '.modal .swrow__label');
      await page.mouse.click(pt[0], pt[1]);
      await sleep(300);
      assert.equal(await checked(page, `.modal [data-testid="${sel}"]`), before, 'clicking the name flips nothing');
    } finally { await page.close(); await browser.close(); }
  });
});
