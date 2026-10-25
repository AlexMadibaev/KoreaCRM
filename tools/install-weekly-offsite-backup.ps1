$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $PSScriptRoot 'weekly-offsite-backup.ps1'
if (-not (Test-Path -LiteralPath (Join-Path $root '.mvp-local/mvp.env'))) {
  throw 'Run tools/start-mvp.ps1 before installing the weekly backup task.'
}

$taskName = 'KoreaCRM-WeeklyOffsiteBackup'
$action = New-ScheduledTaskAction -Execute (Get-Command powershell.exe).Source -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '23:00'
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Korea CRM: weekly local data archive and verified SSH transfer' -Force | Out-Null
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
Write-Host 'Scheduled every Sunday at 23:00 local time. The PC must be running and this user signed in.'
