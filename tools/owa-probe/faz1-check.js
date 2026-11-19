/*
 * Faz 1 kabul olcutu: pilot paneli OWA'da aciliyor ve acik ogeyi okuyor.
 * Yalniz okuma: mail gonderilmez/silinmez/tasinmaz, Exchange'e komut gitmez.
 * node tools/owa-probe/faz1-check.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OWA_URL = 'https://mail.example.local/owa';
const ADDIN_PAGE = 'pilot/taskpane.html';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const USER = process.env.OWA_USER || 'EXAMPLE\\test1';
const PASS = process.env.OWA_PASS;
const OUT = __dirname;
const NAMES = ['Outlook Ajani', 'Outlook Ajanı', 'Ajan'];
const HINT = 'ILN-2026-4471';

if (!PASS) { console.error('OWA_PASS gerekli'); process.exit(2); }
const log = (...a) => console.log('[faz1]', ...a);
const findFrame = p => p.frames().find(f => (f.url() || '').includes('taskpane.html'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true, userAgent: UA,
    viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 2,
    httpCredentials: { username: USER, password: PASS },
  });
  ctx.setDefaultTimeout(30000);
  const page = await ctx.newPage();

  try {
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

    await page.waitForFunction(h => document.body && document.body.innerText.includes(h), HINT, { timeout: 90000 });
    const row = page.locator(`text=${HINT}`).first();
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click({ timeout: 20000 });
    log('mesaj acildi');
    await page.waitForTimeout(6000);
    // Zincirde taslak varsa OWA asil mesaji daraltir ve eklenti dugmesi gorunmez -> ac.
    const kapali = page.locator('[aria-label="Collapsed Message Contents"]');
    if (await kapali.count().catch(() => 0)) { await kapali.last().click().catch(() => {}); await page.waitForTimeout(3500); }

    let acildi = false;
    for (const n of NAMES) {
      const loc = page.locator(`[aria-label*="${n}" i], [title*="${n}" i]`);
      const c = await loc.count().catch(() => 0);
      for (let i = 0; i < c; i++) {
        const el = loc.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        await el.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(4000);
        if (findFrame(page)) { acildi = true; break; }
      }
      if (acildi) break;
    }
    if (!acildi) throw new Error('pilot eklenti dugmesi bulunamadi / panel acilmadi');

    const fr = findFrame(page);
    log('panel cercevesi:', fr.url());

    // panel icerigi yerlesene kadar bekle
    let metin = '';
    const son = Date.now() + 60000;
    while (Date.now() < son) {
      metin = await fr.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      if (/Panel hazır/.test(metin)) break;
      await page.waitForTimeout(1500);
    }

    fs.writeFileSync(path.join(OUT, 'faz1-output.txt'), metin, 'utf8');
    await page.screenshot({ path: path.join(OUT, 'faz1-success.png') });

    console.log('\n===== PANEL METNI =====\n' + metin + '\n=======================\n');
    const ok = /Panel hazır/.test(metin) && new RegExp(HINT).test(metin);
    console.log(ok ? 'FAZ 1 KABUL OLCUTU: KARSILANDI' : 'FAZ 1 KABUL OLCUTU: KARSILANMADI');
    await browser.close();
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('HATA:', e.message);
    await page.screenshot({ path: path.join(OUT, 'faz1-fail.png') }).catch(() => {});
    await browser.close();
    process.exit(1);
  }
})();
