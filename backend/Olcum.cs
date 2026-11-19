/*
 * §12 Kullanım sayacı — "hangi butona kaç kez basıldı, SADECE SAYI".
 *
 * K2 UYUMU — tasarım kararları:
 *  1. Olay adı SABİT ENUM'dur. Serbest metin kabul edilmez. Gerekçe §3.2'deki
 *     reason_code uyarısıyla aynıdır: serbest metin er ya da geç mail içeriği
 *     taşır ve loga sızar. Bilinmeyen olay adı sayılmaz, 400 döner.
 *  2. Kayıtta KİMLİK YOKTUR. Kullanıcı, posta kutusu, msexchuid, adres, konu —
 *     hiçbiri tutulmaz. Yalnız toplam sayaçlar.
 *  3. Diske yazılan dosya (olcum.json) yalnızca "ad: tamsayı" çiftleri içerir.
 *     Mail içeriği değildir, bu yüzden K2 ihlali değildir.
 *  4. Gecikme örnekleri bellekte, sınırlı bir halkada tutulur (süre = sayıdır).
 *
 * ⚠️ §12'nin "en kritik sayısı" (paneli sabitleyen kullanıcı oranı) bu ortamda
 *    ÖLÇÜLEMEZ: sabitleme OWA'da yok (çivi #5 / S9). Yerine panel açma sayacı
 *    konmuştur: panel_acildi_okuma + panel_acildi_yazma.
 */

using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OutlookAjan.Servis;

public sealed class Olcum
{
    /// Kabul edilen olaylar. Bu listede olmayan hiçbir şey sayılmaz (K2).
    public static readonly string[] Olaylar =
    [
        // panel yüzeyi — §12'nin sabitleme metriğinin yerine geçen sayaç
        "panel_acildi_okuma", "panel_acildi_yazma",
        // okuma kipi
        "ozetle", "sekme_ozet", "sekme_aksiyon", "sekme_soru",
        // yazma kipi
        "taslak_kisa", "taslak_detayli", "taslak_resmi",
        "ceviri_tr", "ceviri_en", "kontrol_et", "govdeye_ekle",
        // pasif kontroller (§6 / 6–7) — gösterildi mi
        "ek_hatirlatmasi", "alici_uyarisi",
        // §5.7 kapatma hakkı — §12'nin "kapatma oranı" (rahatsızlık sinyali)
        "ajan_kapatildi", "ajan_acildi", "panel_acildi_kapali",
        // sunucu tarafı (istemci göndermez)
        "analiz_model", "analiz_onbellek", "taslak_model", "kontrol_model", "kontrol_a_yok",
        // JSON ayrıştırma hatası sonrası tekrar denemeler — oranı izlemek için ayrı sayaç
        "analiz_json_tekrar"
    ];

    private static readonly HashSet<string> Gecerli = new(Olaylar, StringComparer.Ordinal);

    private readonly ConcurrentDictionary<string, long> _sayac = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, ConcurrentQueue<long>> _sureler = new(StringComparer.Ordinal);
    private readonly string _dosya;
    private readonly ILogger _kayit;
    private readonly object _yazmaKilidi = new();
    private DateTimeOffset _sonYazma = DateTimeOffset.MinValue;

    private const int SURE_ORNEK_SINIRI = 500;   // halka: bellekte sınırsız büyümesin

    public Olcum(string dosya, ILogger kayit)
    {
        _dosya = dosya;
        _kayit = kayit;
        Yukle();
    }

    public static bool Tanimli(string? olay) => olay is not null && Gecerli.Contains(olay);

    public bool Say(string olay, long adet = 1)
    {
        if (!Tanimli(olay)) return false;
        _sayac.AddOrUpdate(olay, adet, (_, v) => v + adet);
        Kaydet();
        return true;
    }

    /// Süre örneği ekler (ms). Süre bir sayıdır; içerik değildir.
    public void Sure(string olay, long ms)
    {
        if (!Tanimli(olay)) return;
        var kuyruk = _sureler.GetOrAdd(olay, _ => new ConcurrentQueue<long>());
        kuyruk.Enqueue(ms);
        while (kuyruk.Count > SURE_ORNEK_SINIRI && kuyruk.TryDequeue(out _)) { }
    }

