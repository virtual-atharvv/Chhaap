# Chhaap (working name)

**QR-to-print automation for stationery and photocopy shops.**
A customer scans a QR at the counter (or sends a file on WhatsApp), chooses print options, pays online, and the shop's own printer prints the job automatically. No queue, no pen-drives, no cash, no files left on the shop PC.

> **Status: Phase 2 + pilot-hardening in progress.** The core print loop and a mock-verified WhatsApp channel work end-to-end and are covered by automated tests. Real-world integrations (Meta WhatsApp Cloud API, live Razorpay, Windows + physical printer, live Postgres) are **not yet verified**. See [Project status](#project-status).

---

## Table of contents

1. [How it works](#how-it-works)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Repository layout](#repository-layout)
5. [Quick start (local)](#quick-start-local)
6. [Commands](#commands)
7. [Configuration](#configuration)
8. [Using Postgres & onboarding a shop](#using-postgres--onboarding-a-shop)
9. [Running the print agent](#running-the-print-agent)
10. [WhatsApp channel](#whatsapp-channel)
11. [Security & privacy model](#security--privacy-model)
12. [Testing](#testing)
13. [Deployment notes](#deployment-notes)
14. [Project status](#project-status)
15. [Documentation index](#documentation-index)
16. [Contributing workflow (humans & AI agents)](#contributing-workflow-humans--ai-agents)
17. [License](#license)

---

## How it works

```
Customer (browser / WhatsApp)
        │  upload → settings → server-computed quote → pay
        ▼
   Cloud API (Fastify)  ──►  Postgres (or in-memory for dev/tests)
        │  verified payment webhook is the ONLY way to release a job
        ▼  outbound WebSocket (no inbound ports at the shop)
   Print Agent on the shop PC  ──►  CUPS / Windows SumatraPDF / virtual PDF
        ▼
      Printer
```

- **Web platform** (customer page, shop dashboard, WhatsApp bot) runs in the cloud on one Fastify process.
- **Print agent** is a small background app on the shop's PC. Browsers cannot silently print to a local printer, so the agent receives jobs over an outbound WebSocket and drives the print spooler.

## Features

**Customer**
- Scan QR → upload PDF/images → choose colour (B&W / Colour / Smart per-page), sides, copies, page range, paper size, pages-per-sheet.
- Page previews and a **server-computed live price** (the client never sends a price).
- Online payment (Razorpay; UPI-first) and a refresh-safe **order status page** with live updates and a pickup token (e.g. `B-047`).
- Optional receipts/status over WhatsApp (with explicit consent).

**WhatsApp ordering**
- `PRINT <shop-slug>` → send a file → pick options with buttons/lists → pay via UPI link → status messages.
- English / Hindi / Hinglish copy, STOP/START opt-out, `cancel`, `status`, `repeat`.

**Shop owner**
- WhatsApp **OTP login**, live queue, order actions (cancel/refund, reprint, mark collected), printer and agent health, analytics, shop settings, agent pairing codes, owner alerts and commands over WhatsApp.

**Platform / safety**
- Integer-paise money, server-side pricing, **pay-before-print** invariant.
- Tenant isolation derived from the JWT, hashed credentials, signed expiring file URLs.
- Persisted file-deletion deadlines (files removed after printing, even across restarts).
- Reconciliation loop: expires unpaid orders, retries stale jobs, auto-refunds after repeated failure.
- Production boot guards refuse unsafe configurations (simulated payments, mock WhatsApp, memory DB, missing secrets).

## Architecture

| Layer | Technology |
|---|---|
| API, SSE, WebSocket, static UI | Node.js + TypeScript + Fastify (single port) |
| Database | PostgreSQL (`DB_MODE=postgres`) or in-memory (`DB_MODE=memory`, dev/tests) behind one repository interface |
| Payments | Razorpay (orders, payment links, webhooks, refunds); `simulated` mode for local/dev |
| Messaging | WhatsApp Cloud API behind a provider interface (`mock` for dev/tests) |
| PDF pipeline | `pdfinfo`, Ghostscript (`inkcov` colour analysis, image→PDF), `pdftoppm` previews |
| Agent | Node.js; drivers: `CupsDriver`, `VirtualPdfDriver`, `WindowsSumatraDriver` |
| Monorepo | pnpm workspaces |

**Single-instance design (pilot):** rate limits, connected-agent state and the reconciliation timer live in process memory. Run **one** API instance until these are moved to shared infrastructure (see [Deployment notes](#deployment-notes)).

## Repository layout

```
apps/
  api/        Fastify API, routes, auth, payments, storage, WhatsApp, reconciliation, admin CLI
  agent/      Shop-PC print agent (WebSocket client, drivers, crash-safe ledger, pairing)
  web/public/ Static pages served by the API (landing, customer, order status, shop dashboard, pay)
packages/
  shared/     Enums, Zod schemas (incl. checkout contract), state machine, agent protocol
  pricing/    Pure integer-paise pricing engine
  db/         Repository interface, memory + Postgres implementations, schema.sql, migration runner
docs/         Runbook, WhatsApp setup, WhatsApp templates
infra/        docker-compose (Postgres; Redis is provisioned but not used by the code yet)
.github/      CI workflow (build, test, smoke, WhatsApp demo)
Mind.md       Living project memory (current state, decisions, next actions)
implementation.md   Product/engineering blueprint
report.md     Detailed state report (verified vs unverified)
```

## Quick start (local)

**Prerequisites**
- Node.js **20.x**
- pnpm (via Corepack; the exact version is pinned in the root `package.json` → `packageManager`)
- Ghostscript and poppler-utils (for PDF analysis/previews)

```bash
# Kali / Debian / Ubuntu
sudo apt update
sudo apt install -y ghostscript poppler-utils
corepack enable

git clone <your-repo-url> chhaap && cd chhaap
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm demo:whatsapp      # offline demo: scripted WhatsApp conversation → virtual print
pnpm dev:api            # http://localhost:4000
```

Default local configuration is **memory DB + simulated payments + mock WhatsApp**, with seeded demo data:

| URL | What |
|---|---|
| `http://localhost:4000/` | Landing page |
| `http://localhost:4000/s/campus-xerox` | Customer flow for the demo shop |
| `http://localhost:4000/shop/campus-xerox` | Owner dashboard (login with owner phone `9876543210`; the OTP is printed in the API log in mock mode) |
| `http://localhost:4000/o/<orderId>` | Order status page (token is kept in the URL fragment) |

To see a print happen without a printer, run the agent in virtual mode (see [Running the print agent](#running-the-print-agent)).

## Commands

Run from the repository root.

| Command | Purpose |
|---|---|
| `pnpm build` | Build all packages |
| `pnpm test` | Build + run all tests (Postgres contract suite is skipped unless `TEST_DATABASE_URL` is set) |
| `pnpm dev:api` | Start the API in watch/dev mode |
| `pnpm dev:agent` | Start the print agent in watch/dev mode |
| `pnpm smoke` | Boot the API from a clean build, check `/healthz` and `/readyz`, shut down |
| `pnpm demo:whatsapp` | Offline end-to-end WhatsApp demo (prints a transcript) |
| `pnpm db:migrate` | Apply `schema.sql` to the configured Postgres (idempotent) |
| `pnpm admin <command>` | Admin CLI: `create-shop`, `list-shops`, `set-shop-status`, `add-staff`, `seed-demo` (refuses in production) |

> Run `pnpm admin --help` for the exact flags; command names above are stable, flags may evolve.

## Configuration

Configuration is read from environment variables (`apps/api/src/config.ts`). For local development a `.env` file at the repo root is loaded automatically **without overriding variables already set in your shell**. Copy `.env.example` and fill in values; **never commit real secrets.**

| Group | Variables (names only) |
|---|---|
| Runtime | `NODE_ENV`, `PORT`, `HOST`, `PUBLIC_BASE_URL`, `LOG_LEVEL`, `CHHAAP_DATA_DIR` |
| Database | `DB_MODE` (`memory`/`postgres`), `DATABASE_URL` |
| Payments | `PAYMENTS_MODE` (`simulated`/`razorpay`), `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `WEBHOOK_MAX_AGE_SECONDS`, `ORDER_EXPIRY_MINUTES`, `PAYMENT_LINK_TTL_MINUTES` |
| Secrets | `JWT_SECRET`, `AGENT_TOKEN_PEPPER`, `OTP_PEPPER`, `REFRESH_TOKEN_PEPPER`, `FILE_URL_SECRET`, `TURNSTILE_SECRET` |
| WhatsApp | `WHATSAPP_MODE` (`mock`/`cloud`), `WHATSAPP_API_VERSION`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PLATFORM_NUMBER`, `WA_SESSION_TTL_MINUTES`, `WA_MESSAGE_RETENTION_DAYS` |
| Uploads | `MAX_UPLOAD_MB`, `MAX_PAGES`, `FILE_URL_TTL_SECONDS` |
| Limits / ops | `RATE_LIMIT_ENABLED`, `PRINTER_HEARTBEAT_TIMEOUT_MS`, `SENTRY_DSN` (hook only) |

**Production boot guards.** With `NODE_ENV=production` the API refuses to start if payments are `simulated`, WhatsApp is `mock`, the DB is not Postgres, `JWT_SECRET` is missing/placeholder, or `PUBLIC_BASE_URL` is unset. `WHATSAPP_MODE=cloud` and Razorpay mode additionally require their credentials.

## Using Postgres & onboarding a shop

```bash
docker compose -f infra/docker-compose.yml up -d postgres   # or point DATABASE_URL at any Postgres 14+
export DB_MODE=postgres
export DATABASE_URL='postgresql://user:pass@localhost:5432/chhaap'
pnpm db:migrate

# create the first shop + owner (example; see `pnpm admin --help`)
pnpm admin create-shop --slug my-shop --name "My Shop" --city Lucknow --owner-phone +919XXXXXXXXX
```

A fresh Postgres database starts **empty** (the demo shop exists only in memory mode). `create-shop` is idempotent on the slug and creates the owner, the shop, default rate cards and settings. Detailed steps: `docs/runbook.md` → "Onboarding a new shop".

## Running the print agent

1. In the shop dashboard, generate a **pairing code** (6 digits, single-use, expires in 10 minutes).
2. On the shop PC:

```bash
# dev / Linux, real CUPS printer
CHHAAP_SERVER_URL=http://localhost:4000 pnpm --filter @chhaap/agent start -- --pair=123456

# dev / no printer: write "printed" PDFs to a folder
CHHAAP_VIRTUAL_PRINTER=1 CHHAAP_PRINT_OUTPUT_DIR=./test-prints pnpm --filter @chhaap/agent start
```

The agent stores its credentials locally (mode `0600`), connects **outbound** to `/v1/agent/connect`, verifies each file's SHA-256 before printing, keeps a crash-safe ledger so a job is never printed twice after a restart, and reports printer status/heartbeat.

**Windows (production shops):** uses SumatraPDF and a Scheduled Task. See `apps/agent/PACKAGING.md`. *Windows hardware verification is still pending.*

## WhatsApp channel

- Runs through a provider interface: `WHATSAPP_MODE=mock` (default for dev/tests/demo) or `cloud` (Meta WhatsApp Cloud API).
- Webhook: `GET/POST /v1/webhooks/whatsapp` — verification handshake, `X-Hub-Signature-256` HMAC over the raw body, message-id deduplication, async processing.
- Entry point for customers: a QR/link to `https://wa.me/<PLATFORM_NUMBER>?text=PRINT%20<shop-slug>`.
- Messages outside WhatsApp's 24-hour window require approved templates — see `docs/whatsapp-templates.md`.
- Go-live checklist (Meta app, test number, permanent token, templates, business verification): `docs/whatsapp-setup.md`.

## Security & privacy model

- **Pay-before-print:** only a signature-verified payment event can move an order to `queued`. The client "payment success" callback is never trusted.
- **Server-side money:** integer paise; amount and currency are re-checked on the webhook.
- **Auth:** WhatsApp OTP (hashed, 5-minute expiry, attempt/rate limits) → short-lived JWT cookie + rotating refresh token; shop ID always comes from the token.
- **Credentials:** pairing codes, agent tokens, OTPs and refresh tokens are stored as peppered hashes.
- **Uploads:** extension + MIME + magic-byte checks, size/page limits, encrypted PDFs and archives rejected, server-generated storage keys.
- **Retention:** files are deleted after printing (persisted deadline, survives restarts); WhatsApp message content is purged after a retention window; logs redact phone numbers and filenames.
- **Known limitations** (tracked in `Mind.md`/`report.md`): upload malware scanning and signed/authenticated preview URLs are in progress; rate limiting is in-process; Redis-backed coordination is not implemented; no Sentry SDK yet.

## Testing

```bash
pnpm test                         # pricing, DB (memory), API, WhatsApp, config, admin CLI, env loader, web-checkout E2E
TEST_DATABASE_URL=postgresql://... pnpm --filter @chhaap/db test   # Postgres contract suite
pnpm smoke                        # boot smoke check
pnpm demo:whatsapp                # scripted conversation using the real API with mock providers
```

Tests are offline: ephemeral localhost ports, temp data directories, memory DB, mock WhatsApp, simulated payments. CI (`.github/workflows/ci.yml`) installs Ghostscript/poppler and runs build, tests, smoke checks and the WhatsApp demo.

## Deployment notes

- Run **one** API instance (long-lived process; WebSockets). Suitable hosts: a small VPS or Railway-style container with managed Postgres. Put it behind HTTPS (e.g. Cloudflare) on a **permanent domain** — QR standees are printed once.
- Required in production: Postgres, real `JWT_SECRET` and peppers, `PUBLIC_BASE_URL`, Razorpay keys + webhook secret, WhatsApp Cloud credentials, backups with a tested restore.
- Files currently live on local disk (`CHHAAP_DATA_DIR`); object storage (e.g. Cloudflare R2) is a planned abstraction.
- Operational guidance: `docs/runbook.md`.

## Project status

| Area | Status |
|---|---|
| Core order → pay → print loop | ✅ implemented, tested (mock/simulated) |
| Web checkout + order status page | ✅ implemented, tested in simulated mode; 🟡 live Razorpay unverified |
| WhatsApp conversation/ordering | ✅ implemented, tested with mock provider; 🟡 live Meta unverified |
| Owner OTP login, tenant isolation | ✅ implemented, tested |
| Postgres repository + onboarding CLI | ✅ implemented; 🟡 live Postgres run unverified |
| Persistent deletion, reconciliation, agent crash-safety | ✅ implemented, tested |
| Windows agent + real printers | 🟡 scaffold only — hardware unverified |
| Malware scanning / Office conversion | ⬜ in progress — Office uploads should stay disabled until verified |
| Authenticated previews, agent min-version enforcement | ⬜ in progress |
| Pilot shops | ⬜ 0 of target 3–5 |

`Mind.md` is the live source of truth for status, decisions and next actions; `report.md` is a detailed snapshot that separates **verified** from **mocked** behaviour.

## Documentation index

| File | Purpose |
|---|---|
| `Mind.md` | Living project memory — start here if you are an AI agent or a new contributor |
| `implementation.md` | Product and engineering blueprint |
| `report.md` | Detailed state report with known gaps |
| `docs/runbook.md` | Run, deploy, onboard shops, troubleshoot |
| `docs/whatsapp-setup.md` | Meta/WhatsApp setup checklist |
| `docs/whatsapp-templates.md` | Template bodies to submit for approval |
| `apps/agent/PACKAGING.md` | Windows agent packaging and hardware checklist |

## Contributing workflow (humans & AI agents)

1. Read `Mind.md` first; trust code over documents and fix any false claim you find.
2. Reproduce bugs with a failing test before fixing.
3. Money is integer paise, the server computes prices, and only a verified payment event releases a print job — never weaken these.
4. **Checkpoint after every task:** commit, add a line (with commit hash) to the `Mind.md` changelog, and keep "Next Actions" current.
5. Never commit secrets; add new environment variable *names* to `.env.example` and `Mind.md`.
6. Keep `main` green (`pnpm build && pnpm test && pnpm smoke`).

## License

Not yet decided. Until a license file is added, all rights are reserved by the author (Atharv Maurya / Blooming Sparrow).
