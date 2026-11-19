/*
 * Outlook Ajanı — arka uç servisi (Faz 2)
 * Sözleşme: backend/SOZLESME.md
 *
 * Pazarlık edilemez kısıtlar bu dosyada nasıl karşılanıyor:
 *   K2  — mail içeriği diske/veritabanına/günlüğe YAZILMAZ. Önbellek yalnız RAM (IMemoryCache),
 *         süreç bitince kaybolur. Günlüğe yalnız sayı ve süre yazılır.
 *   K9  — aynı ogeId için modele ikinci kez gidilmez; ikinci istek önbellekten döner.
 *   K8  — servis mail göndermez/silmez/taşımaz. Yalnız okur ve analiz döndürür.
 *   §15.1 — API anahtarı hiçbir yanıtta, günlükte veya hata mesajında görünmez.
 *   §15.2 — kodda sağlayıcı adı gömülü değil; config/llm.*.json'dan okunur.
 *
 * Kimlik doğrulama: Exchange identity token (Kimlik.cs), config/auth.*.json ile.
 *
 * Çalıştırma: konsoldan (geliştirme) veya Windows hizmeti olarak (backend/hizmet-kur.ps1).
 * Ortama özgü HER değer yapılandırmadadır; bu dosyada sunucu adı/sertifika gömülü değildir.
 *   AJAN_KOK   — config/, prompts/ ve anahtar dosyasının bulunduğu kök dizin
 *   AJAN_VERI  — olcum.json'un yazılacağı dizin (yalnız sayı; K2)
 */

using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Hosting.WindowsServices;
using OutlookAjan.Servis;

var proje = Environment.GetEnvironmentVariable("AJAN_KOK")
            ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
var veriDizini = Environment.GetEnvironmentVariable("AJAN_VERI") ?? AppContext.BaseDirectory;

// ---------- yapılandırma (§15.2) ----------
var cfgYol = Environment.GetEnvironmentVariable("AJAN_CONFIG")
             ?? Path.Combine(proje, "config", "llm.lab.json");
var cfgKok = JsonNode.Parse(File.ReadAllText(cfgYol))!["llm"]!;

string Cfg(string ad) => cfgKok[ad]?.GetValue<string>() ?? throw new InvalidOperationException($"yapılandırmada eksik: {ad}");
var saglayici = Cfg("provider");
var temelUrl = Cfg("baseUrl");
var model = Cfg("model");
var maxToken = cfgKok["maxTokens"]?.GetValue<int>() ?? 3000;
var ekGovde = cfgKok["extraBody"] as JsonObject;

var anahtarYol = Path.Combine(proje, Cfg("apiKeyFile"));
if (!File.Exists(anahtarYol)) throw new FileNotFoundException($"anahtar dosyası yok: {Cfg("apiKeyFile")}");
var anahtar = File.ReadAllText(anahtarYol).Trim();   // asla loglanmaz, asla döndürülmez

string PromptOku(string ad) => File.ReadAllText(Path.Combine(proje, "prompts", ad));
var sistemPrompt = PromptOku("system-A.en.txt");
var gorevPrompt = PromptOku("task-A.txt");
var sistemB = PromptOku("system-B.en.txt");
var gorevBTaslak = PromptOku("task-B-taslak.txt");
var gorevBCeviri = PromptOku("task-B-ceviri.txt");
var sistemC = PromptOku("system-C.en.txt");
var gorevC = PromptOku("task-C.txt");

// ---------- kimlik doğrulama ayarı (E5 / çivi #8) ----------
var authYol = Environment.GetEnvironmentVariable("AJAN_AUTH_CONFIG")
              ?? Path.Combine(proje, "config", "auth.lab.json");
var authKok = JsonNode.Parse(File.ReadAllText(authYol))!["auth"]!;
var kimlikAyar = new KimlikAyar(
    Etkin: authKok["enabled"]?.GetValue<bool>() ?? true,
    MetadataUrl: authKok["metadataUrl"]!.GetValue<string>(),
    BeklenenIssuer: authKok["expectedIssuer"]!.GetValue<string>(),
    BeklenenAudience: authKok["expectedAudience"]!.GetValue<string>(),
    SapmaSaniye: authKok["clockSkewSeconds"]?.GetValue<int>() ?? 300,
    OnbellekSaat: authKok["metadataCacheHours"]?.GetValue<int>() ?? 24);

