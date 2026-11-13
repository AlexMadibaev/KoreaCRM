$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$keyDir = Join-Path $env:LOCALAPPDATA 'KoreaCRM\UpdaterSigning'
$previousKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD

Push-Location (Join-Path $root 'apps/pos')
try {
  if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    $env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path -LiteralPath (Join-Path $keyDir 'pos.key')).Path
    $secret = Get-Content -LiteralPath (Join-Path $keyDir 'pos.password') -Raw
    $password = ConvertTo-SecureString $secret.Trim()
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Net.NetworkCredential]::new('', $password).Password
  }
  & corepack pnpm tauri build --bundles nsis
  if ($LASTEXITCODE -ne 0) { throw 'POS installer build failed' }
} finally {
  $env:TAURI_SIGNING_PRIVATE_KEY = $previousKey
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousPassword
  Pop-Location
}
