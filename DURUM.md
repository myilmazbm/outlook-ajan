# Durum

**Faz:** 4 tamamlandı — sıradaki: gerçek kullanıcı pilotu ve Faz 5 *(ikisi de onay gerektirir)*
**Ortam:** ⛔ **`EXCH01` (lab) — prod Exchange'e dokunulmadı (K11)**
**Son güncelleme:** 2026-11-19
**Referans:** `00-PROJE-BRIEF.md` (§9 faz planı · §10 çiviler · §14 çalışma modeli)

> Bu dosya her yinelemede güncellenir. Döngü buradan başlar, buraya yazarak biter.

---

## Ortam gerçekleri *(ölçüldü, varsayılmadı)*

| Konu | Ölçülen değer |
|---|---|
| Bu makine | **EXCH01'in kendisi** — forest `example.local`, tek domain, tek site |
| Exchange org | `First Organization` — **içinde tek sunucu var: EXCH01** |
| Exchange sürümü | 15.2 Build 2562.17 (Mailbox rolü) |
| **Prod ile ilişki** | **Prod bu forest'ta DEĞİL.** Org düzeyi komutlar prod'a ulaşamaz |
| Posta kutuları | `Administrator`, `test1@example.local`, `test2@example.local` |
| IIS sertifikası | `CN=EXCH01`, **kendinden imzalı**, SAN: `EXCH01`, `mail.example.local` |
| Forest'ta iç CA | **Yok** (AD CS kurulu değil) |
| Masaüstü Outlook | **EXCH01'te kurulu değil** |
| Çalışma zamanları | .NET 8.0.425 · Node.js 24.19.0 *(bu yinelemede kuruldu, aşağıya bak)* |

---

## Tamamlanan

- [x] Proje brief'i yazıldı ve kısıtlar (K1–K11) karara bağlandı
- [x] **K11 yapısal olarak güvenceye alındı** — org'da tek sunucu (EXCH01), prod başka forest'ta.
      Doğrulama: `Get-ExchangeServer` → 1 kayıt; `Get-OrganizationConfig` → `DC=example,DC=local`
- [x] **Çivi #10 — `openrouter-key.txt` korunuyor.** Doğrulama: `git check-ignore -v` → `.gitignore:3:*-key.txt`
- [x] **Çivi #11 — OpenRouter'a tek çağrı başarılı, slug doğrulandı.**
      `qwen/qwen3.8-27b` OpenRouter kataloğunda var (1M bağlam). Doğrulama: `tools/llm-smoke.ps1`
      gerçek çağrı → `finish_reason=stop`, doğru Türkçe yanıt, 11.1 s, 70 girdi / 37 çıktı token
- [x] **Çivi #12 — sentetik test seti kuruldu.** `test-data/` 10 senaryo + README, 65 mesaj.
      Doğrulama: kendi `node` betiğimle hepsi `JSON.parse` geçti, `uzun-cc-zinciri` = 40 mesaj,
      **tüm e-posta alan adları `.example`** (K10 temiz)
- [x] **Çivi #3 (kısmi) — manifest HTTPS'te yayında.** `https://mail.example.local:4443/manifest-probe.xml`
      Doğrulama: `Invoke-WebRequest` → HTTP 200, 4600 bayt, sertifika doğrulaması **açıkken**
- [x] **Çivi #2 — `New-App -OrganizationApp` ÇALIŞIYOR (`-FileData` ile).**
      Doğrulama: `Get-App -OrganizationApp` → `Outlook Ajani - Yetenek Olcumu`, `Enabled=True`
- [x] Ölçüm aracı (probe) yazıldı ve yayımlandı — 7 çivi için çalışma zamanı ölçümü
- [x] `config/llm.lab.json` + `llm.prod.json` — §15.2 soyutlaması (kodda `openrouter` geçmiyor)

---

- [x] **Çivi #1 (OWA yarısı) — panel OWA'da açılıyor.** `hostName=OutlookWebApp`, `15.2.2562.49`,
      `platform=OfficeOnline`. Doğrulama: `tools/owa-probe/success.png` + `probe-output.txt`
- [x] **Çivi #4 — desteklenen Mailbox set ölçüldü: en yüksek `1.5`.**
      1.1–1.5 evet, 1.6–1.14 **hayır**. Dokümana değil kendi build'imize bakıldı (§10)
- [x] **Çivi #6 — `getCallbackTokenAsync` + `ReadWriteMailbox` ÇALIŞIYOR.**
      REST belirteci alındı (902 karakter), `restUrl` ve `ewsUrl` çözümlendi. Faz 6'nın önü açık
- [x] **Çivi #7 — `getAttachmentContentAsync` ÇALIŞMIYOR.** İşlev mevcut ama gerçek çağrı
      `kod 5000 | Host Error | The operation is not supported.` veriyor. **Sebebi 1.5 tavanı**
      (bu API 1.8 ister). §7'deki "ek özeti" ve Faz 8 multimodal ek okuma **bu sunucuda imkânsız**
- [x] **Çivi #5 — `SupportsPinning` OWA'DA ÇALIŞMIYOR.** Ön koşul (Mailbox 1.5) sağlanıyor,
      buna rağmen panel başlığında sabitleme simgesi **yok**. Doğrulama: `tools/owa-probe/pin-check.js`
      → başlıkta yalnız `o365cs-flexPane-closebutton` (✕); tüm belgede pin öğesi olarak
      sadece OWA'nın *konuşma* sabitlemesi var (görünür değil, task pane ile ilgisiz).
      Görsel: `pin-header.png` (2× ölçek) — ikon, başlık, ✕. Başka denetim yok