// ---------- sunucu ----------
// Ortama özgü değerler (panel kökeni, sertifika, port) koda gömülmez.
var sunucuYol = Environment.GetEnvironmentVariable("AJAN_SUNUCU_CONFIG")
                ?? Path.Combine(proje, "config", "sunucu.lab.json");
var sunucuKok = JsonNode.Parse(File.ReadAllText(sunucuYol))!["sunucu"]!;
var PANEL_KOKEN = sunucuKok["panelOrigin"]!.GetValue<string>();
var CERT_PARMAKIZI = sunucuKok["certThumbprint"]!.GetValue<string>().Replace(" ", "");
var PORT = sunucuKok["port"]?.GetValue<int>() ?? 4444;

// Hizmet olarak çalışırken çalışma dizini system32'dir; içerik kökü exe'nin yanı olmalı.
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = WindowsServiceHelpers.IsWindowsService() ? AppContext.BaseDirectory : default
});
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(o => o.SingleLine = true);
// Konsoldan çalışırken etkisizdir. Hizmetken günlük Olay Günlüğü'ne gider
// (yalnız Warning+; içerik yok — K2).
builder.Host.UseWindowsService(o => o.ServiceName = "OutlookAjanServis");
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient("llm", c => c.Timeout = TimeSpan.FromSeconds(90));
builder.Services.AddHttpClient("meta", c => c.Timeout = TimeSpan.FromSeconds(20));

// Çivi #9 — CORS. Panel ayrı kökende (:4443) olduğu için zorunlu.
// Kasıtlı olarak "*" DEĞİL: kimlik doğrulama Faz 3'te eklenince
// AllowCredentials gerekecek ve "*" ile birlikte kullanılamaz.
builder.Services.AddCors(o => o.AddPolicy("panel", p => p
    .WithOrigins(PANEL_KOKEN)
    .WithMethods("POST", "GET", "OPTIONS")
    .WithHeaders("Content-Type", "Authorization")
    .AllowCredentials()));

builder.WebHost.ConfigureKestrel(k =>
{
    k.ListenAnyIP(PORT, l => l.UseHttps(SunucuSertifikasi(CERT_PARMAKIZI)));
});

var app = builder.Build();
app.UseCors("panel");

var kayit = app.Logger;
var onbellek = app.Services.GetRequiredService<IMemoryCache>();
var istemciFab = app.Services.GetRequiredService<IHttpClientFactory>();
var kimlik = new KimlikDogrulayici(kimlikAyar, istemciFab, kayit);
var olcum = new Olcum(Path.Combine(veriDizini, "olcum.json"), kayit);

if (!kimlikAyar.Etkin)
    kayit.LogWarning("⚠️  KİMLİK DOĞRULAMA KAPALI — /analiz açık uç nokta. Pilota (Faz 3) bu şekilde çıkılmaz.");

// --- A, B ve C çağrılarının ortak model yolu (§15.2: sağlayıcı bilgisi yapılandırmadan) ---
// jsonModu: YALNIZ A ve C çağrıları için. B çağrısı (taslak/çeviri) SERBEST METİN
// döndürür; ona JSON kipi uygulanırsa özellik 4 ve 5 bozulur. Bu yüzden
// response_format global extraBody'ye KONMAZ, çağrı başına verilir.
JsonObject ModelGovdesi(string sistem, string kullanici, double sicaklik, bool jsonModu = false)
{
    var g = new JsonObject
    {
        ["model"] = model,
        ["messages"] = new JsonArray(
            new JsonObject { ["role"] = "system", ["content"] = sistem },
            new JsonObject { ["role"] = "user", ["content"] = kullanici }),
        ["temperature"] = sicaklik,
        ["max_tokens"] = maxToken
    };
    if (jsonModu)
        g["response_format"] = new JsonObject { ["type"] = "json_object" };
    if (ekGovde is not null)
        foreach (var kv in ekGovde) g[kv.Key] = kv.Value?.DeepClone();
    return g;
}

