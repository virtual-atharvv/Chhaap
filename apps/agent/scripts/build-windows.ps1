#Requires -Version 7.0
<#
  Builds a self-contained Windows agent folder and zip.
  Run from anywhere: pwsh -File apps/agent/scripts/build-windows.ps1
#>
param(
  [string]$NodeExePath = "",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentDir = Resolve-Path (Join-Path $scriptDir "..")
$repoRoot = Resolve-Path (Join-Path $agentDir "../..")
$outRoot = Join-Path $repoRoot "dist-windows"
$packageJson = Get-Content (Join-Path $agentDir "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$stage = Join-Path $outRoot "ChhaapAgent-$version"
$appDir = Join-Path $stage "app"

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $appDir | Out-Null

Push-Location $repoRoot
try {
  if (-not $SkipInstall) {
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
  }

  & pnpm --filter @chhaap/agent build
  if ($LASTEXITCODE -ne 0) { throw "agent build failed" }

  # pnpm deploy copies the workspace package plus production dependencies.
  & pnpm --filter @chhaap/agent deploy --prod --legacy $appDir
  $deployed = $LASTEXITCODE -eq 0
  if (-not $deployed) {
    Write-Warning "pnpm deploy failed; staging dist and package.json only."
    Copy-Item -Recurse -Force (Join-Path $agentDir "dist") (Join-Path $appDir "dist")
    Copy-Item -Force (Join-Path $agentDir "package.json") $appDir
    Write-Host "Finish dependencies manually: pnpm --filter @chhaap/agent deploy --prod --legacy `"$appDir`""
  }

  if (-not $NodeExePath) {
    $node = Get-Command node -ErrorAction Stop
    $NodeExePath = $node.Source
  }
  if (-not (Test-Path $NodeExePath)) { throw "Node executable not found: $NodeExePath" }
  Copy-Item -Force $NodeExePath (Join-Path $appDir "node.exe")

  Copy-Item -Force (Join-Path $scriptDir "run-agent.ps1") $appDir
  Copy-Item -Force (Join-Path $scriptDir "install-agent.ps1") $stage
  Copy-Item -Force (Join-Path $scriptDir "uninstall-agent.ps1") $stage

  @"
@echo off
rem Manual foreground start for troubleshooting.
"%~dp0node.exe" "%~dp0dist\index.js" %*
"@ | Set-Content -Encoding ASCII (Join-Path $appDir "start-agent.cmd")

  @"
Chhaap Print Agent $version
===========================

1. Extract the zip.
2. Open an elevated PowerShell in this folder.
3. Run: pwsh -File .\install-agent.ps1
4. Pair once using the 6-digit code from the shop dashboard:
   Stop-ScheduledTask -TaskName ChhaapPrintAgent
   & "`$env:ProgramFiles\Chhaap\Agent\node.exe" "`$env:ProgramFiles\Chhaap\Agent\dist\index.js" --pair=123456
   Start-ScheduledTask -TaskName ChhaapPrintAgent

Configuration and printed-job evidence live in %ProgramData%\Chhaap.
See PACKAGING.md in the repository for the full checklist.
"@ | Set-Content -Encoding UTF8 (Join-Path $stage "README.txt")

  $zip = Join-Path $outRoot "ChhaapAgent-$version.zip"
  if (Test-Path $zip) { Remove-Item -Force $zip }
  Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal

  Write-Host ""
  Write-Host "Built: $zip"
  Write-Host "Stage: $stage"
  Write-Host "Node:  $NodeExePath"
} finally {
  Pop-Location
}
