param([switch]$LocalOnly)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $root '.mvp-local'
$envFile = Join-Path $stateDir 'mvp.env'
$pendingDir = Join-Path $stateDir 'backups\weekly-pending'
$configFile = Join-Path $stateDir 'weekly-offsite.json'
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'

if (-not (Test-Path -LiteralPath $envFile)) { throw 'Local MVP settings are missing. Run tools/start-mvp.ps1 first.' }
$databaseLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $databaseLine) { throw 'DATABASE_URL is missing from local MVP settings.' }
$databaseUrl = $databaseLine.Substring('DATABASE_URL='.Length)
$databaseUri = [uri]$databaseUrl
$query = @($databaseUri.Query.TrimStart('?').Split('&') | Where-Object { $_ -and $_ -notmatch '^schema=' })
$databaseUrl = $databaseUrl.Split('?')[0]
if ($query.Count) { $databaseUrl += '?' + ($query -join '&') }

$dumpTool = Join-Path $pgBin 'pg_dump.exe'
$restoreTool = Join-Path $pgBin 'pg_restore.exe'
if (-not (Test-Path -LiteralPath $dumpTool) -or -not (Test-Path -LiteralPath $restoreTool)) { throw "PostgreSQL tools not found in $pgBin" }
New-Item -ItemType Directory -Path $pendingDir -Force | Out-Null
$lockPath = Join-Path $stateDir 'backups\weekly-offsite.lock'
try {
  $backupLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch {
  throw 'Another backup is already running. Try again after it finishes.'
}

function Assert-Command([int]$exitCode, [string]$message) {
  if ($exitCode -ne 0) { throw $message }
}

function Assert-BundlePath([string]$path) {
  $parent = [IO.Path]::GetFullPath((Split-Path -Parent $path)).TrimEnd('\')
  $expected = [IO.Path]::GetFullPath($pendingDir).TrimEnd('\')
  if ($parent -ne $expected -or (Split-Path -Leaf $path) -notmatch '^weekly-\d{8}T\d{6}Z-[0-9a-f]{8}$') {
    throw 'Refusing to remove a path outside the weekly backup staging directory.'
  }
}

function Check-Manifest([string]$bundlePath) {
  $manifestPath = Join-Path $bundlePath 'manifest.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $names = @($manifest.files | ForEach-Object { $_.name })
  if ($manifest.formatVersion -ne 1 -or $names -notcontains 'database.dump' -or
      @($names | Select-Object -Unique).Count -ne $names.Count) { throw "Invalid manifest: $bundlePath" }
  foreach ($file in $manifest.files) {
    if ($file.name -notin @('database.dump', 'product-images.zip', 'pos-cache.sqlite3') -or $file.sha256 -notmatch '^[0-9A-Fa-f]{64}$') { throw "Invalid backup file entry: $bundlePath" }
    $filePath = Join-Path $bundlePath $file.name
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { throw "Backup file missing: $filePath" }
    $hash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
    if ($hash -ne $file.sha256) { throw "Local backup checksum mismatch: $filePath" }
  }
  return $manifest
}

function Invoke-Ssh([string]$target, [string[]]$options, [string]$remoteCommand) {
  $output = & ssh.exe @options $target $remoteCommand
  Assert-Command $LASTEXITCODE 'SSH command failed. Local backup was retained.'
  return $output
}

function Verify-Remote([string]$target, [string[]]$options, [string]$remotePath, [string]$localPath, $manifest) {
  foreach ($file in $manifest.files) {
    $output = Invoke-Ssh $target $options "sha256sum -- $remotePath/$($file.name)"
    $hash = [string]($output | Select-Object -First 1)
    if ($hash.Length -lt 64 -or $hash.Substring(0, 64).ToUpperInvariant() -ne $file.sha256.ToUpperInvariant()) {
      throw "Remote checksum mismatch: $($file.name). Local backup was retained."
    }
  }
  $manifestOutput = Invoke-Ssh $target $options "sha256sum -- $remotePath/manifest.json"
  $remoteHash = [string]($manifestOutput | Select-Object -First 1)
  $localHash = (Get-FileHash -LiteralPath (Join-Path $localPath 'manifest.json') -Algorithm SHA256).Hash
  if ($remoteHash.Length -lt 64 -or $remoteHash.Substring(0, 64).ToUpperInvariant() -ne $localHash) {
    throw 'Remote manifest checksum mismatch. Local backup was retained.'
  }
}

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$name = "weekly-$stamp-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$building = Join-Path $pendingDir ".$name.building"
$bundle = Join-Path $pendingDir $name
New-Item -ItemType Directory -Path $building -Force | Out-Null
try {
  $dump = Join-Path $building 'database.dump'
  & $dumpTool --format=custom --file $dump --dbname $databaseUrl
  Assert-Command $LASTEXITCODE 'PostgreSQL dump failed.'
  & $restoreTool --list $dump | Out-Null
  Assert-Command $LASTEXITCODE 'PostgreSQL dump verification failed.'
  if ((Get-Item -LiteralPath $dump).Length -lt 100) { throw 'PostgreSQL dump is unexpectedly small.' }

  $files = @($dump)
  $images = Join-Path $stateDir 'product-images'
  if (Test-Path -LiteralPath $images -PathType Container) {
    $imagesZip = Join-Path $building 'product-images.zip'
    Compress-Archive -LiteralPath $images -DestinationPath $imagesZip -CompressionLevel Optimal
    $files += $imagesZip
  }
  $posDatabase = Join-Path $env:APPDATA 'com.koreacrm.pos\pos-cache.sqlite3'
  if (Test-Path -LiteralPath $posDatabase -PathType Leaf) {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { throw 'Python 3 is needed to snapshot the local POS database.' }
    $posSnapshot = Join-Path $building 'pos-cache.sqlite3'
    & $python.Source (Join-Path $PSScriptRoot 'sqlite-snapshot.py') $posDatabase $posSnapshot
    Assert-Command $LASTEXITCODE 'POS SQLite snapshot failed.'
    $files += $posSnapshot
  }
  $entries = @($files | ForEach-Object {
    @{ name = Split-Path -Leaf $_; bytes = (Get-Item -LiteralPath $_).Length; sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash }
  })
  @{ formatVersion = 1; createdAtUtc = (Get-Date).ToUniversalTime().ToString('o'); files = $entries } |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $building 'manifest.json') -Encoding utf8
  Move-Item -LiteralPath $building -Destination $bundle
} catch {
  if (Test-Path -LiteralPath $building) {
    $buildingParent = [IO.Path]::GetFullPath((Split-Path -Parent $building)).TrimEnd('\')
    $expectedParent = [IO.Path]::GetFullPath($pendingDir).TrimEnd('\')
    if ($buildingParent -ne $expectedParent -or (Split-Path -Leaf $building) -notmatch '^\.weekly-\d{8}T\d{6}Z-[0-9a-f]{8}\.building$') {
      throw 'Refusing to remove an incomplete backup outside the staging directory.'
    }
    Remove-Item -LiteralPath $building -Recurse -Force
  }
  throw
}
Write-Host "Verified local weekly backup: $bundle"

if ($LocalOnly -or -not (Test-Path -LiteralPath $configFile)) {
  Write-Host 'Server transfer is not configured. All pending backups remain on this computer.'
  exit 0
}

$config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
if ($config.sshTarget -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9_][A-Za-z0-9_.-]*$' -or
    $config.remoteDirectory -notmatch '^/[A-Za-z0-9_][A-Za-z0-9_./-]*$' -or
    $config.remoteDirectory.Split('/') -contains '..') {
  throw 'Invalid SSH target or remote directory. Local backups were retained.'
}
$remoteBase = $config.remoteDirectory.TrimEnd('/')
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15')
if ($config.sshKeyPath) {
  if (-not (Test-Path -LiteralPath $config.sshKeyPath -PathType Leaf)) { throw 'SSH key not found. Local backups were retained.' }
  $sshOptions += @('-i', [string]$config.sshKeyPath)
}

foreach ($item in @(Get-ChildItem -LiteralPath $pendingDir -Directory | Where-Object { $_.Name -match '^weekly-\d{8}T\d{6}Z-[0-9a-f]{8}$' } | Sort-Object Name)) {
  $manifest = Check-Manifest $item.FullName
  $remoteFinal = "$remoteBase/$($item.Name)"
  & ssh.exe @sshOptions $config.sshTarget "test -d $remoteFinal"
  if ($LASTEXITCODE -eq 0) {
    Verify-Remote $config.sshTarget $sshOptions $remoteFinal $item.FullName $manifest
  } elseif ($LASTEXITCODE -eq 1) {
    $remoteTemp = "$remoteBase/.$($item.Name)-$([guid]::NewGuid().ToString('N').Substring(0, 8)).uploading"
    Invoke-Ssh $config.sshTarget $sshOptions "mkdir -p -- $remoteTemp" | Out-Null
    $sourceFiles = @($manifest.files | ForEach-Object { Join-Path $item.FullName $_.name }) + @(Join-Path $item.FullName 'manifest.json')
    & scp.exe @sshOptions -B -q @sourceFiles "$($config.sshTarget):$remoteTemp/"
    Assert-Command $LASTEXITCODE 'SCP upload failed. Local backup was retained.'
    foreach ($file in $manifest.files) {
      $output = Invoke-Ssh $config.sshTarget $sshOptions "sha256sum -- $remoteTemp/$($file.name)"
      $hash = [string]($output | Select-Object -First 1)
      if ($hash.Length -lt 64 -or $hash.Substring(0, 64).ToUpperInvariant() -ne $file.sha256.ToUpperInvariant()) { throw 'Remote checksum mismatch. Local backup was retained.' }
    }
    Invoke-Ssh $config.sshTarget $sshOptions "test ! -e $remoteFinal && mv -- $remoteTemp $remoteFinal" | Out-Null
    Verify-Remote $config.sshTarget $sshOptions $remoteFinal $item.FullName $manifest
  } else {
    throw 'Could not check remote backup directory. Local backups were retained.'
  }
  Assert-BundlePath $item.FullName
  Remove-Item -LiteralPath $item.FullName -Recurse -Force
  Write-Host "Server verified; local archive removed: $($item.Name)"
}