async Task<(JsonNode? yanit, string? hata, int kod)> ModelCagirAsync(JsonObject govde)
{
    try
    {
        var http = istemciFab.CreateClient("llm");
        using var msg = new HttpRequestMessage(HttpMethod.Post, temelUrl.TrimEnd('/') + "/chat/completions");
        msg.Headers.TryAddWithoutValidation("Authorization", "Bearer " + anahtar);
        msg.Content = new StringContent(govde.ToJsonString(), Encoding.UTF8, "application/json");
        using var cevap = await http.SendAsync(msg);
        var ham = await cevap.Content.ReadAsStringAsync();
        if (!cevap.IsSuccessStatusCode)
        {
            kayit.LogError("model HTTP {kod}", (int)cevap.StatusCode);   // gövde loglanmaz (K2)
            return (null, "model hatası (HTTP " + (int)cevap.StatusCode + ")", 502);
        }
        return (JsonNode.Parse(ham), null, 200);
    }
    catch (TaskCanceledException) { return (null, "model zaman aşımı", 504); }
    catch (Exception ex)
    {
        kayit.LogError("model çağrısı başarısız: {tip}", ex.GetType().Name);   // §15.1: anahtar sızmaz
        return (null, "model çağrısı başarısız", 502);
    }
}

app.MapGet("/saglik", () => Results.Json(new { durum = "ayakta", model, saglayici }));

// ---------- §12 kullanım sayacı ----------
// Gövde YALNIZ {"olay":"<enum>"} kabul eder. Tanımsız ad sayılmaz (K2).
app.MapPost("/olcum", async (HttpContext ctx) =>
{
    var ks = await kimlik.DogrulaAsync(ctx.Request.Headers.Authorization.ToString());
    if (!ks.Gecerli) return Results.Json(new { hata = "kimlik doğrulanamadı" }, statusCode: 401);

    JsonNode? istek;
    try { using var r = new StreamReader(ctx.Request.Body, Encoding.UTF8); istek = JsonNode.Parse(await r.ReadToEndAsync()); }
    catch { return Results.Json(new { hata = "geçersiz JSON" }, statusCode: 400); }

    // İki biçim: tek olay {"olay":"x"} veya toplu {"olaylar":{"x":2,"y":1}}.
    // Toplu biçim bilinçlidir: panel sayaçları biriktirip seyrek gönderir, böylece
    // sekme değiştirmek gibi ucuz işlemler ağ isteği üretmez (§3.2'nin "bedelsiz"
    // vaadi telemetri yüzünden bozulmasın).
    var tekil = istek?["olay"]?.GetValue<string>();
    if (tekil is not null)
    {
        if (!Olcum.Tanimli(tekil)) return Results.Json(new { hata = "tanımsız olay" }, statusCode: 400);
        olcum.Say(tekil);
        return Results.Json(new { tamam = true, sayilan = 1 });
    }

    if (istek?["olaylar"] is not JsonObject toplu)
        return Results.Json(new { hata = "olay veya olaylar gerekli" }, statusCode: 400);

    var sayilan = 0;
    foreach (var kv in toplu)
    {
        if (!Olcum.Tanimli(kv.Key)) continue;                      // tanımsız ad sessizce atılır
        if (kv.Value?.GetValueKind() != JsonValueKind.Number) continue;
        if (!kv.Value.AsValue().TryGetValue<long>(out var adet)) continue;
        if (adet <= 0 || adet > 10000) continue;                   // saçma değerler kabul edilmez
        olcum.Say(kv.Key, adet);
        sayilan++;
    }
    return Results.Json(new { tamam = true, sayilan });
});

app.MapGet("/olcum/ozet", async (HttpContext ctx) =>
{
    var ks = await kimlik.DogrulaAsync(ctx.Request.Headers.Authorization.ToString());
    if (!ks.Gecerli) return Results.Json(new { hata = "kimlik doğrulanamadı" }, statusCode: 401);
    return Results.Content(olcum.Ozet().ToJsonString(), "application/json", Encoding.UTF8);
});

