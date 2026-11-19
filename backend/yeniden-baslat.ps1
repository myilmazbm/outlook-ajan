<#
  Servisi durdur -> derle -> baslat. Calisan surec exe'yi kilitledigi icin
  once durdurulmali; aksi halde derleme MSB3027 ile patlar.
#>
param([switch]$SadeceDurdur)
$ErrorActionPreference = 'Stop'
$proje = Split-Path $PSScriptRoot -Parent

$c = Get-NetTCPConnection -LocalPort 4444 -State Listen -ErrorAction SilentlyContinue
if ($c) {
  $surecId = $c[0].OwningProcess
  Write-Host "4444 dinleyen surec durduruluyor (PID $surecId)" -ForegroundColor Yellow
  Stop-Process -Id $surecId -Force
  Start-Sleep -Seconds 3
} else { Write-Host "4444'te dinleyen yok" }

if ($SadeceDurdur) { return }

Push-Location $PSScriptRoot
try {
  dotnet build -v quiet --nologo
  if ($LASTEXITCODE -ne 0) { throw "derleme basarisiz (exit $LASTEXITCODE)" }
  Write-Host "derleme tamam" -ForegroundColor Green
} finally { Pop-Location }
