/*
 * A cagrisi (§3.2) DEGERLENDIRME KOSUMU
 *
 * Amac: sistem promptunun EN ve TR surumlerini sabit bir beklenti setine karsi
 * puanlamak, boylece prompt degisiklikleri tahmin degil olcum haline gelsin.
 *
 * Kullanim:
 *   node eval/kosum.js [en|tr|her-ikisi] [tekrar-sayisi]
 *   varsayilan: her-ikisi 1
 *
 * K9: tek mail = tek istek. Backend (:4444) KULLANILMAZ, model dogrudan cagrilir.
 * PROMPT SIRASI BILINCLIDIR: [sistem] -> [mail govdesi] -> [goreve ozel talimat]
 * Talimat basa alinirsa prefix cache kazanci kaybolur; bu sira tools/call-a.js
 * ile birebir aynidir ve DEGISTIRILMEMELIDIR.
 *
 * K10: yalniz test-data/ altindaki SENTETIK veriyle calisir.
 * Guvenlik: API anahtari hicbir yere yazilmaz, basilmaz, log'lanmaz.
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var ESZAMANLI = 3;          // ayni anda en fazla 3 istek - API'yi dovmemek icin
var DENEME_HAKKI = 2;       // senaryo basina toplam deneme sayisi

// ---------------------------------------------------------------- yapilandirma
var cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/llm.lab.json'), 'utf8')).llm;
var API_ANAHTARI = fs.readFileSync(path.join(ROOT, cfg.apiKeyFile), 'utf8').trim();
var sema = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/sema-A.json'), 'utf8'));
var gorev = fs.readFileSync(path.join(ROOT, 'prompts/task-A.txt'), 'utf8');
var beklentiler = JSON.parse(fs.readFileSync(path.join(__dirname, 'beklentiler.json'), 'utf8')).senaryolar;

var sistemMetni = {
  en: fs.readFileSync(path.join(ROOT, 'prompts/system-A.en.txt'), 'utf8'),
  tr: fs.readFileSync(path.join(ROOT, 'prompts/system-A.tr.txt'), 'utf8')
};

// Anahtarin yanlislikla ciktiya sizmasini engelleyen tek suzgec.
function maskele(s) {
  s = String(s === undefined || s === null ? '' : s);
  if (API_ANAHTARI && API_ANAHTARI.length > 6) s = s.split(API_ANAHTARI).join('***');
  return s;
}

// ------------------------------------------------------------------ argumanlar
var argDil = (process.argv[2] || 'her-ikisi').toLowerCase();
var argTekrar = parseInt(process.argv[3] || '1', 10);
if (!isFinite(argTekrar) || argTekrar < 1) argTekrar = 1;
var DILLER = argDil === 'en' ? ['en'] : argDil === 'tr' ? ['tr'] : ['en', 'tr'];
if (['en', 'tr', 'her-ikisi'].indexOf(argDil) < 0) {
  console.log('Bilinmeyen arguman: ' + argDil + '  (en | tr | her-ikisi bekleniyor)');
  process.exit(1);
}

var SENARYOLAR = Object.keys(beklentiler).filter(function (id) {
  return fs.existsSync(path.join(ROOT, 'test-data/' + id + '.json'));
});

// ------------------------------------------------------- Turkce duyarli kucultme
// Standart toLowerCase 'I' -> 'i' yapar; Turkce'de 'I' -> 'ı' olmalidir.
function kucult(s) {
  return String(s || '').replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
}

// -------------------------------------------------------- zinciri duz metne cevir
// tools/call-a.js ile BIREBIR ayni gosterim - karsilastirilabilirlik icin sart.
function kisiler(a) {
  return (a || []).map(function (p) { return p.ad + ' <' + p.eposta + '>'; }).join(', ');
}
function govdeUret(veri) {
  return 'Konu: ' + veri.konu + '\n\n' + veri.mesajlar.map(function (m) {
    return '--- Mesaj ' + m.sira + ' ---\n' +
      'Kimden: ' + m.kimden.ad + ' <' + m.kimden.eposta + '>\n' +
      'Kime: ' + kisiler(m.kime) + '\n' +
      (m.cc && m.cc.length ? 'CC: ' + kisiler(m.cc) + '\n' : '') +
      'Tarih: ' + m.tarih + '\n\n' + m.govde;
  }).join('\n\n');
}

// ----------------------------------------------------------------- JSON cikarma
function jsonCikar(s) {
  if (!s) return null;
  s = s.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  var i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j < 0) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
}

// ------------------------------------------------------------- sema dogrulamasi
function semaDogrula(o) {
  var hatalar = [];
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['JSON nesnesi ayristirilamadi'];
  sema.alanlar.forEach(function (a) { if (!(a in o)) hatalar.push('eksik alan: ' + a); });
  Object.keys(sema.enum).forEach(function (a) {
    if (a in o && sema.enum[a].indexOf(o[a]) < 0) hatalar.push('enum disi ' + a + '=' + JSON.stringify(o[a]));
  });
  ['action_items', 'questions'].forEach(function (a) {
    if (a in o && !Array.isArray(o[a])) hatalar.push(a + ' dizi degil');
    else if (Array.isArray(o[a]) && o[a].some(function (x) { return typeof x !== 'string'; })) hatalar.push(a + ' icinde metin olmayan eleman var');
  });
  if ('reply_needed' in o && typeof o.reply_needed !== 'boolean') hatalar.push('reply_needed boolean degil');
  if ('summary' in o && typeof o.summary !== 'string') hatalar.push('summary metin degil');
  return hatalar;
}

// ------------------------------------------------------- uydurma (halusinasyon) tespiti
// Buyuk harfle baslayan ama kaynak metinde HIC gecmeyen ozel-ad adaylarini yakalar.
// Cumle basi sozcukler ve takvim/kurum sozcukleri eleme listesindedir.
var ELEME = ('pazartesi sali çarşamba perşembe cuma cumartesi pazar ocak şubat mart nisan mayıs haziran ' +
  'temmuz ağustos eylül ekim kasım aralık monday tuesday wednesday thursday friday saturday sunday ' +
  'january february march april may june july august september october november december ' +
  'bey hanım bay bayan sayın konu kimden kime mesaj tarih bu şu bir ve veya ama fakat ancak ' +
  'the and for with from this that please note subject dear best kind regards hi hello ' +
  'ayrıca yarın bugün dün hafta ay yıl gün saat tamam evet hayır toplantı rapor sipariş fatura ' +
  'depo gümrük müşteri tedarikçi sözleşme teslim sevkiyat operasyon satınalma muhasebe ' +
  'it ik crm erp api atr').split(/\s+/);

function ozelAdAdaylari(metin) {
  var adaylar = [];
  // Cumle sonu isaretlerinden sonra gelen ilk sozcuk "cumle basi" sayilir.
  var parcalar = String(metin || '').split(/(?:^|[.!?;:\n]\s*)/);
  parcalar.forEach(function (p) {
    var tokenlar = p.split(/[^A-Za-zÇĞİÖŞÜçğıöşüâîû'’]+/).filter(Boolean);
    tokenlar.forEach(function (t, i) {
      // Turkce'de ozel adlara kesme isaretiyle ek gelir: "Korkmaz'ın" -> govde "Korkmaz".
      var govde = t.split(/['’]/)[0];
      if (i === 0) return;                                  // cumle basi -> atla
      if (!/^[A-ZÇĞİÖŞÜ][a-zçğıöşüâîû]{2,}$/.test(govde)) return;
      if (ELEME.indexOf(kucult(govde)) >= 0) return;
      if (adaylar.indexOf(govde) < 0) adaylar.push(govde);
    });
  });
  return adaylar;
}

function uydurmaTespit(cikti, kaynakMetin, yasakli) {
  var bulgular = [];
  var kaynakK = kucult(kaynakMetin);
  var ozet = typeof cikti.summary === 'string' ? cikti.summary : '';

  // 1) Beklenti dosyasindaki yasakli ifadeler ozette geciyor mu?
  (yasakli || []).forEach(function (y) {
    if (kucult(ozet).indexOf(kucult(y)) >= 0) bulgular.push('ozette yasakli ifade: "' + y + '"');
  });

  // 2) Aksiyon maddelerinde kaynakta olmayan ozel ad var mi?
  (Array.isArray(cikti.action_items) ? cikti.action_items : []).forEach(function (a, i) {
    if (typeof a !== 'string') return;
    ozelAdAdaylari(a).forEach(function (ad) {
      if (kaynakK.indexOf(kucult(ad)) < 0) {
        bulgular.push('aksiyon #' + (i + 1) + ' kaynakta olmayan ad: "' + ad + '"');
      }
    });
  });

  return bulgular;
}

// ------------------------------------------------------------------- puanlama
// sema sert kapidir: gecersizse tum puan sifirdir.
var AGIRLIK = { sema: 20, lang: 10, kategori: 15, oncelik: 10, reply_needed: 10, soru: 15, aksiyon: 10, uydurma: 10 };

function puanla(cikti, beklenti, kaynakMetin) {
  var semaHatalari = semaDogrula(cikti);
  var k = {
    sema: semaHatalari.length === 0,
    lang: false, kategori: false, oncelik: false, reply_needed: false,
    soru: false, aksiyon: false, uydurma: false
  };
  var bulgular = [];
  if (!k.sema) {
    return { kriterler: k, puan: 0, semaHatalari: semaHatalari, bulgular: [], sayilar: {} };
  }

  k.lang = cikti.lang === beklenti.lang;
  k.kategori = beklenti.kategori_kabul.indexOf(cikti.category) >= 0;
  k.oncelik = cikti.priority >= beklenti.oncelik_min && cikti.priority <= beklenti.oncelik_max;
  k.reply_needed = cikti.reply_needed === beklenti.reply_needed;

  var soruSayisi = cikti.questions.length;
  var aksiyonSayisi = cikti.action_items.length;
  k.soru = soruSayisi >= beklenti.soru_min && soruSayisi <= beklenti.soru_max;
  k.aksiyon = aksiyonSayisi >= beklenti.aksiyon_min && aksiyonSayisi <= beklenti.aksiyon_max;

  bulgular = uydurmaTespit(cikti, kaynakMetin, beklenti.yasakli_ifadeler);
  k.uydurma = bulgular.length === 0;

  var puan = 0;
  Object.keys(AGIRLIK).forEach(function (a) { if (k[a]) puan += AGIRLIK[a]; });

  return {
    kriterler: k, puan: puan, semaHatalari: [], bulgular: bulgular,
    sayilar: { soru: soruSayisi, aksiyon: aksiyonSayisi }
  };
}

// --------------------------------------------------------------- model cagrisi
function modelCagir(sistem, kullanici) {
  var t0 = Date.now();
  return fetch(cfg.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + API_ANAHTARI, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({
      model: cfg.model,
      // SIRA: sistem -> [govde + gorev]. Govde once, talimat sonra (prefix cache).
      messages: [{ role: 'system', content: sistem }, { role: 'user', content: kullanici }],
      temperature: 0.2,
      max_tokens: cfg.maxTokens || 3000
    }, cfg.extraBody || {}))
  }).then(function (r) { return r.json(); }).then(function (r) {
    if (r.error) throw new Error('API: ' + (r.error.message || 'bilinmeyen hata'));
    if (!r.choices || !r.choices[0]) throw new Error('API: choices bos dondu');
    var u = r.usage || {};
    return {
      ham: r.choices[0].message.content,
      sure: Date.now() - t0,
      girdiToken: u.prompt_tokens || 0,
      ciktiToken: u.completion_tokens || 0,
      bitis: r.choices[0].finish_reason || '?'
    };
  });
}

function tekKosum(senaryoId, dil, tekrar) {
  var veri = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-data/' + senaryoId + '.json'), 'utf8'));
  var govde = govdeUret(veri);
  var kullanici = govde + '\n\n' + gorev;
  var beklenti = beklentiler[senaryoId];

  function dene(kalan) {
    return modelCagir(sistemMetni[dil], kullanici).then(function (c) {
      var o = jsonCikar(c.ham);
      var s = puanla(o, beklenti, govde);
      return {
        senaryo: senaryoId, dil: dil, tekrar: tekrar, hata: null,
        sure: c.sure, girdiToken: c.girdiToken, ciktiToken: c.ciktiToken, bitis: c.bitis,
        cikti: o ? {
          lang: o.lang, category: o.category, priority: o.priority,
          reason_code: o.reason_code, reply_needed: o.reply_needed,
          soru_sayisi: Array.isArray(o.questions) ? o.questions.length : null,
          aksiyon_sayisi: Array.isArray(o.action_items) ? o.action_items.length : null
        } : null,
        kriterler: s.kriterler, puan: s.puan,
        sema_hatalari: s.semaHatalari, uydurma_bulgulari: s.bulgular
      };
    }).catch(function (e) {
      if (kalan > 1) return dene(kalan - 1);
      return {
        senaryo: senaryoId, dil: dil, tekrar: tekrar, hata: maskele(e && e.message),
        sure: 0, girdiToken: 0, ciktiToken: 0, bitis: 'hata',
        cikti: null,
        kriterler: { sema: false, lang: false, kategori: false, oncelik: false, reply_needed: false, soru: false, aksiyon: false, uydurma: false },
        puan: 0, sema_hatalari: ['istek basarisiz'], uydurma_bulgulari: []
      };
    });
  }
  return dene(DENEME_HAKKI);
}

// ------------------------------------------------- sinirli esrzamanlilik havuzu
function havuzdaKosur(isler, sinir) {
  var sonuclar = new Array(isler.length);
  var sonraki = 0;
  function isci() {
    if (sonraki >= isler.length) return Promise.resolve();
    var i = sonraki++;
    return isler[i]().then(function (r) {
      sonuclar[i] = r;
      var d = r.hata ? 'HATA' : (r.puan.toFixed(0) + '/100');
      process.stderr.write('  [' + (i + 1) + '/' + isler.length + '] ' + r.dil + ' ' + r.senaryo + ' -> ' + d + '\n');
      return isci();
    });
  }
  var isciler = [];
  for (var n = 0; n < Math.min(sinir, isler.length); n++) isciler.push(isci());
  return Promise.all(isciler).then(function () { return sonuclar; });
}

// ---------------------------------------------------------------- tablo cizimi
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s.slice(0, Math.max(n, s.length)); }
function padL(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
function isaret(b) { return b ? '+' : '-'; }

var SENARYO_GEN = 18;

function dilTablosu(dil, satirlar) {
  var s = '';
  s += '\n--- SISTEM PROMPT: ' + dil.toUpperCase() + ' ---\n';
  s += pad('SENARYO', SENARYO_GEN) + ' SEMA DIL KAT ONC YNT SOR AKS UYD ' + padL('PUAN', 7) + padL('SURE(ms)', 10) + padL('TOKEN', 8) + '\n';
  s += new Array(SENARYO_GEN + 52).join('-') + '\n';
  satirlar.forEach(function (r) {
    s += pad(r.senaryo, SENARYO_GEN) + ' ' +
      padL(r.kriterler.sema ? 'OK' : 'RED', 4) + ' ' +
      padL(isaret(r.kriterler.lang), 3) + ' ' +
      padL(isaret(r.kriterler.kategori), 3) + ' ' +
      padL(isaret(r.kriterler.oncelik), 3) + ' ' +
      padL(isaret(r.kriterler.reply_needed), 3) + ' ' +
      padL(isaret(r.kriterler.soru), 3) + ' ' +
      padL(isaret(r.kriterler.aksiyon), 3) + ' ' +
      padL(isaret(r.kriterler.uydurma), 3) + ' ' +
      padL(r.puan.toFixed(1), 7) + padL(r.sure, 10) + padL(r.girdiToken + r.ciktiToken, 8) + '\n';
  });
  return s;
}

// ------------------------------------------------------------------------ ana
(function ana() {
  var isler = [];
  DILLER.forEach(function (dil) {
    SENARYOLAR.forEach(function (id) {
      for (var t = 1; t <= argTekrar; t++) {
        (function (i, d, tt) { isler.push(function () { return tekKosum(i, d, tt); }); })(id, dil, t);
      }
    });
  });

  process.stderr.write('Model: ' + cfg.model + '  senaryo=' + SENARYOLAR.length +
    '  dil=' + DILLER.join(',') + '  tekrar=' + argTekrar +
    '  toplam istek=' + isler.length + '  esrzamanli=' + ESZAMANLI + '\n');

  havuzdaKosur(isler, ESZAMANLI).then(function (tumSonuclar) {
    var zaman = new Date();
    var damga = zaman.toISOString().replace(/[:.]/g, '-').replace('Z', '');
    var ozet = { dil: {}, senaryo: {} };
    var cikti = '';

    // --- dil bazli ortalama, her senaryo icin tekrarlarin ortalamasi
    DILLER.forEach(function (dil) {
      var dilSonuc = tumSonuclar.filter(function (r) { return r.dil === dil; });
      var satirlar = SENARYOLAR.map(function (id) {
        var g = dilSonuc.filter(function (r) { return r.senaryo === id; });
        var ort = function (f) { return g.reduce(function (a, r) { return a + f(r); }, 0) / (g.length || 1); };
        // Tekrarlarda kriter isareti: tum tekrarlarda dogruysa '+' sayilir.
        var kr = {};
        Object.keys(AGIRLIK).forEach(function (a) {
          kr[a] = g.length > 0 && g.every(function (r) { return r.kriterler[a]; });
        });
        return {
          senaryo: id, kriterler: kr,
          puan: ort(function (r) { return r.puan; }),
          sure: Math.round(ort(function (r) { return r.sure; })),
          girdiToken: Math.round(ort(function (r) { return r.girdiToken; })),
          ciktiToken: Math.round(ort(function (r) { return r.ciktiToken; })),
          hatali: g.filter(function (r) { return r.hata; }).length
        };
      });

      var toplamPuan = satirlar.reduce(function (a, r) { return a + r.puan; }, 0);
      var ortPuan = toplamPuan / (satirlar.length || 1);
      var toplamSure = dilSonuc.reduce(function (a, r) { return a + r.sure; }, 0);
      var toplamGirdi = dilSonuc.reduce(function (a, r) { return a + r.girdiToken; }, 0);
      var toplamCikti = dilSonuc.reduce(function (a, r) { return a + r.ciktiToken; }, 0);
      var semaRed = dilSonuc.filter(function (r) { return !r.kriterler.sema; }).length;
      var uydurmaSayisi = dilSonuc.reduce(function (a, r) { return a + r.uydurma_bulgulari.length; }, 0);

      ozet.dil[dil] = {
        ortalama_puan: +ortPuan.toFixed(2),
        toplam_puan: +toplamPuan.toFixed(1),
        azami_puan: satirlar.length * 100,
        sema_red_sayisi: semaRed,
        uydurma_bulgu_sayisi: uydurmaSayisi,
        hatali_istek: dilSonuc.filter(function (r) { return r.hata; }).length,
        toplam_sure_ms: toplamSure,
        toplam_girdi_token: toplamGirdi,
        toplam_cikti_token: toplamCikti,
        toplam_token: toplamGirdi + toplamCikti
      };
      ozet.senaryo[dil] = satirlar;

      cikti += dilTablosu(dil, satirlar);
      cikti += new Array(SENARYO_GEN + 52).join('-') + '\n';
      cikti += pad('ORTALAMA / TOPLAM', SENARYO_GEN) + '                                 ' +
        padL(ortPuan.toFixed(1), 7) + padL(toplamSure, 10) + padL(toplamGirdi + toplamCikti, 8) + '\n';
      cikti += 'sema reddi=' + semaRed + '  uydurma bulgusu=' + uydurmaSayisi +
        '  basarisiz istek=' + ozet.dil[dil].hatali_istek +
        '  girdi token=' + toplamGirdi + '  cikti token=' + toplamCikti + '\n';
    });

    // --- karsilastirma tablosu
    if (DILLER.length === 2) {
      cikti += '\n--- KARSILASTIRMA (senaryo bazinda puan) ---\n';
      cikti += pad('SENARYO', SENARYO_GEN) + padL('EN', 8) + padL('TR', 8) + padL('FARK', 9) + '  NOT\n';
      cikti += new Array(SENARYO_GEN + 34).join('-') + '\n';
      SENARYOLAR.forEach(function (id) {
        var e = ozet.senaryo.en.filter(function (r) { return r.senaryo === id; })[0];
        var t = ozet.senaryo.tr.filter(function (r) { return r.senaryo === id; })[0];
        var f = e.puan - t.puan;
        var not = Math.abs(f) < 0.01 ? 'esit' : (f > 0 ? 'EN daha iyi' : 'TR daha iyi');
        cikti += pad(id, SENARYO_GEN) + padL(e.puan.toFixed(1), 8) + padL(t.puan.toFixed(1), 8) +
          padL((f >= 0 ? '+' : '') + f.toFixed(1), 9) + '  ' + not + '\n';
      });
      cikti += new Array(SENARYO_GEN + 34).join('-') + '\n';
      cikti += pad('ORTALAMA', SENARYO_GEN) +
        padL(ozet.dil.en.ortalama_puan.toFixed(1), 8) +
        padL(ozet.dil.tr.ortalama_puan.toFixed(1), 8) +
        padL(((ozet.dil.en.ortalama_puan - ozet.dil.tr.ortalama_puan) >= 0 ? '+' : '') +
          (ozet.dil.en.ortalama_puan - ozet.dil.tr.ortalama_puan).toFixed(1), 9) + '\n';
    }

    // --- bulgular
    var bulguSatirlari = [];
    tumSonuclar.forEach(function (r) {
      if (r.hata) bulguSatirlari.push('[' + r.dil + '/' + r.senaryo + '#' + r.tekrar + '] ISTEK HATASI: ' + r.hata);
      (r.sema_hatalari || []).forEach(function (h) {
        bulguSatirlari.push('[' + r.dil + '/' + r.senaryo + '#' + r.tekrar + '] SEMA: ' + h);
      });
      (r.uydurma_bulgulari || []).forEach(function (h) {
        bulguSatirlari.push('[' + r.dil + '/' + r.senaryo + '#' + r.tekrar + '] UYDURMA SUPHESI: ' + h);
      });
      if (r.cikti) {
        if (!r.kriterler.lang) bulguSatirlari.push('[' + r.dil + '/' + r.senaryo + '#' + r.tekrar + '] DIL: ' + r.cikti.lang + ' (beklenen ' + beklentiler[r.senaryo].lang + ')');
        if (!r.kriterler.kategori) bulguSatirlari.push('[' + r.dil + '/' + r.senaryo + '#' + r.tekrar + '] KATEGORI: ' + r.cikti.category + ' (kabul: ' + beklentiler[r.senaryo].kategori_kabul.join('/') + ')');
        if (!r.kriterler.oncelik) bulguSatirlari.push('[' + r.dil + '/' + r.senaryo + '#' + r.tekrar + '] ONCELIK: ' + r.cikti.priority + ' (bant ' + beklentiler[r.senaryo].oncelik_min + '-' + beklentiler[r.senaryo].oncelik_max + ')');
        if (!r.kriterler.reply_needed) bulguSatirlari.push('[' + r.dil + '/' + r.senaryo + '#' + r.tekrar + '] YANIT: ' + r.cikti.reply_needed + ' (beklenen ' + beklentiler[r.senaryo].reply_needed + ')');
        if (!r.kriterler.soru) bulguSatirlari.push('[' + r.dil + '/' + r.senaryo + '#' + r.tekrar + '] SORU SAYISI: ' + r.cikti.soru_sayisi + ' (bant ' + beklentiler[r.senaryo].soru_min + '-' + beklentiler[r.senaryo].soru_max + ')');
        if (!r.kriterler.aksiyon) bulguSatirlari.push('[' + r.dil + '/' + r.senaryo + '#' + r.tekrar + '] AKSIYON SAYISI: ' + r.cikti.aksiyon_sayisi + ' (bant ' + beklentiler[r.senaryo].aksiyon_min + '-' + beklentiler[r.senaryo].aksiyon_max + ')');
      }
    });
    cikti += '\n--- BULGULAR (' + bulguSatirlari.length + ') ---\n';
    cikti += bulguSatirlari.length ? bulguSatirlari.join('\n') + '\n' : 'Bulgu yok.\n';

    // --- hukum satiri
    cikti += '\n--- HUKUM ---\n';
    DILLER.forEach(function (d) {
      var o = ozet.dil[d];
      cikti += d.toUpperCase() + ': ortalama puan ' + o.ortalama_puan.toFixed(1) + '/100  |  ' +
        'toplam sure ' + o.toplam_sure_ms + ' ms  |  token ' + o.toplam_token +
        ' (girdi ' + o.toplam_girdi_token + ' / cikti ' + o.toplam_cikti_token + ')\n';
    });

    var hukum;
    if (DILLER.length === 2) {
      var fe = ozet.dil.en.ortalama_puan, ft = ozet.dil.tr.ortalama_puan;
      var fark = Math.abs(fe - ft);
      var kazanan = fe > ft ? 'EN' : ft > fe ? 'TR' : 'BERABERE';
      var guven = argTekrar < 3
        ? 'tekrar=' + argTekrar + ' oldugu icin bu fark GURULTU OLABILIR, anlamli sayilmamalidir'
        : (fark >= 5 ? 'fark >= 5 puan, kayda deger' : 'fark < 5 puan, gurultu araligi');
      hukum = kazanan === 'BERABERE'
        ? 'HUKUM: EN ve TR sistem promptlari esit puan aldi (' + fe.toFixed(1) + '/100). [' + guven + ']'
        : 'HUKUM: ' + kazanan + ' sistem promptu daha yuksek puan aldi -- ' +
          fe.toFixed(1) + ' (EN) vs ' + ft.toFixed(1) + ' (TR), fark ' + fark.toFixed(1) +
          ' puan (' + kazanan + ' lehine). [' + guven + ']';
    } else {
      hukum = 'HUKUM: tek dil kosuldu (' + DILLER[0].toUpperCase() + '), ortalama puan ' +
        ozet.dil[DILLER[0]].ortalama_puan.toFixed(1) + '/100. Karsilastirma icin "her-ikisi" ile kosun.';
    }
    cikti += hukum + '\n';

    // --- makine okunur cikti (anahtar ASLA yazilmaz)
    var dosya = path.join(__dirname, 'sonuc-' + damga + '.json');
    fs.writeFileSync(dosya, JSON.stringify({
      _not: 'A cagrisi degerlendirme sonucu. Sentetik veri (test-data/). API anahtari bu dosyada yer almaz.',
      zaman: zaman.toISOString(),
      model: cfg.model,
      diller: DILLER,
      tekrar: argTekrar,
      agirliklar: AGIRLIK,
      ozet: ozet.dil,
      senaryo_ozeti: ozet.senaryo,
      kosumlar: tumSonuclar,
      hukum: hukum
    }, null, 2), 'utf8');

    console.log('=== A CAGRISI DEGERLENDIRME ===');
    console.log('model=' + cfg.model + '  senaryo=' + SENARYOLAR.length + '  dil=' + DILLER.join(',') +
      '  tekrar=' + argTekrar + '  veri=test-data/ (SENTETIK)');
    console.log(cikti);
    console.log('Ayrintili sonuc: ' + dosya);
  }).catch(function (e) {
    console.log('KOSUM HATASI: ' + maskele(e && e.stack ? e.stack : e));
    process.exit(1);
  });
})();