app.MapPost("/analiz", async (HttpContext ctx) =>
{
    // Kimlik doğrulama HER ŞEYDEN ÖNCE. Doğrulanmadan model çağrılmaz (GPU harcanmaz).
    var kimlikSonuc = await kimlik.DogrulaAsync(ctx.Request.Headers.Authorization.ToString());
    if (!kimlikSonuc.Gecerli)
    {
        kayit.LogWarning("kimlik reddedildi: {sebep}", kimlikSonuc.Sebep);   // K2: kimlik/içerik yok
        return Results.Json(new { hata = "kimlik doğrulanamadı" }, statusCode: 401);
    }

    JsonNode? istek;
    try
    {
        using var okuyucu = new StreamReader(ctx.Request.Body, Encoding.UTF8);
        istek = JsonNode.Parse(await okuyucu.ReadToEndAsync());
    }
    catch { return Results.Json(new { hata = "geçersiz JSON" }, statusCode: 400); }

    var ogeId = istek?["ogeId"]?.GetValue<string>();
    var govde = istek?["govde"]?.GetValue<string>();
    if (string.IsNullOrWhiteSpace(ogeId)) return Results.Json(new { hata = "ogeId gerekli" }, statusCode: 400);
    if (string.IsNullOrWhiteSpace(govde)) return Results.Json(new { hata = "govde gerekli" }, statusCode: 400);

    // K9 — aynı öğe için modele ikinci kez gitme
    if (onbellek.TryGetValue(ogeId!, out JsonNode? sakli) && sakli is not null)
    {
        kayit.LogInformation("analiz: önbellekten döndü");   // K2: içerik yok, kimlik yok
        olcum.Say("analiz_onbellek");
        return Results.Content(Paketle(sakli, true, 0, 0, 0).ToJsonString(), "application/json", Encoding.UTF8);
    }

    var metin = ZinciriMetneCevir(istek!);

    // §3.2 prefix-cache sırası: [sistem] -> [mail gövdesi] -> [göreve özel talimat]
    var govdeJson = ModelGovdesi(sistemPrompt, metin + "\n\n" + gorevPrompt, 0.2, jsonModu: true);

    var bas = System.Diagnostics.Stopwatch.StartNew();
    var (yanit, cagriHata, cagriKod) = await ModelCagirAsync(govdeJson);
    bas.Stop();
    if (cagriHata is not null) return Results.Json(new { hata = cagriHata }, statusCode: cagriKod);

    var icerik = yanit?["choices"]?[0]?["message"]?["content"]?.GetValue<string>();
    if (string.IsNullOrWhiteSpace(icerik))
        return Results.Json(new { hata = "model boş yanıt döndü" }, statusCode: 502);

    var sonuc = JsonAyikla(icerik!);

    // ÖLÇÜLDÜ: 60 koşumun 1'inde (~%1,7) model ayrıştırılamayan çıktı verdi (eval/).
    // Bu, pilotun amiral özelliğinde kullanıcıya görünen bir hatadır. Bir kez daha denenir.
    // K9 İHLALİ DEĞİL: K9 "aynı girdiden türeyen İŞLERİ ayrı çağrılara bölme" der;
    // bozuk yanıttan sonra tekrar denemek iş bölme değil, hata kurtarmadır.
    // Tek deneme ile sınırlıdır ve telemetride ayrıca sayılır.
    if (sonuc is null)
    {
        kayit.LogWarning("analiz: JSON ayrıştırılamadı, bir kez daha deneniyor");
        olcum.Say("analiz_json_tekrar");
        var (yanit2, hata2, kod2) = await ModelCagirAsync(govdeJson);
        if (hata2 is not null) return Results.Json(new { hata = hata2 }, statusCode: kod2);
        var icerik2 = yanit2?["choices"]?[0]?["message"]?["content"]?.GetValue<string>();
        sonuc = icerik2 is null ? null : JsonAyikla(icerik2);
        if (sonuc is not null) yanit = yanit2;
    }
    if (sonuc is null)
        return Results.Json(new { hata = "model geçerli JSON üretmedi" }, statusCode: 502);

    var girdiTok = yanit?["usage"]?["prompt_tokens"]?.GetValue<int>() ?? 0;
    var ciktiTok = yanit?["usage"]?["completion_tokens"]?.GetValue<int>() ?? 0;

    // K2 — YALNIZ RAM. Diske/DB'ye yazılmaz; süreç bitince kaybolur.
    var secenek = new MemoryCacheEntryOptions { SlidingExpiration = TimeSpan.FromMinutes(30) };
    onbellek.Set(ogeId!, sonuc, secenek);

    // Ölçüme dayalı ikinci anahtar (bkz. SOZLESME.md): yazma kipinde itemId YOK,
    // conversationId VAR ve okuma kipindekiyle aynı. C çağrısı parent'ın A sonucuna
    // ancak bu anahtarla ulaşabilir.
    var konusmaId = istek?["konusmaId"]?.GetValue<string>();
    if (!string.IsNullOrWhiteSpace(konusmaId))
        onbellek.Set("konusma:" + konusmaId, sonuc, secenek);

    olcum.Say("analiz_model");
    olcum.Sure("analiz_model", bas.ElapsedMilliseconds);
    kayit.LogInformation("analiz: {ms}ms girdi={g} cikti={c}", bas.ElapsedMilliseconds, girdiTok, ciktiTok);
    return Results.Content(Paketle(sonuc, false, bas.ElapsedMilliseconds, girdiTok, ciktiTok).ToJsonString(),
                           "application/json", Encoding.UTF8);
});

