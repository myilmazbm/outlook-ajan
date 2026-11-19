# test-data — Sentetik Türkçe Test E-posta Seti

Bu klasördeki tüm içerik **tamamen uydurmadır**. Hiçbir gerçek şirket, kişi, adres veya
gerçek bir posta kutusundan alınmış metin içermez. Tüm alan adları `.example` uzantılıdır.
Set, Outlook eklentisinin özetleme, aksiyon çıkarımı, soru tespiti ve uyarı üretme
davranışlarını yerel olarak sınamak için kullanılır.

## Dosya İndeksi

| Dosya | Mesaj | Senaryo | Neyi sınar |
|---|---:|---|---|
| `uzun-cc-zinciri.json` | 40 | Gecikmiş konteyner sevkiyatı etrafında kalabalık CC'li, alıntı gürültüsü yoğun, tarafların birbirini dinlemediği uzun zincir | Uzun bağlamda özetleme, konu dağılmasına rağmen ana hattı koruma, kimin neyi beklediğini ayırt etme, token/pencere sınırları |
| `kisa-tek-mesaj.json` | 1 | Tek ve kısa bir rapor talebi | Kısa girdide gereksiz şişirme yapmama, tek aksiyonu doğru çıkarma |
| `karisik-dil.json` | 6 | Yurt dışı tedarikçiyle Türkçe-İngilizce karışık yazışma, cümle içi dil geçişleri | Dil tespiti (`karisik`), yanıt dilinin doğru seçilmesi, iki dilli içerikte özetleme |
| `aksiyon-maddeleri.json` | 3 | Düz metne gömülü, sahibi ve son tarihi belli 5 aksiyon maddesi | Aksiyon çıkarımı, sahip ve tarih eşleme, madde sayısını eksiksiz yakalama |
| `soru-listesi.json` | 1 | Müşterinin tek mesajda sorduğu 6 bağımsız soru | Soru tespiti ve numaralandırma, hiçbir sorunun atlanmaması |
| `eksik-cevap.json` | 1 (+`taslak`) | 4 soruluk mesaja karşılık yalnızca 2 soruyu yanıtlayan taslak | Yanıtlanmamış soruların tespiti, taslak-gelen mesaj karşılaştırması |
| `ek-referansi.json` | 2 (+`ekler: []`) | Gövde eke atıf yapıyor ancak mesajda ek yok | Unutulmuş ek uyarısı, Türkçe ve İngilizce ek ifadelerinin yakalanması |
| `dis-alici.json` | 3 | İç yazışma tonundaki hassas içerikte harici danışmanın CC'de kalması | Dış alıcı / gizlilik uyarısı, alan adına göre iç-dış ayrımı |
| `benzer-adres.json` | 4 | Birbirine çok benzeyen adresler (`ahmet.yildiz` / `ahmet.yildirim`, `s.aydin` / `s.aydın`) | Benzer adres uyarısı, Türkçe diakritik farkının (ı/İ) adres eşlemesine etkisi |
| `toplanti-daveti.json` | 4 | Tarih, saat, yer ve gündemi düz metinde geçen, sonradan saat/yer değişen toplantı daveti | Takvim bilgisi çıkarımı, güncellenmiş bilginin eskisinin yerine geçmesi |

**Toplam:** 10 senaryo, 65 mesaj.

## Dosya Şeması

```json
{
  "id": "<kebab-case-id>",
  "senaryo": "<senaryonun tek satırlık Türkçe açıklaması>",
  "beklenen": { "dil": "tr|en|karisik", "kategori": "<kısa etiket>", "oncelik": "yuksek|orta|dusuk" },
  "konu": "<konu satırı>",
  "mesajlar": [
    {
      "sira": 1,
      "kimden": { "ad": "...", "eposta": "..." },
      "kime": [{ "ad": "...", "eposta": "..." }],
      "cc": [],
      "tarih": "2026-09-15T09:30:00+03:00",
      "govde": "<düz metin gövde>"
    }
  ]
}
```

İki dosyada senaryoya özel ek üst düzey alan bulunur:

- `eksik-cevap.json` → `taslak` (string): yalnızca bazı soruları yanıtlayan taslak cevap.
- `ek-referansi.json` → `ekler` (array): bilinçli olarak boş bırakılmıştır.

## Kurallar

- Kodlama: **UTF-8, BOM yok**. Türkçe diakritikler (ı, İ, ş, ğ, ü, ö, ç) korunmalıdır.
- Tüm kişi, şirket ve alan adları uydurmadır; `.example` dışında alan adı kullanılmaz.
- Tarihler 2026-09-10 … 2026-09-18 aralığında, `+03:00` ofsetiyle verilmiştir.
- `beklenen` bloğu, çıktının otomatik karşılaştırılması için referans etiket setidir;
  modelin gördüğü girdiye dahil edilmemelidir.

## Kullanılan Uydurma Kurumlar ve Kişiler

| Kurum (uydurma) | Alan adı | Rol |
|---|---|---|
| Yıldız Lojistik A.Ş. | `@yildizlojistik.example` | Bizim şirketimiz (iç taraf) |
| Mavi Deniz Tekstil | `@mavidenizteks.example` | Müşteri |
| Kuzey Metal Sanayi | `@kuzeymetal.example` | Yurt içi tedarikçi |
| Nordwind Komponenten GmbH | `@nordwindkomp.example` | Yurt dışı tedarikçi |
| Rota Gümrük Müşavirliği | `@rotagumruk.example` | Gümrük müşaviri |
| Pusula Danışmanlık | `@pusuladanismanlik.example` | Harici danışman |

Kişiler: Selin Aydın, Burak Şentürk, Deniz Korkmaz, Emre Taşkın, Gülnur Özdemir,
Kerem Doğanay, Hakan Bilgin, Ahmet Yıldız, Ahmet Yıldırım (Yıldız Lojistik);
Ayşe Çetinkaya, Murat Yavuzer (Mavi Deniz Tekstil); Tolga Erkan (Kuzey Metal);
Ingrid Vahlberg (Nordwind); Fatma Uğurlu (Rota Gümrük); Nilüfer Aksoy (Pusula Danışmanlık).
