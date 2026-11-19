# eval — A çağrısı değerlendirme koşumu

Bu klasör, **A çağrısının** (mail zinciri analizi, §3.2) çıktı kalitesini sabit bir
beklenti setine karşı puanlar. Amaç tek: *prompt değişikliklerini tahmin etmek yerine
ölçmek*. Şu an karşılaştırılan iki şey `prompts/system-A.en.txt` ile
`prompts/system-A.tr.txt` — yani **aynı şemayı anlatan sistem promptunun İngilizce ve
Türkçe sürümü**.

> **UYARI — VERİ SENTETİKTİR.** Koşum yalnızca `test-data/` altındaki 10 uydurma
> senaryoyla çalışır. Bu ortamda **gerçek mail kullanılması yasaktır** (K10). Hiçbir
> senaryo gerçek bir posta kutusundan, gerçek bir kişiden veya gerçek bir şirketten
> alınmamıştır; tüm alan adları `.example` uzantılıdır. Buradan çıkan puanlar sentetik
> set üzerinde *göreli* bir sinyaldir, saha doğruluğu iddiası değildir.

---

## 1. Ne ölçülüyor?

Her koşum = **1 senaryo × 1 sistem prompt dili × 1 tekrar** → tek bir model isteği.
Çıktı 8 kritere göre puanlanır (toplam 100):

| Kriter | Ağırlık | Ne bakar |
|---|---:|---|
| `sema` | 20 | Çıktı JSON olarak ayrışıyor mu, `prompts/sema-A.json` içindeki tüm alanlar var mı, `lang`/`category`/`reason_code`/`priority` **enum içinde** mi, diziler gerçekten dizi mi, `reply_needed` boolean mı |
| `lang` | 10 | Beklenen tek doğru dil değeriyle birebir eşleşiyor mu |
| `kategori` | 15 | `category`, beklenti dosyasındaki **kabul edilebilir enum listesinde** mi |
| `oncelik` | 10 | `priority`, beklenen 1–5 bandının içinde mi |
| `reply_needed` | 10 | Beklenen boolean'la eşleşiyor mu |
| `soru` | 15 | `questions` eleman sayısı beklenen bantta mı |
| `aksiyon` | 10 | `action_items` eleman sayısı beklenen bantta mı |
| `uydurma` | 10 | Halüsinasyon şüphesi **yok** mu (aşağıya bakınız) |

**`sema` sert kapıdır:** şema geçersizse diğer kriterler hiç değerlendirilmez ve
senaryo puanı **0** olur. Şemayı tutturamayan bir çıktı panelde zaten gösterilemez.

### Uydurma (halüsinasyon) tespiti iki koldan yapılır

1. **Yasaklı ifadeler** — `beklentiler.json` içinde senaryo başına tanımlı, kaynak
   zincirde **hiç geçmeyen** ifadeler (çoğunlukla o zincirde bulunmayan kişi adları,
   uydurulması muhtemel tutarlar/tarihler, yanlış sipariş numaraları). Bunlardan biri
   `summary` içinde geçerse bulgu üretilir. Her yasaklı ifadenin gerçekten kaynak
   metinde bulunmadığı doğrulanmıştır — yani hiçbiri haksız tuzak değildir.
2. **Kaynakta olmayan özel ad** — her `action_items` maddesi taranır; cümle başı
   olmayan, büyük harfle başlayan bir sözcük **kaynak zincir metninde hiç geçmiyorsa**
   şüpheli olarak işaretlenir. Türkçe kesme işareti ekleri (`Korkmaz'ın` → `Korkmaz`)
   ayrıştırılır, ay/gün adları ve yaygın büyük harfli sözcükler eleme listesindedir.

Bu ikinci kol **sezgisel**dir: cümle başı sözcükleri atlandığı için bazı uydurmaları
kaçırabilir. Bulgular "şüphe" olarak raporlanır, kesin hüküm değildir.

---

## 2. Nasıl koşulur?

Node.js v24 gerekir (`C:\Program Files\nodejs`). Bağımlılık yok, `npm install` yok.

```
node eval/kosum.js [en|tr|her-ikisi] [tekrar-sayisi]
```

Varsayılan: `her-ikisi 1`.

```bash
node eval/kosum.js                 # her iki dil, 1 tekrar  (20 istek)
node eval/kosum.js en 1            # yalnız EN promptu      (10 istek)
node eval/kosum.js her-ikisi 3     # her iki dil, 3 tekrar  (60 istek)
```

Koşum:

- `config/llm.lab.json` okunur; API anahtarı `apiKeyFile` yolundan alınır.
- İstek **doğrudan** `{baseUrl}/chat/completions` adresine gider.
  **Backend servisi (:4444) kullanılmaz** — oradaki oturum jetonu süreli olduğu için
  değerlendirme koşumu ona bağlanmaz.
