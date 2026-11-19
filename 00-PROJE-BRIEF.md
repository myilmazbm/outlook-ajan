# Outlook Ajanı — Proje Brief

> Bu dosya, yazılacak Outlook eklentisi ve arka uç servisi için **tek kaynak spesifikasyondur**.
> Yeni bir oturuma başlarken bu dosyayı ilk olarak okut.

**Tarih:** 2026-09-20
**Hedef:** Yerel LLM üzerinde çalışan, çalışan ve yöneticilere mail işlerinde yardımcı olan bir Outlook eklentisi.
**Konuşlanma:** On-prem Exchange, kurum içi GPU altyapısı. **Üretimde hiçbir mail verisi kurumdan çıkmaz.**
**Geliştirme ortamı ayrıdır:** lab'de GPU yoktur, test dış bir API üzerinden yapılır — bu yüzden lab'e yalnızca sentetik veri girer (K10 / §15).

---

## 1. Pazarlık edilemez kısıtlar

Bunlar tartışılmış ve karara bağlanmıştır. Tasarımın geri kalanı bunlardan türer. **Bir öneri bu kısıtlardan biriyle çelişiyorsa öneri yanlıştır.**

| # | Kısıt | Gerekçe |
|---|---|---|
| K1 | **Hizmet hesabı yok. `ApplicationImpersonation` yok.** | Bilgi güvenliği kabul etmiyor |
| K2 | **Mail içeriği hiçbir yere kalıcı olarak yazılmaz** | Veri güvenliği politikası |
| K3 | **Gömme (embedding) vektörü saklanmaz** | Vektör ≠ anonimleştirme; inversion ile metin geri üretilebilir |
| K4 | **Arka planda / gece çalışma yok** | K1'in doğal sonucu |
| K5 | **Tek model: Qwen3.8-27B.** Tüm işleri o yapar | Operasyonel sadelik |
| K6 | **Eklenti yalnızca kullanıcı paneli açıkken çalışır** | Kullanıcı rahatsızlığını önleme |
| K7 | **Gönderim asla durdurulmaz** | Kullanıcı deneyimi kararı |
| K8 | **Ajan mail göndermez, silmez, taşımaz** | Geri alınamaz eylem yasağı |
| K9 | **Bir mail için tek istek.** Aynı girdiden türeyen işler ayrı çağrılara bölünmez | GPU israfını önleme |
| K10 | **Lab/geliştirme ortamında asla gerçek mail verisi kullanılmaz.** Test verisi sentetik veya anonimleştirilmiştir | Geliştirme sırasında dış API kullanılıyor (§15) |
| K11 | **Tüm geliştirme ve test `EXCH01` lab ortamında yapılır. Prod Exchange'e hiçbir aşamada dokunulmaz.** Prod'a geçiş yalnızca Faz 5'te, ayrı onayla | Faz 0 organizasyon düzeyinde kayıt yapıyor (`New-App`); prod'da 8 sunucu ve 500+ kullanıcı etkilenir |

---

## 2. Mimari kararlar ve gerekçeleri

### 2.1 Eklenti tipi: Office.js (VSTO değil)

| | Office.js | VSTO / COM |
|---|---|---|
| Çalıştığı yer | OWA, yeni Outlook, klasik Outlook, Mac, mobil | Sadece klasik Outlook / Windows |
| Gördüğü | **Yalnızca açık olan öğe** | MAPI ile tüm mailbox |
| Geleceği | Var | Yeni Outlook'ta yok |

500+ kullanıcı ve yeni Outlook geçişi nedeniyle **VSTO çıkmaz sokak**. Office.js seçildi.

### 2.2 Mail erişimi: üç seviye

Office.js'in nesne modeli **öğe kapsamlıdır**. `Office.context.mailbox.item` ile açık mailin gövdesi, göndereni, konusu okunur. Klasör gezme, arama, "okunmamışlar" **yoktur**.

| Seviye | Erişim | Yetki dayanağı | Durum |
|---|---|---|---|
| **S1** | Açık öğe | Eklentinin kendisi | ✅ Pilot kapsamı |
| **S2** | Kullanıcının tüm mailbox'ı | `getCallbackTokenAsync` + manifest `ReadWriteMailbox` | 🔶 Faz 6 |
| **S3** | Başkalarının mailbox'ı | `ApplicationImpersonation` | ❌ **K1 ile yasak** |

**S2 önemli:** kullanıcının kendi oturumu yetki verdiği için hizmet hesabı gerekmez. Ama token kısa ömürlüdür ve kullanıcı oturumuna bağlıdır — yani yalnızca **kullanıcı tetiklediği** işler yapılabilir (K4 ile tutarlı).

### 2.3 Etkinleşme: %100 kullanıcı tetiklemeli

**`OnMessageSend` ve event-based activation kullanılmayacaktır.** Sebep: K7 (gönderim durdurulmayacak). Office.js'te ya gönderimi engellersiniz (dialog çıkar) ya izin verirsiniz (öğe kapanır, gösterecek yer kalmaz) — arası yoktur.

Bu kararın yan faydaları:

- ⚠️ On-prem requirement set riski **ortadan kalktı** (event-based activation bulut odaklı bir özellik)
- Manifest belirgin şekilde basitleşti
- Arka planda token kullanımı yok
- Bilgi güvenliğine anlatımı net: **panel kapalıysa ajan hiçbir şey görmüyor**

---

## 3. Model katmanı

### 3.1 Tek model

**Qwen3.8-27B** — 14 Ağustos 2026, Apache 2.0.

