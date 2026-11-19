/*
 * Exchange identity token doğrulaması (E5 / çivi #8).
 *
 * GÜVENLİK NOTLARI — bunlar bilinçli kararlardır, sadeleştirilmemelidir:
 *
 *  1. `alg` ZORUNLU olarak RS256. "none" ve HMAC ("HS256") reddedilir.
 *     Aksi halde saldırgan imzasız veya kendi anahtarıyla imzalı token üretebilir.
 *  2. İmza, HERHANGİ bir claim'e güvenilmeden ÖNCE doğrulanır.
 *  3. Token içindeki `appctx.amurl` ASLA kullanılmaz. Saldırgan onu kendi
 *     sunucusuna çevirip kendi sertifikasını imzalatabilirdi. Metadata adresi
 *     yapılandırmadan (config/auth.*.json) gelir ve sabittir.
 *  4. `iss` ve `aud` beklenen değerlerle karşılaştırılır; `aud` eklentinin
 *     kendi URL'sidir, böylece başka bir eklenti için üretilmiş token kabul edilmez.
 *  5. Hata mesajları kullanıcıya ayrıntı sızdırmaz; ayrıntı yalnız sunucu günlüğüne
 *     (içerik değil, sebep kodu olarak) yazılır.
 */

using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json.Nodes;

namespace OutlookAjan.Servis;

public sealed record KimlikAyar(
    bool Etkin,
    string MetadataUrl,
    string BeklenenIssuer,
    string BeklenenAudience,
    int SapmaSaniye,
    int OnbellekSaat);

public sealed record KimlikSonuc(bool Gecerli, string? MsExchUid, string? Sebep);

public sealed class KimlikDogrulayici(KimlikAyar ayar, IHttpClientFactory fab, ILogger kayit)
{
    private X509Certificate2[] _sertifikalar = [];
    private DateTimeOffset _sonCekme = DateTimeOffset.MinValue;
    private readonly SemaphoreSlim _kilit = new(1, 1);

