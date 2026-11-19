/*
 * A cagrisi (§3.2) kosum araci - K9: tek mail = tek istek.
 * Prompt sirasi BILINCLI: [sistem] -> [mail govdesi] -> [goreve ozel talimat]
 * Talimat basa alinirsa vLLM prefix cache kazanci tamamen kaybolur (§3.2).
 * K10: yalniz test-data/ altindaki sentetik veriyle calisir.
 *
 * Kullanim: node tools/call-a.js <senaryo-id> [en|tr]
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var senaryo = process.argv[2] || 'uzun-cc-zinciri';
var promptDili = process.argv[3] || 'en';

var cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/llm.lab.json'), 'utf8')).llm;
var key = fs.readFileSync(path.join(ROOT, cfg.apiKeyFile), 'utf8').trim();
var sema = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/sema-A.json'), 'utf8'));
var sistem = fs.readFileSync(path.join(ROOT, 'prompts/system-A.' + promptDili + '.txt'), 'utf8');
var gorev = fs.readFileSync(path.join(ROOT, 'prompts/task-A.txt'), 'utf8');

var veri = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-data/' + senaryo + '.json'), 'utf8'));

// zinciri duz metne cevir
function kisiler(a) { return (a || []).map(function (p) { return p.ad + ' <' + p.eposta + '>'; }).join(', '); }
var govde = 'Konu: ' + veri.konu + '\n\n' + veri.mesajlar.map(function (m) {
  return '--- Mesaj ' + m.sira + ' ---\n' +
    'Kimden: ' + m.kimden.ad + ' <' + m.kimden.eposta + '>\n' +
    'Kime: ' + kisiler(m.kime) + '\n' +
    (m.cc && m.cc.length ? 'CC: ' + kisiler(m.cc) + '\n' : '') +
    'Tarih: ' + m.tarih + '\n\n' + m.govde;
}).join('\n\n');

// PREFIX CACHE SIRASI: govde once, talimat sonra
var kullanici = govde + '\n\n' + gorev;

function jsonCikar(s) {
  s = s.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  var i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j < 0) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
}

function dogrula(o) {
  var hatalar = [];
  if (!o) return ['JSON ayristirilamadi'];
  sema.alanlar.forEach(function (a) { if (!(a in o)) hatalar.push('eksik alan: ' + a); });
  Object.keys(sema.enum).forEach(function (a) {
    if (a in o && sema.enum[a].indexOf(o[a]) < 0) hatalar.push('enum disi ' + a + ' = ' + JSON.stringify(o[a]));
  });
  ['action_items', 'questions'].forEach(function (a) {
    if (a in o && !Array.isArray(o[a])) hatalar.push(a + ' dizi degil');
  });
  if ('reply_needed' in o && typeof o.reply_needed !== 'boolean') hatalar.push('reply_needed boolean degil');
  return hatalar;
}

(function () {
  var t0 = Date.now();
  fetch(cfg.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({
      model: cfg.model,
      messages: [{ role: "system", content: sistem }, { role: "user", content: kullanici }],
      temperature: 0.2,
      max_tokens: cfg.maxTokens || 3000
    }, cfg.extraBody || {}))
  }).then(function (r) { return r.json(); }).then(function (r) {
    var ms = Date.now() - t0;
    if (r.error) { console.log('API HATASI: ' + r.error.message); process.exit(1); }
    var ham = r.choices[0].message.content;
    var o = ham ? jsonCikar(ham) : null;
    var hatalar = ham ? dogrula(o) : ['content bos geldi (dusunme tokenlari butceyi yedi mi?)'];
    var dt = (r.usage && r.usage.completion_tokens_details) || {};

    console.log('=== A CAGRISI: ' + senaryo + '  (sistem prompt: ' + promptDili + ') ===');
    console.log('model=' + r.model + '  sure=' + ms + 'ms  girdi=' + r.usage.prompt_tokens +
      '  cikti=' + r.usage.completion_tokens + '  dusunme=' + (dt.reasoning_tokens || 0) +
      '  bitis=' + r.choices[0].finish_reason);
    console.log('SEMA: ' + (hatalar.length ? 'GECERSIZ -> ' + hatalar.join(' | ') : 'GECERLI'));
    if (o) {
      console.log('lang=' + o.lang + '  category=' + o.category + '  priority=' + o.priority +
        '  reason_code=' + o.reason_code + '  reply_needed=' + o.reply_needed);
      console.log('beklenen(test-data): dil=' + veri.beklenen.dil + ' kategori=' + veri.beklenen.kategori + ' oncelik=' + veri.beklenen.oncelik);
      console.log('\n--- summary ---\n' + o.summary);
      console.log('\n--- action_items (' + (o.action_items || []).length + ') ---');
      (o.action_items || []).forEach(function (x, i) { console.log((i + 1) + '. ' + x); });
      console.log('\n--- questions (' + (o.questions || []).length + ') ---');
      (o.questions || []).forEach(function (x, i) { console.log((i + 1) + '. ' + x); });
    } else {
      console.log('HAM CIKTI (ilk 600):\n' + (ham === null ? '<null>' : ham.slice(0, 600)));
    }
  }).catch(function (e) { console.log('HATA: ' + String(e.message).replace(key, '***')); });
})();
