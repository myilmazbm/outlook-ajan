/*
 * Yayin kopyasi hazirlar: depoyu disari acmadan once ozel/ortama ozgu veriyi ayiklar.
 *
 *   node tools/yayin-hazirla.js <hedef-dizin>
 *
 * 1) Yalniz IZINLI dosyalar kopyalanir (beyaz liste). Ekran goruntuleri, olcum
 *    ciktilari, token/parola dosyalari, kosum sonuclari ve derleme ciktilari ALINMAZ.
 * 2) Lab ortamina ozgu adlar (sunucu, etki alani, sertifika parmak izi) yer tutucuyla
 *    degistirilir. Degisim tablosu git-ignore'lu tools/yayin-gizli.json dosyasindan
 *    okunur - yani gercek adlar bu betigin kendisinde de gecmez.
 * 3) Sonuc taranir: yasakli desenlerden biri kalmissa betik HATA ile cikar.
 *
 * Hedef dizin calisma agacinin DISINDA olmalidir.
 */
const fs = require('fs');
const path = require('path');

const kok = path.resolve(__dirname, '..');
const hedef = process.argv[2] && path.resolve(process.argv[2]);
if (!hedef) { console.error('kullanim: node tools/yayin-hazirla.js <hedef-dizin>'); process.exit(2); }
if (hedef === kok || hedef.startsWith(kok + path.sep)) { console.error('hedef, proje dizininin disinda olmali'); process.exit(2); }

const gizli = JSON.parse(fs.readFileSync(path.join(__dirname, 'yayin-gizli.json'), 'utf8'));

// --- 1) beyaz liste ---
const IZINLI = [
  /^\.gitignore$/, /^README\.md$/, /^00-PROJE-BRIEF\.md$/, /^DURUM\.md$/, /^deploy-addin\.ps1$/,
  /^addin\/[^/]+\.(xml|html|js|css)$/, /^addin\/assets\/icon-\d+\.png$/, /^addin\/pilot\/[^/]+\.(xml|html|js|css)$/,
  /^backend\/[^/]+\.(cs|csproj|md|ps1)$/, /^backend\/appsettings\.json$/,
  /^config\/[^/]+\.json$/,
  /^eval\/(README\.md|beklentiler\.json|kosum\.js)$/,
  /^prompts\/[^/]+\.(txt|json)$/,
  /^test-data\/[^/]+\.(json|md)$/,
  /^tools\/(call-a\.js|llm-smoke\.ps1|yayin-hazirla\.js)$/,
  /^tools\/owa-probe\/[^/]+-(check|probe)\.js$/, /^tools\/owa-probe\/(run|dump-labels|token-capture)\.js$/,
  /^tools\/owa-probe\/package(-lock)?\.json$/,
];
const ATLA_DIZIN = new Set(['.git', 'node_modules', 'bin', 'obj', '.claude']);

function gez(dizin, goreli, cikti) {
  for (const ad of fs.readdirSync(dizin, { withFileTypes: true })) {
    const g = goreli ? goreli + '/' + ad.name : ad.name;
    if (ad.isDirectory()) { if (!ATLA_DIZIN.has(ad.name)) gez(path.join(dizin, ad.name), g, cikti); }
    else if (IZINLI.some(r => r.test(g))) cikti.push(g);
    else cikti.atlanan.push(g);
  }
  return cikti;
}
const liste = []; liste.atlanan = [];
gez(kok, '', liste);

// --- 2) kopyala + degistir ---
const kacis = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const degisimler = gizli.degisimler.map(([eski, yeni]) => [new RegExp(kacis(eski), 'gi'), yeni]);
const IKILI = /\.png$/i;

fs.rmSync(hedef, { recursive: true, force: true });
for (const g of liste) {
  const kaynak = path.join(kok, g), varis = path.join(hedef, g);
  fs.mkdirSync(path.dirname(varis), { recursive: true });
  if (IKILI.test(g)) { fs.copyFileSync(kaynak, varis); continue; }
  let metin = fs.readFileSync(kaynak, 'utf8');
  for (const [r, yeni] of degisimler) metin = metin.replace(r, yeni);
  fs.writeFileSync(varis, metin);
}

// --- 3) kalinti taramasi ---
const yasakli = gizli.yasakli.map(y => new RegExp(y, 'i'));
// Sir dosyalarinin ICERIGI de aranir (anahtar/parola/token bir yere yapismis mi).
for (const s of gizli.sirDosyalari || []) {
  const p = path.join(kok, s);
  if (!fs.existsSync(p)) continue;
  const deger = fs.readFileSync(p, 'utf8').trim();
  if (deger.length >= 8) yasakli.push(new RegExp(kacis(deger)));
}
let bulgu = 0;
for (const g of liste) {
  if (IKILI.test(g)) continue;
  const satirlar = fs.readFileSync(path.join(hedef, g), 'utf8').split('\n');
  satirlar.forEach((satir, i) => {
    for (const r of yasakli) if (r.test(satir)) { bulgu++; console.error(`KALINTI ${g}:${i + 1}  (${r.source.slice(0, 12)}...)`); }
  });
}

console.log(`kopyalanan: ${liste.length} dosya   atlanan: ${liste.atlanan.length} dosya   kalinti: ${bulgu}`);
if (bulgu) { console.error('YAYINLAMA: kalinti var, hedef kullanilmamali'); process.exit(1); }
