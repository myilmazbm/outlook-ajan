/*
 * FAZ 3 UCTAN UCA OLCUM (§6 ozellik 4, 5, 8 + yazma kipi)
 *
 * Akis bilincli olarak iki asamali:
 *   1) OKUMA kipi  : "Ozetle" -> A calisir ve sonuc konusmaId ile onbellege yazilir.
 *   2) YAZMA kipi  : taslak (B) ve kontrol (C). C'nin A_YOK yerine GERCEK sonuc
 *      dondurmesi, konusmaId koprusunun calistiginin kanitidir.
 *
 * Yalniz okuma/olcum: mail GONDERILMEZ, silinmez, tasinmaz.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OWA = 'https://mail.example.local/owa';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const USER = process.env.OWA_USER || 'EXAMPLE\\test1';
const PASS = process.env.OWA_PASS;
const HINT = 'ILN-2026-4471';
const NAMES = ['Outlook Ajani', 'Outlook Ajanı', 'Ajan'];
const OUT = __dirname;

if (!PASS) { console.error('OWA_PASS gerekli'); process.exit(2); }
const log = (...a) => console.log('[faz3]', ...a);
const fr = p => p.frames().find(f => (f.url() || '').includes('taskpane.html'));
const bekle = (p, ms) => p.waitForTimeout(ms);

(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({
    ignoreHTTPSErrors: true, userAgent: UA,
    viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 2,
    httpCredentials: { username: USER, password: PASS },
  });
  c.setDefaultTimeout(30000);
  const p = await c.newPage();

  const istekler = [];
  // /olcum TELEMETRIDIR, LLM cagrisi degildir -> istek sayimina KATILMAZ.
  p.on('request', r => {
    const u = r.url() || '';
    if (u.includes(':4444') && !u.includes('/olcum')) istekler.push({ m: r.method(), u });
  });
  const yanitlar = [];
  p.on('response', r => { const u = r.url() || ''; if (u.includes(':4444')) yanitlar.push({ s: r.status(), u }); });
  const say = uc => istekler.filter(r => r.u.includes(uc) && r.m === 'POST').length;

  async function panelAc() {
    for (const n of NAMES) {
      const loc = p.locator(`[aria-label*="${n}" i], [title*="${n}" i]`);
      const cnt = await loc.count().catch(() => 0);
      for (let i = 0; i < cnt; i++) {
        const el = loc.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        await el.click({ timeout: 8000 }).catch(() => {});
        await bekle(p, 4500);
        if (fr(p)) return true;
      }
    }
    return false;
  }

  const sonuc = {};
  try {
    await p.goto(OWA, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await bekle(p, 2500);
    if (await p.locator('#username').count()) {
      await p.fill('#username', USER); await p.fill('#password', PASS);
      await Promise.all([
        p.waitForNavigation({ timeout: 60000 }).catch(() => {}),
        p.evaluate(() => { if (typeof clkLgn === 'function') clkLgn(); }).catch(() => {}),
      ]);
    }
    await bekle(p, 5000);

    for (const s of ['[aria-label="Inbox"]', '[title="Inbox"]']) {
      const f = p.locator(s).first();
      if (await f.count().catch(() => 0) && await f.isVisible().catch(() => false)) { await f.click().catch(() => {}); await bekle(p, 4000); break; }
    }
    await p.waitForFunction(h => document.body && document.body.innerText.includes(h), HINT, { timeout: 90000 });
    await p.locator(`text=${HINT}`).first().click({ timeout: 20000 });
    await bekle(p, 5000);

    /* ---------- 1. OKUMA KIPI: A'yi calistir ---------- */
    const kapali = p.locator('[aria-label="Collapsed Message Contents"]');
    if (await kapali.count().catch(() => 0)) { await kapali.last().click().catch(() => {}); await bekle(p, 3500); }

    if (!(await panelAc())) throw new Error('okuma kipinde panel acilmadi');
    log('okuma kipi paneli acik');
    await bekle(p, 2500);

    const okumaFr = fr(p);
    const ozetle = okumaFr.locator('button:has-text("Özetle")').first();
    if (await ozetle.count().catch(() => 0)) {
      await ozetle.click({ timeout: 10000 }).catch(() => {});
      const son = Date.now() + 120000;
      while (Date.now() < son) {
        const t = await okumaFr.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
        if (/Çözümleme hazır/i.test(t)) { log('A tamamlandi'); break; }
        if (/doğrulanamadı|Servis hatası|Süre doldu|ulaşılamadı/i.test(t)) { log('A HATA'); break; }
        await bekle(p, 2000);
      }
    } else { log('UYARI: Özetle dugmesi yok (zaten ozetlenmis olabilir)'); }
    sonuc.analizSayisi = say('/analiz');
    await p.screenshot({ path: path.join(OUT, 'faz3-okuma.png') });

    /* ---------- 2. YAZMA KIPI ---------- */
    let yazmaAcildi = false;
    for (const s of ['[aria-label="Reply all"]', '[aria-label="Reply"]', '[aria-label="Continue editing"]']) {
      const l = p.locator(s).first();
      if (await l.count().catch(() => 0) && await l.isVisible().catch(() => false)) {
        await l.click({ timeout: 10000 }).catch(() => {});
        await bekle(p, 7000); yazmaAcildi = true; log('yazma kipi acildi:', s); break;
      }
    }
    if (!yazmaAcildi) throw new Error('yazma kipi acilmadi');

    // Ek hatirlatmasini POZITIF sinamak icin govdeye "ekte" gecen bir cumle yazilir.
    // Yoksa hatirlatmanin cikmamasi DOGRU davranistir ve test yaniltici olur.
    let govdeYazildi = false;
    for (const s of ['[aria-label="Message body"]', '[aria-label="Message body, press Alt+F10 to exit"]',
                     'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]']) {
      const g = p.locator(s).first();
      if (await g.count().catch(() => 0) && await g.isVisible().catch(() => false)) {
        await g.click({ timeout: 8000 }).catch(() => {});
        await p.keyboard.type('Talep ettiginiz raporu ekte gonderiyorum.', { delay: 20 }).catch(() => {});
        await bekle(p, 2500);
        govdeYazildi = true;
        log('govdeye "ekte" gecen cumle yazildi:', s);
        break;
      }
    }
    sonuc.govdeYazildi = govdeYazildi;
    if (!govdeYazildi) log('UYARI: compose govdesi bulunamadi, ek hatirlatmasi sinanamayacak');

    if (!(await panelAc())) throw new Error('yazma kipinde panel acilmadi');
    const yazFr = fr(p);
    await bekle(p, 4000);
    log('yazma kipi paneli acik');

    let metin = await yazFr.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    sonuc.yazmaUI = /Taslak|Çeviri|Kontrol/i.test(metin);
    sonuc.ekHatirlatmasi = /eklediğinizden emin olun/i.test(metin);
    log('yazma arayuzu gorunuyor mu:', sonuc.yazmaUI, '| ek hatirlatmasi:', sonuc.ekHatirlatmasi);

    /* --- B: taslak --- */
    const oncekiTaslak = say('/taslak');
    const kisa = yazFr.locator('button:has-text("Kısa")').first();
    if (await kisa.count().catch(() => 0)) {
      await kisa.click({ timeout: 10000 }).catch(() => {});
      const son = Date.now() + 120000;
      while (Date.now() < son) {
        const t = await yazFr.evaluate(() => { var e = document.getElementById('taslakMetin'); return e ? e.value : ''; }).catch(() => '');
        if (t && t.length > 20) { sonuc.taslakUzunluk = t.length; break; }
        await bekle(p, 2000);
      }
    }
    sonuc.taslakIstek = say('/taslak') - oncekiTaslak;
    log('taslak istegi:', sonuc.taslakIstek, '| uretilen metin uzunlugu:', sonuc.taslakUzunluk || 0);

    /* --- C: kontrol --- */
    const oncekiKontrol = say('/kontrol');
    const kontrol = yazFr.locator('button:has-text("Kontrol et")').first();
    if (await kontrol.count().catch(() => 0)) {
      await kontrol.click({ timeout: 10000 }).catch(() => {});
      await bekle(p, 20000);
    }
    sonuc.kontrolIstek = say('/kontrol') - oncekiKontrol;
    metin = await yazFr.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    sonuc.aYok = /özetlenmedi|Özetle'ye/i.test(metin);
    sonuc.kontrolSonucVar = /Cevapsız|Cevaplanan|cevap bekleyen/i.test(metin);

    fs.writeFileSync(path.join(OUT, 'faz3-output.txt'), metin, 'utf8');
    await p.screenshot({ path: path.join(OUT, 'faz3-yazma.png') });

    console.log('\n===== YAZMA PANELI METNI =====\n' + metin + '\n==============================');
    console.log('\n--- SERVIS ISTEKLERI ---');
    istekler.forEach((r, i) => console.log(`  ${i + 1}. ${r.m} ${r.u.split('4444')[1]}`));
    yanitlar.forEach(r => console.log(`     yanit ${r.s} ${r.u.split('4444')[1]}`));

    console.log('\n=== SONUC ===');
    console.log('Yazma arayuzu render edildi   :', sonuc.yazmaUI ? 'GECTI' : 'KALDI');
    console.log('Ek hatirlatmasi (S10)         :', !sonuc.govdeYazildi ? 'SINANMADI (govde yazilamadi)'
      : (sonuc.ekHatirlatmasi ? 'GECTI' : 'KALDI'));
    console.log('B (taslak) tek istek          :', sonuc.taslakIstek === 1 ? 'GECTI' : `KALDI (${sonuc.taslakIstek})`);
    console.log('B metin uretti                :', (sonuc.taslakUzunluk || 0) > 20 ? 'GECTI' : 'KALDI');
    console.log('C (kontrol) tek istek         :', sonuc.kontrolIstek === 1 ? 'GECTI' : `KALDI (${sonuc.kontrolIstek})`);
    console.log('C gercek sonuc (A_YOK degil)  :', (!sonuc.aYok && sonuc.kontrolSonucVar) ? 'GECTI' : `KALDI (aYok=${sonuc.aYok})`);

    const hepsi = sonuc.yazmaUI && sonuc.taslakIstek === 1 && (sonuc.taslakUzunluk || 0) > 20 &&
                  sonuc.kontrolIstek === 1 && !sonuc.aYok && sonuc.kontrolSonucVar &&
                  (!sonuc.govdeYazildi || sonuc.ekHatirlatmasi);
    await b.close();
    process.exit(hepsi ? 0 : 1);
  } catch (e) {
    console.error('HATA:', e.message);
    await p.screenshot({ path: path.join(OUT, 'faz3-fail.png') }).catch(() => {});
    console.error('istekler:', JSON.stringify(istekler.map(r => r.m + ' ' + r.u.split('4444')[1])));
    await b.close();
    process.exit(1);
  }
})();
