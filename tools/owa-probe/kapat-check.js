/*
 * §5.7 kapatma hakki - OWA icinden uctan uca:
 *   1) "Ajani kapat" -> panel kapali gorunume gecer, oge bilgisi gizlenir
 *   2) OWA yeniden yuklenir, panel yeniden acilir -> tercih KALICI (roamingSettings),
 *      oge OKUNMAZ, servise /olcum disinda SIFIR istek gider
 *   3) "Ajani ac" -> panel normale doner (test posta kutusunu acik birakir)
 * Yalniz okuma: mail gonderilmez/silinmez/tasinmaz.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OWA_URL = 'https://mail.example.local/owa';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const USER = process.env.OWA_USER || 'EXAMPLE\\test1';
const PASS = process.env.OWA_PASS;
const OUT = __dirname;
const NAMES = ['Outlook Ajani', 'Outlook Ajanı', 'Ajan'];
const HINT = 'ILN-2026-4471';

if (!PASS) { console.error('OWA_PASS gerekli'); process.exit(2); }
const log = (...a) => console.log('[kapat]', ...a);
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

  // --- servise giden her istegi say (civi #9 + K9 kaniti) ---
  const istekler = [];
  const basarisiz = [];
  // /olcum TELEMETRIDIR, LLM cagrisi degildir -> K9 sayimina KATILMAZ.
  page.on('request', r => {
    const u = r.url() || '';
    if (u.includes(':4444') && !u.includes('/olcum')) istekler.push({ m: r.method(), u, t: Date.now() });
  });
  page.on('requestfailed', r => { if ((r.url() || '').includes(':4444')) basarisiz.push({ u: r.url(), e: r.failure() && r.failure().errorText }); });
  page.on('response', async r => {
    if ((r.url() || '').includes(':4444')) log('  yanit', r.status(), r.request().method(), r.url().split('/').pop());
  });

  try {
    await page.goto(OWA_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    if (await page.locator('#username').count()) {
      await page.fill('#username', USER);
      await page.fill('#password', PASS);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
        page.evaluate(() => { if (typeof clkLgn === 'function') clkLgn(); }).catch(() => {}),
      ]);
    }
    await page.waitForTimeout(5000);

    const paneliAc = async () => {
    await page.waitForFunction(h => document.body && document.body.innerText.includes(h), HINT, { timeout: 90000 });
    await page.locator(`text=${HINT}`).first().click({ timeout: 20000 });
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
    if (!acildi) throw new Error('panel acilmadi');

      await page.waitForTimeout(4000);
      return findFrame(page);
    };
    const gorunur = (fr, id) => fr.evaluate(i => { const e = document.getElementById(i); return !!e && e.offsetParent !== null; }, id);
    const sonuc = {};

    // --- 1) kapat ---
    let fr = await paneliAc();
    // onceki kosumdan kapali kaldiysa once ac
    if (await gorunur(fr, 'acDugme')) { await fr.locator('#acDugme').click(); await page.waitForTimeout(4000); }
    sonuc['Acikken oge bilgisi gorunuyor'] = await gorunur(fr, 'ogeBilgi');
    await fr.locator('#kapatDugme').click({ timeout: 15000 });
    await page.waitForTimeout(5000);
    sonuc['Kapat: kapali gorunum cikti'] = await gorunur(fr, 'kapaliAlani');
    sonuc['Kapat: oge bilgisi ve Ozetle gizlendi'] = !(await gorunur(fr, 'ogeBilgi')) && !(await gorunur(fr, 'ozetleDugme'));

    // --- 2) kalicilik: yeniden yukle ---
    istekler.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    fr = await paneliAc();
    sonuc['Yeniden yuklemede tercih korundu'] = await gorunur(fr, 'kapaliAlani');
    sonuc['Kapaliyken oge okunmadi (konu bos)'] = (await fr.evaluate(() => document.getElementById('konu').textContent)) === '—';
    sonuc['Kapaliyken servise icerik istegi yok'] = istekler.length === 0;
    await page.screenshot({ path: path.join(OUT, 'fail-kapat-kapali.png') }).catch(() => {});

    // --- 3) ac ---
    await fr.locator('#acDugme').click({ timeout: 15000 });
    await page.waitForTimeout(6000);
    sonuc['Ac: oge bilgisi geri geldi'] = await gorunur(fr, 'ogeBilgi');
    sonuc['Ac: konu okundu'] = new RegExp(HINT).test(await fr.evaluate(() => document.getElementById('konu').textContent));

    console.log(''); console.log('=== SONUC ===');
    let hepsi = true;
    for (const k of Object.keys(sonuc)) { console.log(k.padEnd(42) + ': ' + (sonuc[k] ? 'GECTI' : 'KALDI')); if (!sonuc[k]) hepsi = false; }
    await browser.close();
    process.exit(hepsi ? 0 : 1);
  } catch (e) {
    console.error('HATA:', e.message);
    await page.screenshot({ path: path.join(OUT, 'fail-kapat.png') }).catch(() => {});
    await browser.close();
    process.exit(1);
  }
})();
