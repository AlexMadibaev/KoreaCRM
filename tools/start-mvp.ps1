param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $root '.mvp-local'
$envFile = Join-Path $stateDir 'mvp.env'
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'
$dbName = 'koreacrm_mvp'
$dbPort = 5433
$webPort = 3010
$apiPort = 3011

function New-RandomText([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Wait-Http([string]$url) {
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch { Start-Sleep -Seconds 1 }
  }
  throw "Service did not start: $url. Check logs in $stateDir"
}

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
if (-not (Test-Path $envFile)) {
  $ownerPassword = New-RandomText 18
  $jwtSecret = New-RandomText 48
  @(
    "DATABASE_URL=postgresql://koreacrm@127.0.0.1:${dbPort}/${dbName}?schema=public"
    "JWT_SECRET=$jwtSecret"
    'SEED_OWNER_LOGIN=owner'
    "SEED_OWNER_PASSWORD=$ownerPassword"
    "API_PORT=$apiPort"
    'API_HOST=127.0.0.1'
    "WEB_ORIGIN=http://127.0.0.1:$webPort"
    'POS_ORIGIN=http://tauri.localhost,tauri://localhost'
    'NEXT_PUBLIC_API_URL=/api'
  ) | ForEach-Object { [string]$_ } | Set-Content -LiteralPath $envFile -Encoding ascii
  Write-Host "Created local MVP settings: $envFile"
}

Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^([A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
$env:KOREACRM_NEXT_DIST_DIR = '.next-mvp'
$env:KOREACRM_API_PROXY_TARGET = "http://127.0.0.1:$apiPort"
if ($env:NEXT_PUBLIC_API_URL -ne '/api') {
  throw "Set NEXT_PUBLIC_API_URL=/api in $envFile, then rerun the script without -SkipBuild"
}

$pgReady = Join-Path $pgBin 'pg_isready.exe'
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$psql = Join-Path $pgBin 'psql.exe'
$createdb = Join-Path $pgBin 'createdb.exe'
if (-not (Test-Path $pgReady)) { throw "PostgreSQL 16 was not found at $pgBin" }
& $pgReady -h 127.0.0.1 -p $dbPort | Out-Host
if ($LASTEXITCODE -ne 0) {
  $dataDir = Join-Path $root 'tools/pg-test-data'
  if (-not (Test-Path (Join-Path $dataDir 'PG_VERSION'))) { throw "PostgreSQL data directory not found: $dataDir" }
  & $pgCtl -D $dataDir -l (Join-Path $stateDir 'postgres.log') -o "-p $dbPort -c listen_addresses=127.0.0.1" -w start
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL could not start on port $dbPort" }
}

$existing = & $psql -h 127.0.0.1 -p $dbPort -U koreacrm -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='$dbName'"
if ($LASTEXITCODE -ne 0) { throw 'Cannot connect to PostgreSQL as koreacrm' }
if (-not $existing) {
  & $createdb -h 127.0.0.1 -p $dbPort -U koreacrm $dbName
  if ($LASTEXITCODE -ne 0) { throw "Cannot create database $dbName" }
  Write-Host "Created clean database: $dbName"
}

Push-Location $root
try {
  & corepack pnpm --filter @koreacrm/database exec prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
  & corepack pnpm --filter @koreacrm/database db:seed
  if ($LASTEXITCODE -ne 0) { throw 'Database seed failed' }
  if (-not $SkipBuild -or -not (Test-Path (Join-Path $root 'apps/web/.next-mvp/BUILD_ID'))) {
    & corepack pnpm --filter @koreacrm/api build
    if ($LASTEXITCODE -ne 0) { throw 'API build failed' }
    & corepack pnpm --filter @koreacrm/web build
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed' }
  }
} finally { Pop-Location }

$node = (Get-Command node -ErrorAction Stop).Source
$apiHealth = "http://127.0.0.1:$apiPort/health"
$webLogin = "http://127.0.0.1:$webPort/login"
try { $apiRunning = (Invoke-WebRequest -Uri $apiHealth -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $apiRunning = $false }
if (-not $apiRunning) {
  Start-Process -FilePath $node -ArgumentList 'dist/main.js' -WorkingDirectory (Join-Path $root 'apps/api') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'api.out.log') -RedirectStandardError (Join-Path $stateDir 'api.err.log') | Out-Null
}
Wait-Http $apiHealth
try { $webRunning = (Invoke-WebRequest -Uri $webLogin -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $webRunning = $false }
if (-not $webRunning) {
  Start-Process -FilePath $node -ArgumentList "node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port $webPort" -WorkingDirectory (Join-Path $root 'apps/web') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'web.out.log') -RedirectStandardError (Join-Path $stateDir 'web.err.log') | Out-Null
}
Wait-Http $webLogin

$lanAddress = [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
  Where-Object { $_.OperationalStatus -eq 'Up' } |
  ForEach-Object {
    $properties = $_.GetIPProperties()
    if ($properties.GatewayAddresses.Count -gt 0) {
      $properties.UnicastAddresses | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' } | ForEach-Object { $_.Address.IPAddressToString }
    }
  } | Select-Object -First 1

Write-Host "MVP ready: $webLogin"
if ($lanAddress) { Write-Host "Wi-Fi/LAN address: http://${lanAddress}:$webPort/login" }
Write-Host "Initial login: $env:SEED_OWNER_LOGIN"
Write-Host "Initial password: $env:SEED_OWNER_PASSWORD"
Write-Host 'The password above is for the newly created local database. Change it in the app before entering real data.'
