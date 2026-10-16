$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSCommandPath
$node = (Get-Command node -ErrorAction Stop).Source
$apiUrl = 'http://127.0.0.1:3001/health'
$siteUrl = 'http://127.0.0.1:3000/'
$webRoot = Join-Path $projectRoot 'apps\web'

function Get-Health {
  try { Invoke-RestMethod -Uri $apiUrl -TimeoutSec 2 } catch { $null }
}

function Test-Preview {
  try { (Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

$health = Get-Health
if ($health -and $health.service -ne 'koreacrm-pos-demo') { throw "Порт 3001 занят другим сервером: $($health.service)" }
if (-not $health) {
  Start-Process -FilePath $node -ArgumentList @('demo-server.mjs') -WorkingDirectory (Join-Path $projectRoot 'apps\pos') -WindowStyle Hidden
}
if (-not (Test-Preview)) {
  $next = Join-Path $webRoot 'node_modules\next\dist\bin\next'
  if (-not (Test-Path -LiteralPath $next)) { throw 'Зависимости не установлены. Выполните corepack pnpm install в корне проекта.' }
  Push-Location $projectRoot
  try {
    corepack pnpm --filter @koreacrm/web build
    if ($LASTEXITCODE -ne 0) { throw 'Сборка кабинета завершилась с ошибкой.' }
  } finally { Pop-Location }
  Start-Process -FilePath $node -ArgumentList @($next, 'start', '--hostname', '127.0.0.1', '--port', '3000') -WorkingDirectory $webRoot -WindowStyle Hidden
}
for ($attempt = 0; $attempt -lt 80; $attempt++) {
  if ((Get-Health) -and (Test-Preview)) {
    Start-Process $siteUrl
    Write-Host 'Личный кабинет открыт. Логин: demo, пароль: demo1234.'
    exit 0
  }
  Start-Sleep -Milliseconds 500
}
throw 'Не удалось запустить кабинет. Проверьте, свободны ли порты 3000 и 3001.'
