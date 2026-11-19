<#
  Arka ucu Windows hizmeti olarak kurar/gunceller (yeniden baslatmada kendiliginden kalkar).

  Yerlesim ($Kok altinda):
    app\      yayinlanan servis (salt okunur)
    config\   llm/auth/sunucu yapilandirmasi
    prompts\  sistem ve gorev promptlari
    veri\     olcum.json (yalniz sayi - K2). Hizmet hesabinin YAZABILDIGI tek yer.
    <anahtar> config'teki apiKeyFile (ornek: openrouter-key.txt)

  Hesap: NT SERVICE\<HizmetAdi> (sanal hizmet hesabi). Parolasi yok, etki alani
  yetkisi yok, yalniz asagida verilen dosya izinlerine sahip. Administrator ile
  CALISTIRILMAZ.

  Yalniz lab ortami (K11). Yonetici olarak calistirin.

  Kaldirmak icin:  .\hizmet-kur.ps1 -Kaldir
#>
param(
  [string]$Kok = 'C:\OutlookAjan',
  [string]$HizmetAdi = 'OutlookAjanServis',
  [string]$Ortam = 'lab',
  [switch]$Kaldir
)
$ErrorActionPreference = 'Stop'
$proje = Split-Path $PSScriptRoot -Parent
$hesap = "NT SERVICE\$HizmetAdi"

function Stop-Hizmet {
  $h = Get-Service -Name $HizmetAdi -ErrorAction SilentlyContinue
  if ($h -and $h.Status -ne 'Stopped') { Stop-Service -Name $HizmetAdi -Force; $h.WaitForStatus('Stopped', '00:00:30') }
}

if ($Kaldir) {
  Stop-Hizmet
  if (Get-Service -Name $HizmetAdi -ErrorAction SilentlyContinue) { sc.exe delete $HizmetAdi | Out-Null }
  Write-Host "hizmet kaldirildi (dosyalar $Kok altinda birakildi)" -ForegroundColor Yellow
  return
}

# --- yapilandirmayi oku (anahtar dosyasi adi ve sertifika icin) ---
$llm    = (Get-Content (Join-Path $proje "config\llm.$Ortam.json") -Raw | ConvertFrom-Json).llm
$sunucu = (Get-Content (Join-Path $proje "config\sunucu.$Ortam.json") -Raw | ConvertFrom-Json).sunucu
$anahtarKaynak = Join-Path $proje $llm.apiKeyFile
if (-not (Test-Path $anahtarKaynak)) { throw "anahtar dosyasi yok: $($llm.apiKeyFile)" }

# --- elle baslatilmis kopya varsa durdur (ayni portu tutar) ---
Stop-Hizmet
$dinleyen = Get-NetTCPConnection -LocalPort $sunucu.port -State Listen -ErrorAction SilentlyContinue
if ($dinleyen) { Stop-Process -Id $dinleyen[0].OwningProcess -Force; Start-Sleep -Seconds 2 }

# --- yayinla ve kopyala ---
foreach ($d in 'app', 'config', 'prompts', 'veri') { New-Item -ItemType Directory -Force -Path (Join-Path $Kok $d) | Out-Null }
dotnet publish (Join-Path $PSScriptRoot 'OutlookAjan.Servis.csproj') -c Release -o (Join-Path $Kok 'app') --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw "yayinlama basarisiz (exit $LASTEXITCODE)" }
Copy-Item (Join-Path $proje "config\*.$Ortam.json") (Join-Path $Kok 'config') -Force
Copy-Item (Join-Path $proje 'prompts\*') (Join-Path $Kok 'prompts') -Force
Copy-Item $anahtarKaynak (Join-Path $Kok $llm.apiKeyFile) -Force

# --- hizmet ---
$exe = Join-Path $Kok 'app\OutlookAjan.Servis.exe'
if (-not (Get-Service -Name $HizmetAdi -ErrorAction SilentlyContinue)) {
  New-Service -Name $HizmetAdi -BinaryPathName "`"$exe`"" -DisplayName 'Outlook Ajani - arka uc' `
    -Description 'Outlook Ajani eklentisinin arka uc servisi. Mail icerigi diske yazilmaz.' -StartupType Automatic | Out-Null
}
sc.exe config $HizmetAdi obj= $hesap start= delayed-auto | Out-Null
sc.exe failure $HizmetAdi reset= 86400 actions= restart/5000/restart/30000/restart/60000 | Out-Null
# Sanal hesap SID'i hizmet kaydi olusunca cozulur; izinler bu yuzden burada verilir.
Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$HizmetAdi" -Name Environment -Type MultiString -Value @(
  "AJAN_KOK=$Kok",
  "AJAN_VERI=$(Join-Path $Kok 'veri')",
  "AJAN_CONFIG=$(Join-Path $Kok "config\llm.$Ortam.json")",
  "AJAN_AUTH_CONFIG=$(Join-Path $Kok "config\auth.$Ortam.json")",
  "AJAN_SUNUCU_CONFIG=$(Join-Path $Kok "config\sunucu.$Ortam.json")"
)

# --- dosya izinleri: kok salt okunur, yalniz veri\ yazilabilir ---
icacls $Kok /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' "${hesap}:(OI)(CI)RX" | Out-Null
icacls (Join-Path $Kok 'veri') /grant "${hesap}:(OI)(CI)M" | Out-Null

# --- TLS sertifikasinin ozel anahtarina okuma izni ---
$sertifika = Get-Item "Cert:\LocalMachine\My\$($sunucu.certThumbprint)"
$rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($sertifika)
if ($rsa -is [System.Security.Cryptography.RSACng]) {
  $anahtarDosya = Get-ChildItem "$env:ProgramData\Microsoft\Crypto\Keys", "$env:ProgramData\Microsoft\Crypto\RSA\MachineKeys" -Filter $rsa.Key.UniqueName -ErrorAction SilentlyContinue | Select-Object -First 1
} else {
  $anahtarDosya = Get-ChildItem "$env:ProgramData\Microsoft\Crypto\RSA\MachineKeys" -Filter $rsa.CspKeyContainerInfo.UniqueKeyContainerName | Select-Object -First 1
}
if (-not $anahtarDosya) { throw 'sertifika ozel anahtar dosyasi bulunamadi' }
icacls $anahtarDosya.FullName /grant "${hesap}:R" | Out-Null

# --- Olay Gunlugu kaynagi (hizmet hesabi kendisi olusturamaz) ---
if (-not [System.Diagnostics.EventLog]::SourceExists('OutlookAjan.Servis')) {
  New-EventLog -LogName Application -Source 'OutlookAjan.Servis'
}

Start-Service -Name $HizmetAdi
(Get-Service -Name $HizmetAdi).WaitForStatus('Running', '00:00:30')
Write-Host "hizmet calisiyor: $HizmetAdi ($hesap), kok=$Kok" -ForegroundColor Green
