#Requires -RunAsAdministrator
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles "Chhaap\Agent"),
  [string]$TaskName = "ChhaapPrintAgent",
  [switch]$PurgeData
)

$ErrorActionPreference = "Stop"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }

if ($PurgeData) {
  $dataDir = Join-Path $env:ProgramData "Chhaap"
  if (Test-Path $dataDir) { Remove-Item -Recurse -Force $dataDir }
  Write-Host "Removed agent program files and %ProgramData%\Chhaap."
} else {
  Write-Host "Removed agent program files. Pairing config/ledger kept in %ProgramData%\Chhaap."
}
