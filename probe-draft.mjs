
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function rc(sel) { const el = await p.$(sel); if (!el) return false; const bb = await el.boundingBox(); if (!bb) return false; await p.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2); return true; }
async function clickText(re) { return await p.evaluate((rex) => { const rx=new RegExp(rex); const all=[...document.querySelectorAll('button, [role="button"], .tapx, a')]; const h=all.find(x=>rx.test((x.textContent||'').trim())); if(h){h.click();return true;} return false; }, re.source); }
await p.goto('http://127.0.0.1:3100/', { waitUntil: 'domcontentloaded' });
await sleep(6000);
for (let i=0;i<2;i++){ await rc('.spa-entry__gate'); await sleep(900); }
for (let i=0;i<3;i++){ await rc('.spa-entry__skip'); await sleep(700); }
await p.evaluate(() => { const el=document.querySelector('.field__input'); if(!el)return; const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(el,'Tester'); el.dispatchEvent(new Event('input',{bubbles:true})); });
await sleep(600); await clickText(/^(开始|进入)$/); await sleep(4000);
await clickText(/独立模拟/); await sleep(3500); await clickText(/开始独立模拟/); await sleep(4000);
await rc('[data-testid="seat-bg-pick"]'); await sleep(1500);
const pick = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('.nc-pick__card')];
  const real = cards.find(c => !/--none/.test(c.className) && c.querySelector('img, .nc-pick__art'));
  if (!real) return { n: cards.length, ok: false };
  real.click(); return { n: cards.length, ok: true, cls: real.className };
});
console.log('picked:', JSON.stringify(pick));
await sleep(1500);
await clickText(/^(完成|关闭|确定)$/); await sleep(1500);
console.log('seat:', await p.evaluate(() => ({ layer: !!document.querySelector('.rseat .nc-layer'), cls: document.querySelector('.rseat')?.className })));
await clickText(/开始模拟/); await sleep(4500);
await clickText(/准备就绪|开始/); await sleep(5500);
const d = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.dorder')];
  const r0 = rows[0];
  return { rows: rows.length, art: !!r0?.querySelector('.dorder__art'), nc: !!r0?.querySelector('.nc-layer'),
    ncBg: r0?.querySelector('.nc-layer') ? getComputedStyle(r0.querySelector('.nc-layer')).backgroundImage.slice(0,80) : null };
});
console.log('draft:', JSON.stringify(d));
await p.screenshot({ path: '.scratch/draft-only-nc.png', clip: await p.evaluate(() => { const r = document.querySelector('.dorder'); if(!r) return null; const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }) });
console.log('errs:', errs.slice(0,3).join(' | ')||'none');
await b.close();
