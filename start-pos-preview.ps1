$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSCommandPath
$posRoot = Join-Path $projectRoot 'apps\pos'
$node = (Get-Command node -ErrorAction Stop).Source
$apiUrl = 'http://127.0.0.1:3001/health'
$siteUrl = 'http://127.0.0.1:5173/'

function Get-Health {
  try { Invoke-RestMethod -Uri $apiUrl -TimeoutSec 2 } catch { $null }
}

function Test-Preview {
  try {
    $response = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 2
    $response.StatusCode -eq 200 -and $response.Content.Contains('Korea CRM POS')
  } catch { $false }
}

$health = Get-Health
if ($health -and $health.service -ne 'koreacrm-pos-demo') {
  throw "Порт 3001 занят другим сервером: $($health.service)"
}
if (-not $health) {
  Start-Process -FilePath $node -ArgumentList @('demo-server.mjs') -WorkingDirectory $posRoot -WindowStyle Hidden
}
if (-not (Test-Preview)) {
  $vite = Join-Path $posRoot 'node_modules\vite\bin\vite.js'
  if (-not (Test-Path -LiteralPath $vite)) { throw 'Зависимости не установлены. Выполните corepack pnpm install в корне проекта.' }
  Start-Process -FilePath $node -ArgumentList @($vite, '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $posRoot -WindowStyle Hidden
}

for ($attempt = 0; $attempt -lt 40; $attempt++) {
  $health = Get-Health
  if ($health.service -eq 'koreacrm-pos-demo' -and (Test-Preview)) {
    Start-Process $siteUrl
    Write-Host 'Касса открыта в браузере. Логин: demo, пароль: demo1234, сервер: http://127.0.0.1:3001'
    exit 0
  }
  Start-Sleep -Milliseconds 250
}
throw 'Не удалось запустить демо. Проверьте, свободны ли порты 3001 и 5173.'
