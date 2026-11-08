param([ValidatePattern('^\.next[a-zA-Z0-9._-]*$')][string]$WebDistDir = '.next-release-check-20261109', [switch]$RestartDatabase, [switch]$RegenerateDatabaseClient)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$crmWebPorts = @(3010, 3020, 3021, 3022)
$crmApiPort = 3011

function Get-CrmListeners {
  $listeners = @{}
  foreach ($line in (& netstat.exe -ano -p tcp)) {
    if ($line -match '^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$') {
      $listenerPort = [int]$Matches[1]
      if ($listenerPort -in ($crmWebPorts + $crmApiPort)) { $listeners[$listenerPort] = [int]$Matches[2] }
    }
  }
  return $listeners
}

# Validate every listener before stopping anything. No blanket node.exe termination.
$listeners = Get-CrmListeners
foreach ($listenerPort in $listeners.Keys) {
  $serverProcess = Get-Process -Id $listeners[$listenerPort] -ErrorAction Stop
  if ($serverProcess.ProcessName -ne 'node') { throw "Port $listenerPort is used by another application. Nothing was stopped." }
  if ($listenerPort -eq $crmApiPort) {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$listenerPort/health" -TimeoutSec 5
    $swagger = Invoke-RestMethod -Uri "http://127.0.0.1:$listenerPort/docs-json" -TimeoutSec 5
    if ($health.service -ne 'api' -or $swagger.info.title -ne 'Korea CRM API') { throw "Port $listenerPort is not the CRM API. Nothing was stopped." }
  } else {
    $page = Invoke-WebRequest -Uri "http://127.0.0.1:$listenerPort/login" -UseBasicParsing -TimeoutSec 5
    if ($page.Content -notmatch '<title>Korea CRM</title>') { throw "Port $listenerPort is not Korea CRM. Nothing was stopped." }
  }
}

foreach ($serverId in @($listeners.Values | Sort-Object -Unique)) {
  try { Stop-Process -Id $serverId -Force -ErrorAction Stop }
  catch { throw "Windows denied stopping CRM process $serverId. Run this restart script as the user who started the servers, or as administrator. No extra server was started." }
}
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  if ((Get-CrmListeners).Count -eq 0) { break }
  Start-Sleep -Milliseconds 250
}
if ((Get-CrmListeners).Count) { throw 'Some CRM ports remain occupied. No extra server was started.' }

if ($RegenerateDatabaseClient) {
  Push-Location $projectRoot
  try {
    & corepack pnpm --filter @koreacrm/database db:generate
    if ($LASTEXITCODE -ne 0) { throw 'Database client generation failed. CRM servers remain stopped.' }
    & corepack pnpm --filter @koreacrm/api build
    if ($LASTEXITCODE -ne 0) { throw 'API build failed. CRM servers remain stopped.' }
  } finally { Pop-Location }
}
$postgresData = Join-Path $projectRoot 'tools/pg-test-data'
$postgresPidFile = Join-Path $postgresData 'postmaster.pid'
if ($RestartDatabase -and (Test-Path -LiteralPath $postgresPidFile)) {
  $postgresState = Get-Content -LiteralPath $postgresPidFile -TotalCount 4
  $recordedData = [IO.Path]::GetFullPath($postgresState[1].Replace('/', '\'))
  if ($recordedData -ne [IO.Path]::GetFullPath($postgresData) -or $postgresState[3] -ne '5433') { throw 'Unexpected PostgreSQL cluster. Database was not stopped.' }
  & 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe' -D $postgresData -m fast -w stop
  if ($LASTEXITCODE -ne 0) { throw 'CRM PostgreSQL could not stop cleanly. No new server was started.' }
}

if (-not $RestartDatabase) { Write-Host 'Keeping the existing CRM PostgreSQL server running.' }
Write-Host 'Old CRM web/API servers stopped. Starting the latest build on port 3010.'
& (Join-Path $PSScriptRoot 'start-mvp.ps1') -SkipBuild -WebPort 3010 -WebDistDir $WebDistDir