- Mesaj sırası `tools/call-a.js` ile birebir aynıdır ve **değiştirilmemelidir**:
  `[sistem prompt] → [mail gövdesi] → [göreve özel talimat]`.
  Talimat başa alınırsa vLLM prefix cache kazancı tamamen kaybolur (§3.2).
- En fazla **3 istek aynı anda** uçar; API dövülmez.
- Bir senaryo patlarsa **tüm koşum iptal olmaz**: o senaryo 1 kez yeniden denenir,
  yine olmazsa 0 puanla `HATA` olarak raporlanır ve koşum devam eder.
- **API anahtarı hiçbir yere basılmaz, loglanmaz veya dosyaya yazılmaz.** Hata
  mesajları anahtar için maskeden geçirilir.

### Çıktılar

- **stdout**: dil başına ayrıntı tablosu (senaryo × kriter × puan × süre × token),
  iki dil koşulduysa senaryo bazında karşılaştırma tablosu, bulgu listesi ve
  sonunda **HÜKÜM** satırı — hangi sistem prompt dilinin kazandığı, kaç puan farkla,
  ve her dil için toplam süre + toplam token.
- **`eval/sonuc-<zaman-damgasi>.json`**: makine okunur tam sonuç (her koşumun
  kriterleri, puanı, bulguları, token/süre değerleri, ağırlıklar, hüküm metni).
  Bu dosyada API anahtarı **yer almaz**.

> **Tek tekrarla sonuç yorumlanmaz.** `tekrar=1` ile çıkan puan farkı büyük ölçüde
> örnekleme gürültüsüdür; hüküm satırı bunu açıkça yazar. Ciddi bir karar için
> en az `her-ikisi 3`, tercihen 5 tekrar koşulmalıdır.

---

## 3. Beklenti dosyası (`beklentiler.json`)

`test-data/*.json` içindeki `beklenen` blokları **serbest metindir**
(`sevkiyat-gecikmesi`, `gizlilik-uyarisi` gibi) ve `sema-A.json` enum'larıyla
eşleşmez. Bu yüzden değerlendirme onları **kullanmaz**; `eval/beklentiler.json`
senaryoların tamamı okunarak enum'lara göre ayrıca türetilmiştir.

Beklenti "tek doğru cevap" değil, **kabul edilebilir aralık** tanımlar: bir zincir için
birden çok kategori savunulabilir, öncelik tek sayı değil banttır.

Senaryo girdisinin alanları:

```json
"senaryo-id": {
  "_not": "bu beklentinin tek satırlık gerekçesi",
  "lang": "tr",
  "kategori_kabul": ["action_required", "question"],
  "oncelik_min": 3, "oncelik_max": 5,
  "reply_needed": true,
  "soru_min": 4, "soru_max": 4,
  "aksiyon_min": 1, "aksiyon_max": 4,
  "yasakli_ifadeler": ["Ingrid", "412 bin"]
}
```

---

## 4. Yeni senaryo nasıl eklenir?

1. `test-data/<yeni-id>.json` dosyasını mevcut şemaya uygun oluşturun
   (`test-data/README.md` içindeki şema; UTF-8, BOM yok, `.example` alan adları,
   **tamamen uydurma içerik**). Bu klasör bu koşumun sahibi değildir — ekleme
   yaparken oradaki kurallara uyun.
2. `eval/beklentiler.json` → `senaryolar` altına **aynı id ile** bir giriş ekleyin.
   Girişi doldurmadan önce senaryoyu baştan sona okuyun; `_not` alanına neden bu
   bandı seçtiğinizi tek satırla yazın.
3. `yasakli_ifadeler` seçerken, seçtiğiniz her ifadenin kaynak zincirde **gerçekten
   geçmediğini** doğrulayın; aksi halde haksız ceza verirsiniz. Güvenli seçim:
   o zincirde bulunmayan kişi adları ve metinde olmayan tutar/tarih biçimleri.
4. `node eval/kosum.js en 1` ile bir kez koşun, yeni senaryonun `BULGULAR` bölümünde
   beklenmedik ceza almadığını kontrol edin.

Koşum `beklentiler.json` içindeki id'leri gezer ve karşılığında
`test-data/<id>.json` bulunmayanları sessizce atlar; yani beklenti eklemeden
eklenen senaryo puanlanmaz.

---

## 5. Sınırlar

- Puanlar **biçim ve sayım** doğruluğunu ölçer; özet metninin *anlamsal* kalitesini
  ölçmez. "Doğru sayıda aksiyon çıkardı" ile "doğru aksiyonları çıkardı" aynı şey
  değildir.
- `uydurma` kriteri sezgiseldir (bkz. §1); yanlış negatif verebilir.
- `temperature=0.2` ile koşulur, yani sonuç tam belirlenimci değildir. Tek tekrarın
  sonucu tekrar edilebilir sayılmamalıdır.
- Bu klasör yalnızca **ölçer**. Promptlar burada değiştirilmez.
