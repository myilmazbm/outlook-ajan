/*
 * Faz 2 uctan uca olcum — OWA icinden:
 *   Civi #9 : panel (:4443) -> servis (:4444) cagrisi OWA'nin sandbox'li iframe'inden GECIYOR MU?
 *   K9      : "Ozetle" tek istek uretmeli; sekme degistirmek SIFIR istek uretmeli.
 * Yalniz okuma: mail gonderilmez/silinmez/tasinmaz.
 *
 * node tools/owa-probe/faz2-check.js
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
const log = (...a) => console.log('[faz2]', ...a);
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
    const fr = findFrame(page);
    log('panel:', fr.url());
    await page.waitForTimeout(3000);

    const oncePasif = istekler.length;
    log('panel acilisinda servise giden istek:', oncePasif, '(pasif kontroller LLM kullanmamali -> 0 beklenir)');

    // --- Ozetle ---
    const btn = fr.locator('button:has-text("Özetle"), button:has-text("Ozetle"), [role="button"]:has-text("Özetle")').first();
    await btn.click({ timeout: 15000 });
    log('Ozetle basildi');

    // sonuc gelene kadar bekle
    // BITIS SINYALINI bekle. Onceki surum "yukleniyor" gibi kelimeler ariyordu,
    // ama panel "Çözümleniyor…" yaziyor -> dongu hemen kiriliyor ve ucus sirasinda
    // olcum yapiliyordu. Artik panelin kendi bitis/hata mesaji beklenir.
    let metin = '';
    const son = Date.now() + 120000;
    while (Date.now() < son) {
      metin = await fr.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      if (/Çözümleme hazır/i.test(metin)) { log('bitis sinyali: basarili'); break; }
      if (/doğrulanamadı|Servis hatası|Süre doldu|ulaşılamadı|biçimde değil/i.test(metin)) { log('bitis sinyali: HATA'); break; }
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(3000);
    const sonrasiOzet = istekler.length;
    log('Ozetle sonrasi toplam istek:', sonrasiOzet);

    // --- sekmeler: SIFIR yeni istek uretmeli (K9 / §3.2) ---
    // DIKKAT: :has-text() alt dize esler — "Özet" ayni zamanda "Özetle"/"Özetlendi"
    // dugmesini de yakalar. Sekmeler role="tab" ve TAM metinle secilir.
    for (const sekme of ['Aksiyonlar', 'Sorular', 'Özet']) {
      const t = fr.getByRole('tab', { name: sekme, exact: true }).first();
      if (await t.count().catch(() => 0)) {
        await t.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2000);
        log(`  "${sekme}" sekmesi -> toplam istek: ${istekler.length}`);
      } else { log(`  "${sekme}" sekmesi bulunamadi`); }
    }
    await page.waitForTimeout(2000);
    const sonToplam = istekler.length;

    // son tiklama "Özet" idi: gercekten o sekme mi etkin ve icerik degisti mi?
    const sekmeDurum = await fr.evaluate(() => {
      var secili = document.querySelector('[role="tab"][aria-selected="true"]');
      var gorunurPanel = Array.prototype.slice.call(document.querySelectorAll('[role="tabpanel"]'))
        .filter(function (p) { return p.offsetParent !== null; })
        .map(function (p) { return (p.innerText || '').trim().slice(0, 80); });
      var yuk = document.getElementById('yukleniyor');
      return {
        seciliSekme: secili ? secili.textContent.trim() : '(yok)',
        gorunurPanelSayisi: gorunurPanel.length,
        gorunurIcerik: gorunurPanel[0] || '',
        yukleniyorGorunur: !!(yuk && yuk.offsetParent !== null)
      };
    });
    log('secili sekme:', sekmeDurum.seciliSekme, '| gorunur panel:', sekmeDurum.gorunurPanelSayisi);
    log('gorunur icerik:', JSON.stringify(sekmeDurum.gorunurIcerik));
    log('yukleniyor gostergesi hala gorunur mu?:', sekmeDurum.yukleniyorGorunur);

    metin = await fr.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    fs.writeFileSync(path.join(OUT, 'faz2-output.txt'), metin, 'utf8');
    await page.screenshot({ path: path.join(OUT, 'faz2-success.png') });

    console.log('\n===== PANEL METNI =====\n' + metin + '\n=======================');
    console.log('\n--- SERVISE GIDEN ISTEKLER ---');
    istekler.forEach((r, i) => console.log(`  ${i + 1}. ${r.m} ${r.u}`));
    if (basarisiz.length) { console.log('--- BASARISIZ ---'); basarisiz.forEach(b => console.log('  ', b.u, b.e)); }

    const analizSayisi = istekler.filter(r => r.u.includes('/analiz') && r.m === 'POST').length;
    const corsGecti = istekler.length > 0 && basarisiz.length === 0;
    const k9Gecti = analizSayisi === 1 && sonToplam === sonrasiOzet;

    console.log('\n=== SONUC ===');
    const sekmeGecti = sekmeDurum.seciliSekme === 'Özet' && sekmeDurum.gorunurPanelSayisi === 1;
    const yuklemeGecti = sekmeDurum.yukleniyorGorunur === false;

    console.log('Civi #9 (CORS, OWA sandbox icinden):', corsGecti ? 'GECTI' : 'KALDI');
    console.log('K9 (tek istek, sekmeler bedelsiz):', k9Gecti ? 'GECTI' : `KALDI (analiz POST=${analizSayisi}, sekme oncesi=${sonrasiOzet}, sonra=${sonToplam})`);
    console.log('Sekme gecisi (Özet etkin, tek panel):', sekmeGecti ? 'GECTI' : `KALDI (secili=${sekmeDurum.seciliSekme}, gorunur=${sekmeDurum.gorunurPanelSayisi})`);
    console.log('Yukleme gostergesi gizlendi:', yuklemeGecti ? 'GECTI' : 'KALDI (hala gorunuyor)');

    await browser.close();
    process.exit(corsGecti && k9Gecti && sekmeGecti && yuklemeGecti ? 0 : 1);
  } catch (e) {
    console.error('HATA:', e.message);
    if (basarisiz.length) { console.error('--- BASARISIZ ISTEKLER ---'); basarisiz.forEach(b => console.error('  ', b.u, b.e)); }
    await page.screenshot({ path: path.join(OUT, 'faz2-fail.png') }).catch(() => {});
    await browser.close();
    process.exit(1);
  }
})();
