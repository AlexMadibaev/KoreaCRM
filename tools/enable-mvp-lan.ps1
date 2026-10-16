$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open PowerShell as Administrator and run this script again.'
}

$name = 'KoreaCRM MVP LAN'
netsh advfirewall firewall show rule name="$name" | Out-Null
if ($LASTEXITCODE -ne 0) {
  netsh advfirewall firewall add rule name="$name" dir=in action=allow protocol=TCP localport=3010 profile=any remoteip=localsubnet
  if ($LASTEXITCODE -ne 0) { throw 'Windows Firewall rule could not be created.' }
}
Write-Host 'LAN access to TCP port 3010 is enabled for the local subnet.'