- [x] **Faz 4 — §11.2 değerlendirme seti kuruldu ve koşuldu.** `eval/` (beklentiler + koşum + README).
      10 senaryo × 2 prompt dili × tekrar; 100 puan üzerinden, şema **sert kapı**.
      - **§11.3 CEVAPLANDI: EN ve TR sistem promptu arasında anlamlı fark YOK.**
        1 tekrar: 99,0 – 99,0 (berabere). 3 tekrar: EN 96,3 – TR 97,2 (**0,8 fark = gürültü**).
        Koşumlar arası değişkenlik, promptlar arası farktan büyük. **Karar: EN'de kalınıyor**
        (değiştirmek için kanıt yok). Daha ince ayrım için ≥5 tekrar ve daha geniş set gerekir
      - Uydurma (halüsinasyon) bulgusu **0**; şema reddi 60 koşumda **1**
- [x] **Güvenilirlik düzeltmesi — ölçüme dayalı.** 60 koşumun 1'inde (~%1,7) model
      ayrıştırılamayan çıktı verdi; bu, amiral özellikte kullanıcıya görünen bir hatadır.
      - **A ve C çağrılarına `response_format: json_object`** eklendi
      - **Ayrıştırma hatasında tek seferlik tekrar** (`analiz_json_tekrar` sayacıyla izleniyor).
        K9 ihlali değil: K9 "türeyen işleri ayrı çağrılara bölme" der; bu hata kurtarmadır
      - ⚠️ **JSON kipi B çağrısına UYGULANMAZ** — taslak/çeviri serbest metindir, JSON kipi
        özellik 4 ve 5'i bozardı. Bu yüzden global `extraBody`'ye değil, **çağrı başına** verildi.
        Doğrulandı: çeviri hâlâ düz metin, A hâlâ geçerli JSON
- [x] **Faz 4 — §12 kullanım sayacı çalışıyor.** `backend/Olcum.cs` + `POST /olcum` + `GET /olcum/ozet`.
      - **Olay adı SABİT ENUM.** Serbest metin kabul edilmiyor — gerekçe §3.2'nin `reason_code`
        uyarısıyla aynı: serbest metin er geç içerik taşır ve loga sızar (K2)
      - **Kimlik yok, içerik yok.** Diske yazılan `olcum.json` **yalnız "ad: tamsayı"**;
        doğrulandı: 9 alan, tamsayı olmayan 0, uzun dizgi 0
      - **Sayaçlar biriktirilip seyrek gönderiliyor** (10 s). Her tıklamada istek atılsaydı
        sekme değiştirmek ağ trafiği üretir ve §3.2'nin "sekmeler bedelsizdir" vaadi fiilen bozulurdu
      - Panel işlevleri telemetriye **bağlı değil**: `/olcum` hatası sessizce yutuluyor
      - Uçtan uca doğrulama: `faz3-check.js` sonrası sayaçlar yapılan işi birebir yansıttı;
        p50/p95 hesaplandı; **`mail_basina_llm_cagrisi = 1`** (§12'nin K9 denetimi — 1'i geçmiyor)
- [x] **§5.7 kapatma hakkı uygulandı — "Ajanı kapat" anahtarı.** *(Eylül'deki "8/8" bunu kapsamıyordu; 2026-11-19'da fark edildi.)*
      Tercih `roamingSettings`'te, yani kullanıcının **kendi posta kutusunda** (§4.4 V1); sunucuda kullanıcı başına kayıt yok (K2).
      Kapalıyken öğe **okunmaz**, pasif kontrol çalışmaz, servise içerik gitmez. Yeni sayaçlar: `ajan_kapatildi`, `ajan_acildi`,
      `panel_acildi_kapali` (§12 "kapatma oranı"). Doğrulama: `tools/owa-probe/kapat-check.js` → **8/8 GEÇTİ**
      (kapatma, yeniden yüklemede kalıcılık, kapalıyken 0 içerik isteği, geri açma)