// ---------- B çağrısı: taslak / çeviri (§3.2) ----------
// Önbelleğe ALINMAZ: kullanıcı niyeti (ton / hedef dil) her seferinde değişebilir.
app.MapPost("/taslak", async (HttpContext ctx) =>
{
    var ks = await kimlik.DogrulaAsync(ctx.Request.Headers.Authorization.ToString());
    if (!ks.Gecerli) { kayit.LogWarning("kimlik reddedildi: {sebep}", ks.Sebep); return Results.Json(new { hata = "kimlik doğrulanamadı" }, statusCode: 401); }

    JsonNode? istek;
    try { using var r = new StreamReader(ctx.Request.Body, Encoding.UTF8); istek = JsonNode.Parse(await r.ReadToEndAsync()); }
    catch { return Results.Json(new { hata = "geçersiz JSON" }, statusCode: 400); }

    var gorev = istek?["gorev"]?.GetValue<string>();
    var govde = istek?["govde"]?.GetValue<string>();
    if (string.IsNullOrWhiteSpace(govde)) return Results.Json(new { hata = "govde gerekli" }, statusCode: 400);

    string talimat;
    if (gorev == "taslak")
    {
        var ton = istek?["ton"]?.GetValue<string>() ?? "kisa";
        if (ton is not ("kisa" or "detayli" or "resmi")) return Results.Json(new { hata = "ton geçersiz" }, statusCode: 400);
        talimat = gorevBTaslak.Replace("{TON}", ton);
    }
    else if (gorev == "ceviri")
    {
        var hedef = istek?["hedefDil"]?.GetValue<string>() ?? "en";
        if (hedef is not ("tr" or "en")) return Results.Json(new { hata = "hedefDil geçersiz" }, statusCode: 400);
        talimat = gorevBCeviri.Replace("{HEDEF_DIL}", hedef);
    }
    else return Results.Json(new { hata = "gorev 'taslak' veya 'ceviri' olmalı" }, statusCode: 400);

    // A ile AYNI önek sırası: [sistem] -> [mail] -> [talimat] (prefix cache, §3.2)
    // Çeviride BAŞLIKLAR GÖNDERİLMEZ: kullanıcı gövdenin çevirisini ister, "Konu:/Kimden:"
    // satırlarının değil. (Ölçüldü: başlık gönderilince model onları da çeviriyordu.)
    var metin = gorev == "ceviri" ? govde! : ZinciriMetneCevir(istek!);
    var bas = System.Diagnostics.Stopwatch.StartNew();
    var (yanit, hata, kod) = await ModelCagirAsync(ModelGovdesi(sistemB, metin + "\n\n" + talimat, 0.4));
    bas.Stop();
    if (hata is not null) return Results.Json(new { hata }, statusCode: kod);

    var icerik = yanit?["choices"]?[0]?["message"]?["content"]?.GetValue<string>();
    if (string.IsNullOrWhiteSpace(icerik)) return Results.Json(new { hata = "model boş yanıt döndü" }, statusCode: 502);

    olcum.Say("taslak_model");
    olcum.Sure("taslak_model", bas.ElapsedMilliseconds);
    kayit.LogInformation("taslak({g}): {ms}ms girdi={i} cikti={c}", gorev, bas.ElapsedMilliseconds,
        yanit?["usage"]?["prompt_tokens"]?.GetValue<int>() ?? 0, yanit?["usage"]?["completion_tokens"]?.GetValue<int>() ?? 0);

    return Results.Content(new JsonObject
    {
        ["metin"] = icerik!.Trim(),
        ["meta"] = new JsonObject
        {
            ["sure_ms"] = bas.ElapsedMilliseconds,
            ["girdi_token"] = yanit?["usage"]?["prompt_tokens"]?.GetValue<int>() ?? 0,
            ["cikti_token"] = yanit?["usage"]?["completion_tokens"]?.GetValue<int>() ?? 0
        }
    }.ToJsonString(), "application/json", Encoding.UTF8);
});

