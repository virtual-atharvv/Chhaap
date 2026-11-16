# Chhaap Windows Print Agent — Packaging & Deployment

This document is the scaffold for shipping the agent to a shop PC. The Linux
build and the driver abstraction are tested; **real Windows/SumatraPDF/hardware
execution is `UNVERIFIED` until performed on a shop machine.**

## What ships

| Item | Purpose |
|---|---|
| `node.exe` | Bundled Node.js runtime so the shop PC does not need Node installed |
| `dist/` | Compiled agent (`@chhaap/agent` + `@chhaap/shared`) |
| `node_modules/` | Production dependencies (`ws`) |
| `run-agent.ps1` | Starts the agent and appends rotated logs under `%ProgramData%\Chhaap` |
| `install-agent.ps1` | Copies the bundle to `%ProgramFiles%\Chhaap\Agent` and registers an auto-start Scheduled Task |
| `uninstall-agent.ps1` | Stops and removes the Scheduled Task and program files |
| `start-agent.cmd` | Manual foreground start (troubleshooting) |

Configuration (pairing credentials, server URL) is stored in
`%ProgramData%\Chhaap\config.json` with owner-only ACLs. Printed-job evidence is
kept in `%ProgramData%\Chhaap\printed-jobs.json` so a crash after spooling never
reprints.

## Build (on Windows, PowerShell 7+)

Prerequisites: Windows 10/11, Node.js 20 LTS, pnpm (Corepack), SumatraPDF
installed on the target shop PC (not required to build).

```powershell
# From the repo root
corepack enable
pnpm install
pwsh -File apps/agent/scripts/build-windows.ps1
```

The script produces `dist-windows/ChhaapAgent-<version>/` and a matching
`.zip`. It deliberately uses only the repository's existing dependencies. If
`pnpm deploy` is unavailable in your pnpm version, the script falls back to a
staged copy and prints the exact command to finish the dependency copy.

## Install at the shop

1. Copy `ChhaapAgent-<version>.zip` to the shop PC and extract it.
2. Open an elevated PowerShell in the extracted folder.
3. Run:

```powershell
pwsh -File .\install-agent.ps1
```

4. In the shop dashboard, open **Settings → Agent pairing** and generate a
   6-digit single-use code (valid for 10 minutes).
5. Pair the agent once (the Scheduled Task must be stopped briefly so the code
   can be entered in the foreground):

```powershell
Stop-ScheduledTask -TaskName ChhaapPrintAgent
& "$env:ProgramFiles\Chhaap\Agent\node.exe" "$env:ProgramFiles\Chhaap\Agent\dist\index.js" --pair=123456
Start-ScheduledTask -TaskName ChhaapPrintAgent
```

6. Verify in the dashboard that the printer is **online**. The agent reports
   discovery and status on connect and every 45 seconds.

Environment overrides (set as machine environment variables or pass them to the
process):

| Variable | Meaning |
|---|---|
| `CHHAAP_SERVER_URL` | Cloud base URL, e.g. `https://app.example.com` |
| `CHHAAP_AGENT_NAME` | Human-readable agent name shown in the dashboard |
| `CHHAAP_AGENT_ID` / `CHHAAP_AGENT_TOKEN` | Optional overrides for paired credentials |
| `CHHAAP_PAIRING_CODE` | Non-interactive pairing code |
| `CHHAAP_SUMATRA_PATH` | Absolute path to `SumatraPDF.exe` if not in Program Files |
| `CHHAAP_VIRTUAL_PRINTER` | `1` only for development; never on a real shop PC |
| `CHHAAP_PRINT_OUTPUT_DIR` | Override the virtual-printer output directory (dev only) |

## Auto-start, updates and logs

- The Scheduled Task runs at startup as `SYSTEM` with highest privileges.
- Logs: `%ProgramData%\Chhaap\agent.log`; the runner rotates to `.1` at 10 MB.
- The server's `hello.ack` includes `minAgentVersion`. The agent logs a clear
  update warning when below it; hard enforcement is a server-side policy (the
  cloud can refuse dispatch to old agents).
- Auto-update is intentionally **not** wired in this phase. Ship a new zip,
  stop the task, replace the folder, and start the task. A signed updater is a
  Phase 3 task.

## Hardware validation checklist (human task)

Run this on a real shop PC before the first pilot order:

- [ ] `Get-Printer` lists the shop printer; the name matches the dashboard.
- [ ] `SumatraPDF.exe -print-to "<printer>" -print-settings "simplex,monochrome,1x,paper=A4,fit" -silent sample.pdf` prints one copy.
- [ ] Duplex, colour and copies settings are honoured for the printer model.
- [ ] A4/A3/Legal paper selection works (or the dashboard is limited to supported sizes).
- [ ] Unplugging the printer marks it offline within 60 seconds and blocks new orders.
- [ ] Paper-out reports `paper_out`; recovery returns to `online`.
- [ ] Killing the agent after spooling but before `job.result` does not reprint on reconnect.
- [ ] Rebooting Windows restarts the agent and it reconnects without manual work.
- [ ] `%ProgramData%\Chhaap\config.json` is readable only by Administrators/SYSTEM.
- [ ] No PDFs remain in `%ProgramData%\Chhaap\spool` after success or failure.

Record the printer model, driver version and results in `Mind.md` §9/§10. Until
then this whole section is **UNVERIFIED: real Windows + SumatraPDF + hardware**.