    public JsonObject Ozet()
    {
        var sayaclar = new JsonObject();
        foreach (var ad in Olaylar)
            sayaclar[ad] = _sayac.TryGetValue(ad, out var v) ? v : 0;

        var gecikme = new JsonObject();
        foreach (var kv in _sureler)
        {
            var dizi = kv.Value.ToArray();
            if (dizi.Length == 0) continue;
            Array.Sort(dizi);
            gecikme[kv.Key] = new JsonObject
            {
                ["ornek"] = dizi.Length,
                ["p50_ms"] = Yuzdelik(dizi, 0.50),
                ["p95_ms"] = Yuzdelik(dizi, 0.95)
            };
        }

        long Al(string a) => _sayac.TryGetValue(a, out var v) ? v : 0;

        var uretilen = Al("taslak_kisa") + Al("taslak_detayli") + Al("taslak_resmi") + Al("ceviri_tr") + Al("ceviri_en");
        var panelAcma = Al("panel_acildi_okuma") + Al("panel_acildi_yazma");
        var aCagri = Al("analiz_model");

        var turetilmis = new JsonObject
        {
            // K9 denetimi: okuma kipinde mail başına LLM çağrısı 1'i geçmemeli (§12).
            // Önbellek isabeti arttıkça bu oran 1'in ALTINA iner — istenen budur.
            ["mail_basina_llm_cagrisi"] = (aCagri + Al("analiz_onbellek")) == 0
                ? null
                : JsonValue.Create(Math.Round((double)aCagri / (aCagri + Al("analiz_onbellek")), 3)),
            // §12: "A çağrısı sonrası ek buton tıklaması" — tek istek ilkesinin kazancı
            ["a_sonrasi_sekme_tiklamasi"] = Al("ozetle") == 0
                ? null
                : JsonValue.Create(Math.Round((double)(Al("sekme_aksiyon") + Al("sekme_soru")) / Al("ozetle"), 3)),
            // §12: taslak kabul oranı — üretilen metin gerçekten kullanıldı mı
            ["taslak_kabul_orani"] = uretilen == 0
                ? null
                : JsonValue.Create(Math.Round((double)Al("govdeye_ekle") / uretilen, 3)),
            ["panel_acma_toplam"] = panelAcma
        };

        return new JsonObject
        {
            ["sayaclar"] = sayaclar,
            ["gecikme"] = gecikme,
            ["turetilmis"] = turetilmis,
            ["_not"] = "Yalnız sayı ve süre. İçerik, kimlik, adres veya konu tutulmaz (K2). "
                     + "§12'nin 'paneli sabitleyen oran' metriği bu ortamda ölçülemez (S9); "
                     + "yerine panel_acma_toplam kullanılır."
        };
    }

    private static long Yuzdelik(long[] siraliDizi, double oran)
    {
        if (siraliDizi.Length == 0) return 0;
        var i = (int)Math.Ceiling(oran * siraliDizi.Length) - 1;
        if (i < 0) i = 0;
        if (i >= siraliDizi.Length) i = siraliDizi.Length - 1;
        return siraliDizi[i];
    }

    /// En fazla 5 saniyede bir diske yazar (her tıklamada disk I/O yapılmaz).
    private void Kaydet()
    {
        lock (_yazmaKilidi)
        {
            if (DateTimeOffset.UtcNow - _sonYazma < TimeSpan.FromSeconds(5)) return;
            _sonYazma = DateTimeOffset.UtcNow;
            try
            {
                var nesne = new JsonObject();
                foreach (var kv in _sayac) nesne[kv.Key] = kv.Value;   // yalnız ad: tamsayı
                File.WriteAllText(_dosya, nesne.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            }
            catch (Exception ex) { _kayit.LogWarning("ölçüm dosyası yazılamadı ({tip})", ex.GetType().Name); }
        }
    }

    private void Yukle()
    {
        try
        {
            if (!File.Exists(_dosya)) return;
            if (JsonNode.Parse(File.ReadAllText(_dosya)) is not JsonObject nesne) return;
            foreach (var kv in nesne)
            {
                // Dosyadan gelen her şey doğrulanır: tanımlı olay + tamsayı.
                if (!Tanimli(kv.Key)) continue;
                if (kv.Value?.GetValueKind() == JsonValueKind.Number && kv.Value.AsValue().TryGetValue<long>(out var v))
                    _sayac[kv.Key] = v;
            }
            _kayit.LogInformation("ölçüm dosyası yüklendi: {n} sayaç", _sayac.Count);
        }
        catch (Exception ex) { _kayit.LogWarning("ölçüm dosyası okunamadı ({tip})", ex.GetType().Name); }
    }
}