// ---------- C çağrısı: eksik cevap kontrolü (§3.2) ----------
// Girdi orijinal mail DEĞİL: A'nın questions dizisi + kullanıcının taslağı.
// Bu yüzden ucuzdur — 15.000 token'lık zincir yeniden okunmaz.
app.MapPost("/kontrol", async (HttpContext ctx) =>
{
    var ks = await kimlik.DogrulaAsync(ctx.Request.Headers.Authorization.ToString());
    if (!ks.Gecerli) { kayit.LogWarning("kimlik reddedildi: {sebep}", ks.Sebep); return Results.Json(new { hata = "kimlik doğrulanamadı" }, statusCode: 401); }

    JsonNode? istek;
    try { using var r = new StreamReader(ctx.Request.Body, Encoding.UTF8); istek = JsonNode.Parse(await r.ReadToEndAsync()); }
    catch { return Results.Json(new { hata = "geçersiz JSON" }, statusCode: 400); }

    var konusmaId = istek?["konusmaId"]?.GetValue<string>();
    var taslak = istek?["taslak"]?.GetValue<string>();
    if (string.IsNullOrWhiteSpace(konusmaId)) return Results.Json(new { hata = "konusmaId gerekli" }, statusCode: 400);
    if (string.IsNullOrWhiteSpace(taslak)) return Results.Json(new { hata = "taslak gerekli" }, statusCode: 400);

    // §3.2: C TEK BAŞINA ÇALIŞAMAZ. Parent için A hiç çalışmadıysa panel uyarır.
    if (!onbellek.TryGetValue("konusma:" + konusmaId, out JsonNode? aSonuc) || aSonuc is null)
    {
        olcum.Say("kontrol_a_yok");
        return Results.Json(new { hata = "önceki analiz yok", kod = "A_YOK" }, statusCode: 409);
    }

    var sorular = aSonuc["questions"] as JsonArray ?? [];
    if (sorular.Count == 0)
        return Results.Content(new JsonObject
        {
            ["sonuc"] = new JsonObject { ["cevaplanan"] = new JsonArray(), ["cevapsiz"] = new JsonArray(), ["not"] = "Bu zincirde cevap bekleyen soru yok." },
            ["meta"] = new JsonObject { ["soru_sayisi"] = 0, ["sure_ms"] = 0, ["girdi_token"] = 0, ["cikti_token"] = 0 }
        }.ToJsonString(), "application/json", Encoding.UTF8);

    var sb = new StringBuilder();
    sb.Append("Questions that were asked:\n");
    for (var i = 0; i < sorular.Count; i++) sb.Append(i + 1).Append(". ").Append(sorular[i]?.GetValue<string>()).Append('\n');
    sb.Append("\nDraft reply:\n").Append(taslak);

    var bas = System.Diagnostics.Stopwatch.StartNew();
    var (yanit, hata, kod) = await ModelCagirAsync(ModelGovdesi(sistemC, sb + "\n\n" + gorevC, 0.1, jsonModu: true));
    bas.Stop();
    if (hata is not null) return Results.Json(new { hata }, statusCode: kod);

    var icerik = yanit?["choices"]?[0]?["message"]?["content"]?.GetValue<string>();
    var sonucC = icerik is null ? null : JsonAyikla(icerik);
    if (sonucC is null) return Results.Json(new { hata = "model geçerli JSON üretmedi" }, statusCode: 502);

    var girdiTokC = yanit?["usage"]?["prompt_tokens"]?.GetValue<int>() ?? 0;
    olcum.Say("kontrol_model");
    olcum.Sure("kontrol_model", bas.ElapsedMilliseconds);
    kayit.LogInformation("kontrol: {ms}ms soru={s} girdi={i}", bas.ElapsedMilliseconds, sorular.Count, girdiTokC);

    return Results.Content(new JsonObject
    {
        ["sonuc"] = sonucC.DeepClone(),
        ["meta"] = new JsonObject
        {
            ["soru_sayisi"] = sorular.Count,
            ["sure_ms"] = bas.ElapsedMilliseconds,
            ["girdi_token"] = girdiTokC,
            ["cikti_token"] = yanit?["usage"]?["completion_tokens"]?.GetValue<int>() ?? 0
        }
    }.ToJsonString(), "application/json", Encoding.UTF8);
});

