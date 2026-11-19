<#
  Faz 0/1 - eklenti dosyalarini IIS kok dizinine kopyalar.
  Kaynak : <proje>\addin
  Hedef  : C:\inetpub\outlook-ajan  (IIS sitesi "OutlookAjan", https://mail.example.local:4443)
  Yalniz EXCH01 lab ortami (K11).
#>
$ErrorActionPreference = 'Stop'
$src  = Join-Path $PSScriptRoot 'addin'
$dest = 'C:\inetpub\outlook-ajan'

if (-not (Test-Path $src))  { throw "Kaynak dizin yok: $src" }
if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }

# /MIR kullanilmiyor: hedefte elle konulmus dosyalar silinmesin.
robocopy $src $dest /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy basarisiz (exit $LASTEXITCODE)" }

Write-Host "Kopyalandi -> $dest" -ForegroundColor Green
Get-ChildItem $dest -Recurse -File |
  Select-Object @{n='Dosya';e={$_.FullName.Substring($dest.Length+1)}}, Length |
  Format-Table -AutoSize

# robocopy 0-7 arasi basari demektir; PowerShell/CI icin normallestir.
exit 0
