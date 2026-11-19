# Outlook Ajanı

On-prem Exchange için, **yerel LLM** ile çalışan bir Outlook (OWA) görev paneli eklentisi ve arka uç servisi.
Açık mail zincirini özetler, aksiyon maddelerini ve cevap bekleyen soruları çıkarır, yanıt taslağı ve çeviri
üretir, yazdığınız taslağın hangi soruları cevapsız bıraktığını gösterir.

Tasarımın çıkış noktası: **mail verisi kurumdan çıkmaz ve hiçbir yere kalıcı yazılmaz.**

> **Durum:** lab ortamında uçtan uca çalışıyor ve ölçüldü. Gerçek kullanıcılarla pilot ve üretime geçiş
> **yapılmadı**. Ayrıntı: [`DURUM.md`](DURUM.md).

> **Bu depodaki sunucu adları yer tutucudur.** `mail.example.local`, `EXCH01`, `example.local` ve sıfırlardan
> oluşan sertifika parmak izi gerçek değildir; kendi ortamınızın değerleriyle değiştirin (aşağıda "Kurulum").

## Ne yapar

| # | Özellik | Kip | Model çağrısı |
|---|---|---|---|
| 1–3 | Özet · aksiyon maddeleri · cevap bekleyen sorular | Okuma | **A** — tek istek, üç sekme aynı yanıttan dolar |
| 4 | Yanıt taslağı (kısa / detaylı / resmî) | Yazma | **B** |
| 5 | Çeviri (TR ↔ EN) | Yazma | **B** |
| 6 | Ek kontrolü — "ekte" yazıyor ama ek yok | Okuma: kesin · Yazma: hatırlatma | yok (yerel) |
| 7 | Alıcı kontrolü — dış alıcı, birbirine benzeyen adresler | İkisi de | yok (yerel) |
| 8 | Taslak kontrolü — hangi sorular cevapsız kaldı | Yazma | **C** — zinciri yeniden okumaz |
| — | "Ajanı kapat" anahtarı; tercih kullanıcının kendi posta kutusunda durur | İkisi de | yok |

## Temel kısıtlar

Tamamı [`00-PROJE-BRIEF.md`](00-PROJE-BRIEF.md) §1'de (K1–K11). Koda en çok yön verenler:

- **Hizmet hesabı ve `ApplicationImpersonation` yok.** Eklenti yalnız kullanıcının açtığı öğeyi, kullanıcının yetkisiyle görür.
- **Mail içeriği diske, veritabanına veya günlüğe yazılmaz.** Sonuç önbelleği yalnız RAM'dedir.
- **Eklenti yalnız kullanıcı paneli açtığında çalışır;** arka planda iş yoktur.
- **Ajan mail göndermez, silmez, taşımaz.** Maile yazan tek yol kullanıcının bastığı "Gövdeye ekle" düğmesidir.
- **Bir mail için tek model isteği.** Sekme değiştirmek istek üretmez.
- **Geliştirme ortamına gerçek mail girmez.** Lab'de model dış bir API üzerinden çağrıldığı için tüm test verisi sentetiktir.

## Mimari

```
Outlook / OWA
  └─ görev paneli (addin/pilot, Office.js, ES5)          https://<eklenti-host>:4443
        │  Authorization: Bearer <Exchange identity token>
        ▼
     arka uç (backend, .NET 8 minimal API)                https://<servis-host>:4444
        │  POST /analiz (A) · /taslak (B) · /kontrol (C) · /olcum
        ▼
     OpenAI uyumlu model ucu  (lab: dış API · üretim: vLLM + LiteLLM)
```

- **Kimlik doğrulama:** Exchange identity token; imza, Exchange'in yayımladığı metadata'daki sertifikayla
  doğrulanır. `alg` RS256'ya sabittir, metadata adresi ve `iss` yapılandırmada sabittir (token içindeki adrese güvenilmez).
- **Sağlayıcı soyutlaması:** kodda sağlayıcı adı geçmez; lab'den üretime geçiş `config/llm.*.json` değişikliğidir.
- **Kullanım sayacı:** yalnız sabit adlı sayaçlar ve süreler. Kimlik, adres, konu, içerik tutulmaz.

## Dizinler

| Dizin | İçerik |
|---|---|
| `addin/pilot/` | Eklenti: manifest, panel (HTML/CSS/JS) |
| `addin/` (kök) | Faz 0 yetenek ölçüm aracı (requirement set, callback token, ek API'leri) |
| `backend/` | Servis, kimlik doğrulama, sayaç, API sözleşmesi (`SOZLESME.md`), hizmet kurulum betiği |
| `config/` | `llm` · `auth` · `sunucu` yapılandırmaları (`lab` ve `prod` şablonu) |
| `prompts/` | Sistem ve görev promptları, çıktı şeması |
| `test-data/` | 10 sentetik Türkçe/İngilizce mail senaryosu |
| `eval/` | A çağrısı için puanlı değerlendirme koşumu |
| `tools/owa-probe/` | OWA'yı Playwright ile süren uçtan uca testler |

## Kurulum (lab)

Gerekenler: Exchange Server (on-prem), .NET 8 SDK, Node.js 24, eklentiyi yayımlayacak bir IIS sitesi,
OpenAI uyumlu bir model ucu ve anahtarı.

1. **Yapılandırma**
   - `config/sunucu.lab.json` — servis portu, eklentinin kökeni (`panelOrigin`), TLS sertifikası parmak izi
   - `config/auth.lab.json` — Exchange metadata adresi, beklenen `iss` ve `aud` (panelin tam URL'si)
   - `config/llm.lab.json` — model ucu, model adı, anahtar dosyasının adı
   - Anahtarı proje köküne `*-key.txt` adıyla koyun (`.gitignore` kapsamındadır)
2. **Eklenti adresleri** — `addin/pilot/taskpane.js` başındaki `SERVIS_KOKU` ve `IC_ALAN`, `addin/pilot/manifest.xml` içindeki URL'ler
3. **Eklentiyi yayımla** — `deploy-addin.ps1` dosyaları IIS dizinine kopyalar
4. **Eklentiyi kaydet** (Exchange remote PowerShell): `New-App -OrganizationApp -FileData ([IO.File]::ReadAllBytes('manifest.xml'))`
5. **Servisi kur** — yönetici olarak `backend\hizmet-kur.ps1`. Servisi düşük yetkili sanal hizmet hesabıyla
   Windows hizmeti olarak kurar; geliştirme için `dotnet run` da yeterlidir.

## Test

```
node eval/kosum.js her-ikisi 3            # A çağrısı kalite puanı (sentetik set)

cd tools/owa-probe && npm install
OWA_PASS=... node faz2-check.js           # CORS + tek istek ilkesi
OWA_PASS=... node faz3-check.js           # taslak, çeviri, kontrol
OWA_PASS=... node kapat-check.js          # "Ajanı kapat" anahtarı
```

## Bilinen sınırlar

- **Yalnız OWA'da ölçüldü.** Masaüstü Outlook'ta denenmedi.
- Ölçülen sunucuda Mailbox requirement set tavanı **1.5**: ek içeriği okunamıyor, yazma kipinde ek varlığı
  öğrenilemiyor (bu yüzden iddia yerine hatırlatma gösteriliyor), OWA'da panel sabitlenemiyor.
- Gecikme ve eşzamanlılık sayıları dış API üzerinden alındı; üretim donanımında yeniden ölçülmeli.
- Değerlendirme seti küçük ve sentetik (10 senaryo).
- Üretim yapılandırmaları (`*.prod.json`) şablondur.

## Lisans

[MIT](LICENSE)