| | |
|---|---|
| Mimari | 27B **dense**, 64 katman |
| Girdi | **Multimodal** — metin, görsel, video |
| Bağlam | 262k native (1M'e genişletilebilir) |
| İş | **Hepsi** — sınıflandırma, dil tespiti, özet, aksiyon çıkarma, taslak, çeviri |

Ayrı bir sınıflandırma modeli **yoktur ve gerekmez.** §3.2'deki analiz çağrısı `lang`, `category` ve `priority` alanlarını zaten asıl modelin çıktısında üretiyor. İkinci bir model çağırmak, aynı maili **ikinci kez prefill etmek** demektir — tasarruf değil, israf.

> **Tek istisna, ileride çıkarsa:** Faz 6'daki toplu triyaj (bir kullanıcının 200 mailini tek seferde etiketleme) özet üretmeyi gerektirmez, yalnızca etiket üretir. Orada küçük bir sınıflandırma modeli maliyeti düşürebilir. **Faz 6 onaylanırsa ölçülür; o güne kadar mimaride yeri yoktur.**

### 3.2 Tek istek ilkesi (K9)

#### Neden

Mail işlerinde maliyetin çoğu **çıktıda değil, girdide**. 40 mesajlık bir zincir ~15.000 token; özet ~150 token. Yani asıl iş, mailin okunması (prefill).

Kullanıcı sırayla "Özetle", "Aksiyonlar", "Sorular" derse ve her biri ayrı çağrı olursa, **aynı 15.000 token üç kez** işlenir. Tek çağrıda hepsi üretilirse bir kez işlenir.

> **Kural:** aynı girdiden türeyen her şey **tek çağrıda** üretilir. Kullanıcı hangi bölüme baktıysa panel onu gösterir, gerisi zaten hazır bekler.

#### Üç çağrı şekli

Her şeyi tek çağrıya sıkıştırmak da doğru değil — bazı işler farklı girdi kullanır veya uzun çıktı üretir. Toplam **üç** şekil vardır, fazlası yoktur:

| | **A — Analiz** | **B — Üretim** | **C — Taslak kontrolü** |
|---|---|---|---|
| Girdi | Açık mail | Açık mail + kullanıcı niyeti | **A'nın çıktısı** + kullanıcının taslağı |
| Çıktı | Kısa, yapılandırılmış | Uzun, serbest metin | Kısa, yapılandırılmış |
| Ne zaman | İlk butona basıldığında, **bir kez** | Kullanıcı özellikle istediğinde | "Kontrol et" |
| Kapsar | Dil, kategori, öncelik, **özet**, **aksiyonlar**, **sorular**, cevap gerekli mi | **Taslak**, **çeviri** | Eksik cevap kontrolü |

**A çağrısının çıktısı:**

```json
{
  "lang": "tr",
  "category": "action_required",
  "priority": 3,
  "reason_code": "deadline_mentioned",
  "reply_needed": true,
  "summary": "...",
  "action_items": ["...", "..."],
  "questions": ["...", "..."]
}
```

Tek çağrı; panelin **dört** butonunu birden dolduruyor (özet, aksiyonlar, sorular, öncelik).

**B neden ayrı:**
- **Taslak** kullanıcının ton tercihine bağlı (kısa/detaylı/resmi) — A anında bu bilgi yok
- **Çeviri** uzun çıktı üretir; her mail için üretilse yalnızca isteyenlerin kullandığı bir maliyet doğar
- İkisi de **her mailde gerekmez**; A ise panel açıldığında zaten anlamlı

**C neden ayrı — ve neden ucuz:**

Girdisi açık mail değil, **kullanıcının yazdığı taslaktır**; o yüzden A veya B ile birleşemez.

Ama orijinal maili **yeniden okumasına gerek yoktur.** A zaten `questions` dizisini üretmiştir. C'nin girdisi:

```
[A'nın questions dizisi]  +  [kullanıcının taslağı]
```

Yani C, 15.000 token'lık zinciri değil, birkaç yüz token'ı işler.

> ⚠️ **Yazma modunda açık öğe, cevaplanan mail değil, taslağın kendisidir.** Önbellek öğe kimliğine göre tutulduğu için C, önce **cevaplanan mailin** (parent) kimliğini çözmeli ve A sonucunu ondan almalıdır.
>
> Parent için A hiç çalışmadıysa: panel ya "önce özet alın" der, ya da sessizce parent üzerinde A'yı tetikler. **C tek başına çalışamaz.**

#### Prefix cache uyumlu prompt sırası

A ve B aynı maili kullandığı için, prompt'lar **ortak önek** paylaşacak şekilde kurulmalı:

```
[sistem prompt]  ->  [mail gövdesi]  ->  [göreve özel talimat]
      sabit              sabit                değişken
```

Bu sırayla vLLM'in **prefix caching**'i devreye girer: kullanıcı A'dan sonra B isterse mail ikinci kez prefill edilmez, KV cache'ten okunur. Talimatı başa koyarsanız bu kazanç tamamen kaybolur.

> Prefix cache yalnızca GPU belleğinde yaşar, diske yazmaz — §4.2 ile uyumludur.

#### Oturum içi önbellek

A çağrısının sonucu **bellekte**, öğe kimliğine göre tutulur; kullanıcı aynı maile geri dönerse yeniden çağrı yapılmaz.

> ⚠️ **Yalnızca RAM.** Diske, veritabanına veya tarayıcı depolamasına yazılmaz (K2). Oturum bitince kaybolur — bu istenen davranıştır.

#### A çağrısı ne zaman tetiklenir

**Seçim değiştikçe otomatik değil.** Sabitlenmiş panelde kullanıcı gün içinde yüzlerce maile tıklar; her tıklamada analiz yapmak, gerçek kullanımın kat kat üstünde yük üretir.

**Kural: A, kullanıcı ilk butona bastığında çalışır.** Yük, gerçek kullanımla orantılı kalır.

*(Uzun zincirlerde otomatik tetikleme sonradan denenebilir, ancak §12'de ölçülmeden açılmaz.)*

#### reason_code uyarısı

> ⚠️ **`reason_code` sabit enum olmalı, serbest metin değil.** Model kendi cümleleriyle gerekçe yazarsa o cümle mail içeriğinden alıntı taşır ve **loglara içerik sızar (K2 ihlali)**. Serbest metin üreten hiçbir alan kalıcı hale getirilmez.

`summary`, `action_items` ve `questions` serbest metindir — **panelde gösterilir, asla loglanmaz veya saklanmaz.**

### 3.3 Sunum: vLLM + LiteLLM

Mevcut donanım: **2× H200 (141 GB)**. İhtiyaç halinde 8× B300 alınabilir — **şimdilik gerekmiyor**, darboğaz GPU olmayacak.

```
GPU 0 ─ Qwen3.8-27B replika A ─┐
                               ├─ LiteLLM ─ Ajan servisi
GPU 1 ─ Qwen3.8-27B replika B ─┘
```

**TP=2 değil, 2 replika (DP).** 27B dense BF16 ≈ 54 GB, tek H200'e rahat sığıyor. İş yükü toplu/kısa istekler; **throughput önemli, gecikme değil.** Tensor parallel bu profilde toplam verimi düşürür.

> ⚠️ **`--max-model-len` mutlaka düşürülecek.** 262k varsayılanla açılırsa KV cache belleği yutar ve eşzamanlı istek sayısı çöker. Mail için **8k–32k** yeterlidir. 500 kullanıcıda throughput burada belirlenir.

### 3.4 Multimodal fırsatı

Qwen3.8-27B görsel ve video kabul ediyor. Mail bağlamında karşılığı:

- Gövdeye gömülü tablo ve ekran görüntüsü
- Taranmış fatura / imzalı evrak
- Hata ekranı görselleri

Ayrı bir OCR hattı kurmadan ele alınabilir. **Faz 8 opsiyonu**, pilotta yok.

---

## 4. Veri yönetişimi

### 4.1 İşleme modeli

Mail içeriği RAM'de yaşar → GPU'ya gider → sonuç döner → **referans bırakılmaz.** Diskle hiç temas etmez.

### 4.2 İçerik üç yerden sessizce diske sızar

Bu bölüm kod incelemesinin zorunlu maddesidir.

| Nerede | Risk | Yapılacak |
|---|---|---|
| **LiteLLM** | Spend tracking / logging özelliği istek ve yanıt gövdesini veritabanına yazabilir | İçerik loglamayı açıkça kapat; `detailed_debug` kapalı; tüm callback entegrasyonlarını denetle |
| **vLLM** | Request logging prompt'u stdout'a basar; log toplayıcı varsa kalıcı hale gelir | Request logging kapalı. Prefix cache yalnız GPU belleğinde, diske yazmaz — sorun değil |
| **Kendi kodunuz** | `try/except` içindeki exception trace çoğu zaman prompt'un tamamını içerir | Hata yakalamada gövde **asla** trace'e konmaz |

Üçüncüsü en sinsisidir. Tek bir satır, bilgi güvenliğine verilen sözü bozar.

### 4.3 Denetim günlüğü sınırı

| Yazılabilir | Yazılamaz |
|---|---|
| Zaman damgası | Konu |
| Takma kullanıcı kimliği (HMAC, anahtar ayrı) | Gövde |
| Model adı | Gönderen adresi |
| Token sayıları | Alıcılar |
| Gecikme | Ek adları |
| Dönen kategori | Model çıktısının serbest metni |
| Hata kodu | |

**Kabul edilen bedel:** *"Ajan geçen salı mailimi yanlış sınıflandırdı"* şikâyeti **geriye dönük incelenemez.** İlgili mail elimizde yoktur. Çözüm: kullanıcının o an "bunu incele" diyerek olayı kendi rızasıyla göndermesi. **Bu, yöneticilere baştan söylenmelidir.**

### 4.4 Etiket verisi nerede duracak

K2 ve K3 altında öğrenme döngüsü üç katmanda kurulur. Hiçbirinde mail içeriği yoktur.

#### V1 — Kullanıcının kendi mailbox'ı

`Office.context.roamingSettings` verisi kullanıcının kendi mailbox'ında saklanır. Yeni veri deposu kurulmaz; veri zaten bulunduğu yerde kalır. Yönetişim savunması kolay: *"Kullanıcının tercihleri kendi kutusundan çıkmıyor."*

Sınır: ~32 KB, kullanıcıya özel, kurum geneli öğrenme yok.
Kullanım: susturulan göndericiler, kişisel öncelik ayarları, kapatılan özellikler, panel tercihleri.

#### V2 — Türetilmiş öznitelikler + etiket *(ayrı onay gerektirir)*

Saklanan şey mail değil, **mail hakkındaki sayılardır**. Sabit ve denetlenebilir şema:

| Öznitelik | Örnek |
|---|---|
| Gönderen domain'i (adres değil) | `firma.com.tr` |
| İç / dış gönderen | `internal` |
| TO mu CC mi | `to` |
| Alıcı sayısı | `7` |
| Zincir derinliği | `4` |
| Uzunluk kovası | `medium` |
| Ek var mı | `true` |
| Gün içi saat | `09` |
| Bu göndericiye geçmiş ortalama cevap süresi | `2.1 saat` |
| Modelin verdiği etiket | `action_required` |
| Kullanıcının düzeltmesi | `informational` |

**Dayanak:** öncelik tahmini büyük ölçüde **davranışsaldır**, metinsel değil. *"Bu kişiye genelde 2 saat içinde cevap veriyorum"* sinyali, mailin içeriğinden daha güçlüdür. İçerik saklamadan işe yarar bir sınıflandırıcı eğitilebilir.

Yanında zorunlu: takma kullanıcı kimliği, sabit saklama süresi (öneri: 180 gün), şema dışına çıkan hiçbir alanın yazılmasına izin vermeyen bir doğrulama katmanı.

#### V3 — Hiçbir şey

Yönetim "hiç veri olmasın" derse bu da geçerli bir seçimdir: sürekli zero-shot. Model iyileşmez ama çalışır.
**V2 projeye gömülmez; ayrı bir onay olarak sunulur.**

### 4.5 K3'ün sonucu: RAG masadan kalkıyor

Kalıcı vektör deposu kurulamayacağı için **geçmiş mailler üzerinde RAG yapılamaz.** V2'deki öznitelik tablosu bunun yerine geçer.

---

## 5. Kullanıcı deneyimi kuralları

### 5.1 Yönetici kural

> **Mail okumak bir karar anı değildir. Gönder'e basmak karar anıdır.**
> Okurken kesinti = öfke. Ama K7 gereği gönderimde de durdurma yok.

Sonuç: **hiçbir anda kesinti yok.** Kontroller gönderim anından **öne alınır**, yazarken sessizce gösterilir.

> **Deterministik kontroller pasif çalışabilir. Model çıktısı asla kendiliğinden görünmez.**

"Ek koymayı unuttunuz" → kural, ~%99 isabet, pasif gösterilir.
"Bu mail sert okunuyor" → model, öznel, yanılır. Yalnızca kullanıcı istediğinde.

### 5.2 Kullanıcı bir özellik menüsünden seçim yapmaz

Panel **bağlama göre** 3–4 eylem gösterir:

```
Uzun zincir okuyor  ->  [Özetle]  [Aksiyonlar]  [Sorular]  [Taslak]
Kısa bir mail       ->  [Taslak]  [Çevir]        (özet anlamsız, gösterilmez)
Yazma modunda       ->  [Kontrol et]
```

Geri kalanı "Daha fazla" altında. Kullanıcı ilk gün 4 şey görür, 60 şey değil.

> ⚠️ **Buton adları §6'daki pilot kapsamıyla birebir aynıdır.** Mockup'a §7'deki yedekten buton eklenmez ("Düzelt", "Cevapla" vb. **pilotta yoktur**).

### 5.3 Yüzeyler ve rahatsızlık merdiveni

| Seviye | Yüzey | Kesinti | Karar |
|---|---|---|---|
| 0 | Kategori rengi (mail listesinde) | Yok | Faz 6 |
| 1 | **Sabitlenmiş task pane** | Yok | ⭐ **Ana ve tek yüzey** |
| 2 | Ribbon butonu | Yok | Kullanılır |
| 3 | Bildirim çubuğu (`notificationMessages`) | Düşük | **Pilotta kullanılmaz** |
| 4 | Gönderim kontrolü (`OnMessageSend`) | Yüksek | ❌ **K7 ile yasak** |
| 5 | Modal dialog | Çok yüksek | ❌ **Asla** |

### 5.4 Sabitlenebilir panel — kilit tasarım

Manifest'te `SupportsPinning`. Kullanıcı paneli **bir kez** sabitler; panel seçtiği her maile göre kendini günceller.

- Kullanıcı kendi açtı → kesinti değil
- Sabitlemeyen kullanıcı **hiçbir şey görmez**
- Özet, mailin üstüne fırlayan kutu değil, yanda duran panel
- Kapatmak tek tık

**Varsayılan: sabitlenmemiş.** Zorla açılan panel, bildirimden beterdir.

### 5.5 Yazma modunda gösterim

Metin bloğu değil, göz ucuyla okunan tek satır:

```
+---------------------------------+
|  v Alıcılar        ! Ek         |   <- tek satır, sessiz, PASİF
+---------------------------------+
|                                 |
|   [ Kontrol et ]                |   <- talep üzerine, LLM
|                                 |
+---------------------------------+
```

> **Şeritte yalnızca deterministik kontroller vardır** (§6 / 6–7: alıcı ve ek). Eksik cevap kontrolü (§6 / 8) LLM gerektirir, **şeride konmaz** — "Kontrol et" butonuyla çalışır ve sonucunu panel gövdesinde gösterir.

- `!` işareti **kırmızı değil, amber**. Hata değil, bilgi.
- Tıklanırsa tek cümle açılır: *"Metinde 'ekte' geçiyor, ek yok."*
- Tıklanmazsa orada öylece durur. Hiçbir şey açılmaz, titremez, öne çıkmaz.
- Bildirim çubuğu kullanılmaz — yazarken gövdeyi aşağı iten bar, panelden daha rahatsız edicidir.

### 5.6 K6'nın kabul edilen bedeli

Eklenti yalnızca panel açıkken çalıştığı için: **ek unutma hatasını en çok yapacak kişi, paneli açmayan kişidir.** Koruma, ona en çok ihtiyacı olanı atlar.

Telafi: **sabitleme.** Kullanıcı bir kez sabitlerse her yazma ekranında zaten açıktır.

**Pilotun kritik ölçütü:** *kaç kişi paneli sabitledi?* Düşükse sorun özellikte değil, keşfedilebilirliktedir.

### 5.7 Kapatma hakkı

Her özellik kullanıcı tarafından kapatılabilir; tercih V1'de (kullanıcının kendi mailbox'ı) durur.

Varsayılanlar:
- Panel: **sabitlenmemiş**
- Pasif kontroller: **açık** (panel açıkken)
- Tek bir **"Ajanı kapat"** anahtarı bulunmalı — bulamayan kullanıcı IT'ye şikâyet eder.

---

## 6. Pilot kapsamı

**8 özellik, ama yalnızca 3 çağrı şekli. Hepsi S1 (açık öğe). Mailbox geneline erişim yok, impersonation yok, yönetişim yükü sıfıra yakın.**

| # | Özellik | Mod | Tetik | **Çağrı** |
|---|---|---|---|---|
| 1 | **Zincir özeti** | Talep üzerine | Buton | **A** |
| 2 | Aksiyon maddeleri | Talep üzerine | Buton | **A** *(aynı çağrı)* |
| 3 | Soru listesi | Talep üzerine | Buton | **A** *(aynı çağrı)* |
| 4 | **Cevap taslağı** | Talep üzerine | Buton | **B** |
| 5 | TR ↔ EN çeviri | Talep üzerine | Buton | **B** |
| 6 | **Ek kontrolü** | Pasif | Panel açıkken otomatik | **Yok** |
| 7 | Alıcı kontrolü (dış / benzer adres) | Pasif | Panel açıkken otomatik | **Yok** |
| 8 | Eksik cevap kontrolü | Talep üzerine | "Kontrol et" | **C** *(A'nın çıktısı + taslak)* |

**1–3 tek çağrıdır (K9).** Kullanıcı "Özetle"ye bastığında aksiyonlar ve sorular da üretilmiş olur; o butonlara sonradan basmak **anında ve bedelsizdir**. Dil, kategori ve öncelik de aynı çıktıda gelir (§3.2).

**6 ve 7 pasif olabilir çünkü deterministiktir** — tarayıcıda çalışan birkaç satır JavaScript, GPU'ya hiç gitmez. 800 ms debounce ile çalışır, maliyeti sıfırdır.

**8 bilinçli olarak butona bağlıdır.** Sürekli LLM çağrısı hem GPU'yu boşa yakar hem de yarım kalmış taslağı analiz ettiği için isabetsiz sonuç verir.

> **1 numara tek başına projeyi haklı çıkarır.** 40 mesajlık CC zincirini 10 saniyede okumak, insanların gerçekten istediği şeydir.

**Taslak akışı (K8):** üretilen metin doğrudan gönderilmez. Panelde gösterilir, kullanıcı isterse cevap gövdesine yapıştırılır veya Drafts'a yazılır. Gönderme eylemi her zaman kullanıcınındır.

---

## 7. Yetenek yedeği (backlog)

Pilot dışı. **Buradan bir madde eklemek için ölçüme dayalı gerekçe gerekir.**

### Katman 0 — LLM'siz, kural tabanlı
Reply-All uyarısı · geç saat gönderim uyarısı · bülten/otomatik mail ayıklama

### S1 — Açık öğe, okuma modu
Öncelik tahmini · eskalasyon/ton tespiti · "cevap vermem gerekiyor mu" · kısaltma-jargon açıklama · talep çıkarma · toplantı daveti özeti · tarih-yer çıkarıp takvim önerme · iletişim bilgisi çıkarma · soru listesi çıkarma · **görsel/ekran görüntüsü okuma** · **taranmış belge okuma** · ek özeti *(⚠️ `getAttachmentContentAsync` requirement set'e bağlı, on-prem'de doğrulanmalı)*

### S1 — Yazma modu
Ton ayarı · uzat/kısalt · konu satırı önerisi · madde madde yazdığını maile dönüştürme · Türkçe imla-akıcılık düzeltme · kurum şablonu kapanış önerisi

### S2 — Mailbox geneli, kullanıcı tetikli *(callback token + `ReadWriteMailbox`)*
**Triyaj butonu (kategori etiketleme)** · **Günlük Özet butonu** · haftalık özet · cevapsız kalanlar · bekleyen taahhütler · doğal dille arama · ilgili geçmiş yazışma bulma · toplantı hazırlığı brifingi · klasörleme önerisi · bülten temizliği · tekrar eden zincir tespiti · toplu etiketleme · kişisel istatistik · takvim yükü analizi · çakışan toplantı tespiti

### S2 — Yönetici *(mevcut yetkilerle)*
Kendi kutusundaki ekip trafiği özeti · onay bekleyenler · eskalasyon radarı · kimi bekletiyorum · **paylaşımlı kutu triyajı (`info@`, `destek@`)** · **delege edilmiş kutu triyajı** · izne çıkarken devir brifingi

> **Paylaşımlı ve delege kutular önemli:** izinler **zaten tanımlı** olduğu için yeni yetki istemeden ekip düzeyinde değer üretilir. Yöneticilere böyle sunulmalıdır.

### S2 — Sistem yönetimi *(en düşük riskli pilot genişlemesi)*
NDR çözümleme (hata kodunu sade Türkçeye çevirme) · monitoring uyarılarını tekilleştirip özetleme · mail başlığı analizi (SPF/DKIM/DMARC) · teslim gecikmesi şikâyetini başlıklardan okuma

> ⚠️ **Şüpheli mail değerlendirmesi güvenlik ürünü gibi konumlandırılmaz.** "Yardımcı ikinci göz" olarak sunulur; kullanıcı modelin "temiz" demesine güvenip phishing'e tıklarsa sorumluluk kurumda kalır.

---

## 8. Yapılamayacaklar

Yöneticilere **baştan** söylenmelidir.

| Yapılamaz | Sebep |
|---|---|
| Outlook kapalıyken herhangi bir şey | K1, K4 |
| Gece toplu triyaj, sabaha hazır gelen kutusu | K1, K4 |
| Yöneticinin ekip üyelerinin kutusunu görmesi | K1 |
| Kurum geneli mail analitiği | K1 |
| İçerikten öğrenen, zamanla akıllanan model | K2 |
| Geçmiş mailler üzerinde RAG | K3 |
| Geriye dönük hata incelemesi | §4.3 |
| Kişiye özel yazım stili öğrenme | K2 |
| Panel kapalıyken pasif kontroller | K6 |

### Sorulmaya değer tek istisna

Kısıtlar **mail verisi** için konulmuştur. **Kurum içi dokümanlar** (prosedür, politika, ürün kataloğu, fiyat listesi) ayrı bir korpustur ve muhtemelen bu kapsamda değildir.

Bunlara RAG kurulabilirse şu açılır: *"Müşteri iade koşullarını soruyor — prosedüre göre cevap taslağı yaz."* **Mail verisi hiç saklanmadan** cevap kalitesi ciddi biçimde artar.

Bilgi güvenliğine **ayrı bir soru** olarak götürülmelidir. Cevap "evet" ise projenin en yüksek getirili tek eklentisi budur.

---

## 9. Faz planı

| Faz | İçerik | Yetki | Yönetişim yükü |
|---|---|---|---|
| **0** | On-prem doğrulama çivileri (bkz. §10) | — | Yok |
| **1** | Boş panel: Merhaba dünya, OWA + Outlook'ta açılıyor | — | Yok |
| **2** | Model hattı: sağlayıcı soyutlaması + Qwen3.8-27B çağrısı. **Lab'de OpenRouter (§15), üretimde vLLM + LiteLLM (§3.3)** | — | Yok |
| **3** | **Pilot 8 özellik / 3 çağrı** (§6), 20 gönüllü | S1 | Sıfıra yakın |
| **4** | Ölçüm, budama, prompt iyileştirme | S1 | Yok |
| **5** | Kademeli yaygınlaştırma — **prod'a ilk geçiş, ayrı onayla (K11)** | S1 | Düşük |
| **6** | Triyaj + Günlük Özet | **S2** | Orta — ayrı onay |
| **7** | Paylaşımlı/delege kutular, yönetici özellikleri | S2 | Orta |
| **8** | *(opsiyonel)* Doküman RAG, multimodal ek okuma | — | Ayrı onay |

**Pilotta hem teknik hem idari riski aynı anda almayın.** Faz 3 kasıtlı olarak S1 ile sınırlıdır.

> ⛔ **Faz 0–4 tamamen `EXCH01` lab ortamındadır (K11).** Prod Exchange ilk kez Faz 5'te, ayrı onayla devreye girer. Faz 3'teki "20 gönüllü" de lab üzerinden çalışır.

---

## 10. Faz 0 — İlk gün doğrulama çivileri

> ## ⛔ Hedef ortam: `EXCH01` (lab)
>
> Bu bölümdeki çivilerin bazıları **organizasyon düzeyinde kalıcı değişiklik** yapar — özellikle `New-App -OrganizationApp`.
>
> **Hepsi yalnızca lab Exchange'inde (`EXCH01`) çalıştırılır.** Prod Exchange'e (2 DAG, 8 sunucu, 500+ kullanıcı) hiçbir komut gönderilmez (K11).
>
> Bir komutu çalıştırmadan önce **hangi Exchange'e bağlı olduğunu doğrula.** Emin değilsen çalıştırma, sor.

Bunlar **mimariyi değiştirebilecek** belirsizliklerdir. Kod yazmadan önce duvara çarpın.

- [ ] **Boş bir task pane eklentisi** OWA'da ve masaüstü Outlook'ta açılıyor mu?
- [ ] On-prem dağıtım: `New-App -OrganizationApp -Url <manifest-url>` çalışıyor mu?
      *(M365 admin merkezindeki Centralized Deployment buluta özeldir, bu ortamda yoktur)*
- [ ] Manifest HTTPS'te barındırılıyor; sertifika zinciri **tüm istemcilerde** geçerli mi?
- [ ] **Hangi Mailbox requirement set destekleniyor?** Dokümandaki genel tabloya güvenmeyin, kendi build'inizde deneyerek ölçün.
- [ ] `SupportsPinning` bu ortamda çalışıyor mu? **(§5.4'ün tamamı buna bağlı)**
- [ ] `getCallbackTokenAsync` + `ReadWriteMailbox` çalışıyor mu? *(Faz 6 için, şimdiden ölçülsün)*
- [ ] `getAttachmentContentAsync` destekleniyor mu? *(backlog için)*
- [ ] **Kimlik doğrulama:** Office SSO Entra ister. Saf on-prem'de Exchange identity token mı, kendi API'nize Kerberos/Windows auth mı?
- [ ] **CORS:** OWA eklentisi sandbox'lı iframe'de çalışır. Kendi API'nize çağrıda `Access-Control-Allow-Credentials` gerekecek — baştan planlayın.
- [ ] `openrouter-key.txt` yerinde ve **`.gitignore`'a eklendi** *(ilk commit'ten önce)*
- [ ] OpenRouter üzerinden Qwen3.8-27B'ye tek çağrı başarılı; **model slug'ı doğrulandı** (§15.2)
- [ ] `test-data/` altında sentetik test maili seti oluşturuldu (K10)

---

## 11. Türkçe kalite ve değerlendirme

Yazışmalar **~%85 Türkçe, %15 İngilizce**.

### 11.1 Türkçe'ye özel model aramayın

**Cetvel** (Koç Üniversitesi KUIS-AI, EACL 2026) — 23 görev, 7 kategori, 33 açık ağırlıklı model üzerinde Türkçe değerlendirme. Bulgusu:

> **Türkçe'ye özel eğitilmiş modeller, iyi çok dilli modellerin gerisinde kalıyor.**

Yani Qwen3.8-27B doğru tercihtir; "Türkçe LLM" arayışına girilmemelidir.

### 11.2 Kendi değerlendirme setiniz

- Kurumun gerçek yazışmalarından **50 örneklik** bir set hazırlayın *(bu set K2 kapsamında değerlendirilmeli — anonimleştirilmiş veya sentetik olmalı, bkz. §13 S3)*
- Model ve prompt değişikliklerini **bu sete karşı ölçün**. Yoksa "daha iyi oldu galiba" ile ilerlersiniz
- Cetvel'in görev setini yanına referans olarak koyun

### 11.3 Prompt dili

**Sistem prompt'unu İngilizce, çıktıyı mailin dilinde** deneyin — çoğu modelde talimat uyumu İngilizce prompt'ta daha iyidir. **İkisini de ölçün**, körlemesine seçmeyin.

Çıktı dili kuralı: **gelen mailin diliyle aynı.** `lang` alanı (§3.2) bunu belirler.

---

## 12. Ölçüm ve budama

Kullanım sayacı tutulur: **hangi butona kaç kez basıldı — sadece sayı.** İçerik yok, K2 ile uyumlu.

| Metrik | Neden |
|---|---|
| **Paneli sabitleyen kullanıcı oranı** | §5.6 — en kritik sayı |
| **Mail başına ortalama LLM çağrısı** | K9 denetimi — okuma modunda **1'i geçmemeli** |
| A çağrısı sonrası ek buton tıklaması | Tek istek ilkesinin kazancını gösterir |
| Özellik başına kullanım sayısı | Budama kararı |
| Taslak kabul oranı (üretilen vs. kullanılan) | Kalite göstergesi |
| p50 / p95 yanıt süresi | Kapasite |
| Kapatma oranı | Rahatsızlık sinyali |

> **Bir özellik iki hafta boyunca kullanılmadıysa silin.**

§7'deki yedeğe geri dönme baskısı sürekli gelecektir ("şunu da ekleyelim"). Ölçüm, o baskıya karşı elinizdeki tek savunmadır.

**Pilot 20 kişiyle başlar; 500'e çıkarken özellik listesi uzamış değil, kısalmış olmalıdır.**

---

## 13. Açık sorular

| # | Soru | Kime |
|---|---|---|
| S1 | V2 (türetilmiş öznitelik + etiket) saklanabilir mi? (§4.4) | Bilgi güvenliği |
| S2 | Kurum içi dokümanlar üzerinde RAG serbest mi? (§8) | Bilgi güvenliği |
| S3 | Değerlendirme seti için anonimleştirilmiş gerçek mail kullanılabilir mi? (§11.2) | Bilgi güvenliği |
| S4 | Denetim günlüğünde içerik olmaması kabul ediliyor mu? (§4.3) | Yönetim |
| S5 | Yöneticilerin ekip kutularını göremeyeceği kabul ediliyor mu? (§8) | Yönetim |
| S6 | Pilot gönüllü grubu kim? *(öneri: sistem yönetimi ekibi — en düşük risk)* | Yönetim |

---

## 14. Çalışma modeli

Bu proje **Claude tarafından, büyük ölçüde kendi başına** yürütülecektir. Aşağıdaki rol, ekip ve döngü tanımı bağlayıcıdır.

### 14.1 Rol

> **Sen bu projede sistem uzmanı ve yazılım takım lideri rolündesin.**

Bu iki şeyi aynı anda taşımak demektir:

| Sistem uzmanı olarak | Takım lideri olarak |
|---|---|
| Exchange, on-prem kimlik doğrulama, ağ ve dağıtım kararları sana ait | İşi parçalara böler, ajanlara dağıtırsın |
| Ortamdan doğrulanmamış hiçbir şeyi varsaymazsın | Gelen işi **incelemeden kabul etmezsin** |
| Bir şeyin çalıştığını ancak çalıştırdıysan söylersin | Mimari kararları devretmezsin |

**Devredilmeyecek işler:** mimari kararlar · K1–K11 ile ilgili her şey · son inceleme · kullanıcıya rapor.

### 14.2 Ajan ekibi

Gerektiğinde alt ajanlara görev verilir. Ölçü basit:

| Ajana ver | Kendin yap |
|---|---|
| Bağımsız, paralel yürüyebilecek işler | Kısıtlara dokunan her şey |
| Geniş arama/keşif (dokümantasyon taraması, API araştırması) | Mimari ve tasarım kararları |
| Tek dosyaya odaklı, sınırı net uygulama işi | Faz geçiş kararları |
| Birbirinden bağımsız test yazımı | Son inceleme ve birleştirme |

**Kural:** ajana verilen her görev, **tek cümlelik bir kabul ölçütü** taşımalıdır. Ölçüt yazılamıyorsa görev henüz yeterince parçalanmamıştır.

**Kural:** ajan çıktısı doğrudan kabul edilmez. Özellikle *"çalışıyor"* iddiaları — çalıştığını kendin doğrula.

### 14.3 Döngü

Her yineleme aynı sırayı izler:

```
1. DURUM.md oku          -> nerede kalındı
2. Sıradaki adımı seç    -> en küçük anlamlı parça
3. Gerekirse ajana ver   -> kabul ölçütüyle birlikte
4. Uygula
5. Doğrula               -> çalıştır, test et; iddia değil kanıt
6. Kısıt denetimi        -> K1-K11'e karşı gözden geçir
7. DURUM.md güncelle
8. Devam veya dur
```

**Duracağın yerler:**

- Bir kısıt (K1–K11) ihlal edilmeden ilerlenemiyorsa
- **Prod Exchange'e dokunmak gerekiyorsa — koşulsuz dur (K11)**
- Hangi Exchange'e bağlı olduğundan emin değilsen — çalıştırma, sor
- §10'daki bir doğrulama çivisi başarısız olduysa — **mimari değişebilir, kullanıcıya sor**
- §13'teki açık sorulardan biri yolu tıkıyorsa
- §6'nın dışına çıkmak gerekiyorsa
- İki yineleme üst üste aynı hatada takıldıysa

**Durmayacağın yerler:** küçük belirsizlikler. Makul varsayımı yap, `DURUM.md`'ye **"Varsayım"** olarak yaz, devam et.

### 14.4 DURUM.md

Proje kökünde tutulur, her yinelemede güncellenir:

Bölüm başlıkları sabittir, **silinmez veya yeniden adlandırılmaz**:

| Bölüm | İçerik |
|---|---|
| `## Tamamlanan` | Bitmiş ve **doğrulanmış** işler |
| `## Devam eden` | Şu an üzerinde çalışılan |
| `## Sıradaki adım` | Bir sonraki yinelemenin girdisi |
| `## Varsayımlar` | §14.3 gereği yazılan makul varsayımlar |
| `## Engeller` | İlerlemeyi durduran şeyler |
| `## Kullanıcıya sorulacaklar` | §13'ten açık kalanlar |
| `## Yineleme günlüğü` | Tarih · yapılan · **neyle doğrulandı** |

Son sütun (*doğrulama*) boş bırakılan bir satır, **yapılmamış doğrulama** demektir (§14.1).

---

## 15. Geliştirme ortamı: OpenRouter

Lab ortamında **GPU yoktur.** Geliştirme ve test, OpenRouter üzerinden aynı model ile yapılır.

### 15.1 Anahtar

| | |
|---|---|
| Dosya | `openrouter-key.txt` (proje kökü, düz metin) |
| **`.gitignore`** | **Zorunlu** — ilk commit'ten önce eklenir |
| Loglama | Anahtar hiçbir log, hata mesajı veya çıktıya yazılmaz |
| Okuma | Yalnızca yapılandırmadaki `apiKeyFile` yolundan |

### 15.2 Sağlayıcı soyutlaması

**OpenRouter kodun içine gömülmez.** İki ortam da OpenAI uyumlu API konuşur, yani tek istemci kodu yeter — değişen sadece yapılandırmadır.

```jsonc
// Lab
{
  "llm": {
    "provider":   "openrouter",
    "baseUrl":    "https://openrouter.ai/api/v1",
    "apiKeyFile": "openrouter-key.txt",
    "model":      "qwen/qwen3.8-27b"      // ⚠️ kesin slug OpenRouter model listesinden doğrulanmalı
  }
}

// Üretim
{
  "llm": {
    "provider":   "litellm",
    "baseUrl":    "http://litellm.internal:4000/v1",
    "apiKeyFile": "litellm-key.txt",
    "model":      "qwen3.8-27b"
  }
}
```

Üretime geçiş **tek dosya değişikliği** olmalıdır. Kodda `openrouter` kelimesi geçen tek yer bu yapılandırmadır.

### 15.3 ⚠️ K10 — bu ortama gerçek mail gitmez

OpenRouter **dış bir servistir.** Projenin tüm premisi *"veri kurumdan çıkmıyor"* üzerine kurulu; lab testinde gerçek yazışma göndermek bu premisi geçersiz kılar.

| ✅ Kullanılabilir | ❌ Kullanılamaz |
|---|---|
| Sentetik/uydurma test mailleri | Kurumdan alınmış gerçek mail |
| Tamamen anonimleştirilmiş örnekler | "Sadece bir tanesini deneyelim" |
| Kendi yazdığınız örnek zincirler | Gerçek isim, adres, müşteri verisi |

**Test verisi seti proje içinde tutulur** (`test-data/`), sentetiktir, ve §11.2'deki değerlendirme setinden ayrıdır.

### 15.4 OpenRouter'da doğrulanamayacak şeyler

Lab testi mantığı doğrular, **performansı doğrulamaz.** Şunlar üretime geçerken vLLM üzerinde yeniden ölçülmelidir:

| Konu | Neden lab'de ölçülemez |
|---|---|
| **Prefix caching kazancı (§3.2)** | Sağlayıcının cache davranışı kontrol edilemez |
| `--max-model-len` ayarı (§3.3) | Sunucu sizin değil |
| Eşzamanlılık / throughput (500 kullanıcı) | Rate limit farklı, batching farklı |
| p50 / p95 gecikme (§12) | Ağ gecikmesi baskın |

> Lab'de **doğru çalıştığını**, üretimde **hızlı çalıştığını** doğrularsınız. İkisini karıştırmayın.

---

## 16. Yeni oturuma açılış cümlesi

Döngüyü başlatmak için:

```
/loop
```

ardından:

> `00-PROJE-BRIEF.md` ve varsa `DURUM.md` dosyalarını oku.
> **§14'teki rol ve döngüye göre çalış** — sistem uzmanı ve yazılım takım lideri olarak, gerektiğinde ajanlara görev vererek.
> §1'deki kısıtlar (K1–K11) pazarlık edilemez. §9'daki fazlarla ilerle, **§10'daki doğrulama çivilerinden başla** —
> orada çıkacak sonuç mimariyi değiştirebilir. §6'nın dışına çıkma; §7 yalnızca referanstır.
> **Tüm çalışma `EXCH01` lab ortamındadır — prod Exchange'e hiçbir komut gönderme (K11).**
> Testleri §15'teki OpenRouter yapılandırmasıyla, **yalnızca sentetik veriyle** yap.
> Her yinelemede `DURUM.md`'yi güncelle. §14.3'teki durma koşullarından birine gelirsen dur ve sor.

---

## Kaynaklar

- [Qwen/Qwen3.8-27B — Hugging Face](https://huggingface.co/Qwen/Qwen3.8-27B)
- [Qwen 3.8 Model Lineup](https://codersera.com/blog/qwen-3-8-model-lineup-2026/)
- [Alibaba releases Qwen3.8-27B open weights — DataNorth AI](https://datanorth.ai/news/alibaba-releases-qwen3-8-27b)
- [Cetvel: Turkish LLM benchmark — ACL Anthology (EACL 2026)](https://aclanthology.org/2026.eacl-long.46/)
- [KUIS-AI/cetvel — GitHub](https://github.com/KUIS-AI/cetvel)
