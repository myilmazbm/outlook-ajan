/*
 * Faz 2 + Faz 3 - panel + arka uc cozumlemesi.
 *
 * OKUMA KIPI (Faz 2 - degismedi, gerilemez):
 *   "Ozetle" dugmesi /analiz ucuna TEK istek atar. Ozet, Aksiyonlar ve Sorular
 *   sekmeleri ayni yanittan doldurulur; sekme degistirmek SIFIR istek uretir.
 *   Bu yolda XMLHttpRequest yalnizca istekYolla() icinde acilir.
 *
 * YAZMA KIPI (Faz 3 - yeni):
 *   Taslak/ceviri -> POST /taslak, Kontrol -> POST /kontrol. Her dugme basimi
 *   kendi ucuna TEK istek atar; hepsi jsonIstek() uzerinden gider. Okuma
 *   kipindeki akisa dokunmaz - iki yol birbirinden bagimsizdir.
 *   Yazma kipinde EK KONTROLU YOKTUR: getAttachmentsAsync bu kipte calismiyor
 *   (olculdu: hata 5000), bu yuzden hic denenmez.
 *
 * K8 / sert kural: uretilen metin maile KENDILIGINDEN yazilmaz. Govdeye yazan
 *   tek yol kullanicinin bastigi "Govdeye ekle" dugmesidir (govdeyeEkle()).
 *   Panel mail gondermez, silmez, tasimaz.
 *
 * Pasif kontroller (ek referansi, alici kontrolu) tamamen yereldir:
 *   arka uc yok, model yok, agdan bagimsiz, sessiz - hicbir sey ziplamaz.
 *
 * K2: mail icerigi diske, gunluge, localStorage/sessionStorage/IndexedDB/cerez'e
 *     YAZILMAZ. Sonuc yalniz bu dosyadaki degiskenlerde durur, panel kapaninca
 *     kaybolur. Dosyada tek bir console cagrisi bulunmaz.
 *
 * ES5: masaustu Outlook webview'i eski olabilir. Ok fonksiyonu, sablon dizgi,
 *      let/const, async/await, yayma islemi ve fetch KULLANILMAZ.
 */
