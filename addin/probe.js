/* Yetenek Ölçümü - Faz 0 doğrulama çivisi (ölçüm aracı)
 *
 * Kurallar:
 *  - Hiçbir yetenek varsayılmaz; her şey çalışma anında ölçülür.
 *  - Her ölçüm kendi try/catch bloğundadır; bir ölçümün patlaması diğerlerini engellemez.
 *  - Tüm eşzamansız çağrılar 10 saniyede zaman aşımına uğrar.
 *  - GÜVENLİK: belirteçler ve posta gövdesi içeriği asla tam olarak DOM'a yazılmaz,
 *    asla console'a yazılmaz. Belirteçler yalnızca uzunluk + ilk 12 karakter olarak raporlanır.
 *  - Saf ES5: ok işlevi, şablon dizesi, blok kapsamlı değişken, eşzamansız işlev yok.
 */
/* global Office */
(function () {
  'use strict';

  var TIMEOUT_MS = 10000;
  var BOOT_TIMEOUT_MS = 15000;
  var TOKEN_PREFIX_LEN = 12;
  var DETAIL_MAX = 400;

  var MAILBOX_SETS = ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7',
                      '1.8', '1.9', '1.10', '1.11', '1.12', '1.13', '1.14'];

  var ITEM_MEMBERS = ['body', 'subject', 'from', 'to', 'cc', 'attachments',
                      'itemType', 'conversationId', 'internetMessageId', 'dateTimeCreated'];

  var VERDICT_OK = 'VAR';
  var VERDICT_NO = 'YOK';
  var VERDICT_ERR = 'HATA';

  var started = false;
  var bootTimer = null;
  var readyInfo = null;
  var sections = [];
  var resultsEl = null;
  var statusEl = null;
  var envEl = null;

  /* ---------------------------------------------------------------- yardımcılar */

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(node, value) {
    if (!node) { return; }
    if (typeof node.textContent !== 'undefined') {
      node.textContent = value;
    } else {
      node.innerText = value;
    }
  }

  function make(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) { node.className = cls; }
    if (typeof text !== 'undefined' && text !== null) { setText(node, text); }
    return node;
  }

  function clip(value, max) {
    var s;
    try {
      s = String(value);
    } catch (e) {
      return '(dizeye çevrilemedi)';
    }
    if (s.length <= max) { return s; }
    return s.substring(0, max) + ' … (kısaltıldı, toplam ' + s.length + ' karakter)';
  }

  function txt(value) {
    if (value === null) { return '(null)'; }
    if (typeof value === 'undefined') { return '(tanımsız)'; }
    if (typeof value === 'string') {
      return value.length ? clip(value, DETAIL_MAX) : '(boş metin)';
    }
    return clip(value, DETAIL_MAX);
  }

  function errText(e) {
    if (!e) { return 'bilinmeyen hata'; }
    var parts = [];
    try {
      if (typeof e.code !== 'undefined' && e.code !== null && e.code !== '') {
        parts.push('kod ' + e.code);
      }
      if (e.name) { parts.push(String(e.name)); }
      if (e.message) { parts.push(String(e.message)); }
    } catch (inner) {
      parts.push('(hata nesnesi okunamadı)');
    }
    if (!parts.length) {
      try { parts.push(String(e)); } catch (x) { parts.push('(çözümlenemedi)'); }
    }
    return clip(parts.join(' | '), DETAIL_MAX);
  }

  function succeeded(result) {
    if (!result) { return false; }
    try {
      if (typeof Office !== 'undefined' && Office.AsyncResultStatus &&
          result.status === Office.AsyncResultStatus.Succeeded) {
        return true;
      }
      return String(result.status).toLowerCase() === 'succeeded';
    } catch (e) {
      return false;
    }
  }

  function asyncErr(result) {
    if (result && result.error) { return errText(result.error); }
    if (result) { return 'durum: ' + txt(result.status); }
    return 'sonuç nesnesi gelmedi';
  }

  /* GÜVENLİK: belirteç metni buradan dışarı çıkmaz. */
  function tokenInfo(token) {
    if (typeof token !== 'string') {
      return 'belirteç alındı fakat metin değil (tür: ' + (typeof token) + ')';
    }
    if (!token.length) {
      return 'belirteç boş geldi (uzunluk 0)';
    }
    return 'uzunluk ' + token.length + ' karakter | ilk ' + TOKEN_PREFIX_LEN + ': ' +
           token.substring(0, TOKEN_PREFIX_LEN) + '… (gerisi bilerek gizlendi)';
  }

  function mailbox() {
    if (typeof Office === 'undefined') { throw new Error('Office nesnesi yok (office.js yüklenmedi)'); }
    if (!Office.context) { throw new Error('Office.context yok'); }
    if (!Office.context.mailbox) { throw new Error('Office.context.mailbox yok'); }
    return Office.context.mailbox;
  }

  function currentItem() {
    var mb = mailbox();
    if (!mb.item) { throw new Error('Office.context.mailbox.item yok (açık öğe bulunamadı)'); }
    return mb.item;
  }

  /* ---------------------------------------------------------------- çizim */

  function addSection(title) {
    var sec = { title: title, rows: [], notes: [] };
    var wrap = make('div', 'section');
    wrap.appendChild(make('h2', null, title));
    var body = make('div', 'rows');
    wrap.appendChild(body);
    resultsEl.appendChild(wrap);
    sec.body = body;
    sections.push(sec);
    return sec;
  }

  function addRow(sec, label) {
    var row = { label: label, verdict: '?', detail: 'ölçülüyor…' };
    var node = make('div', 'row');
    node.appendChild(make('span', 'label', label));
    var v = make('span', 'verdict verdict-pending', '…');
    var d = make('span', 'detail', 'ölçülüyor…');
    node.appendChild(v);
    node.appendChild(d);
    sec.body.appendChild(node);
    row.vEl = v;
    row.dEl = d;
    sec.rows.push(row);
    return row;
  }

  function setRow(row, verdict, detail) {
    if (!row) { return; }
    var cls = 'verdict-err';
    if (verdict === VERDICT_OK) { cls = 'verdict-ok'; }
    if (verdict === VERDICT_NO) { cls = 'verdict-no'; }
    row.verdict = verdict;
    row.detail = clip(detail, DETAIL_MAX);
    row.vEl.className = 'verdict ' + cls;
    setText(row.vEl, verdict);
    setText(row.dEl, row.detail);
  }

  function addNote(sec, text, cls) {
    var node = make('div', 'note' + (cls ? ' ' + cls : ''), text);
    sec.body.appendChild(node);
    sec.notes.push(text);
  }

  /* Eşzamanlı ölçüm: kendi try/catch'i içinde çalışır. */
  function measure(sec, label, fn) {
    var row = addRow(sec, label);
    try {
      var r = fn();
      if (!r) {
        setRow(row, VERDICT_ERR, 'ölçüm sonuç döndürmedi');
      } else {
        setRow(row, r.verdict, r.detail);
      }
    } catch (e) {
      setRow(row, VERDICT_ERR, 'istisna: ' + errText(e));
    }
    return row;
  }

  /* Eşzamansız ölçüm koruması: 10 sn sonra zaman aşımı, ilk yanıt kazanır. */
  function guard(row) {
    var settled = false;
    var timer = window.setTimeout(function () {
      if (settled) { return; }
      settled = true;
      setRow(row, VERDICT_ERR, 'zaman aşımı — ' + (TIMEOUT_MS / 1000) +
             ' saniye içinde geri çağrı gelmedi');
    }, TIMEOUT_MS);
    return function (verdict, detail) {
      if (settled) { return; }
      settled = true;
      try { window.clearTimeout(timer); } catch (e) { /* yoksayılır */ }
      setRow(row, verdict, detail);
    };
  }

  function valueVerdict(value, emptyNote) {
    if (typeof value === 'undefined' || value === null || value === '') {
      return { verdict: VERDICT_NO, detail: emptyNote || '(değer yok)' };
    }
    return { verdict: VERDICT_OK, detail: txt(value) };
  }

  function existsVerdict(owner, name) {
    if (!owner) { return { verdict: VERDICT_ERR, detail: 'üst nesne yok' }; }
    var v = owner[name];
    if (typeof v === 'undefined' || v === null) {
      return { verdict: VERDICT_NO, detail: 'üye yok' };
    }
    var kind = typeof v;
    if (kind === 'object' && typeof v.length === 'number' &&
        Object.prototype.toString.call(v) === '[object Array]') {
      return { verdict: VERDICT_OK, detail: 'var (dizi, ' + v.length + ' öğe)' };
    }
    if (kind === 'string' || kind === 'number' || kind === 'boolean') {
      return { verdict: VERDICT_OK, detail: 'var (' + kind + ') = ' + txt(v) };
    }
    return { verdict: VERDICT_OK, detail: 'var (' + kind + ')' };
  }

  function isFn(owner, name) {
    return !!owner && typeof owner[name] === 'function';
  }

  function fnVerdict(owner, name) {
    if (!owner) { return { verdict: VERDICT_ERR, detail: 'üst nesne yok' }; }
    if (isFn(owner, name)) {
      return { verdict: VERDICT_OK, detail: 'işlev olarak mevcut'};
    }
    return { verdict: VERDICT_NO, detail: 'işlev değil / yok (tür: ' + (typeof owner[name]) + ')' };
  }

  function setStatus(text, cls) {
    if (!statusEl) { return; }
    statusEl.className = 'status ' + cls;
    setText(statusEl, text);
  }

  /* ---------------------------------------------------------------- 1. ana uygulama ve platform */

  function probeHost() {
    var sec = addSection('1. Ana uygulama ve platform');
    try {
      measure(sec, 'diagnostics.hostName', function () {
        return valueVerdict(mailbox().diagnostics.hostName);
      });
      measure(sec, 'diagnostics.hostVersion', function () {
        return valueVerdict(mailbox().diagnostics.hostVersion);
      });
      measure(sec, 'diagnostics.OWAView', function () {
        return valueVerdict(mailbox().diagnostics.OWAView,
                            '(yok — yalnızca Outlook on the web bildirir)');
      });
      measure(sec, 'Office.context.platform', function () {
        if (typeof Office === 'undefined' || !Office.context) { throw new Error('Office.context yok'); }
        return valueVerdict(Office.context.platform);
      });
      measure(sec, 'Office.context.contentLanguage', function () {
        return valueVerdict(Office.context.contentLanguage);
      });
      measure(sec, 'Office.context.displayLanguage', function () {
        return valueVerdict(Office.context.displayLanguage);
      });
      measure(sec, 'onReady bilgisi (host/platform)', function () {
        if (!readyInfo) { return { verdict: VERDICT_NO, detail: 'onReady bilgi nesnesi gelmedi' }; }
        return { verdict: VERDICT_OK,
                 detail: 'host=' + txt(readyInfo.host) + ' | platform=' + txt(readyInfo.platform) };
      });
    } catch (e) {
      failSection(sec, 'Ana uygulama ve platform ölçümü', e);
    }
  }

  /* ---------------------------------------------------------------- 2. gereksinim kümeleri */

  function checkSet(sec, version, supported) {
    measure(sec, 'Mailbox ' + version, function () {
      if (typeof Office === 'undefined' || !Office.context || !Office.context.requirements ||
          typeof Office.context.requirements.isSetSupported !== 'function') {
        throw new Error('Office.context.requirements.isSetSupported yok');
      }
      var ok = Office.context.requirements.isSetSupported('Mailbox', version);
      if (ok === true) {
        supported.push(version);
        return { verdict: VERDICT_OK, detail: 'destekleniyor (evet)' };
      }
      return { verdict: VERDICT_NO, detail: 'desteklenmiyor (hayır)' };
    });
  }

  function highestOf(list) {
    var best = null;
    var i, parts, bestParts;
    for (i = 0; i < list.length; i++) {
      parts = String(list[i]).split('.');
      if (best === null) {
        best = list[i];
        bestParts = parts;
      } else if (parseInt(parts[0], 10) > parseInt(bestParts[0], 10) ||
                 (parseInt(parts[0], 10) === parseInt(bestParts[0], 10) &&
                  parseInt(parts[1], 10) > parseInt(bestParts[1], 10))) {
        best = list[i];
        bestParts = parts;
      }
    }
    return best;
  }

  function probeRequirements() {
    var sec = addSection('2. Gereksinim kümeleri — Mailbox (ana ölçüm)');
    try {
      var supported = [];
      var i;
      for (i = 0; i < MAILBOX_SETS.length; i++) {
        checkSet(sec, MAILBOX_SETS[i], supported);
      }
      var best = highestOf(supported);
      measure(sec, 'En yüksek desteklenen Mailbox set', function () {
        if (!best) {
          return { verdict: VERDICT_NO, detail: 'hiçbir sürüm doğrulanamadı' };
        }
        return { verdict: VERDICT_OK,
                 detail: best + ' (toplam ' + supported.length + ' sürüm destekleniyor)' };
      });
      addNote(sec, 'En yüksek desteklenen Mailbox set: ' + (best ? best : 'tespit edilemedi'),
              'note-summary');
    } catch (e) {
      failSection(sec, 'Gereksinim kümesi ölçümü', e);
    }
  }

  /* ---------------------------------------------------------------- 3. kimlik belirteci */

  function probeIdentityToken() {
    var sec = addSection('3. Kimlik belirteci — getUserIdentityTokenAsync');
    var row = addRow(sec, 'getUserIdentityTokenAsync');
    var done = null;
    try {
      var mb = mailbox();
      if (!isFn(mb, 'getUserIdentityTokenAsync')) {
        setRow(row, VERDICT_NO, 'yöntem bu ana uygulamada tanımlı değil');
        return;
      }
      done = guard(row);
      mb.getUserIdentityTokenAsync(function (result) {
        try {
          if (succeeded(result)) {
            done(VERDICT_OK, tokenInfo(result.value));
          } else {
            done(VERDICT_ERR, 'başarısız — ' + asyncErr(result));
          }
        } catch (inner) {
          done(VERDICT_ERR, 'geri çağrı istisnası: ' + errText(inner));
        }
      });
    } catch (e) {
      if (done) {
        done(VERDICT_ERR, 'istisna: ' + errText(e));
      } else {
        setRow(row, VERDICT_ERR, 'istisna: ' + errText(e));
      }
    }
  }

  /* ---------------------------------------------------------------- 4. geri çağrı belirteci */

  function probeCallbackToken() {
    var sec = addSection('4. Geri çağrı belirteci — getCallbackTokenAsync (isRest: true)');
    var row = addRow(sec, 'getCallbackTokenAsync');
    var done = null;
    try {
      var mb = mailbox();
      if (!isFn(mb, 'getCallbackTokenAsync')) {
        setRow(row, VERDICT_NO, 'yöntem bu ana uygulamada tanımlı değil');
      } else {
        done = guard(row);
        mb.getCallbackTokenAsync({ isRest: true }, function (result) {
          try {
            if (succeeded(result)) {
              done(VERDICT_OK, 'REST belirteci alındı | ' + tokenInfo(result.value));
            } else {
              done(VERDICT_ERR, 'başarısız — ' + asyncErr(result));
            }
          } catch (inner) {
            done(VERDICT_ERR, 'geri çağrı istisnası: ' + errText(inner));
          }
        });
      }
      measure(sec, 'mailbox.restUrl', function () {
        return valueVerdict(mailbox().restUrl, '(yok — REST uç noktası bildirilmiyor)');
      });
      measure(sec, 'mailbox.ewsUrl', function () {
        return valueVerdict(mailbox().ewsUrl, '(yok — EWS uç noktası bildirilmiyor)');
      });
    } catch (e) {
      if (done) {
        done(VERDICT_ERR, 'istisna: ' + errText(e));
      } else {
        setRow(row, VERDICT_ERR, 'istisna: ' + errText(e));
      }
    }
  }

  /* ---------------------------------------------------------------- 5. ekler */

  function probeAttachments() {
    var sec = addSection('5. Ekler — getAttachmentContentAsync');
    var row = null;
    var done = null;
    try {
      var it = currentItem();
      measure(sec, 'item.getAttachmentContentAsync', function () {
        return fnVerdict(it, 'getAttachmentContentAsync');
      });
      measure(sec, 'item.attachments', function () {
        return existsVerdict(it, 'attachments');
      });

      row = addRow(sec, 'ilk ek üzerinde gerçek çağrı');
      var list = it.attachments;
      if (!isFn(it, 'getAttachmentContentAsync')) {
        setRow(row, VERDICT_NO, 'test edilemedi — yöntem bu ana uygulamada yok');
        return;
      }
      if (!list || typeof list.length !== 'number' || list.length === 0) {
        setRow(row, VERDICT_NO, 'test edilemedi — açık öğede ek yok');
        return;
      }

      var first = list[0];
      done = guard(row);
      it.getAttachmentContentAsync(first.id, function (result) {
        try {
          if (succeeded(result)) {
            var val = result.value || {};
            var len = (val.content && typeof val.content.length === 'number') ?
                      val.content.length : -1;
            /* GÜVENLİK: ek içeriği asla gösterilmez, yalnızca biçim ve uzunluk. */
            done(VERDICT_OK, 'başarılı | ek adı: ' + txt(first.name) +
                 ' | biçim: ' + txt(val.format) +
                 ' | içerik uzunluğu: ' + (len >= 0 ? len + ' karakter' : 'bilinmiyor'));
          } else {
            done(VERDICT_ERR, 'başarısız — ' + asyncErr(result));
          }
        } catch (inner) {
          done(VERDICT_ERR, 'geri çağrı istisnası: ' + errText(inner));
        }
      });
    } catch (e) {
      if (done) {
        done(VERDICT_ERR, 'istisna: ' + errText(e));
      } else if (row) {
        setRow(row, VERDICT_ERR, 'istisna: ' + errText(e));
      } else {
        failSection(sec, 'Ek ölçümü', e);
      }
    }
  }

  /* ---------------------------------------------------------------- 6. öğe yüzeyi */

  function checkMember(sec, it, name) {
    measure(sec, 'item.' + name, function () {
      return existsVerdict(it, name);
    });
  }

  function probeItemSurface() {
    var sec = addSection('6. Öğe yüzeyi — mevcut üyeler ve kip');
    try {
      var it = currentItem();
      var i;
      for (i = 0; i < ITEM_MEMBERS.length; i++) {
        checkMember(sec, it, ITEM_MEMBERS[i]);
      }
      measure(sec, 'öğe kipi (okuma / oluşturma)', function () {
        var body = it.body;
        if (!body) {
          return { verdict: VERDICT_NO, detail: 'item.body yok — kip belirlenemedi' };
        }
        var hasGet = isFn(body, 'getAsync');
        var hasSet = isFn(body, 'setAsync');
        var detail = 'body.getAsync=' + (hasGet ? 'var' : 'yok') +
                     ' | body.setAsync=' + (hasSet ? 'var' : 'yok') + ' → ';
        if (hasSet) {
          detail += 'oluşturma (compose) kipi';
        } else if (hasGet) {
          detail += 'okuma (read) kipi';
        } else {
          detail += 'kip belirlenemedi';
        }
        if (!hasGet && !hasSet) {
          return { verdict: VERDICT_NO, detail: detail };
        }
        return { verdict: VERDICT_OK, detail: detail };
      });
    } catch (e) {
      failSection(sec, 'Öğe yüzeyi ölçümü', e);
    }
  }

  /* ---------------------------------------------------------------- 7. sabitleme (pinning) */

  function probePinning() {
    var sec = addSection('7. Sabitleme (pinning) — dolaylı ölçüm');
    try {
      measure(sec, 'item.itemType', function () {
        return valueVerdict(currentItem().itemType,
                            '(yok — sabitleme yalnızca ileti/randevu okuma kipinde geçerlidir)');
      });
      measure(sec, 'ön koşul: Mailbox 1.5', function () {
        if (typeof Office === 'undefined' || !Office.context || !Office.context.requirements) {
          throw new Error('Office.context.requirements yok');
        }
        if (Office.context.requirements.isSetSupported('Mailbox', '1.5') === true) {
          return { verdict: VERDICT_OK, detail: 'Mailbox 1.5 destekleniyor — sabitleme ön koşulu sağlanıyor' };
        }
        return { verdict: VERDICT_NO, detail: 'Mailbox 1.5 desteklenmiyor — sabitleme çalışmaz' };
      });
      measure(sec, 'SupportsPinning doğrudan ölçüm', function () {
        return { verdict: VERDICT_NO,
                 detail: 'API ile özellik algılaması yapılamaz — gözle doğrulama gerekir' };
      });
      addNote(sec, 'Sabitleme (pin) simgesi panelin sağ üst köşesinde görünüyor mu? Gözle doğrula.',
              'note-instruction');
    } catch (e) {
      failSection(sec, 'Sabitleme ölçümü', e);
    }
  }

  /* ---------------------------------------------------------------- bölüm düzeyi hata */

  function failSection(sec, label, e) {
    try {
      var row = addRow(sec, label);
      setRow(row, VERDICT_ERR, 'istisna: ' + errText(e));
    } catch (inner) {
      /* çizim bile başarısızsa yapacak bir şey yok */
    }
  }

  /* ---------------------------------------------------------------- döküm ve pano */

  function pad(s, n) {
    var out = String(s);
    while (out.length < n) { out += ' '; }
    return out;
  }

  function buildTranscript() {
    var lines = [];
    var i, j, sec, row;
    lines.push('=== Yetenek Ölçümü — Outlook eklentisi tanılama ===');
    try { lines.push('Zaman     : ' + new Date().toString()); } catch (e) { /* yoksayılır */ }
    try { lines.push('Sayfa     : ' + window.location.href); } catch (e) { /* yoksayılır */ }
    try { lines.push('User agent: ' + navigator.userAgent); } catch (e) { /* yoksayılır */ }
    lines.push('Not       : belirteçler bilerek kısaltılmıştır (uzunluk + ilk 12 karakter).');
    lines.push('');
    for (i = 0; i < sections.length; i++) {
      sec = sections[i];
      lines.push('## ' + sec.title);
      for (j = 0; j < sec.rows.length; j++) {
        row = sec.rows[j];
        lines.push('[' + pad(row.verdict, 5) + '] ' + pad(row.label, 34) + ' : ' + row.detail);
      }
      for (j = 0; j < sec.notes.length; j++) {
        lines.push('NOT: ' + sec.notes[j]);
      }
      lines.push('');
    }
    if (!sections.length) {
      lines.push('(hiç ölçüm satırı üretilemedi — Office.js başlatılamamış olabilir)');
    }
    lines.push('=== döküm sonu ===');
    return lines.join('\n');
  }

  function copyState(text, isError) {
    var el = byId('copyState');
    if (!el) { return; }
    el.className = 'copystate' + (isError ? ' copystate-err' : '');
    setText(el, text);
  }

  function legacyCopy(text) {
    var area = byId('transcript');
    if (!area) { return false; }
    area.value = text;
    try {
      area.focus();
      area.select();
      var ok = document.execCommand ? document.execCommand('copy') : false;
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  function onCopy() {
    var text;
    try {
      text = buildTranscript();
    } catch (e) {
      copyState('Döküm oluşturulamadı: ' + errText(e), true);
      return;
    }
    var area = byId('transcript');
    if (area) { area.value = text; }
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(function () {
          copyState('Kopyalandı (' + text.length + ' karakter).', false);
        }, function (err) {
          if (legacyCopy(text)) {
            copyState('Kopyalandı (yedek yöntem, ' + text.length + ' karakter).', false);
          } else {
            copyState('Kopyalanamadı: ' + errText(err) + ' — metin alanından elle kopyalayın.', true);
          }
        });
        return;
      }
    } catch (e) {
      /* yedek yönteme düşülür */
    }
    if (legacyCopy(text)) {
      copyState('Kopyalandı (yedek yöntem, ' + text.length + ' karakter).', false);
    } else {
      copyState('Kopyalanamadı — pano erişimi engellendi.', true);
    }
  }

  /* ---------------------------------------------------------------- ortam bilgisi */

  function renderEnv() {
    if (!envEl) { return; }
    var add = function (label, value) {
      envEl.appendChild(make('div', null, label + ': ' + value));
    };
    try { add('Sayfa', window.location.href); } catch (e) { /* yoksayılır */ }
    try { add('Tarayıcı', navigator.userAgent); } catch (e) { /* yoksayılır */ }
    try {
      add('office.js', (typeof Office === 'undefined') ? 'YÜKLENMEDİ' : 'yüklendi');
    } catch (e) { /* yoksayılır */ }
  }

  /* ---------------------------------------------------------------- akış */

  function clearBootMessage() {
    var boot = byId('bootMessage');
    if (boot && boot.parentNode) {
      boot.parentNode.removeChild(boot);
    }
  }

  function runAll(reason) {
    if (started) { return; }
    started = true;
    clearBootMessage();
    if (reason === 'ready') {
      setStatus('Office.js hazır — ölçüm çalışıyor. Eşzamansız satırlar en geç ' +
                (TIMEOUT_MS / 1000) + ' saniyede sonuçlanır.', 'status-ok');
    }
    probeHost();
    probeRequirements();
    probeIdentityToken();
    probeCallbackToken();
    probeAttachments();
    probeItemSurface();
    probePinning();
  }

  function renderBootError(message) {
    clearBootMessage();
    setStatus('HATA: ' + message, 'status-err');
    var sec = addSection('0. Başlatma');
    var row = addRow(sec, 'Office.onReady');
    setRow(row, VERDICT_ERR, message);
    addNote(sec, 'Office.js başlatılamadı. Aşağıdaki ölçümler yine de denendi; ' +
                 'hepsinin HATA vermesi beklenir. Bu sayfayı Outlook içinde açın.');
    runAll('boot-error');
  }

  function boot() {
    resultsEl = byId('results');
    statusEl = byId('status');
    envEl = byId('env');
    renderEnv();

    var btn = byId('copyBtn');
    if (btn) {
      if (btn.addEventListener) {
        btn.addEventListener('click', onCopy, false);
      } else if (btn.attachEvent) {
        btn.attachEvent('onclick', onCopy);
      }
    }

    if (window.__officeLoadFailed === true) {
      renderBootError('office.js CDN üzerinden yüklenemedi (ağ/proxy engeli olabilir).');
      return;
    }

    bootTimer = window.setTimeout(function () {
      if (started) { return; }
      renderBootError('Office.onReady ' + (BOOT_TIMEOUT_MS / 1000) +
                      ' saniye içinde çalışmadı.');
    }, BOOT_TIMEOUT_MS);

    try {
      if (typeof Office === 'undefined') {
        window.clearTimeout(bootTimer);
        renderBootError('Office nesnesi tanımsız — office.js yüklenmedi.');
        return;
      }
      if (typeof Office.onReady === 'function') {
        Office.onReady(function (info) {
          try { window.clearTimeout(bootTimer); } catch (e) { /* yoksayılır */ }
          readyInfo = info || null;
          runAll('ready');
        });
      } else {
        Office.initialize = function () {
          try { window.clearTimeout(bootTimer); } catch (e) { /* yoksayılır */ }
          runAll('ready');
        };
      }
    } catch (e) {
      try { window.clearTimeout(bootTimer); } catch (inner) { /* yoksayılır */ }
      renderBootError('Office başlatma çağrısı istisna verdi: ' + errText(e));
    }
  }

  window.onerror = function (msg) {
    try {
      if (statusEl && started) {
        setStatus('Yakalanmamış betik hatası: ' + clip(msg, 200) +
                  ' — diğer satırlar geçerliliğini korur.', 'status-warn');
      }
    } catch (e) { /* yoksayılır */ }
    return false;
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else if (document.addEventListener) {
    document.addEventListener('DOMContentLoaded', boot, false);
  } else {
    window.onload = boot;
  }

}());
