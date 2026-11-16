#Requires -RunAsAdministrator
<#
  Installs the staged agent to %ProgramFiles%\Chhaap\Agent and registers it as
  an auto-start Scheduled Task. Run from the extracted bundle directory.
#>
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles "Chhaap\Agent"),
  [string]$TaskName = "ChhaapPrintAgent"
)

$ErrorActionPreference = "Stop"
$sourceApp = Join-Path $PSScriptRoot "app"
if (-not (Test-Path (Join-Path $sourceApp "dist\index.js"))) {
  throw "app\dist\index.js not found. Extract the full bundle and run install-agent.ps1 from its root."
}

$dataDir = Join-Path $env:ProgramData "Chhaap"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

# Do not overwrite config.json/printed-jobs.json: they are the agent identity
# and the crash-safety ledger.
Copy-Item -Recurse -Force (Join-Path $sourceApp "*") $InstallDir

# Restrict agent state to Administrators and SYSTEM.
& icacls $dataDir /inheritance:r /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" | Out-Null
$config = Join-Path $dataDir "config.json"
if (Test-Path $config) {
  & icacls $config /inheritance:r /grant:r "Administrators:F" "SYSTEM:F" | Out-Null
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$InstallDir\run-agent.ps1`"" `
  -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 0)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed to $InstallDir"
Write-Host "State/logs: $dataDir"
Write-Host "Pair the agent once with a fresh dashboard code:"
Write-Host "  Stop-ScheduledTask -TaskName $TaskName"
Write-Host "  & `"$InstallDir\node.exe`" `"$InstallDir\dist\index.js`" --pair=<code>"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