(function () {
  'use strict';

  /* Ortama ozgu iki deger - dagitimda YALNIZ bu iki satir degisir. */
  var SERVIS_KOKU = 'https://mail.example.local:4444';
  var IC_ALAN = 'example.local';

  var OLCUM_UCU = SERVIS_KOKU + '/olcum';
  var SERVIS_UCU = SERVIS_KOKU + '/analiz';
  var TASLAK_UCU = SERVIS_KOKU + '/taslak';
  var KONTROL_UCU = SERVIS_KOKU + '/kontrol';
  var ZAMAN_ASIMI_MS = 60000;
  /* Govdede eke atif arayan sozcukler. Metin once Turkce-duyarli sadelestirilir,
     bu yuzden "ilisikte" kalibi hem "ilişikte" hem "iliskte" yazimini yakalar. */
  var EK_SOZCUKLERI = ['ekte', 'ekler', 'ilisikte', 'iliskte', 'attached', 'attachment', 'ek olarak'];

  var KATEGORI_ADI = {
    'action_required': 'Aksiyon gerekli',
    'question': 'Soru',
    'fyi': 'Bilgi',
    'meeting': 'Toplantı',
    'approval': 'Onay',
    'escalation': 'Eskalasyon',
    'newsletter': 'Bülten',
    'automated': 'Otomatik ileti',
    'other': 'Diğer'
  };

  var SEKMELER = [
    { dugme: 'sekmeOzet', panel: 'panelOzet' },
    { dugme: 'sekmeAksiyon', panel: 'panelAksiyon' },
    { dugme: 'sekmeSoru', panel: 'panelSoru' }
  ];

  /* Yazma kipinde ucus sirasinda kilitlenen uretim dugmeleri. */
  var YAZMA_DUGMELERI = ['taslakKisa', 'taslakDetayli', 'taslakResmi', 'ceviriTr', 'ceviriEn'];

  /* ---- oturum durumu: yalniz bellekte ---- */
  var oge = null;
  var govdeMetni = null;      /* getAsync ile okunan duz metin */
  var govdeHatasi = false;
  var istekSuruyor = false;
  var cozumlendi = false;
  var sonSonuc = null;        /* /analiz yanitinin "sonuc" alani - uc sekmenin de kaynagi */
  var sonMeta = null;         /* /analiz yanitinin "meta" alani */

  /* ---- yazma kipi durumu: yalniz bellekte ---- */
  var yazmaKipi = false;
  var yazmaKonu = '';
  var yazmaKime = [];
  var yazmaCc = [];
  var uretilenMetin = '';     /* /taslak yanitindaki "metin" - yalniz ekranda durur */
  var uretimSuruyor = false;
  var kontrolSuruyor = false;

  /* ---------------- §12 kullanim sayaci ----------------
   * SADECE SAYI gonderilir: {"olaylar":{"ozetle":1}}. Icerik, konu, adres,
   * kimlik YOK (K2). Olay adlari sabit listedir; sunucu tanimsiz adi saymaz.
   *
   * BIRIKTIRILIR: her tiklamada istek atilsa sekme degistirmek ag trafigi
   * uretirdi ve "sekmeler bedelsizdir" (§3.2) vaadi fiilen bozulurdu.
   * Bu yuzden sayaclar bellekte toplanip seyrek gonderilir.
   *
   * Sessizdir: basarisiz olursa kullaniciya hicbir sey gosterilmez, panelin
   * hicbir islevi telemetriye BAGLI DEGILDIR.
   */
  var olcumKovasi = {};
  var olcumZamanlayici = null;
  var OLCUM_BEKLEME_MS = 10000;

  function olcumSay(olay) {
    if (!olay) { return; }
    olcumKovasi[olay] = (olcumKovasi[olay] || 0) + 1;
    if (olcumZamanlayici === null) {
      olcumZamanlayici = setTimeout(olcumGonder, OLCUM_BEKLEME_MS);
    }
  }

  function olcumGonder() {
    olcumZamanlayici = null;
    var kova = olcumKovasi;
    olcumKovasi = {};
    var bosMu = true;
    var k;
    for (k in kova) { if (kova.hasOwnProperty(k)) { bosMu = false; break; } }
    if (bosMu) { return; }

    kimlikAl(function (kimlikToken) {
      try {
        var istek = new XMLHttpRequest();
        istek.open('POST', OLCUM_UCU, true);
        istek.timeout = 15000;
        istek.setRequestHeader('Content-Type', 'application/json');
        if (kimlikToken) { istek.setRequestHeader('Authorization', 'Bearer ' + kimlikToken); }
        /* Sessiz: hata olursa yutulur. Sayac kaybi kabul edilebilir;
           kullaniciyi telemetri yuzunden rahatsiz etmek edilemez. */
        istek.onerror = function () {};
        istek.ontimeout = function () {};
        istek.send(JSON.stringify({ olaylar: kova }));
      } catch (e) { /* yutulur */ }
    });
  }

  /* ---------------- kucuk yardimcilar ---------------- */

  function el(id) {
    return document.getElementById(id);
  }

  function yaz(id, deger) {
    var e = el(id);
    if (e) {
      e.textContent = (deger === null || deger === undefined || deger === '') ? '—' : String(deger);
    }
  }

  function sinifla(id, sinif) {
    var e = el(id);
    if (e) { e.className = sinif; }
  }

  function durum(sinif, metin) {
    var d = el('durum');
    if (!d) { return; }
    d.className = 'durum ' + sinif;
    d.textContent = metin;
  }

  function bosalt(e) {
    while (e && e.firstChild) { e.removeChild(e.firstChild); }
  }

  /* Turkce-duyarli sadelestirme: buyuk/kucuk I sorunu ve aksanlar duzlenir. */
  function sadelestir(metin) {
    if (!metin) { return ''; }
    var s = String(metin);
    s = s.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/Ş/g, 's').replace(/Ğ/g, 'g');
    s = s.replace(/Ü/g, 'u').replace(/Ö/g, 'o').replace(/Ç/g, 'c');
    s = s.toLowerCase();
    s = s.replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g');
    s = s.replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
    s = s.replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u');
    return s;
  }

  function sozcukGecerMi(sadeMetin, sozcuk) {
    var kacan = sozcuk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var kalip = new RegExp('(^|[^a-z0-9])' + kacan);
    return kalip.test(sadeMetin);
  }

  function alanAdi(eposta) {
    var s = String(eposta || '');
    var i = s.lastIndexOf('@');
    return (i < 0) ? '' : sadelestir(s.substring(i + 1));
  }

  function ortakOnek(a, b) {
    var n = Math.min(a.length, b.length);
    var i = 0;
    while (i < n && a.charAt(i) === b.charAt(i)) { i++; }
    return i;
  }

  function duzenlemeUzakligi(a, b) {
    var m = a.length;
    var n = b.length;
    if (Math.abs(m - n) > 4) { return 99; }
    var onceki = [];
    var simdiki = [];
    var i, j, bedel;
    for (j = 0; j <= n; j++) { onceki[j] = j; }
    for (i = 1; i <= m; i++) {
      simdiki = [i];
      for (j = 1; j <= n; j++) {
        bedel = (a.charAt(i - 1) === b.charAt(j - 1)) ? 0 : 1;
        simdiki[j] = Math.min(onceki[j] + 1, simdiki[j - 1] + 1, onceki[j - 1] + bedel);
      }
      onceki = simdiki;
    }
    return onceki[n];
  }

  /* ---------------- oge bilgisi ---------------- */

  function kisiler(dizi) {
    var cikti = [];
    var i, k;
    if (!dizi || !dizi.length) { return cikti; }
    for (i = 0; i < dizi.length; i++) {
      k = dizi[i];
      if (!k) { continue; }
      cikti.push({
        ad: k.displayName || '',
        eposta: k.emailAddress || ''
      });
    }
    return cikti;
  }

  /*
   * Okuma kipinde to/cc duz dizidir (degismedi). Yazma kipinde ise getAsync'li
   * nesnedir (olculdu), bu yuzden acilista okunup yazmaKime/yazmaCc'ye alinir.
   */
  function tumAlicilar() {
    var liste = [];
    var i, kime, cc;
    if (yazmaKipi) {
      kime = yazmaKime;
      cc = yazmaCc;
    } else {
      kime = kisiler(oge ? oge.to : null);
      cc = kisiler(oge ? oge.cc : null);
    }
    for (i = 0; i < kime.length; i++) { liste.push(kime[i]); }
    for (i = 0; i < cc.length; i++) { liste.push(cc[i]); }
    return liste;
  }

  function ogeyiGoster() {
    yaz('konu', oge.subject);
    yaz('kimden', oge.from ? (oge.from.displayName || oge.from.emailAddress) : '—');

    var alicilar = tumAlicilar();
    yaz('alici', alicilar.length + ' kişi');

    var ekSayisi = (oge.attachments && oge.attachments.length) ? oge.attachments.length : 0;
    yaz('ek', ekSayisi === 0 ? 'yok' : ekSayisi + ' ek');

    sinifla('ogeBilgi', 'kart');
  }

  /* ---------------- pasif kontrol 1: ek referansi (yalniz okuma kipi) ---------------- */

  function ekKontrolu() {
    var not = el('ekNotu');
    if (!not) { return; }

    if (govdeHatasi || govdeMetni === null) {
      not.className = 'not sessiz';
      not.textContent = 'Gövde okunamadığı için ek kontrolü yapılamadı.';
      return;
    }

    var ekSayisi = (oge.attachments && oge.attachments.length) ? oge.attachments.length : 0;
    if (ekSayisi > 0) {
      not.className = 'not amber gizli';
      not.textContent = '';
      return;
    }

    var sade = sadelestir(govdeMetni);
    var i;
    for (i = 0; i < EK_SOZCUKLERI.length; i++) {
      if (sozcukGecerMi(sade, EK_SOZCUKLERI[i])) {
        not.className = 'not amber';
        not.textContent = 'Metinde "ekte" geçiyor, ek yok.';
        return;
      }
    }
    not.className = 'not amber gizli';
    not.textContent = '';
  }

  /* ---------------- pasif kontrol 2: alici kontrolu (iki kipte de) ---------------- */

  function disAlicilar(alicilar) {
    var cikti = [];
    var i, alan;
    for (i = 0; i < alicilar.length; i++) {
      alan = alanAdi(alicilar[i].eposta);
      if (alan && alan !== IC_ALAN) { cikti.push(alicilar[i].eposta); }
    }
    return cikti;
  }

  function benzerCiftler(alicilar) {
    var ciftler = [];
    var i, j, hamA, hamB, sadeA, sadeB;
    for (i = 0; i < alicilar.length; i++) {
      hamA = String(alicilar[i].eposta || '');
      if (!hamA) { continue; }
      sadeA = sadelestir(hamA);
      for (j = i + 1; j < alicilar.length; j++) {
        hamB = String(alicilar[j].eposta || '');
        if (!hamB || hamA === hamB) { continue; }
        sadeB = sadelestir(hamB);
        if (sadeA === sadeB) {
          ciftler.push(hamA + ' / ' + hamB);
        } else if (ortakOnek(sadeA, sadeB) >= 6 && duzenlemeUzakligi(sadeA, sadeB) <= 3) {
          ciftler.push(hamA + ' / ' + hamB);
        }
        if (ciftler.length >= 3) { return ciftler; }
      }
    }
    return ciftler;
  }

  function aliciKontrolu() {
    var not = el('aliciNotu');
    if (!not) { return; }

    var alicilar = tumAlicilar();
    if (!alicilar.length) {
      not.className = 'not sessiz gizli';
      not.textContent = '';
      return;
    }

    var parcalar = [];
    var dis = disAlicilar(alicilar);
    var benzer = benzerCiftler(alicilar);

    if (dis.length) {
      var gosterilen = dis.slice(0, 3).join(', ');
      if (dis.length > 3) { gosterilen = gosterilen + ' (+' + (dis.length - 3) + ')'; }
      parcalar.push(dis.length + ' dış alıcı: ' + gosterilen);
    } else {
      parcalar.push('Tüm alıcılar kurum içi.');
    }

    if (benzer.length) {
      parcalar.push('benzer adres: ' + benzer.join(' · '));
      /* §12: uyari GERCEKTEN gosterildiginde sayilir; her panel acilisinda degil. */
      olcumSay('alici_uyarisi');
    }

    not.className = 'not sessiz';
    not.textContent = parcalar.join(' — ');
  }

  /* ---------------- govde okuma ---------------- */

  function govdeOku(bitince) {
    if (govdeMetni !== null) { bitince(true); return; }
    if (!oge || !oge.body || typeof oge.body.getAsync !== 'function') {
      govdeHatasi = true;
      bitince(false);
      return;
    }
    try {
      oge.body.getAsync(Office.CoercionType.Text, function (yanit) {
        if (yanit && yanit.status === Office.AsyncResultStatus.Succeeded) {
          govdeMetni = (yanit.value === null || yanit.value === undefined) ? '' : String(yanit.value);
          govdeHatasi = false;
          bitince(true);
        } else {
          govdeHatasi = true;
          bitince(false);
        }
      });
    } catch (e) {
      govdeHatasi = true;
      bitince(false);
    }
  }

  /*
   * Yazma kipinde govde kullanici yazdikca degisir; onbellege alinmaz,
   * her dugme basiminda TAZE okunur. Bu bir arka uc istegi degildir.
   */
  function govdeOkuTaze(bitince) {
    if (!oge || !oge.body || typeof oge.body.getAsync !== 'function') {
      bitince(false, '');
      return;
    }
    try {
      oge.body.getAsync(Office.CoercionType.Text, function (yanit) {
        if (yanit && yanit.status === Office.AsyncResultStatus.Succeeded) {
          bitince(true, (yanit.value === null || yanit.value === undefined) ? '' : String(yanit.value));
        } else {
          bitince(false, '');
        }
      });
    } catch (e) {
      bitince(false, '');
    }
  }

  /* ---------------- sekmeler: yalniz DOM, istek YOK ---------------- */

  function sekmeSec(panelId) {
    var i, s, d, p, etkin;
    for (i = 0; i < SEKMELER.length; i++) {
      s = SEKMELER[i];
      etkin = (s.panel === panelId);
      d = el(s.dugme);
      p = el(s.panel);
      if (d) {
        d.className = etkin ? 'sekme etkin' : 'sekme';
        d.setAttribute('aria-selected', etkin ? 'true' : 'false');
      }
      if (p) {
        p.className = etkin ? 'panel' : 'panel gizli';
      }
    }
  }

  /* Mevcut bir tiklama isleyicisini sarar: once sayar, sonra isi yapar.
     Sayim basarisiz olsa bile islev calisir - telemetri hicbir seyi bloke etmez. */
  function olcumluBaglayici(olay, islev) {
    return function () {
      try { olcumSay(olay); } catch (e) { /* yutulur */ }
      return islev.apply(this, arguments);
    };
  }

  function sekmeBaglayici(panelId) {
    return function () {
      try {
        olcumSay(panelId === 'panelOzet' ? 'sekme_ozet'
          : (panelId === 'panelAksiyon' ? 'sekme_aksiyon' : 'sekme_soru'));
      } catch (e) { /* yutulur */ }
      sekmeSec(panelId);
    };
  }

  function sekmeleriBagla() {
    var i, d;
    for (i = 0; i < SEKMELER.length; i++) {
      d = el(SEKMELER[i].dugme);
      if (d) { d.onclick = sekmeBaglayici(SEKMELER[i].panel); }
    }
  }

  /* ---------------- sonucu ekrana dokme ---------------- */

  function etiketEkle(kap, metin, ekSinif) {
    var s = document.createElement('span');
    s.className = ekSinif ? ('etiket ' + ekSinif) : 'etiket';
    s.textContent = metin;
    kap.appendChild(s);
  }

  function oncelikSinifi(oncelik) {
    if (oncelik >= 4) { return 'onc-yuksek'; }
    if (oncelik === 3) { return 'onc-orta'; }
    return 'onc-dusuk';
  }

  function etiketleriDok() {
    var kap = el('etiketler');
    if (!kap) { return; }
    bosalt(kap);

    var kategori = sonSonuc.category ? (KATEGORI_ADI[sonSonuc.category] || sonSonuc.category) : 'Kategori yok';
    etiketEkle(kap, kategori, '');

    if (sonSonuc.priority !== null && sonSonuc.priority !== undefined) {
      etiketEkle(kap, 'Öncelik ' + sonSonuc.priority + '/5', oncelikSinifi(Number(sonSonuc.priority)));
    }

    if (sonSonuc.reply_needed === true) {
      etiketEkle(kap, 'Yanıt gerekli', 'evet');
    } else if (sonSonuc.reply_needed === false) {
      etiketEkle(kap, 'Yanıt gerekmiyor', 'hayir');
    }

    if (sonMeta && sonMeta.onbellek === true) {
      etiketEkle(kap, 'önbellekten geldi', 'onbellek');
    }
  }

  function listeyiDok(listeId, bosId, maddeler) {
    var liste = el(listeId);
    var bos = el(bosId);
    var i, li;
    if (!liste) { return; }
    bosalt(liste);

    if (!maddeler || !maddeler.length) {
      if (bos) { bos.className = 'bos'; }
      return;
    }
    if (bos) { bos.className = 'bos gizli'; }
    for (i = 0; i < maddeler.length; i++) {
      li = document.createElement('li');
      li.textContent = String(maddeler[i]);
      liste.appendChild(li);
    }
  }

  /*
   * Tek yanittan uc sekme: burada bir kez calisir, uc panel de dolar.
   * Sonrasinda sekme dugmeleri yalniz gorunurluk degistirir (sekmeSec),
   * bu fonksiyon ve istekGonder bir daha cagrilmaz.
   */
  function sonucuDok() {
    if (!sonSonuc) { return; }
    etiketleriDok();
    yaz('ozetMetin', sonSonuc.summary);
    listeyiDok('aksiyonListe', 'aksiyonBos', sonSonuc.action_items);
    listeyiDok('soruListe', 'soruBos', sonSonuc.questions);
    sekmeSec('panelOzet');
    sinifla('sonucAlani', '');
  }

  /* ---------------- durum gostergeleri ---------------- */

  function yuklemeGoster(acik) {
    sinifla('yukleniyor', acik ? 'yukleme' : 'yukleme gizli');
  }

  function hataGoster(metin) {
    var e = el('analizHata');
    if (!e) { return; }
    e.className = 'durum hata';
    e.textContent = metin;
  }

  function hataTemizle() {
    var e = el('analizHata');
    if (!e) { return; }
    e.className = 'durum hata gizli';
    e.textContent = '';
  }

  function dugmeyiKilitle(kilitli, etiket) {
    var d = el('ozetleDugme');
    if (!d) { return; }
    d.disabled = kilitli;
    if (etiket) { d.textContent = etiket; }
  }

  /* ---------------- kimlik ---------------- */

  /*
   * Kimlik (E5): Exchange identity token her cagride TAZE alinir - /analiz,
   * /taslak ve /kontrol icin ayni yoldan. Token yalniz Authorization
   * basliginda kullanilir - DOM'a yazilmaz, loglanmaz, depolanmaz. Panel
   * kapaninca izi kalmaz (K2).
   */
  function kimlikAl(geriCagri) {
    try {
      if (!Office.context.mailbox.getUserIdentityTokenAsync) { geriCagri(null); return; }
      var bitti = false;
      var sayac = setTimeout(function () {
        if (!bitti) { bitti = true; geriCagri(null); }
      }, 15000);
      Office.context.mailbox.getUserIdentityTokenAsync(function (r) {
        if (bitti) { return; }
        bitti = true;
        clearTimeout(sayac);
        geriCagri(r && r.status === 'succeeded' ? r.value : null);
      });
    } catch (e) { geriCagri(null); }
  }

  /* ---------------- OKUMA KIPI: /analiz - tek istek yeri ---------------- */

  function istekGovdesi() {
    return JSON.stringify({
      ogeId: oge.itemId || '',
      /* C cagrisinin (yazma kipi) A sonucuna ulasabilmesi icin ZORUNLU:
         yazma kipinde itemId yok, conversationId var ve okuma kipiyle ayni.
         Bu alan gonderilmezse /kontrol her zaman 409 A_YOK doner. */
      konusmaId: oge.conversationId || '',
      konu: oge.subject || '',
      kimden: oge.from
        ? { ad: oge.from.displayName || '', eposta: oge.from.emailAddress || '' }
        : { ad: '', eposta: '' },
      kime: kisiler(oge.to),
      cc: kisiler(oge.cc),
      govde: govdeMetni === null ? '' : govdeMetni
    });
  }

  function yanitiIsle(istek) {
    var veri = null;
    if (istek.status === 200) {
      try {
        veri = JSON.parse(istek.responseText);
      } catch (e) {
        hataGoster('Servis yanıtı çözümlenemedi.');
        return false;
      }
      if (!veri || !veri.sonuc) {
        hataGoster('Servis yanıtı beklenen biçimde değil.');
        return false;
      }
      sonSonuc = veri.sonuc;
      sonMeta = veri.meta || null;
      sonucuDok();
      return true;
    }

    var aciklama = '';
    try {
      veri = JSON.parse(istek.responseText);
      if (veri && veri.hata) { aciklama = ' — ' + veri.hata; }
    } catch (e2) {
      aciklama = '';
    }

    if (istek.status === 0) {
      hataGoster('Servise ulaşılamadı. Çözümleme servisi (4444) çalışmıyor olabilir. Panelin geri kalanı kullanılabilir.');
    } else if (istek.status === 400) {
      hataGoster('İstek geçersiz bulundu (400)' + aciklama);
    } else if (istek.status === 502) {
      hataGoster('Model hatası (502)' + aciklama);
    } else if (istek.status === 401) {
      hataGoster('Kimlik doğrulanamadı (401). Oturumunuz yenilenmiş olabilir; paneli kapatıp yeniden açın.');
    } else if (istek.status === 504) {
      hataGoster('Servis zaman aşımına uğradı (504)' + aciklama);
    } else {
      hataGoster('Servis hatası (' + istek.status + ')' + aciklama);
    }
    return false;
  }

  /*
   * Okuma kipinde XMLHttpRequest.open cagrisinin TEK gectigi yer burasi.
   * istekSuruyor  : ucus sirasinda ikinci tiklamayi keser.
   * cozumlendi    : basarili yanittan sonra dugmeyi kalici kilitler.
   * Sekme degistirme bu fonksiyona hicbir yerden ulasmaz.
   */
  function istekGonder() {
    if (istekSuruyor || cozumlendi) { return; }
    istekSuruyor = true;
    hataTemizle();
    yuklemeGoster(true);
    dugmeyiKilitle(true, 'Kimlik alınıyor…');

    kimlikAl(function (kimlikToken) {
      dugmeyiKilitle(true, 'Çözümleniyor…');
      istekYolla(kimlikToken);
    });
  }

  function istekYolla(kimlikToken) {
    var kapandi = false;
    var istek = new XMLHttpRequest();

    function bitir(basarili) {
      if (kapandi) { return; }
      kapandi = true;
      istekSuruyor = false;
      yuklemeGoster(false);
      if (basarili) {
        cozumlendi = true;
        dugmeyiKilitle(true, 'Özetlendi');
        durum('tamam', 'Çözümleme hazır — sekmeler yeni istek göndermez.');
      } else {
        dugmeyiKilitle(false, 'Özetle');
      }
    }

    istek.open('POST', SERVIS_UCU, true);
    istek.timeout = ZAMAN_ASIMI_MS;
    try {
      istek.setRequestHeader('Content-Type', 'application/json');
      if (kimlikToken) {
        istek.setRequestHeader('Authorization', 'Bearer ' + kimlikToken);
      }
    } catch (e) {
      /* bazi eski webview'ler open oncesi/sonrasi kati davranir; sessiz gecilir */
    }

    istek.onreadystatechange = function () {
      if (istek.readyState !== 4 || kapandi) { return; }
      bitir(yanitiIsle(istek));
    };

    istek.ontimeout = function () {
      if (kapandi) { return; }
      hataGoster('Süre doldu: servis 60 saniyede yanıt vermedi. Yeniden deneyebilirsiniz.');
      bitir(false);
    };

    istek.onerror = function () {
      if (kapandi) { return; }
      hataGoster('Servise ulaşılamadı. Ağ ya da sertifika engeli olabilir.');
      bitir(false);
    };

    try {
      istek.send(istekGovdesi());
    } catch (e3) {
      hataGoster('İstek gönderilemedi: ' + (e3 && e3.message ? e3.message : 'bilinmeyen hata'));
      bitir(false);
    }
  }

  function ozetleTiklandi() {
    olcumSay("ozetle");
    if (istekSuruyor || cozumlendi) { return; }
    hataTemizle();

    if (govdeMetni !== null) {
      istekGonder();
      return;
    }

    /* Acilista govde okunamamissa bir kez daha denenir. */
    dugmeyiKilitle(true, 'Gövde okunuyor…');
    govdeOku(function (basarili) {
      if (basarili) {
        ekKontrolu();
        dugmeyiKilitle(false, 'Özetle');
        istekGonder();
      } else {
        dugmeyiKilitle(false, 'Özetle');
        hataGoster('Mail gövdesi okunamadı (body.getAsync başarısız). Çözümleme yapılamıyor.');
      }
    });
  }

  /* ================= YAZMA KIPI: /taslak ve /kontrol ================= */

  /*
   * Yazma kipindeki tek istek noktasi. Her cagri kendi XHR'ini acar, kimligi
   * TAZE alir (Authorization: Bearer), 60 sn zaman asimi koyar ve sonucu geri
   * cagriya birakir. Okuma kipindeki istekYolla'ya hicbir bagi yoktur.
   *   bitti(durumKodu, veri) -> durumKodu -1 zaman asimi, 0 ag/gonderim hatasi.
   */
  function jsonIstek(ucAdresi, govdeJson, bitti) {
    kimlikAl(function (kimlikToken) {
      var kapandi = false;
      var istek = new XMLHttpRequest();

      function son(durumKodu, veri) {
        if (kapandi) { return; }
        kapandi = true;
        bitti(durumKodu, veri);
      }

      istek.open('POST', ucAdresi, true);
      istek.timeout = ZAMAN_ASIMI_MS;
      try {
        istek.setRequestHeader('Content-Type', 'application/json');
        if (kimlikToken) {
          istek.setRequestHeader('Authorization', 'Bearer ' + kimlikToken);
        }
      } catch (e) {
        /* bazi eski webview'ler kati davranir; sessiz gecilir */
      }

      istek.onreadystatechange = function () {
        if (istek.readyState !== 4 || kapandi) { return; }
        var veri = null;
        try { veri = JSON.parse(istek.responseText); } catch (e2) { veri = null; }
        son(istek.status, veri);
      };

      istek.ontimeout = function () { son(-1, null); };
      istek.onerror = function () { son(0, null); };

      try {
        istek.send(govdeJson);
      } catch (e3) {
        son(0, null);
      }
    });
  }

  function hataMetni(durumKodu, veri) {
    var ek = (veri && veri.hata) ? ' — ' + veri.hata : '';
    if (durumKodu === -1) {
      return 'Süre doldu: servis 60 saniyede yanıt vermedi. Yeniden deneyebilirsiniz.';
    }
    if (durumKodu === 0) {
      return 'Servise ulaşılamadı. Çözümleme servisi (4444) çalışmıyor olabilir.';
    }
    if (durumKodu === 400) { return 'İstek geçersiz bulundu (400)' + ek; }
    if (durumKodu === 401) {
      return 'Kimlik doğrulanamadı (401). Oturumunuz yenilenmiş olabilir; paneli kapatıp yeniden açın.';
    }
    if (durumKodu === 502) { return 'Model hatası (502)' + ek; }
    if (durumKodu === 504) { return 'Servis zaman aşımına uğradı (504)' + ek; }
    return 'Servis hatası (' + durumKodu + ')' + ek;
  }

  /* ---- yazma kipi gostergeleri ---- */

  function uretimDugmeleriKilitle(kilitli) {
    var i, d;
    for (i = 0; i < YAZMA_DUGMELERI.length; i++) {
      d = el(YAZMA_DUGMELERI[i]);
      if (d) { d.disabled = kilitli; }
    }
  }

  function taslakYuklemeGoster(acik, metin) {
    sinifla('taslakYukleniyor', acik ? 'yukleme' : 'yukleme gizli');
    if (acik && metin) { yaz('taslakYuklemeMetni', metin); }
  }

  function taslakHataGoster(metin) {
    var e = el('taslakHata');
    if (!e) { return; }
    e.className = 'durum hata';
    e.textContent = metin;
  }

  function taslakHataTemizle() {
    var e = el('taslakHata');
    if (!e) { return; }
    e.className = 'durum hata gizli';
    e.textContent = '';
  }

  function ekleNotuGoster(sinif, metin) {
    var e = el('ekleNotu');
    if (!e) { return; }
    if (!metin) {
      e.className = 'not sessiz gizli';
      e.textContent = '';
      return;
    }
    e.className = 'not ' + sinif;
    e.textContent = metin;
  }

  /* Uretilen metin yalniz salt okunur kutuya yazilir - maile DOKUNMAZ. */
  function uretilenMetniGoster(baslik, metin) {
    var kutu = el('taslakMetin');
    uretilenMetin = metin;
    if (kutu) { kutu.value = metin; }
    yaz('taslakBasligi', baslik);
    sinifla('taslakSonuc', 'kart grup');
    ekleNotuGoster('sessiz', '');
  }

  /* ---- taslak / ceviri: POST /taslak ---- */

  function uretimIstegi(govdeNesnesi, yuklemeMetni, baslik) {
    if (uretimSuruyor) { return; }
    uretimSuruyor = true;
    taslakHataTemizle();
    ekleNotuGoster('sessiz', '');
    uretimDugmeleriKilitle(true);
    taslakYuklemeGoster(true, yuklemeMetni);

    jsonIstek(TASLAK_UCU, JSON.stringify(govdeNesnesi), function (durumKodu, veri) {
      uretimSuruyor = false;
      uretimDugmeleriKilitle(false);
      taslakYuklemeGoster(false, '');

      if (durumKodu === 200) {
        if (!veri || typeof veri.metin !== 'string') {
          taslakHataGoster('Servis yanıtı beklenen biçimde değil.');
          return;
        }
        uretilenMetniGoster(baslik, veri.metin);
        return;
      }
      taslakHataGoster(hataMetni(durumKodu, veri));
    });
  }

  function kimdenBilgisi() {
    var p = null;
    try { p = Office.context.mailbox.userProfile; } catch (e) { p = null; }
    return {
      ad: (p && p.displayName) ? p.displayName : '',
      eposta: (p && p.emailAddress) ? p.emailAddress : ''
    };
  }

  function taslakBaglayici(ton, baslik) {
    return function () {
      if (uretimSuruyor) { return; }
      taslakHataTemizle();
      govdeOkuTaze(function (basarili, metin) {
        if (!basarili) {
          taslakHataGoster('Mail gövdesi okunamadı (body.getAsync başarısız). Taslak üretilemiyor.');
          return;
        }
        uretimIstegi({
          gorev: 'taslak',
          ton: ton,
          konu: yazmaKonu,
          kimden: kimdenBilgisi(),
          kime: yazmaKime,
          cc: yazmaCc,
          govde: metin
        }, 'Taslak üretiliyor… en çok 60 saniye.', baslik);
      });
    };
  }

  function ceviriBaglayici(hedefDil, baslik) {
    return function () {
      if (uretimSuruyor) { return; }
      taslakHataTemizle();
      govdeOkuTaze(function (basarili, metin) {
        if (!basarili) {
          taslakHataGoster('Mail gövdesi okunamadı (body.getAsync başarısız). Çeviri yapılamıyor.');
          return;
        }
        if (!metin || !metin.replace(/\s+/g, '')) {
          taslakHataGoster('Gövde boş — çevrilecek metin yok.');
          return;
        }
        uretimIstegi({
          gorev: 'ceviri',
          hedefDil: hedefDil,
          govde: metin
        }, 'Çevriliyor… en çok 60 saniye.', baslik);
      });
    };
  }

  /* ---- maile yazan TEK yol ---- */

  /*
   * K8 / sert kural: bu fonksiyon yalnizca kullanici "Govdeye ekle" dugmesine
   * bastiginda calisir. Panelde setSelectedDataAsync ya da setAsync cagiran
   * baska hicbir yer yoktur; uretilen metin kendiliginden maile girmez.
   */
  function govdeyeEkle() {
    if (!uretilenMetin) {
      ekleNotuGoster('sessiz', 'Eklenecek metin yok.');
      return;
    }
    if (!oge || !oge.body || typeof oge.body.setSelectedDataAsync !== 'function') {
      ekleNotuGoster('amber', 'Bu pencerede gövdeye yazılamıyor.');
      return;
    }
    try {
      oge.body.setSelectedDataAsync(
        uretilenMetin,
        { coercionType: Office.CoercionType.Text },
        function (yanit) {
          if (yanit && yanit.status === Office.AsyncResultStatus.Succeeded) {
            ekleNotuGoster('sessiz', 'Metin, imlecin bulunduğu yere eklendi.');
          } else {
            ekleNotuGoster('amber', 'Gövdeye eklenemedi. İmleci gövdeye koyup yeniden deneyin.');
          }
        }
      );
    } catch (e) {
      ekleNotuGoster('amber', 'Gövdeye eklenemedi: ' + (e && e.message ? e.message : 'bilinmeyen hata'));
    }
  }

  /* ---- kontrol: POST /kontrol (C cagrisi) ---- */

  function kontrolYuklemeGoster(acik) {
    sinifla('kontrolYukleniyor', acik ? 'yukleme' : 'yukleme gizli');
  }

  function kontrolHataGoster(metin) {
    var e = el('kontrolHata');
    if (!e) { return; }
    e.className = 'durum hata';
    e.textContent = metin;
  }

  function kontrolBilgiGoster(metin) {
    var e = el('kontrolBilgi');
    if (!e) { return; }
    if (!metin) {
      e.className = 'not amber gizli';
      e.textContent = '';
      return;
    }
    e.className = 'not amber';
    e.textContent = metin;
  }

  function kontrolTemizle() {
    var e = el('kontrolHata');
    if (e) {
      e.className = 'durum hata gizli';
      e.textContent = '';
    }
    kontrolBilgiGoster('');
  }

  /* cevapsiz = baskin (amber), cevaplanan = sessiz (gri) - siniflar CSS'te. */
  function kontroluDok(sonuc) {
    listeyiDok('cevapsizListe', 'cevapsizBos', sonuc.cevapsiz);
    listeyiDok('cevaplananListe', 'cevaplananBos', sonuc.cevaplanan);

    var n = el('kontrolNot');
    if (n) {
      if (sonuc['not']) {
        n.className = 'not sessiz';
        n.textContent = String(sonuc['not']);
      } else {
        n.className = 'not sessiz gizli';
        n.textContent = '';
      }
    }
    sinifla('kontrolSonuc', '');
  }

  function kontrolDugmesiKilitle(kilitli, etiket) {
    var d = el('kontrolDugme');
    if (!d) { return; }
    d.disabled = kilitli;
    if (etiket) { d.textContent = etiket; }
  }

  function kontrolTiklandi() {
    if (kontrolSuruyor) { return; }
    kontrolTemizle();

    govdeOkuTaze(function (basarili, metin) {
      if (!basarili) {
        kontrolHataGoster('Mail gövdesi okunamadı (body.getAsync başarısız). Kontrol yapılamıyor.');
        return;
      }
      if (!metin || !metin.replace(/\s+/g, '')) {
        kontrolBilgiGoster('Gövde boş. Önce yanıtınızı yazın, sonra kontrol edin.');
        return;
      }

      kontrolSuruyor = true;
      kontrolDugmesiKilitle(true, 'Kontrol ediliyor…');
      kontrolYuklemeGoster(true);

      jsonIstek(KONTROL_UCU, JSON.stringify({
        konusmaId: (oge && oge.conversationId) ? oge.conversationId : '',
        taslak: metin
      }), function (durumKodu, veri) {
        kontrolSuruyor = false;
        kontrolYuklemeGoster(false);
        kontrolDugmesiKilitle(false, 'Kontrol et');

        if (durumKodu === 200) {
          if (!veri || !veri.sonuc) {
            kontrolHataGoster('Servis yanıtı beklenen biçimde değil.');
            return;
          }
          kontroluDok(veri.sonuc);
          return;
        }

        /*
         * 409 / A_YOK bir ariza degil, beklenen durumdur (SOZLESME, Faz 3):
         * C tek basina calisamaz, once A'nin sorulari gerekir. Ham hata
         * gosterilmez; ne yapilacagi soylenir.
         */
        if (durumKodu === 409 && veri && veri.kod === 'A_YOK') {
          sinifla('kontrolSonuc', 'gizli');
          kontrolBilgiGoster('Bu yazışma henüz özetlenmedi — kontrol, özetteki sorulara dayanır. ' +
            'Zincirdeki özgün iletiyi açıp panelde “Özetle”ye basın, sonra buraya dönüp yeniden deneyin.');
          return;
        }

        kontrolHataGoster(hataMetni(durumKodu, veri));
      });
    });
  }

  /* ---- yazma kipi acilisi ---- */

  /* Yazma kipinde to/cc getAsync'lidir (olculdu); ikisi de bitince geri donulur. */
  function yazmaAlicilariOku(bitince) {
    var bekleyen = 2;

    function birBitti() {
      bekleyen--;
      if (bekleyen === 0) { bitince(); }
    }

    function oku(alan, yazici) {
      if (!alan || typeof alan.getAsync !== 'function') { yazici([]); birBitti(); return; }
      try {
        alan.getAsync(function (yanit) {
          if (yanit && yanit.status === Office.AsyncResultStatus.Succeeded) {
            yazici(kisiler(yanit.value));
          } else {
            yazici([]);
          }
          birBitti();
        });
      } catch (e) {
        yazici([]);
        birBitti();
      }
    }

    oku(oge.to, function (v) { yazmaKime = v; });
    oku(oge.cc, function (v) { yazmaCc = v; });
  }

  function yazmaKonuOku() {
    if (!oge.subject || typeof oge.subject.getAsync !== 'function') { return; }
    try {
      oge.subject.getAsync(function (yanit) {
        if (yanit && yanit.status === Office.AsyncResultStatus.Succeeded) {
          yazmaKonu = (yanit.value === null || yanit.value === undefined) ? '' : String(yanit.value);
          yaz('konu', yazmaKonu);
        }
      });
    } catch (e) {
      /* konu okunamazsa bos gider; taslak yine uretilebilir */
    }
  }

  function yazmaDugmeleriniBagla() {
    var d;

    d = el('taslakKisa');
    if (d) { d.onclick = olcumluBaglayici('taslak_kisa', taslakBaglayici('kisa', 'Üretilen taslak — kısa')); }
    d = el('taslakDetayli');
    if (d) { d.onclick = olcumluBaglayici('taslak_detayli', taslakBaglayici('detayli', 'Üretilen taslak — detaylı')); }
    d = el('taslakResmi');
    if (d) { d.onclick = olcumluBaglayici('taslak_resmi', taslakBaglayici('resmi', 'Üretilen taslak — resmî')); }

    d = el('ceviriTr');
    if (d) { d.onclick = olcumluBaglayici('ceviri_tr', ceviriBaglayici('tr', 'Çeviri — Türkçe')); }
    d = el('ceviriEn');
    if (d) { d.onclick = olcumluBaglayici('ceviri_en', ceviriBaglayici('en', 'Çeviri — İngilizce')); }

    d = el('ekleDugme');
    if (d) { d.onclick = olcumluBaglayici('govdeye_ekle', govdeyeEkle); }

    d = el('kontrolDugme');
    if (d) { d.onclick = olcumluBaglayici('kontrol_et', kontrolTiklandi); }
  }

  /*
   * Yazma kipi: okuma kipinin dugmesi ve ek satiri gizlenir.
   * Ek kontrolu HIC denenmez - getAttachmentsAsync bu kipte hata 5000 veriyor.
   */
  function yazmaBaslat() {
    olcumSay("panel_acildi_yazma");
    sinifla('okumaEylem', 'eylem gizli');
    sinifla('ekEtiketi', 'gizli');
    sinifla('ek', 'gizli');
    sinifla('ekNotu', 'not amber gizli');
    sinifla('yazmaAlani', '');

    yaz('ustAlt', 'Taslak, çeviri, kontrol');
    yaz('ogeBasligi', 'Yazılan ileti');
    yaz('kimdenEtiketi', 'Gönderen');
    yaz('konu', '');

    var ben = kimdenBilgisi();
    yaz('kimden', ben.ad || ben.eposta);
    yaz('alici', '');
    sinifla('ogeBilgi', 'kart');

    yazmaKonuOku();
    yazmaDugmeleriniBagla();

    durum('tamam', 'Panel hazır — yazma kipi. Üretilen metin siz eklemedikçe maile yazılmaz.');

    /* Alici kontrolu: pasif, sessiz, otomatik - arka uca hicbir istek gitmez. */
    yazmaAlicilariOku(function () {
      var alicilar = tumAlicilar();
      yaz('alici', alicilar.length + ' kişi');
      aliciKontrolu();
    });

    yazmaEkHatirlatmasi();
  }

  /*
   * §6 ozellik 6 - YAZMA KIPI (S10 karari).
   *
   * Bu kipte ekin gercekten eklenip eklenmedigi OGRENILEMIYOR:
   * item.attachments yok, getAttachmentsAsync ise cagrilinca "kod 5000 -
   * The operation is not supported" veriyor (Mailbox 1.8 ister; bu sunucu 1.5).
   *
   * Bu yuzden §5.5'teki "ek yok" IDDIASI KURULMAZ - dogrulugunu bilemeyiz.
   * Yerine HATIRLATMA yazilir: govdede "ekte" gecerse kullaniciya sorulur.
   * Yanlis iddia yok; ek zaten eklenmisse bedeli tek bir sessiz satirdir.
   */
  function yazmaEkHatirlatmasi() {
    var not = el('ekNotu');
    if (!not) { return; }

    govdeOkuTaze(function (basarili, metin) {
      if (!basarili || !metin) {
        not.className = 'not amber gizli';
        return;
      }
      var sade = sadelestir(metin);
      var i;
      for (i = 0; i < EK_SOZCUKLERI.length; i++) {
        if (sozcukGecerMi(sade, EK_SOZCUKLERI[i])) {
          not.className = 'not amber';
          not.textContent = 'Metinde "ekte" geçiyor — eklediğinizden emin olun.';
          olcumSay("ek_hatirlatmasi");
          return;
        }
      }
      not.className = 'not amber gizli';
    });
  }

  /* ---------------- §5.7 kapatma hakki ----------------
   * Tek anahtar: "Ajani kapat". Tercih roamingSettings'te, yani kullanicinin
   * KENDI posta kutusunda durur (§4.4 V1) - sunucumuzda kullanici basina hicbir
   * kayit tutulmaz (K2). Saklanan tek sey bir boolean'dir; icerik degildir.
   *
   * Kapaliyken panel acilsa bile: oge OKUNMAZ, pasif kontrol calismaz, hicbir
   * dugme gosterilmez, servise icerik gitmez. Giden tek sey sayactir (yalniz sayi).
   */
  var KAPALI_ANAHTARI = 'ajanKapali';
  var kapaliDurum = false;
  var baslatildi = false;

  function kapaliMi() {
    try {
      return Office.context.roamingSettings.get(KAPALI_ANAHTARI) === true;
    } catch (e) {
      return false;
    }
  }

  function kapaliKaydet(deger, bitince) {
    try {
      var ayarlar = Office.context.roamingSettings;
      if (deger) { ayarlar.set(KAPALI_ANAHTARI, true); } else { ayarlar.remove(KAPALI_ANAHTARI); }
      ayarlar.saveAsync(function (sonuc) {
        bitince(!!sonuc && sonuc.status === Office.AsyncResultStatus.Succeeded);
      });
    } catch (e) {
      bitince(false);
    }
  }

  function kapaliGoster() {
    kapaliDurum = true;
    sinifla('ogeBilgi', 'kart gizli');
    sinifla('okumaEylem', 'eylem gizli');
    sinifla('yukleniyor', 'yukleme gizli');
    sinifla('analizHata', 'durum hata gizli');
    sinifla('sonucAlani', 'gizli');
    sinifla('yazmaAlani', 'gizli');
    sinifla('kapatAlani', 'kapatAlani gizli');
    sinifla('kapaliAlani', 'kart');
    durum('bekle', 'Ajan kapalı.');
  }

  function kapatTiklandi() {
    if (istekSuruyor || uretimSuruyor || kontrolSuruyor) {
      durum('bekle', 'Süren işlem bitince kapatabilirsiniz.');
      return;
    }
    kapaliKaydet(true, function (basarili) {
      if (!basarili) {
        durum('hata', 'Tercih kaydedilemedi; ajan açık kaldı.');
        return;
      }
      olcumSay('ajan_kapatildi');
      kapaliGoster();
    });
  }

  function acTiklandi() {
    kapaliKaydet(false, function (basarili) {
      if (!basarili) {
        durum('hata', 'Tercih kaydedilemedi; ajan kapalı kaldı.');
        return;
      }
      olcumSay('ajan_acildi');
      kapaliDurum = false;
      sinifla('kapaliAlani', 'kart gizli');
      sinifla('kapatAlani', 'kapatAlani');
      if (!baslatildi) {
        ogeyiBaslat();
        return;
      }
      /* Ayni panel oturumunda kapatilip acildi: gizlenenleri geri getir. */
      sinifla('ogeBilgi', 'kart');
      if (yazmaKipi) {
        sinifla('yazmaAlani', '');
      } else {
        sinifla('okumaEylem', 'eylem');
        if (cozumlendi) { sinifla('sonucAlani', ''); }
      }
      durum('tamam', 'Ajan açık.');
    });
  }

  /* ---------------- acilis ---------------- */

  /* Faz 2'deki acilis akisi - satir satir aynidir. */
  function okumaBaslat() {
    olcumSay("panel_acildi_okuma");
    ogeyiGoster();
    aliciKontrolu();
    sekmeleriBagla();

    var d = el('ozetleDugme');
    if (d) { d.onclick = ozetleTiklandi; }

    durum('tamam', 'Panel hazır — öğe okundu, pasif kontroller yapıldı.');

    /* Govde yalniz ek kontrolu ve sonraki cozumleme icin bellekte tutulur. */
    govdeOku(function () {
      ekKontrolu();
      dugmeyiKilitle(false, 'Özetle');
    });
  }

  function baslat() {
    var kapat = el('kapatDugme');
    if (kapat) { kapat.onclick = kapatTiklandi; }
    var ac = el('acDugme');
    if (ac) { ac.onclick = acTiklandi; }

    /* Kapaliysa oge HIC okunmaz. */
    if (kapaliMi()) {
      olcumSay('panel_acildi_kapali');
      kapaliGoster();
      return;
    }
    sinifla('kapatAlani', 'kapatAlani');
    ogeyiBaslat();
  }

  function ogeyiBaslat() {
    try {
      baslatildi = true;
      oge = Office.context.mailbox.item;
      if (!oge) {
        durum('hata', 'Açık öğe yok — bir ileti seçin.');
        return;
      }

      /* Kip tespiti (olculdu): body.setAsync varsa YAZMA, yoksa OKUMA. */
      yazmaKipi = !!(oge.body && typeof oge.body.setAsync === 'function');

      if (yazmaKipi) {
        yazmaBaslat();
      } else {
        okumaBaslat();
      }
    } catch (e) {
      durum('hata', 'Beklenmeyen hata: ' + (e && e.message ? e.message : 'bilinmeyen'));
    }
  }

  if (typeof Office === 'undefined') {
    durum('hata', 'office.js yüklenemedi.');
    return;
  }

  Office.onReady(function (bilgi) {
    if (!bilgi || bilgi.host !== Office.HostType.Outlook) {
      durum('hata', 'Bu panel Outlook dışında çalışmaz.');
      return;
    }
    baslat();
  });
})();
