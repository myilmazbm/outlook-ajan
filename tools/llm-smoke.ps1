<#
  §15.2 saglayici soyutlamasi dogrulama araci.
  Yapilandirmadan okur; kodda "openrouter" gecmez. Ortam degistirmek = -Config degistirmek.
  K10: bu araca YALNIZCA sentetik metin verilir.
#>
param(
  [string]$Config = (Join-Path $PSScriptRoot '..\config\llm.lab.json'),
  [string]$Prompt = 'Tek kelimeyle cevapla: Turkiye''nin baskenti neresi?'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cfg  = (Get-Content $Config -Raw | ConvertFrom-Json).llm

$keyPath = Join-Path $root $cfg.apiKeyFile
if (-not (Test-Path $keyPath)) { throw "Anahtar dosyasi bulunamadi: $($cfg.apiKeyFile)" }
$key = (Get-Content $keyPath -Raw).Trim()          # anahtar asla ekrana/loga yazilmaz

$body = @{
  model    = $cfg.model
  messages = @(@{ role = 'user'; content = $Prompt })
  max_tokens = 400
} | ConvertTo-Json -Depth 6

$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
  $r = Invoke-RestMethod -Uri "$($cfg.baseUrl)/chat/completions" -Method Post `
        -Headers @{ Authorization = "Bearer $key"; 'Content-Type' = 'application/json' } `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 120
} catch {
  # anahtar sizmasin diye hata mesaji temizlenir
  $msg = $_.Exception.Message -replace [regex]::Escape($key), '***'
  throw "LLM cagrisi basarisiz: $msg"
}
$sw.Stop()

[pscustomobject]@{
  Saglayici   = $cfg.provider
  Model       = $r.model
  Sure_ms     = $sw.ElapsedMilliseconds
  GirdiToken  = $r.usage.prompt_tokens
  CiktiToken  = $r.usage.completion_tokens
  BitisNedeni = $r.choices[0].finish_reason
} | Format-List

Write-Host '--- YANIT ---' -ForegroundColor Cyan
$r.choices[0].message.content
