/*
 * Civi #5 — SupportsPinning GORSEL DOGRULAMA.
 * probe.js bunu API ile olcemez; panel basligindaki sabitleme (pin) simgesi
 * gercekten var mi diye DOM'a ve ekran goruntusune bakar.
 * Yalniz okuma yapar: mail gonderilmez, silinmez, tasinmaz. Exchange'e komut gitmez.
 *
 * node tools/owa-probe/pin-check.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OWA_URL = 'https://mail.example.local/owa';
const ADDIN_PAGE = 'probe.html';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const USER = process.env.OWA_USER || 'EXAMPLE\\test1';
const PASS = process.env.OWA_PASS;
const OUT = __dirname;
const ADDIN_NAMES = ['Yetenek Olcumu', 'Yetenek Ölçümü', 'Outlook Ajani', 'Outlook Ajanı'];

if (!PASS) { console.error('OWA_PASS gerekli'); process.exit(2); }
const log = (...a) => console.log('[pin]', ...a);

function findAddinFrame(page) {
  return page.frames().find(f => (f.url() || '').includes(ADDIN_PAGE));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true, userAgent: UA,
    viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 2,
    httpCredentials: { username: USER, password: PASS },
  });
  context.setDefaultTimeout(30000);
  const page = await context.newPage();

  await page.goto(OWA_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  if (/logon\.aspx|auth\/logon/i.test(page.url()) || await page.locator('#username').count()) {
    await page.fill('#username', USER);
    await page.fill('#password', PASS);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
      page.evaluate(() => { if (typeof clkLgn === 'function') clkLgn(); }).catch(() => {}),
    ]);
  }
  await page.waitForTimeout(5000);
  log('url', page.url());

  // ekli mesaji ac - calisan kosumdaki yontemin aynisi
  const HINT = 'ILN-2026-4471';
  await page.waitForFunction(h => document.body && document.body.innerText.includes(h), HINT, { timeout: 90000 });
  const row = page.locator(`text=${HINT}`).first();
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.click({ timeout: 20000 });
  log('mesaj satirina tiklandi');
  await page.waitForTimeout(6000);

  // eklentiyi ac
  for (const n of ADDIN_NAMES) {
    const loc = page.locator(`[aria-label*="${n}" i], [title*="${n}" i]`);
    const c = await loc.count().catch(() => 0);
    let done = false;
    for (let i = 0; i < c; i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(4000);
      if (findAddinFrame(page)) { done = true; break; }
    }
    if (done) break;
  }
  const fr = findAddinFrame(page);
  log('eklenti cercevesi:', fr ? fr.url() : 'BULUNAMADI');
  if (!fr) { await page.screenshot({ path: path.join(OUT, 'pin-fail.png') }); await browser.close(); process.exit(1); }

  await page.waitForTimeout(3000);

  // panel kabugunu bul: iframe elementinden yukari yuru
  const info = await page.evaluate((addinPage) => {
    const ifr = Array.from(document.querySelectorAll('iframe')).find(f => (f.src || '').includes(addinPage));
    if (!ifr) return { hata: 'iframe yok' };
    const atalar = [];
    let el = ifr.parentElement;
    for (let i = 0; i < 7 && el; i++) {
      const r = el.getBoundingClientRect();
      atalar.push({
        seviye: i, tag: el.tagName, cls: (el.className || '').toString().slice(0, 120),
        id: el.id || '', rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
      el = el.parentElement;
    }
    // panel kabugu = iframe'i iceren en genis ust kapsayici
    const kabuk = ifr.closest('[class*="pane" i],[class*="Panel" i],[class*="addin" i],[class*="App" i]') || ifr.parentElement.parentElement;
    const kr = kabuk.getBoundingClientRect();

    // panel KABUGU iframe'in disinda: sag ust bolgedeki TUM gorunur dugmeleri tara
    const dugmeler = Array.from(document.querySelectorAll('button,[role="button"],a,[onclick],[class*="btn" i],[class*="icon" i],img,span,i'))
      .filter(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.width < 90 && r.height < 90 &&
               r.x > kr.x - 40 && r.y > kr.y - 90 && r.y < kr.y + 30;
      })
      .map(e => ({
        tag: e.tagName, cls: (e.className || '').toString().slice(0, 80), id: e.id || '',
        aria: e.getAttribute('aria-label') || '', title: e.getAttribute('title') || '',
        txt: (e.textContent || '').trim().slice(0, 30),
        rect: (r => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }))(e.getBoundingClientRect()),
      }));

    // tum belgede pin/sabitle gecen her sey (gizli olsa bile)
    const pinAdaylari = Array.from(document.querySelectorAll('*')).filter(e => {
      const s = ((e.getAttribute && (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')) + ' ' + (e.className || '').toString()).toLowerCase();
      return /\bpin\b|pinned|unpin|sabitle|raptiye|thumbtack/.test(s);
    }).map(e => ({
      tag: e.tagName, cls: (e.className || '').toString().slice(0, 100),
      aria: e.getAttribute('aria-label') || '', title: e.getAttribute('title') || '',
      gorunur: !!(e.getBoundingClientRect().width && e.getBoundingClientRect().height),
    })).slice(0, 40);

    return {
      atalar, kabukCls: (kabuk.className || '').toString().slice(0, 150),
      kabukRect: { x: Math.round(kr.x), y: Math.round(kr.y), w: Math.round(kr.width), h: Math.round(kr.height) },
      baslikHtml: kabuk.innerHTML.slice(0, 2500),
      dugmeler, pinAdaylari,
    };
  }, ADDIN_PAGE);

  fs.writeFileSync(path.join(OUT, 'pin-dom.json'), JSON.stringify(info, null, 2), 'utf8');
  log('kabuk', info.kabukCls, JSON.stringify(info.kabukRect));
  log('baslik bolgesindeki dugmeler:');
  (info.dugmeler || []).forEach(d => log('   ', d.tag, '| aria=' + d.aria, '| title=' + d.title, '| cls=' + d.cls, '| txt=' + d.txt));
  log('PIN ADAYLARI (tum belge):', (info.pinAdaylari || []).length);
  (info.pinAdaylari || []).forEach(p => log('    PIN?', p.tag, 'aria=' + p.aria, 'title=' + p.title, 'cls=' + p.cls, 'gorunur=' + p.gorunur));

  // baslik bolgesini kirp + hover sonrasi tekrar
  const kr = info.kabukRect;
  const clip = { x: Math.max(0, kr.x - 20), y: Math.max(0, kr.y - 80), width: Math.min(kr.w + 20, 1680 - kr.x + 20), height: 110 };
  await page.screenshot({ path: path.join(OUT, 'pin-header.png'), clip });
  await page.mouse.move(kr.x + kr.w / 2, kr.y + 20);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'pin-header-hover.png'), clip });
  log('ekran goruntuleri yazildi: pin-header.png / pin-header-hover.png');

  await browser.close();
})();
