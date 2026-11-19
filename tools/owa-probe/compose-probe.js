/*
 * YAZMA (compose) KIPI OLCUMU — Faz 3'un on kosulu.
 *
 * Cevaplanacak soru (§3.2): C cagrisi, cevaplanan mailin (parent) A sonucunu
 * bulmak zorunda. Yazma kipinde acik oge TASLAKTIR; taslagin itemId'si
 * kaydedilene kadar olmayabilir. O zaman parent'a nasil baglanacagiz?
 * Aday: conversationId. VARSAYILMAZ - olculur.
 *
 * Yalniz okuma/olcum: mail GONDERILMEZ. Acilan taslak kaydedilmeden kapatilir.
 */
const { chromium } = require('playwright');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const USER = process.env.OWA_USER || 'EXAMPLE\\test1';
const PASS = process.env.OWA_PASS;
const HINT = 'ILN-2026-4471';
const NAMES = ['Outlook Ajani', 'Outlook Ajanı', 'Ajan'];
const path = require('path');
const OUT = __dirname;

if (!PASS) { console.error('OWA_PASS gerekli'); process.exit(2); }
const log = (...a) => console.log('[compose]', ...a);
const findFrame = p => p.frames().find(f => (f.url() || '').includes('taskpane.html'));

(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({
    ignoreHTTPSErrors: true, userAgent: UA,
    viewport: { width: 1680, height: 1050 },
    httpCredentials: { username: USER, password: PASS },
  });
  c.setDefaultTimeout(30000);
  const p = await c.newPage();

  try {
    await p.goto('https://mail.example.local/owa', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(2500);
    if (await p.locator('#username').count()) {
      await p.fill('#username', USER); await p.fill('#password', PASS);
      await Promise.all([
        p.waitForNavigation({ timeout: 60000 }).catch(() => {}),
        p.evaluate(() => { if (typeof clkLgn === 'function') clkLgn(); }).catch(() => {}),
      ]);
    }
    await p.waitForTimeout(5000);
    // Onceki kosumdan kalan taslak listede ustte cikabiliyor; once Gelen Kutusu'na gec.
    for (const sel of ['[aria-label="Inbox"]', 'text=Inbox', '[title="Inbox"]']) {
      const f = p.locator(sel).first();
      if (await f.count().catch(() => 0) && await f.isVisible().catch(() => false)) {
        await f.click({ timeout: 8000 }).catch(() => {});
        log('Gelen Kutusu secildi');
        await p.waitForTimeout(4000);
        break;
      }
    }
    await p.waitForFunction(h => document.body && document.body.innerText.includes(h), HINT, { timeout: 90000 });
    // taslak satirini atla: "Draft"/"Taslak" ibaresi tasimayan satiri sec
    const satirlar = p.locator(`text=${HINT}`);
    const adet = await satirlar.count();
    let secildi = false;
    for (let i = 0; i < adet; i++) {
      const s = satirlar.nth(i);
      const metin = await s.evaluate(e => (e.closest('[role="option"],[role="listitem"],div') || e).innerText || '').catch(() => '');
      if (/draft|taslak/i.test(metin)) { log('taslak satiri atlandi'); continue; }
      await s.scrollIntoViewIfNeeded().catch(() => {});
      await s.click({ timeout: 20000 });
      secildi = true;
      break;
    }
    if (!secildi) { await satirlar.first().click({ timeout: 20000 }); }
    await p.waitForTimeout(5000);
    log('okuma kipinde mesaj acik');

    // --- YANITLA ---
    async function yanitDene() {
      // "Continue editing" = zincirde duran taslagi yazma kipinde acar; olcum icin
      // Reply kadar gecerli (hatta C senaryosunun tam kendisi).
      for (const sel of ['[aria-label="Reply all"]', '[aria-label="Reply"]', '[title="Reply all"]', '[title="Reply"]',
                         '[aria-label="Continue editing"]', '[title="Continue editing"]',
                         'button:has-text("Reply all")', 'button:has-text("Reply")',
                         '[aria-label*="Yanıtla" i]', 'span:has-text("Reply all")']) {
        const l = p.locator(sel).first();
        if (await l.count().catch(() => 0) && await l.isVisible().catch(() => false)) {
          await l.click({ timeout: 10000 }).catch(() => {});
          await p.waitForTimeout(6000);
          log('tiklanan yanit denetimi:', sel);
          return true;
        }
      }
      return false;
    }

    // Zincirde taslak varken OWA mesajlari KAPALI gosteriyor; once genislet.
    const kapali = p.locator('[aria-label="Collapsed Message Contents"]');
    const kapaliAdet = await kapali.count().catch(() => 0);
    if (kapaliAdet > 0) {
      log('kapali mesaj bulundu (' + kapaliAdet + ') -> genisletiliyor');
      await kapali.last().click({ timeout: 8000 }).catch(() => {});
      await p.waitForTimeout(4000);
    }

    let yanitlandi = await yanitDene();
    if (!yanitlandi) {
      // Zincirde taslak varsa OWA dogrudan Reply dugmesi yerine "Mail Actions"
      // menusunu gosteriyor. Menuyu acip tekrar dene.
      log('dogrudan Reply yok -> Mail Actions menusu deneniyor');
      for (const m of ['[aria-label="Mail Actions"]', '[title="Mail Actions"]', '[aria-label*="More actions" i]']) {
        const mm = p.locator(m).first();
        if (await mm.count().catch(() => 0) && await mm.isVisible().catch(() => false)) {
          await mm.click({ timeout: 8000 }).catch(() => {});
          await p.waitForTimeout(2500);
          yanitlandi = await yanitDene();
          if (yanitlandi) break;
          await p.keyboard.press('Escape').catch(() => {});
        }
      }
    }
    if (!yanitlandi) {
      const etiketler = await p.evaluate(() => Array.from(document.querySelectorAll('[aria-label],[title]'))
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map(e => e.getAttribute('aria-label') || e.getAttribute('title')).filter(Boolean).slice(0, 50));
      console.log('GORUNUR ETIKETLER:', JSON.stringify(etiketler));
      await p.screenshot({ path: path.join(OUT, 'compose-reply-yok.png') }).catch(() => {});
      throw new Error('Yanitla dugmesi bulunamadi');
    }

    await p.screenshot({ path: path.join(OUT, 'compose-acik.png') });

    // --- eklentiyi yazma kipinde ac ---
    let acildi = false;
    for (const n of NAMES) {
      const loc = p.locator(`[aria-label*="${n}" i], [title*="${n}" i]`);
      const cnt = await loc.count().catch(() => 0);
      for (let i = 0; i < cnt; i++) {
        const el = loc.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        await el.click({ timeout: 8000 }).catch(() => {});
        await p.waitForTimeout(4500);
        if (findFrame(p)) { acildi = true; break; }
      }
      if (acildi) break;
    }
    if (!acildi) {
      // tanilama: yazma seridinde ne var?
      const etiketler = await p.evaluate(() => Array.from(document.querySelectorAll('[aria-label],[title]'))
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map(e => e.getAttribute('aria-label') || e.getAttribute('title')).filter(Boolean).slice(0, 60));
      console.log('GORUNUR ETIKETLER:', JSON.stringify(etiketler, null, 1));
      throw new Error('eklenti yazma kipinde acilmadi');
    }

    const fr = findFrame(p);
    log('panel (yazma kipi):', fr.url());
    await p.waitForTimeout(3000);

    const olcum = await fr.evaluate(() => new Promise(function (res) {
      var o = { hazir: false };
      if (typeof Office === 'undefined' || !Office.context || !Office.context.mailbox) { res({ hata: 'Office yok' }); return; }
      var it = Office.context.mailbox.item;
      function tip(x) { return x === undefined ? 'undefined' : (x === null ? 'null' : typeof x); }
      o.hazir = true;
      o.itemType = it.itemType;
      o.itemId_tipi = tip(it.itemId);
      o.itemId_var = !!it.itemId;
      o.itemId_uzunluk = it.itemId ? String(it.itemId).length : 0;
      o.conversationId_tipi = tip(it.conversationId);
      o.conversationId_var = !!it.conversationId;
      o.conversationId_deger = it.conversationId ? String(it.conversationId) : null;
      o.body_getAsync = typeof it.body?.getAsync;
      o.body_setAsync = typeof it.body?.setAsync;
      o.body_setSelectedDataAsync = typeof it.body?.setSelectedDataAsync;
      o.subject_tipi = tip(it.subject);
      o.subject_getAsync = it.subject && typeof it.subject.getAsync;
      o.to_tipi = tip(it.to);
      o.to_getAsync = it.to && typeof it.to.getAsync;
      o.cc_getAsync = it.cc && typeof it.cc.getAsync;
      o.attachments_tipi = tip(it.attachments);
      o.saveAsync = typeof it.saveAsync;
      o.getInitializationContextAsync = typeof it.getInitializationContextAsync;
      // §6 ozellik 6 (ek kontrolu) yazma kipinde mumkun mu?
      o.getAttachmentsAsync = typeof it.getAttachmentsAsync;
      o.addFileAttachmentAsync = typeof it.addFileAttachmentAsync;
      o.set_1_5 = Office.context.requirements.isSetSupported('Mailbox', '1.5');
      o.set_1_8 = Office.context.requirements.isSetSupported('Mailbox', '1.8');
      o.displayReplyForm = typeof Office.context.mailbox.displayReplyFormAsync;

      // kip tespiti
      o.kip = (typeof it.body?.setAsync === 'function') ? 'compose(yazma)' : 'read(okuma)';

      // getAttachmentsAsync ISLEV OLARAK var gorunuyor ama gercekten calisiyor mu?
      // Faz 0'da getAttachmentContentAsync de "var"di, cagirinca kod 5000 verdi.
      // Bu yuzden GERCEKTEN cagrilir.
      var ekBitti = false;
      if (typeof it.getAttachmentsAsync === 'function') {
        try {
          var ekSayac = setTimeout(function () {
            if (!ekBitti) { ekBitti = true; o.ek_cagri = 'zaman asimi'; devam(); }
          }, 12000);
          it.getAttachmentsAsync(function (r) {
            if (ekBitti) return; ekBitti = true; clearTimeout(ekSayac);
            if (r.status === 'succeeded') {
              o.ek_cagri = 'BASARILI';
              o.ek_sayisi = r.value ? r.value.length : 0;
            } else {
              o.ek_cagri = 'HATA kod=' + (r.error && r.error.code) + ' ' + (r.error && r.error.message);
            }
            devam();
          });
        } catch (e) { o.ek_cagri = 'istisna: ' + e.message; ekBitti = true; devam(); }
      } else { o.ek_cagri = 'islev yok'; ekBitti = true; devam(); }

      function devam() {
      // aud claim'i yazma kipinde degisti mi?
      var bitti = false;
      var sayac = setTimeout(function () { if (!bitti) { bitti = true; res(o); } }, 15000);
      Office.context.mailbox.getUserIdentityTokenAsync(function (r) {
        if (bitti) return; bitti = true; clearTimeout(sayac);
        if (r.status === 'succeeded') {
          try {
            o.tokenHam = r.value;   // yalniz yerel test dosyasina yazilir, ekrana basilmaz
            var pr = r.value.split('.')[1];
            var j = JSON.parse(atob(pr.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - pr.length % 4) % 4)));
            o.token_aud = j.aud;
            o.token_alindi = true;
          } catch (e) { o.token_coz_hata = String(e); }
        } else { o.token_alindi = false; o.token_hata = r.error && r.error.message; }
        res(o);
      });
      }
    }));

    // Token'i gitignore'lu yerel dosyaya yaz (B/C uc noktalarini sinamak icin).
    // Ekrana ASLA basilmaz.
    try { require('fs').writeFileSync(path.join(OUT, 'lab-creds-token.txt'), olcum.tokenHam || '', 'utf8'); } catch (e) {}
    delete olcum.tokenHam;

    console.log('\n=== YAZMA KIPI OLCUMU ===');
    console.log(JSON.stringify(olcum, null, 2));
    await p.screenshot({ path: path.join(OUT, 'compose-panel.png') });

    console.log('\n=== C CAGRISI ICIN SONUC ===');
    if (olcum.conversationId_var) console.log('conversationId MEVCUT -> parent baglantisi bunun uzerinden kurulabilir');
    else console.log('conversationId YOK -> baska bir baglanti yolu gerekiyor');
    console.log('itemId mevcut mu:', olcum.itemId_var);
    console.log('aud degisti mi:', olcum.token_aud === 'https://mail.example.local:4443/pilot/taskpane.html' ? 'HAYIR (ayni URL, auth uyumlu)' : 'EVET -> ' + olcum.token_aud);

    await b.close();
  } catch (e) {
    console.error('HATA:', e.message);
    await p.screenshot({ path: path.join(OUT, 'compose-fail.png') }).catch(() => {});
    await b.close();
    process.exit(1);
  }
})();
