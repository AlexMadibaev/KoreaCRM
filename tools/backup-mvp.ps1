$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $root '.mvp-local'
$envFile = Join-Path $stateDir 'mvp.env'
if (-not (Test-Path $envFile)) { throw 'Run tools/start-mvp.ps1 first' }
$databaseLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1
if (-not $databaseLine) { throw 'DATABASE_URL is missing from mvp.env' }
$env:DATABASE_URL = $databaseLine.Substring('DATABASE_URL='.Length)
$env:BACKUP_DIR = Join-Path $stateDir 'backups'
$env:PG_BIN_DIR = 'C:\Program Files\PostgreSQL\16\bin'
Push-Location $root
try {
  & node tools/postgres-backup.mjs backup
  if ($LASTEXITCODE -ne 0) { throw 'Database backup failed' }
} finally { Pop-Location }
