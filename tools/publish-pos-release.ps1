param(
  [string]$InstallerPath,
  [string]$Tag,
  [string]$Title,
  [string]$NotesFile,
  [switch]$ExistingRelease
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $root 'apps/pos/src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$version = $config.version
$repo = 'AlexMadibaev/KoreaCRM'
if (-not $Tag) { $Tag = "v$version-pos" }
if (-not $InstallerPath) { $InstallerPath = Join-Path $root "apps/pos/src-tauri/target/release/bundle/nsis/Korea CRM POS_${version}_x64-setup.exe" }
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
if ([IO.Path]::GetExtension($installer) -ne '.exe') { throw 'Expected an EXE installer' }
if ($config.bundle.createUpdaterArtifacts) {
  if ($ExistingRelease) { throw 'Use a new release for a signed installer' }
  if ($Tag -ne "v$version-pos") { throw 'Release tag must match the POS version' }
  $signature = (Get-Content -LiteralPath "$installer.sig" -Raw).Trim()
  if (-not $signature) { throw 'The installer signature is empty' }
}
if (-not $ExistingRelease) {
  if (-not $Title -or -not $NotesFile) { throw 'New releases require -Title and -NotesFile' }
  $notes = (Resolve-Path -LiteralPath $NotesFile).Path
}

$tempDir = Join-Path ([IO.Path]::GetTempPath()) ('koreacrm-pos-release-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null
$stableInstaller = Join-Path $tempDir 'KoreaCRM-POS-setup.exe'
$manifest = Join-Path $tempDir 'latest.json'
try {
  Copy-Item -LiteralPath $installer -Destination $stableInstaller
  if ($ExistingRelease) {
    & gh release upload $Tag $stableInstaller --repo $repo --clobber
    if ($LASTEXITCODE -ne 0) { throw 'Stable installer upload failed' }
  } else {
    $commit = & git -C $root rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot determine release commit' }
    $assets = @($installer, $stableInstaller)
    if ($config.bundle.createUpdaterArtifacts) {
      @{
        version = $version
        platforms = @{
          'windows-x86_64' = @{
            signature = $signature
            url = "https://github.com/$repo/releases/download/$Tag/KoreaCRM-POS-setup.exe"
          }
        }
      } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifest -Encoding Ascii
      $assets += $manifest
    }
    & gh release create $Tag @assets --repo $repo --target $commit --title $Title --notes-file $notes --draft
    if ($LASTEXITCODE -ne 0) { throw 'Release creation failed; check its draft before retrying' }
  }
  & gh release edit $Tag --repo $repo --draft=false --latest
  if ($LASTEXITCODE -ne 0) { throw 'Cannot publish the release as Latest' }
  Write-Output 'https://github.com/AlexMadibaev/KoreaCRM/releases/latest/download/KoreaCRM-POS-setup.exe'
} finally {
  if (Test-Path -LiteralPath $stableInstaller) { Remove-Item -LiteralPath $stableInstaller }
  if (Test-Path -LiteralPath $manifest) { Remove-Item -LiteralPath $manifest }
  Remove-Item -LiteralPath $tempDir
}
