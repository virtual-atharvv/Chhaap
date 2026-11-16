#Requires -Version 7.0
# Scheduled-task entry point: runs the agent and rotates its log at 10 MB.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataDir = Join-Path $env:ProgramData "Chhaap"
$log = Join-Path $dataDir "agent.log"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

if (Test-Path $log) {
  $size = (Get-Item $log).Length
  if ($size -gt 10MB) {
    Move-Item -Force $log "$log.1"
  }
}

& (Join-Path $root "node.exe") (Join-Path $root "dist\index.js") *>> $log
exit $LASTEXITCODE