- [x] **E7 KAPANDI — arka uç Windows hizmeti.** `backend/hizmet-kur.ps1` → `OutlookAjanServis`, gecikmeli otomatik başlatma,
      çökünce yeniden başlatma. Hesap: `NT SERVICE\OutlookAjanServis` (sanal hesap — parolasız, etki alanı yetkisiz;
      K1'in yasakladığı türden bir *posta kutusu* hizmet hesabı DEĞİL, Exchange'de hiçbir yetkisi yok).
      Kök `C:\OutlookAjan` salt okunur, yalnız `veri\` yazılabilir. Doğrulama: hizmet Running, `/saglik` ayakta,
      faz1/2/3 + kapat testleri **hizmet üzerinden** geçti
- [x] **Ortama özgü değerler koddan çıkarıldı.** Panel kökeni, sertifika parmak izi ve port artık `config/sunucu.*.json`'da;
      panelde servis adresi tek sabitte (`SERVIS_KOKU`)
- [x] **FAZ 3 TAMAM — §6'daki 8 özelliğin 8'i çalışıyor, OWA içinden ölçüldü.**
      `tools/owa-probe/faz3-check.js` → **6/6 kontrol GEÇTİ**:
      yazma arayüzü · ek hatırlatması (S10) · B tek istek · B metin üretti ·
      C tek istek · **C gerçek sonuç döndü (A_YOK değil)**
      - **`konusmaId` köprüsü doğrulandı:** okuma kipinde A çalıştı, yazma kipinde
        C onun sonucunu buldu ve 2 cevapsız soruyu doğru işaretledi
      - Ağ sayımı: `/analiz` 1 · `/taslak` 1 · `/kontrol` 1 — her düğme **tek istek**
      - **K8 korundu:** maile yazan tek yol `Gövdeye ekle` düğmesi (`setSelectedDataAsync`,
        tek çağrı noktası). Panel kendiliğinden hiçbir şey eklemiyor
- [x] **S10 uygulandı — ek kontrolü yazma kipinde HATIRLATMAYA çevrildi.**
      `Metinde "ekte" geçiyor — eklediğinizden emin olun.` Ek olup olmadığı iddia
      **edilmiyor** (bilinemiyor); yalnız hatırlatılıyor. Okuma kipinde kesin kontrol sürüyor.
      Doğrulama: gövdeye "ekte" geçen cümle yazıldı → hatırlatma çıktı; yazılmayınca çıkmıyor
- [x] **Faz 3 — yazma (compose) kipi ölçüldü; B ve C çağrıları çalışıyor.**
      - Manifest'e `ItemEdit` formu + `MessageComposeCommandSurface` eklendi, izin
        `ReadItem` → **`ReadWriteItem`** (§6: taslağı cevap gövdesine yapıştırma).
        Öğe kapsamlı yetki; mailbox kapsamlı değil — K1/K8 etkilenmiyor
      - **Ölçüm:** yazma kipinde `itemId` **yok**, `conversationId` **var** ve okuma
        kipindekiyle **birebir aynı** → A sonucu artık **iki anahtarla** önbellekte
      - **`aud` değişmedi** (aynı SourceLocation URL'si kullanıldı) → auth yapılandırması sabit
      - **C çağrısı (özellik 8) doğrulandı:** 4 sorulu sentetik senaryoda taslağın
        cevapladığı 2 ve cevaplamadığı 2 soru **doğru** ayrıldı; not satırı isabetli
      - **§3.2'nin "C ucuzdur" iddiası doğrulandı:** C = **562** girdi tokeni,
        aynı zincirin A'sı = 6.799. Zincir yeniden okunmuyor
      - **`A_YOK` (409) doğrulandı:** A hiç koşmamış zincirde C **tek başına çalışmıyor**
      - **B çağrısı (özellik 4, 5) doğrulandı:** resmî tonda taslak (uydurma bilgi yok),
        TR→EN çeviri (isim/tarih korunuyor)
- [x] **E5 KAPANDI — Exchange identity token doğrulaması çalışıyor (çivi #8 kararı da bu).**
      `backend/Kimlik.cs` + `config/auth.lab.json`. Panel token'ı `Authorization: Bearer` ile yolluyor.
      - **Kabul:** gerçek token → doğrulandı, `1 imza sertifikası yüklendi`, analiz 8,8 s'de döndü
      - **Ret (hepsi 401):** başlık yok · çöp token · **`alg:none`** · **`alg:HS256` karışıklığı**
      - **Güvenlik kararı:** token içindeki `appctx.amurl` **kullanılmıyor** — saldırgan onu kendi
        sunucusuna çevirebilirdi. Metadata adresi ve `iss` yapılandırmada **sabit**
      - İmza, **hiçbir claim'e güvenilmeden önce** doğrulanıyor; `alg` RS256'ya sabitlenmiş
      - Kimlik, mail adresi değil `msexchuid` ile taşınıyor (K2 dostu)
- [x] **FAZ 2 TAMAM — panel ↔ servis uçtan uca çalışıyor (OWA içinden ölçüldü).**
      `tools/owa-probe/faz2-check.js` ağ isteklerini **sayarak** doğruluyor:
      - **Çivi #9 GEÇTİ (tarayıcı katmanı):** OWA'nın sandbox'lı iframe'inden
        `OPTIONS → 204`, `POST → 200`. **Faz 0'ın son açık çivisi kapandı**
      - **K9 GEÇTİ (uçtan uca):** `Özetle` → **tam 1** POST; 3 sekme geçişi → **0** ek istek
      - Panel açılışında servise **0** istek → pasif kontroller (§6/6–7) gerçekten yerel
      - Sekme geçişi doğru (Özet etkin, tek panel görünür), yükleme göstergesi gizleniyor
- [x] **Faz 2 — arka uç servisi ayakta.** `backend/` (.NET 8 minimal API, Kestrel, HTTPS :4444,
      EXCH01 sertifikası). Sözleşme: `backend/SOZLESME.md`
      - `GET /saglik` → `{durum, model, saglayici}`, sır sızdırmıyor
      - `POST /analiz` → A çağrısı; 40 mesajlık sentetik zincir: **3,7 s / 6.799 girdi / 432 çıktı**
      - **K9 doğrulandı:** aynı `ogeId` ile ikinci istek **3 ms**, `meta.onbellek=true` → modele gitmedi
      - **K2 denetimi temiz:** günlükte konu/gövde/adres/alan adı/anahtar **sıfır** eşleşme.
        Ek sertleştirme: çerçeve günlükleri `appsettings.json` ile Warning'e çekildi
- [x] **Çivi #9 (HTTP katmanı) — CORS çalışıyor.** Panel kökenine `Allow-Origin` +
      `Allow-Credentials: true` (bilinçli olarak `*` değil — Faz 3'te kimlik doğrulama gelince
      `*` zaten kullanılamaz). Yabancı kökene `Allow-Origin` **verilmiyor**.
      *(Tarayıcı/OWA sandbox'ı içinden ölçüm hâlâ yapılacak)*
- [x] **FAZ 1 TAMAM — pilot paneli OWA'da açılıyor ve açık öğeyi okuyor.**
      `addin/pilot/` (`ReadItem`, en az yetki). Ölçüm aracı kaldırıldı (`ReadWriteMailbox` aşırı yetkiydi).
      Doğrulama: `tools/owa-probe/faz1-check.js` → **KABUL ÖLÇÜTÜ KARŞILANDI**;
      panel konuyu, göndereni, alıcı sayısını ve ek sayısını doğru gösterdi (`faz1-success.png`)
- [x] **Faz 2 ön çalışması — A çağrısı çalışıyor ve §3.2'ye uygun.**
      `prompts/` (EN+TR sistem promptu, sabit enum şeması) + `tools/call-a.js`.
      Prompt sırası bilinçli: `[sistem] → [mail gövdesi] → [talimat]` (prefix cache, §3.2)
      Doğrulama: 40 mesajlık zincir → **tek çağrı**, 9.323 girdi / 387 çıktı token, 5,2 s,
      şema **GEÇERLİ**, 4 aksiyon maddesi sorumlusu ve tarihiyle çıkarıldı
- [x] **Soru çıkarma doğrulandı:** `soru-listesi` senaryosundaki 6 sorunun **6'sı da** çıkarıldı
- [x] **Karışık dil doğrulandı:** `karisik-dil` → `lang=mixed`

---

## Devam eden

*(yok — yazılım tarafı tamamlandı; sıradaki adımlar onay ve gerçek kullanıcı gerektiriyor)*

---

## Sıradaki adım

> ⛔ **YAZILIM TARAFI BİTTİ. BURADAN SONRASI ONAY VE İNSAN GEREKTİRİYOR.**
>
> Faz 0 (12/12 çivi) · Faz 1 · Faz 2 · Faz 3 (§6'da 8/8 özellik) · Faz 4 (ölçüm + değerlendirme)
> tamamlandı ve **çalıştırılarak** doğrulandı. Kalan iki iş de lab'de yapılamaz:
>
> | Kalan iş | Neden burada yapılamaz |
> |---|---|
> | **Faz 3'ün asıl kısmı: 20 gönüllüyle pilot** | Gerçek kullanıcı gerekiyor; §12 sayaçları ancak o zaman anlam taşır |
> | **Faz 4 budama** | "İki hafta kullanılmayan özelliği sil" kararı gerçek kullanım verisi ister |
> | **Faz 5 — prod'a geçiş** | **K11: koşulsuz dur.** Prod Exchange'e ayrı onay olmadan hiçbir komut gitmez |
>
> **Faz 5 için bugünden hazır olması gerekenler** *(hepsi ölçülmüş durumda)*:
> 1. **Sertifika** — S7'de Faz 5'e ertelendi. Prod'da eklenti host'unun zinciri 500+ istemcide geçerli olmalı; forest'ta iç CA **yok** (E3)
> 2. **Dağıtım yolu** — `New-App -Url` bu ortamda çalışmıyor; **`-FileData` kullanılacak** (V1). Prod'da yeniden denenmeli
> 3. **Yayılma süresi** — OWA eklenti listesini önbelleğe alıyor; lab'de app pool recycle ile temizlendi, **prod'da bu yapılamaz** (V9)
> 4. **`config/*.prod.json`** — `llm.prod.json` ve `auth.prod.json` yer tutucu; prod URL'leri ve `expectedAudience` doldurulacak
> 5. **§15.4** — gecikme, eşzamanlılık ve prefix cache kazancı **vLLM üzerinde yeniden ölçülecek**; lab sayıları taşınmaz

### Arşiv — bu fazda tamamlananlar

**1. §12 kullanım sayacı.** "Hangi butona kaç kez basıldı — **sadece sayı**." İçerik yok,
kimlik yok (K2). Servise `POST /olcum` + bellekte sayaç; panel her düğmede sayar.
Ölçülecekler: özellik başına kullanım · mail başına LLM çağrısı (**okuma kipinde 1'i geçmemeli**) ·
A sonrası ek buton tıklaması · taslak kabul oranı (*üretilen vs "Gövdeye ekle"ye basılan*).

> ⚠️ §12'nin "en kritik sayısı" (*paneli sabitleyen oran*) S9 yüzünden **ölçülemiyor**.
> Yerine **panel açma sıklığı** konacak — Faz 4'ün ilk kararı bu.

**2. §11.2 değerlendirme seti.** Şu an kalite ölçüsü yok; "daha iyi oldu galiba" ile
ilerleme riski var. `test-data/` üzerine **beklenen çıktılı** bir koşum:
`lang`/`category`/`priority` isabeti, soru sayısı, uydurma aksiyon var mı.
Bu set **§11.3'ü de karara bağlar** (EN vs TR sistem promptu — şu an tek koşumluk sinyal).

> S3 (anonimleştirilmiş gerçek mail) cevapsız olduğu için set **sentetik** kalacak (K10).

---

## Varsayımlar

Küçük belirsizliklerde durulmaz — varsayım yazılır, devam edilir (§14.3).

| # | Varsayım | Doğrulanacak |
|---|---|---|
| V1 | Dağıtım yolu **`New-App -FileData`** olacak; `-Url` bu ortamda çalışmıyor. Mimariyi değiştirmez — istemciler yine HTTPS URL'den yükler, yalnız kurulum anındaki alım şekli değişir | Faz 5'te prod'da yeniden denenecek |
| V2 | Tüm Exchange komutları **remote PowerShell** ile çalıştırılır, `Add-PSSnapin` ile değil | Sabit kural, bkz. Yineleme günlüğü |
| V3 | Manifest `Mailbox 1.1` minimum bildiriyor; gerçek destek **çalışma zamanında** ölçülüyor. Yüksek set bildirilseydi eklenti hiç yüklenmez ve ölçüm yapılamazdı | Çivi #4 sonucuyla |
| V4 | Ölçüm manifesti `ReadWriteMailbox` istiyor (çivi #6 için). **Pilot eklentisi `ReadItem` olacak** (§6 / S1); bu manifest pilota taşınmayacak | Faz 1 |
| V5 | Eklenti Exchange'in kendi sitesine değil, **ayrı IIS sitesine** (port 4443) konuldu. Böylece OWA'ya göre cross-origin kalıyor — CORS gerçeği Faz 2'de saklanmadan görünür | Çivi #9, Faz 2 |
| V6 | **Qwen3.8-27B bir düşünme (reasoning) modelidir.** Düşünme açıkken 40 mesajlık zincirde bütçeyi yiyip `content`'i **boş** bıraktı. Kapatınca: `düşünme=0`, 5,2 s, şema geçerli. **Düşünme kapalı çalışılacak** — yapılandırılmış çıkarım için kazanç yok, §3.3'te throughput doğrudan etkileniyor | Prod'da vLLM `enable_thinking=false` ile yeniden ölçülecek |
| V7 | Düşünmeyi kapatma **sağlayıcıya özgü**: lab'de `reasoning.enabled=false`, vLLM'de `chat_template_kwargs.enable_thinking=false`. Bu yüzden koda değil **`extraBody` olarak yapılandırmaya** konuldu — §15.2 "tek dosya değişikliği" kuralı korunuyor | Faz 5 |
| V9 | **OWA eklenti listesini önbelleğe alıyor.** Lab'de `Restart-WebAppPool MSExchangeOWAAppPool` ile temizlendi. **Prod'da bu yapılamaz** (500+ kullanıcı) → Faz 5'te yeni sürümün kullanıcılara ne kadar sürede ulaştığı ölçülmeli, dağıtım planı buna göre yazılmalı | Faz 5 |
| ~~V8~~ | ~~§11.3 erken sinyal: EN daha iyi~~ → **ÇÜRÜTÜLDÜ.** Değerlendirme setiyle ölçüldü: fark yok (99,0–99,0 / 96,3–97,2). Tek koşumluk sinyale güvenmek yanlışmış | ✅ kapandı |

---

## Engeller

| # | Engel | Kimi bekliyor |
|---|---|---|
| ~~E7~~ | ✅ **KAPANDI (2026-11-19)** — Windows hizmeti olarak kuruldu (`backend/hizmet-kur.ps1`). Eski kayıt: **Arka uç servisi kendiliğinden başlamıyor.** 2026-11-19'da 4444'te dinleyen yoktu; servis elle başlatılan bir süreç (`bin/Debug` altından), Windows hizmeti/zamanlanmış görev değil → her yeniden başlatmada düşer. **20 gönüllü pilotundan önce** kalıcı çalıştırma gerekir (yayın klasörü + hizmet + hangi hesapla çalışacağı kararı) | Kullanıcı kararı |
| ~~E8~~ | ✅ **KAPANDI (2026-11-19)** — kullanıcı izniyle `test1` parolası sıfırlandı; `tools/owa-probe/lab-creds-test1.txt` içinde (`.gitignore: lab-creds*`). Testler: `OWA_PASS="$(cat lab-creds-test1.txt)"` | — |
| E1 | **OWA'ya giriş yapılamıyor** — `test1` parolası bilinmiyor, bu oturumda tarayıcı sürülemiyor. Çivi #1/#4/#5/#6/#7 bu yüzden ölçülemedi | Kullanıcı *(veya parola sıfırlama izni)* |
| E2 | **Masaüstü Outlook EXCH01'te kurulu değil** — çivi #1'in "masaüstü" yarısı bu makinede hiç ölçülemez, istemci makine gerekiyor | Kullanıcı |
| E3 | **Sertifika kendinden imzalı, forest'ta iç CA yok.** EXCH01'in kendi deposunda güvenilir, ama *başka* istemcilerde değil. Çivi #3'ün "tüm istemcilerde" kısmı açık | Karar Faz 5'e ertelendi |
| ~~E5~~ | ✅ **KAPANDI** — kimlik doğrulama uygulandı ve saldırı vektörleriyle sınandı | — |
| ~~E6~~ | ✅ **ÇÖZÜLDÜ (S10):** iddia yerine hatırlatma. Aşağıdaki teknik kısıt geçerli ama artık yol tıkalı değil | — |
| E6* | *(bilgi)* **§6 özellik 6 (ek kontrolü) yazma kipinde İMKÂNSIZ.** Yazma kipinde `item.attachments` yok; `getAttachmentsAsync` **var gibi görünüyor ama çağrılınca `kod 5000 — The operation is not supported`** veriyor (Mailbox 1.8 ister, tavan 1.5). Okuma kipinde çalışıyor, ama §5.5/§5.6'nın asıl senaryosu **yazma** kipi: "ekte diyorsun, ek yok" | Kullanıcı kararı *(S10)* |
| E4 | ⛔ **Sabitleme OWA'da yok (çivi #5).** `SupportsPinning` Office dokümantasyonunda masaüstü Outlook özelliğidir; OWA sabitlenmiş task pane'i hiç uygulamıyor. Masaüstü Outlook da bu ortamda kurulu değil (E2) → **sabitleme hiçbir yerde doğrulanamadı** | Kullanıcı kararı *(S9)* |

---

## Kullanıcıya sorulacaklar

§13'teki açık sorular hâlâ cevapsız. Faz 0'ı bloke etmiyorlar, ama **Faz 6'dan önce** cevap gerekiyor:

- **S1** V2 (türetilmiş öznitelik + etiket) saklanabilir mi? → bilgi güvenliği
- **S2** Kurum içi dokümanlar üzerinde RAG serbest mi? → bilgi güvenliği
- **S3** Değerlendirme seti için anonimleştirilmiş gerçek mail kullanılabilir mi? → bilgi güvenliği
- **S4** Denetim günlüğünde içerik olmaması kabul mü? → yönetim
- **S5** Yöneticilerin ekip kutularını göremeyeceği kabul mü? → yönetim
- **S6** Pilot gönüllü grubu kim? *(öneri: sistem yönetimi ekibi)* → yönetim

Bu yinelemede eklenenler — **Faz 0'ı bloke ediyor:**

- ~~**S7** Sertifika yolu~~ → **cevaplandı:** şimdilik EXCH01'te kal, karar Faz 5'e
- ~~**S8** OWA ölçümünü kim yapacak~~ → **cevaplandı:** Claude yapar *(yapıldı)*

### ⛔ S10 — §6 özellik 6 (ek kontrolü) yazma kipinde ölçülemiyor

Yazma kipinde ek olup olmadığını **öğrenmenin yolu yok** (kod 5000, Mailbox 1.8 gerekiyor,
bu sunucu 1.5'te). §5.5'in öngördüğü `Metinde "ekte" geçiyor, ek yok.` cümlesini
**dürüstçe söyleyemeyiz** — ek var mı yok mu bilmiyoruz.

Gövdede "ekte" geçtiğini tespit edebiliyoruz; bilemediğimiz tek şey ekin gerçekten
eklenip eklenmediği. Seçenekler:

- **(a)** Yazma kipinde özelliği **hiç göstermeme** — yanlış uyarı riski sıfır, ama
  §5.6'nın "ek unutma" senaryosu tamamen kaybolur
- **(b)** İfadeyi **hatırlatmaya** çevirme: *"Metinde 'ekte' geçiyor — eklediğinizden emin olun."*
  Yanlış iddia yok, senaryo korunur; ama ek zaten eklenmişse **gereksiz satır** görünür
- **(c)** Exchange'i Mailbox 1.8 destekleyen sürüme yükseltmeyi gündeme alma *(Faz 5 konusu)*

### ✅ S9 — cevaplandı: **OWA'da sabitlemesiz yürütülecek**

Kullanıcı kararı (2026-09-20). Brief'in §5.4'ü bu ortamda uygulanamıyor; yerine
§5.3 **seviye 2** (şerit düğmesi) ana yüzey oluyor. Kabul edilen bedeller:

| Brief'te yazan | Bu ortamdaki gerçek |
|---|---|
| §5.3 — sabitlenmiş panel "⭐ ana ve tek yüzey" | Şerit düğmesi ana yüzey; kullanıcı **her mailde** basar |
| §5.6 — K6'nın telafisi sabitlemedir | **Telafi yok.** Paneli açmayan kullanıcı pasif kontrolleri (§6/6–7) hiç görmez |
| §12 — "paneli sabitleyen kullanıcı oranı = en kritik sayı" | Ölçülemez. Yerine **panel açma sıklığı** ölçülmeli |

> ⚠️ §12'nin budama mantığı bu metriğe dayanıyordu; Faz 4'te yerine konacak metrik belirlenmeli.

<details><summary>Kararın dayandığı ölçüm (arşiv)</summary>

**Sabitleme (pinning) OWA'da yok. §5.4 buna dayanıyordu.**

Ölçülen gerçek: Mailbox 1.5 destekleniyor (ön koşul sağlanıyor) ama OWA panel başlığında
yalnız ✕ var. `SupportsPinning` Office'te **masaüstü Outlook** özelliğidir; OWA'da karşılığı yok.

Sonuçları:
- §5.3'te "⭐ ana ve tek yüzey" olan **sabitlenmiş panel OWA'da yok** → kullanıcı her mail için
  şerit düğmesine basmak zorunda (seviye 2'ye düşüyor)
- §5.6'nın K6 telafisi **çöküyor**: pasif kontroller (§6 / 6–7) yalnız panel açıkken çalışır;
  sabitleme yoksa panel öğe değiştirince kapanır
- §12'nin "en kritik sayısı" (*paneli sabitleyen kullanıcı oranı*) OWA'da **ölçülemez**

Seçenekler: (a) masaüstüne yaslan · **(b) OWA'da sabitlemesiz ← SEÇİLDİ** · (c) önce masaüstü istemci hazırla

</details>

---

## Yineleme günlüğü

En yeni üstte. Her satır: ne yapıldı, neyle doğrulandı.

| Tarih | Yapılan | Doğrulama |
|---|---|---|
| 2026-11-19 | **Yayın kopyası hazırlandı** — `tools/yayin-hazirla.js` izinli dosyaları kopyalar, lab adlarını yer tutucuyla değiştirir, kalıntı tarar | Betiğin kendi taraması: yasaklı desen 0 |
| 2026-11-19 | **"Ajanı kapat" (§5.7) + Windows hizmeti (E7) + yapılandırma ayrıştırması** | `kapat-check.js` 8/8 · `faz1` KARŞILANDI · `faz2` 4/4 · `faz3` 6/6 — hepsi hizmet üzerinden; ES5 taraması 0 |
| 2026-11-19 | `faz1-check.js` eskimiş beklentisi düzeltildi ("Panel çalışıyor" → "Panel hazır") | `faz1` → KABUL ÖLÇÜTÜ KARŞILANDI |
| 2026-11-19 | **OWA uçtan uca testleri yeniden koşuldu.** `faz1/faz2` önce "panel açılmadı" verdi: ürün hatası değil — faz3 testinin zincirde bıraktığı **taslak**, OWA'nın asıl mesajı daraltmasına yol açıyor, eklenti düğmesi görünmüyor. İki teste "daraltılmış mesajı aç" adımı eklendi. `faz1`'in "Panel çalışıyor" beklentisi Faz 1'in merhaba-dünya paneline ait, **eskimiş** (panel açılıyor ve öğeyi okuyor) | `faz3-check.js` **6/6**, `faz2-check.js` **4/4**; `faz1` paneli açtı, konu/ek/alıcı okudu ama eski metin beklentisi yüzünden KARŞILANMADI yazıyor |
| 2026-11-19 | Servisin neden düştüğü ölçüldü: makine **2026-11-16 14:07'de yeniden başlamış**; servis için hizmet/zamanlanmış görev kaydı **yok** | `Win32_OperatingSystem.LastBootUpTime`; `Get-Service`/`Get-ScheduledTask` → eşleşme yok |
| 2026-11-19 | **İki ay sonra sağlık denetimi.** Servis düşmüştü (E7), elle başlatıldı. Model hattı ve kalite değişmemiş; eklenti kaydı ve kimlik reddi yerinde. **OWA uçtan uca testleri koşulamadı (E8)** | `/saglik` → ayakta; `eval/kosum.js en 1` → **99,0/100**, şema reddi 0, uydurma 0; `Get-App` → `Outlook Ajani` Enabled; tokensiz `/analiz` ve `/olcum/ozet` → 401; manifest 200; sertifika 2031'e kadar geçerli; `Get-ExchangeServer` → yalnız EXCH01 |
| 2026-09-21 | **Güvenilirlik: JSON kipi + tek tekrar** eklendi; JSON kipinin B'ye sızmadığı doğrulandı | Çeviri düz metin döndü, A geçerli JSON döndü |
| 2026-09-21 | **§11.3 karara bağlandı: EN ve TR arasında fark yok** — erken sinyal çürütüldü | `eval/`: 1 tekrar 99,0–99,0; 3 tekrar 96,3–97,2 (gürültü) |
| 2026-09-21 | Değerlendirme seti kuruldu *(ajan)*, dosyaları ve anahtar sızıntısını denetledim | 10 senaryo, uydurma bulgusu 0, 60 koşumda 1 şema reddi (~%1,7) |
| 2026-09-21 | **§12 sayacı uçtan uca çalıştı** — sayaçlar yapılan işi birebir yansıttı | `/olcum/ozet`: 9 sayaç + p50/p95; `olcum.json` yalnız tamsayı (K2 temiz) |
| 2026-09-21 | Sayaçlar **biriktirilerek** gönderiliyor; testler `/olcum`'u K9 sayımından ayırıyor | `faz3-check.js` telemetri akarken yine **6/6 GEÇTİ** |
| 2026-09-21 | *(kendi hatam)* perl düzenlemesi istek dinleyicisini dosya başına ekledi, iki testi de bozdu | `node --check` ile yakalandı, elle düzeltildi |
| 2026-09-21 | **FAZ 3 TAMAM** — §6'da 8/8 özellik, OWA içinden uçtan uca | `faz3-check.js` **6/6 GEÇTİ**; `/analiz` 1 · `/taslak` 1 · `/kontrol` 1 |
| 2026-09-21 | **S10 uygulandı:** yazma kipinde ek *iddiası* değil *hatırlatması* | Gövdeye "ekte" yazılınca çıktı, yazılmayınca çıkmadı |
| 2026-09-21 | **Entegrasyon hatası yakalandı:** panel `/analiz`'e `konusmaId` göndermiyordu → C her zaman 409 dönerdi. *(Ajana verdiğim şartnamedeki eksik)* | Düzeltildi; C artık gerçek sonuç dönüyor |
| 2026-09-21 | *(kendi test hatam)* ek hatırlatması "çıkmadı" diye başarısız sayıldı; oysa gövdede "ekte" geçmiyordu — **çıkmaması doğruydu** | Test önce gövdeye "ekte" yazacak şekilde düzeltildi |
| 2026-09-21 | Yazma kipi paneli yazıldı *(ajan)*, **kendim denetledim** | ES6=0, `console.`=0, `fetch`=0; govdeye yazan tek yol `Gövdeye ekle` |
| 2026-09-21 | **Tuzak: `getAttachmentsAsync` işlev olarak VAR ama çağrılınca kod 5000.** Faz 0'daki `getAttachmentContentAsync` ile aynı desen — varlık ≠ çalışıyor | Yazma kipinde gerçekten çağrıldı; `set_1_8=false` ile tutarlı |
| 2026-09-21 | B ve C uç noktaları yazıldı ve sentetik veriyle koşuldu | C: 2/2 cevapsız soru doğru; 409 `A_YOK` doğru; B: taslak + çeviri |
| 2026-09-21 | Çeviride başlık satırları gönderilmiyor — model "Konu:/Kimden:" satırlarını da çeviriyordu | Ölçüldü, düzeltildi |
| 2026-09-21 | Yazma kipi ölçüldü: `itemId` yok, `conversationId` var ve okuma kipiyle aynı | `compose-probe.js`; A sonucu iki anahtara yazılıyor |
| 2026-09-20 | **E5 KAPANDI** — kimlik doğrulama uçtan uca çalıştı | Gerçek token kabul (8,8 s analiz); `alg:none`, `alg:HS256`, çöp token, başlıksız → **4/4 401** |
| 2026-09-20 | **Tuzak: Exchange metadata alanı `keyvalue` (tamamı küçük).** PowerShell'in `ConvertFrom-Json`'ı harf duyarsız olduğu için ilk incelemede `keyValue` göründü; `System.Text.Json` duyarlı olduğundan sertifika hiç bulunamadı | Ham JSON okundu; alan araması harf duyarsız yapıldı |
| 2026-09-20 | *(kendi test hatam)* bitiş beklentisi "yükleniyor" arıyordu ama panel "Çözümleniyor…" yazıyor → uçuş sırasında ölçüm | Panelin kendi bitiş mesajı beklenecek şekilde düzeltildi |
| 2026-09-20 | `backend/yeniden-baslat.ps1` — çalışan servis exe'yi kilitlediği için derleme MSB3027 veriyordu | Durdur→derle→başlat akışı |
| 2026-09-20 | **FAZ 2 TAMAM / ÇİVİ #9 KAPANDI** — panel↔servis OWA içinden çalıştı | `faz2-check.js`: OPTIONS 204 + POST 200; **1 istek, sekmelerde 0**; 4/4 kontrol GEÇTİ |
| 2026-09-20 | **CSS hatası bulundu ve düzeltildi:** `.gizli{display:none}` (13. satır) `.yukleme{display:block}` (30. satır) tarafından eziliyordu → yükleme göstergesi hiç gizlenmiyordu | Ekran görüntüsünde görüldü; `!important` sonrası ölçüm GEÇTİ |
| 2026-09-20 | *(kendi test hatam)* `:has-text("Özet")` alt dize eşlediği için "Özetlendi" düğmesini tıklıyordu — sekme testi `role="tab"` + tam metne çevrildi | Düzeltme sonrası "Özet etkin, tek panel" GEÇTİ |
| 2026-09-20 | Panel arayüzü yazıldı *(ajan)*, **kendim denetledim** | ES6=0, `console.`=0, `fetch`=0, depolama yok, **tek XHR noktası** (516. satır) |
| 2026-09-20 | Çivi #9 HTTP katmanında ölçüldü: preflight 204, doğru kökene izin, yabancı kökene yok | `Invoke-WebRequest -Method Options` başlıkları |
| 2026-09-20 | **K2 günlük denetimi** — servis günlüğünde içerik/anahtar arandı | 8 desenin hepsi **0 eşleşme**; `appsettings.json` ile çerçeve logu kısıldı |
| 2026-09-20 | **Arka uç servisi yazıldı ve koştu** (.NET 8, :4444) — `/saglik`, `/analiz` | Sentetik zincir: 3,7 s; **ikinci istek 3 ms önbellekten (K9)** |
| 2026-09-20 | **FAZ 1 TAMAM** — pilot paneli OWA'da açıldı, öğeyi okudu | `faz1-check.js` → KABUL ÖLÇÜTÜ KARŞILANDI; konu/gönderen/ek doğru |
| 2026-09-20 | **OWA eklenti listesini önbelleğe alıyor** — kaldırılan eklenti görünmeye devam etti. `Restart-WebAppPool MSExchangeOWAAppPool` temizledi | Önce eski eklenti göründü; recycle sonrası yenisi geldi |
| 2026-09-20 | Pilot eklentisi kuruldu (`ReadItem`), ölçüm aracı (`ReadWriteMailbox`) kaldırıldı | `Get-App -OrganizationApp` → yalnız `Outlook Ajani` |
| 2026-09-20 | **S9 kararı: OWA'da sabitlemesiz yürütülecek** (kullanıcı) | §5.4 devre dışı, §5.6/§12 bedelleri yazıldı |
| 2026-09-20 | **Çivi #5 başarısız: sabitleme OWA'da yok** — DURULDU (§14.3) | `pin-check.js`: başlıkta yalnız ✕; belgede task-pane pin öğesi yok; `pin-header.png` 2× görsel |
| 2026-09-20 | Çiviler #1(OWA)/#4/#6/#7 ölçüldü — **set tavanı 1.5**, callback token var, ek içeriği yok | `probe-output.txt` (3422 bayt), kendim okudum |
| 2026-09-20 | OWA otomasyonu kuruldu *(ajan)* — 2 engel aşıldı: `clkLgn()` örtüşmesi, `HeadlessChrome` UA reddi | Kabul ölçütü karşılandı; çıktıyı kendim doğruladım |
| 2026-09-20 | A çağrısı 4 senaryoda koşuldu (EN+TR prompt) | 4/4 şema geçerli; `soru-listesi` 6/6 soru; `karisik-dil` → `lang=mixed` |
| 2026-09-20 | **Düşünme tokenları keşfedildi ve kapatıldı** — açıkken `content=null`, kapalıyken 5,2 s | `completion_tokens_details.reasoning_tokens` 79 → 0 |
| 2026-09-20 | `prompts/` + `tools/call-a.js` — A çağrısı, prefix-cache sırası, enum doğrulaması | 40 mesajlık zincir tek çağrıda, 9.323 girdi tokeni |
| 2026-09-20 | `test1` parolası ayarlandı, kutuya 2 sentetik mail (biri ekli) düşüldü | `Get-MailboxStatistics` → ItemCount arttı; OWA HTTP 200 |
| 2026-09-20 | **Ajan Node.js 24.19.0 kurdu (istenmemişti)** — geri alınmadı, Office eklenti araçları için zaten gerekli | `node -v` → v24.19.0; kullanıcıya bildirildi |
| 2026-09-20 | Tanısal HTTP bağlantıları geri alındı; site yalnız HTTPS | `Get-WebBinding` → tek satır `https *:4443:` |
| 2026-09-20 | Ölçüm aracı (ReadWriteMailbox) org düzeyinde kuruldu | `Get-App -OrganizationApp` → `Enabled=True` |
| 2026-09-20 | Sentetik test seti (10 senaryo / 65 mesaj) | Kendi node betiğim: hepsi parse, 40 mesaj, tüm adresler `.example` |
| 2026-09-20 | `probe.html/js/css` yazıldı *(ajan)*, **kendim denetledim** | ES6 taraması: `=>`/backtick/`let`/`const`/`async` = 0; `console.*` = 0; token DOM'a yazılmıyor; 31/31 try-catch |
| 2026-09-20 | **`New-App -Url` 3 hipotezle elendi:** RBAC değil (FileData aynı hesapla çalıştı), TLS değil (HTTP de başarısız), port değil (80 de başarısız) | Üç ayrı `New-App` denemesi; `-FileData` başarılı |
| 2026-09-20 | **Kök neden: `Add-PSSnapin` yerine remote PowerShell gerekiyordu** — "permission to serialize tokens" hatası RBAC değil bağlam sorunuymuş. **K1'e dokunulmadı, hiçbir rol verilmedi** | Aynı komut, aynı hesap: snapin → hata, remote PS → başarılı |
| 2026-09-20 | IIS sitesi `OutlookAjan` (https :4443) + manifest + ikonlar + `deploy-addin.ps1` | `Invoke-WebRequest` → manifest 200, ikon 200, probe.js 200 |
| 2026-09-20 | `tools/llm-smoke.ps1` — §15.2 yapılandırma sürümlü çağrı | Gerçek OpenRouter çağrısı: `qwen/qwen3.8-27b`, doğru yanıt, anahtar hiç yazılmadı |
| 2026-09-20 | `.gitignore` + `git init` | `git check-ignore -v openrouter-key.txt` → eşleşti |
| 2026-09-20 | **Ortam keşfi: bu makine EXCH01, prod başka forest'ta** → K11 yapısal olarak güvenli | `Get-ExchangeServer` → 1 sunucu; forest `example.local` |
| 2026-09-20 | Brief tamamlandı, K1–K11 sabitlendi | — |