app.Logger.LogInformation("servis ayakta: https://*:{p}  saglayici={s} model={m}", PORT, saglayici, model);
app.Run();


// ---------------- yardımcılar ----------------

static JsonObject Paketle(JsonNode sonuc, bool onbellekten, long ms, int girdi, int cikti) => new()
{
    ["sonuc"] = sonuc.DeepClone(),
    ["meta"] = new JsonObject
    {
        ["onbellek"] = onbellekten,
        ["sure_ms"] = ms,
        ["girdi_token"] = girdi,
        ["cikti_token"] = cikti
    }
};

static string Kisiler(JsonNode? dizi)
{
    if (dizi is not JsonArray a) return "";
    return string.Join(", ", a.Select(k =>
        (k?["ad"]?.GetValue<string>() ?? "") + " <" + (k?["eposta"]?.GetValue<string>() ?? "") + ">"));
}

static string ZinciriMetneCevir(JsonNode istek)
{
    var sb = new StringBuilder();
    sb.Append("Konu: ").Append(istek["konu"]?.GetValue<string>() ?? "").Append("\n\n");
    var kimden = istek["kimden"];
    if (kimden is not null)
        sb.Append("Kimden: ").Append(kimden["ad"]?.GetValue<string>() ?? "")
          .Append(" <").Append(kimden["eposta"]?.GetValue<string>() ?? "").Append(">\n");
    var kime = Kisiler(istek["kime"]);
    if (kime.Length > 0) sb.Append("Kime: ").Append(kime).Append('\n');
    var cc = Kisiler(istek["cc"]);
    if (cc.Length > 0) sb.Append("CC: ").Append(cc).Append('\n');
    sb.Append('\n').Append(istek["govde"]?.GetValue<string>() ?? "");
    return sb.ToString();
}

static JsonNode? JsonAyikla(string s)
{
    s = s.Trim();
    if (s.StartsWith("```"))
    {
        var ilkSatirSonu = s.IndexOf('\n');
        if (ilkSatirSonu > 0) s = s[(ilkSatirSonu + 1)..];
        var kapanis = s.LastIndexOf("```", StringComparison.Ordinal);
        if (kapanis >= 0) s = s[..kapanis];
    }
    var i = s.IndexOf('{');
    var j = s.LastIndexOf('}');
    if (i < 0 || j <= i) return null;
    try { return JsonNode.Parse(s[i..(j + 1)]); } catch { return null; }
}

static X509Certificate2 SunucuSertifikasi(string parmakIzi)
{
    using var depo = new X509Store(StoreName.My, StoreLocation.LocalMachine);
    depo.Open(OpenFlags.ReadOnly);
    var bulunan = depo.Certificates.Find(X509FindType.FindByThumbprint, parmakIzi, false);
    if (bulunan.Count == 0)
        throw new InvalidOperationException("sunucu sertifikası bulunamadı: " + parmakIzi);
    return bulunan[0];
}