    public async Task<KimlikSonuc> DogrulaAsync(string? yetkiBasligi)
    {
        if (!ayar.Etkin) return new KimlikSonuc(true, null, "dogrulama kapali");

        if (string.IsNullOrWhiteSpace(yetkiBasligi) ||
            !yetkiBasligi.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return new KimlikSonuc(false, null, "Authorization: Bearer yok");

        var token = yetkiBasligi["Bearer ".Length..].Trim();
        var parca = token.Split('.');
        if (parca.Length != 3) return new KimlikSonuc(false, null, "JWT 3 parçalı değil");

        JsonNode? baslik, iddia;
        try
        {
            baslik = JsonNode.Parse(Encoding.UTF8.GetString(Base64UrlCoz(parca[0])));
            iddia = JsonNode.Parse(Encoding.UTF8.GetString(Base64UrlCoz(parca[1])));
        }
        catch { return new KimlikSonuc(false, null, "başlık/gövde çözülemedi"); }

        // (1) alg sabitlenir — "none"/HS256 saldırılarına kapı bırakılmaz
        var alg = baslik?["alg"]?.GetValue<string>();
        if (!string.Equals(alg, "RS256", StringComparison.Ordinal))
            return new KimlikSonuc(false, null, "alg RS256 değil");

        var x5t = baslik?["x5t"]?.GetValue<string>();

        // (2) imza her şeyden önce doğrulanır
        var sertler = await SertifikalariAlAsync(false);
        if (!ImzaDogru(token, parca, x5t, sertler))
        {
            // sertifika döndüyse (rollover) bir kez tazeleyip tekrar dene
            sertler = await SertifikalariAlAsync(true);
            if (!ImzaDogru(token, parca, x5t, sertler))
                return new KimlikSonuc(false, null, "imza doğrulanamadı");
        }

        // (4) imza geçerli — artık claim'lere bakılabilir
        var iss = iddia?["iss"]?.GetValue<string>();
        if (!string.Equals(iss, ayar.BeklenenIssuer, StringComparison.OrdinalIgnoreCase))
            return new KimlikSonuc(false, null, "issuer beklenenden farklı");

        var aud = iddia?["aud"]?.GetValue<string>();
        if (!string.Equals(aud, ayar.BeklenenAudience, StringComparison.OrdinalIgnoreCase))
            return new KimlikSonuc(false, null, "audience beklenenden farklı");

        var simdi = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var exp = iddia?["exp"]?.GetValue<long>() ?? 0;
        var nbf = iddia?["nbf"]?.GetValue<long>() ?? 0;
        if (exp <= 0 || nbf <= 0) return new KimlikSonuc(false, null, "exp/nbf yok");
        if (simdi > exp + ayar.SapmaSaniye) return new KimlikSonuc(false, null, "token süresi dolmuş");
        if (simdi < nbf - ayar.SapmaSaniye) return new KimlikSonuc(false, null, "token henüz geçerli değil");

        // appctx içindeki msexchuid kullanıcıyı tanımlar (mail adresi değil — K2 dostu)
        string? uid = null;
        try
        {
            var appctx = iddia?["appctx"]?.GetValue<string>();
            if (appctx is not null) uid = JsonNode.Parse(appctx)?["msexchuid"]?.GetValue<string>();
        }
        catch { /* uid yoksa da token geçerlidir */ }

        return new KimlikSonuc(true, uid, null);
    }

    private static bool ImzaDogru(string token, string[] parca, string? x5t, X509Certificate2[] sertler)
    {
        if (sertler.Length == 0) return false;
        var imzalanan = Encoding.ASCII.GetBytes(parca[0] + "." + parca[1]);
        byte[] imza;
        try { imza = Base64UrlCoz(parca[2]); } catch { return false; }

        foreach (var sert in sertler)
        {
            // x5t varsa önce parmak izi eşleşmesi aranır (derinlemesine savunma)
            if (!string.IsNullOrEmpty(x5t))
            {
                var beklenen = Convert.ToHexString(Base64UrlCoz(x5t));
                if (!string.Equals(beklenen, sert.Thumbprint, StringComparison.OrdinalIgnoreCase)) continue;
            }
            using var rsa = sert.GetRSAPublicKey();
            if (rsa is null) continue;
            if (rsa.VerifyData(imzalanan, imza, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
                return true;
        }
        return false;
    }

    private async Task<X509Certificate2[]> SertifikalariAlAsync(bool zorla)
    {
        if (!zorla && _sertifikalar.Length > 0 &&
            DateTimeOffset.UtcNow - _sonCekme < TimeSpan.FromHours(ayar.OnbellekSaat))
            return _sertifikalar;

        await _kilit.WaitAsync();
        try
        {
            if (!zorla && _sertifikalar.Length > 0 &&
                DateTimeOffset.UtcNow - _sonCekme < TimeSpan.FromHours(ayar.OnbellekSaat))
                return _sertifikalar;

            var http = fab.CreateClient("meta");
            // (3) SABİT adres — token'daki amurl'e asla bakılmaz
            var ham = await http.GetStringAsync(ayar.MetadataUrl);
            var belge = JsonNode.Parse(ham);

            var liste = new List<X509Certificate2>();
            if (Alan(belge, "keys") is JsonArray anahtarlar)
            {
                foreach (var a in anahtarlar)
                {
                    if (!string.Equals(Alan(a, "usage")?.GetValue<string>(), "signing", StringComparison.OrdinalIgnoreCase)) continue;
                    // DIKKAT: Exchange bu alani "keyvalue" (tamami kucuk) olarak yaziyor.
                    // System.Text.Json indeksleyicisi BUYUK/KUCUK HARFE DUYARLIDIR;
                    // PowerShell'in ConvertFrom-Json'i duyarsiz oldugu icin bu fark
                    // ilk incelemede gorunmuyor. Bu yuzden alan adi duyarsiz aranir.
                    var deger = Alan(Alan(a, "keyvalue"), "value")?.GetValue<string>();
                    if (string.IsNullOrWhiteSpace(deger)) continue;
                    try { liste.Add(new X509Certificate2(Convert.FromBase64String(deger))); }
                    catch { /* bozuk kayıt atlanır */ }
                }
            }

            if (liste.Count > 0)
            {
                _sertifikalar = [.. liste];
                _sonCekme = DateTimeOffset.UtcNow;
                kayit.LogInformation("kimlik: {n} imza sertifikası yüklendi", liste.Count);
            }
            else kayit.LogWarning("kimlik: metadata'da imza sertifikası bulunamadı");

            return _sertifikalar;
        }
        catch (Exception ex)
        {
            kayit.LogError("kimlik: metadata alınamadı ({tip})", ex.GetType().Name);
            return _sertifikalar;   // elde eskisi varsa onunla devam
        }
        finally { _kilit.Release(); }
    }

    /// JSON alanini buyuk/kucuk harfe duyarsiz bulur (bkz. "keyvalue" notu).
    private static JsonNode? Alan(JsonNode? dugum, string ad)
    {
        if (dugum is not JsonObject nesne) return null;
        foreach (var kv in nesne)
            if (string.Equals(kv.Key, ad, StringComparison.OrdinalIgnoreCase))
                return kv.Value;
        return null;
    }

    private static byte[] Base64UrlCoz(string s)
    {
        s = s.Replace('-', '+').Replace('_', '/');
        switch (s.Length % 4)
        {
            case 2: s += "=="; break;
            case 3: s += "="; break;
            case 1: throw new FormatException("geçersiz base64url");
        }
        return Convert.FromBase64String(s);
    }
}
