$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root '.mvp-local/firewall-diagnostic.txt'
$profile = Get-NetFirewallProfile -PolicyStore ActiveStore | Where-Object { $_.Name -eq 'Public' } | Select-Object Name,Enabled,DefaultInboundAction,AllowLocalFirewallRules,LogBlocked,LogFileName
$rule = Get-NetFirewallRule -PolicyStore ActiveStore -DisplayName 'KoreaCRM MVP LAN' -ErrorAction SilentlyContinue | Select-Object DisplayName,Enabled,Action,Profile,PolicyStoreSourceType
@('Public profile:', ($profile | Format-List | Out-String), 'Active rule:', ($rule | Format-List | Out-String)) | Set-Content -LiteralPath $output -Encoding utf8
Set-NetFirewallProfile -Name Public -LogBlocked True
Write-Host "Firewall diagnostics written to $output; blocked-connection logging enabled."
