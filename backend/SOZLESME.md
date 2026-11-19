# Arka uç sözleşmesi (Faz 2)

Panel ile servis arasındaki **tek kaynak**. Panel `https://mail.example.local:4443`,
servis `https://mail.example.local:4444` — **bilinçli olarak ayrı köken** (çivi #9 / V5).

## POST /analiz

A çağrısı (§3.2). **Bir mail = bir istek (K9).** Aynı `ogeId` tekrar gelirse RAM
önbelleğinden dönülür, modele gidilmez.

### İstek
```json
{
  "ogeId":  "AAQkAD...",          // Office.context.mailbox.item.itemId — önbellek anahtarı
  "konu":   "RE: Sevkiyat gecikmesi",
  "kimden": { "ad": "Ayşe Çetinkaya", "eposta": "a.cetinkaya@ornek.example" },
  "kime":   [ { "ad": "...", "eposta": "..." } ],
  "cc":     [ { "ad": "...", "eposta": "..." } ],
  "govde":  "düz metin gövde"
}
```

### Yanıt 200
```json
{
  "sonuc": {
    "lang": "tr", "category": "action_required", "priority": 4,
    "reason_code": "explicit_request", "reply_needed": true,
    "summary": "...", "action_items": ["..."], "questions": ["..."]
  },
  "meta": { "onbellek": false, "sure_ms": 5183, "girdi_token": 9323, "cikti_token": 387 }
}
```

`sonuc` alanları ve enum'ları `prompts/sema-A.json` ile birebir aynıdır.

### Hata
```json
{ "hata": "kısa açıklama" }
```
`400` geçersiz istek · `502` model hatası · `504` zaman aşımı.

## GET /saglik
```json
{ "durum": "ayakta", "model": "qwen/qwen3.8-27b", "saglayici": "openrouter" }
```
Anahtar veya yapılandırma sırrı **döndürülmez**.

## Kurallar (pazarlık edilemez)

- **K2:** mail içeriği diske, veritabanına, günlüğe **yazılmaz**. Önbellek yalnız RAM'dedir,
  süreç bitince kaybolur. Günlüğe yalnız sayı/süre yazılır — konu, gövde, adres asla.
- **K9:** aynı `ogeId` için modele ikinci kez gidilmez.
- **K8:** servis mail göndermez, silmez, taşımaz. Yalnız okur ve analiz döndürür.
- **§15.1:** API anahtarı hiçbir yanıtta, günlükte veya hata mesajında görünmez.
- **§15.2:** kodda `openrouter` kelimesi geçmez; sağlayıcı `config/llm.*.json`'dan okunur.

## ⚠️ Kimlik doğrulama — Faz 2'de HENÜZ YOK

Çivi #8 ölçüldü: `getUserIdentityTokenAsync` çalışıyor (972 karakter).
Ancak bu serviste **token doğrulaması yapılmıyor** — uç nokta lab içinde açıktır.
**Faz 3'ten (pilot) önce Exchange identity token doğrulaması zorunludur.**

---

# Faz 3 ekleri — B ve C çağrıları

## Önbellek anahtarı — ölçüme dayalı karar

Yazma kipinde `item.itemId` **yoktur** (ölçüldü: `undefined`), ama `conversationId`
vardır ve **okuma kipindekiyle birebir aynıdır** (ölçüldü). §3.2 C çağrısının
"parent"in A sonucunu bulmasını şart koştuğu için:

> **A sonucu HEM `ogeId` HEM `konusmaId` altında önbelleğe yazılır.**
> `ogeId` = §3.2'nin istediği öğe bazlı kesinlik. `konusmaId` = C'nin yazma
> kipinden erişebildiği tek bağlantı. Yalnız `konusmaId` kullanılsaydı aynı
> zincirdeki farklı mailler tek kayda çakışırdı.

## POST /taslak  (B çağrısı)

Girdi: açık mail + **kullanıcı niyeti**. Çıktı: uzun serbest metin. Önbelleğe **alınmaz**
(niyet her seferinde değişir).

```json
{
  "gorev":  "taslak" | "ceviri",
  "konu":   "...",
  "govde":  "...",
  "ton":    "kisa" | "detayli" | "resmi",      // yalniz gorev=taslak
  "hedefDil": "tr" | "en"                        // yalniz gorev=ceviri
}
```
Yanıt: `{ "metin": "...", "meta": { "sure_ms": n, "girdi_token": n, "cikti_token": n } }`

> **K8:** dönen metin gönderilmez. Panel gösterir; yapıştırma kararı kullanıcınındır.

## POST /kontrol  (C çağrısı)

§3.2: girdisi **orijinal mail değil**, A'nın `questions` dizisi + kullanıcının taslağıdır.
Bu yüzden ucuzdur — 15.000 token'lık zincir yeniden okunmaz.

```json
{ "konusmaId": "AAQkAD...", "taslak": "kullanicinin yazdigi metin" }
```

Yanıt:
```json
{
  "sonuc": { "cevaplanan": ["..."], "cevapsiz": ["..."], "not": "tek cumle" },
  "meta": { "soru_sayisi": 6, "sure_ms": 1200, "girdi_token": 210, "cikti_token": 90 }
}
```

**409** `{ "hata": "onceki analiz yok", "kod": "A_YOK" }` — bu zincir için A hiç
çalışmamışsa. Panel bunu görünce "önce Özetle'ye basın" der. **C tek başına çalışamaz** (§3.2).
