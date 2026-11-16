# MIND.md — Living Project Memory for "Chhaap" (QR-to-Print Automation SaaS)

> **READ THIS FIRST.** This file is the single source of truth for the project's *current state*.
> `implementation.md` = the plan. `Mind.md` = the reality.
> Any AI model or developer reading this file must be able to continue the work without asking for context.

---

## 🔐 AI PROTOCOL (follow strictly)

### On session START
1. Read this entire file top to bottom.
2. Read `implementation.md` only for the sections relevant to the "Next Actions" below.
3. Verify claims against the repo if code exists (this file can lag behind; trust code over text, then fix this file).
4. Restate in 3 lines: *current phase, last completed item, what you will do now.*

### On session END (mandatory)
1. Update **§2 Status Dashboard** and **§4 Phase Checklist** (tick/untick honestly).
2. Append an entry to **§9 Changelog** (newest at top) — date, what changed, files touched.
3. Log any decision in **§7 Decisions Log**; any new problem in **§8 Blockers & Risks**.
4. Rewrite **§10 Next Actions** (max 7 items, ordered, concrete).
5. Update `Last updated` and `Last updated by`.
6. Never delete history; mark things `[superseded]` instead. Never store secrets — env var *names* only.

### Style rules
- Dates in `YYYY-MM-DD`. Be factual, terse, specific (file paths, endpoints, commit hashes).
- Mark uncertainty explicitly: `UNVERIFIED:`.
- Status vocabulary: `⬜ todo` · `🟡 in progress` · `✅ done` · `⛔ blocked` · `❌ dropped`.

---

## 1. PROJECT SNAPSHOT

| Field | Value |
|---|---|
| **Project** | Chhaap (working name) — QR → upload → pay → auto-print for stationery shops |
| **Founder / Owner** | Atharv Maurya (Blooming Sparrow), Lucknow, India |
| **Model** | B2B SaaS: monthly subscription per shop + small transaction fee |
| **Core promise** | Customer scans QR, uploads/WhatsApps a file, sets options, pays; shop's printer prints automatically. No queue, no cash, no file leaks. |
| **Target customer (beachhead)** | Photocopy/stationery shops near colleges in Lucknow |
| **Repo** | `chhaap` pnpm monorepo, branch `main` (repository root; no machine-specific paths in tracked files) |
| **Live URLs** | Local dev: `http://localhost:4000/` (landing), `/s/campus-xerox` (customer), `/shop/campus-xerox` (owner) |
| **Last updated** | 2026-11-16 |
| **Last updated by** | AI assistant — Phase 2 (bug-fix sweep, WhatsApp, agent hardening, docs) |

### Elevator state
**Phase 2 implemented and automated tests green; pilot/hardware/Meta verification still pending.**
Web and WhatsApp ordering share one pricing/payment/dispatch pipeline. Memory DB is
test/local-only; Postgres repository, persistent deletion, owner OTP auth, WhatsApp
mock and cloud providers, owner alerts, and a Windows agent scaffold exist. Real
Meta/Razorpay/Windows-printer/Postgres validation remains a human task.

---

## 2. STATUS DASHBOARD

| Area | Status | Notes |
|---|---|---|
| Product definition | ✅ done | Scope, MVP, non-goals defined in `implementation.md` §1 |
| Business model | 🟡 draft | Plans/pricing proposed; needs validation with real shop owners in Lucknow |
| Architecture | ✅ done | Cloud API + outbound-WS print agent + storage + pricing engine; Phase 2 delivery model in `implementation.md` §21 |
| Repo & CI | ✅ done | pnpm workspaces, TypeScript project references, GitHub Actions (`build` + `test` + WhatsApp demo) |
| Database layer | ✅ done | Postgres repository + idempotent SQL migration runner + memory repo for tests; repository contract tests run against both (Postgres conditional) |
| Database migration | ✅ done | `packages/db/src/schema.sql`, `packages/db/src/migrate.ts`, root `pnpm db:migrate` |
| Customer PWA | ✅ done | Upload → settings → server quote → consent → simulated/live checkout → SSE tracking |
| Shop dashboard | ✅ done | OTP login, queue, rates, printer health, agent pairing, analytics, settings |
| API / order state machine | ✅ done | Fastify routes split into plugins; optimistic status transitions and audit events |
| Pricing engine | ✅ done | Integer paise, n-up, duplex, Smart mode, min fee, GST-once; property tests |
| File pipeline | ✅ done | Magic-byte validation, size/page limits, `pdfinfo`, Ghostscript colour analysis, `pdftoppm` previews; Office/ClamAV optional |
| File deletion | ✅ done | Persisted `delete_after` + minute sweeper; restart test passes; hard safety net |
| Payment webhook | ✅ done | Raw-body HMAC, timing-safe compare, replay/stale/amount/currency checks, DB dedupe |
| Reconciliation | ✅ done | Expires unpaid orders, retries stale jobs, fails/refunds after 3 attempts |
| WhatsApp channel | ✅ done (mock) | Persistent conversation state machine, buttons/lists, payment links, receipts/status, STOP/START/CANCEL/STATUS/REPEAT |
| WhatsApp Cloud API | 🟡 implemented / `UNVERIFIED: live Meta` | Provider, two-step media download, signature verification, template fallback; no real credentials here |
| Owner notifications | ✅ done (mock) | Printer offline/issue, failed order, daily summary, debounce/quiet hours; owner QUEUE/PAUSE/RESUME/TODAY |
| WhatsApp OTP login | ✅ done (mock) | Hashed OTP, 5-min expiry, 5-attempt lock, per-phone/IP limits, rotated refresh cookies |
| Tenant isolation | ✅ done | Every shop route derives shop from JWT; cross-shop suite green |
| Print agent | ✅ done (Linux/test) | Reconnect backoff+jitter, heartbeat, unfinished-job hello, persistent ledger, SHA-256 guard, serialised jobs |
| Windows agent packaging | 🟡 scaffold / `UNVERIFIED: hardware` | `apps/agent/PACKAGING.md` + PowerShell build/install/log scripts; no Windows hardware run |
| Observability | 🟡 partial | Fastify/pino structured logs, request IDs, PII redaction, `/healthz`, `/readyz`; Sentry only env hook |
| Pilot shops | ⬜ todo | 0 of target 3–5 (field visits pending) |
| Revenue | — | ₹0 MRR |

**Current phase:** `Phase 2 — Real MVP + WhatsApp (implemented; verification pending)` → `Phase 2.5 — Pilot hardening`
**Overall progress:** ~55% (core loop + WhatsApp mock verified; real-world integrations unverified)

---

## 3. KEY DECISIONS ALREADY MADE (quick reference)

| # | Decision | Status |
|---|---|---|
| D1 | Agent connects **outbound via WebSocket**; no inbound ports at shops | Decided & Implemented |
| D2 | Payment must be **verified via webhook** before any job is queued (pay-before-print) | Decided & Implemented |
| D3 | Server computes all prices; all money in **paise (integers)** | Decided & Implemented |
| D4 | Normalise every upload to **PDF** server-side; agent only prints PDFs | Decided & Implemented |
| D5 | Stack: Fastify/TS API, WebSocket Gateway, Pure Pricing TS package, Postgres DDL, pnpm monorepo | Decided & Implemented |
| D6 | Files auto-deleted by persisted sweeper (hard TTL) + immediate agent spool cleanup | Decided & Implemented |
| D7 | Settlement model: Razorpay **Route** (platform collects, pays out shops) vs shop-owned account | **OPEN** — recommended: Route; start with manual weekly payouts |
| D8 | Product/brand name & domain | **OPEN** — "Chhaap" is a placeholder |
| D9 | Dual-mode printer execution: CUPS `lp` on Linux; Virtual PDF for dev/tests; SumatraPDF on Windows | Decided & Implemented (Windows unverified) |
| D10 | WhatsApp is a channel over the same order pipeline, not a second order system | Decided & Implemented |
| D11 | Single-platform WhatsApp number + `PRINT <slug>`; per-shop numbers later | Decided & Implemented |
| D12 | Persist WhatsApp conversation state in `wa_sessions`; duplicate webhooks are idempotent | Decided & Implemented |
| D13 | Simulated payments/routes and mock WhatsApp/DB are forbidden in production at config boot | Decided & Implemented |
| D14 | Pilot delivery stays single-port Fastify static UI; no separate Next.js server | Decided & Implemented |
| D15 | TypeScript tests compile to `dist-test` and run with `node --test` (no tsx/vitest dependency) | Decided & Implemented |

---

## 4. PHASE CHECKLIST

### Phase 0 — Validate (target: Week 0–1)
- [ ] Visit ≥10 shops; record printer models, OS, internet quality, current rates, pain points
- [ ] Get ≥3 shops to commit to a pilot
- [ ] Finalise name + domain
- [ ] Decide settlement model (D7)
- [x] Create monorepo and CI workflow

### Phase 1 — Walking Skeleton (Week 1–2)
- [x] DB schema + migrations (`packages/db/src/schema.sql`, `migrate.ts`)
- [x] Shop auth (`/v1/auth/*`) / 6-digit agent pairing code
- [x] Upload pipeline + PDF page count + colour detection
- [x] Agent ↔ WebSocket ↔ dispatch ↔ CUPS/Virtual-PDF print (automated)
- [x] Order state machine + audit log
- [x] Customer PWA + Shop dashboard + SSE tracking

### Phase 2 — Real MVP (Week 3–6)
- [x] Pricing engine + property tests
- [x] Previews via `pdftoppm`
- [x] Persistent file deletion sweeper + restart test
- [x] Postgres repository + migration runner + contract tests (conditional)
- [x] Payment webhook hardening + reconciliation
- [x] Tenant isolation + shop OTP auth
- [x] Agent reconnect/backoff, persistent ledger, hash guard, unfinished-job reconciliation
- [x] Windows driver + packaging scaffold (`apps/agent/PACKAGING.md`)
- [ ] DOCX/PPTX/XLSX/image conversion execution (LibreOffice not installed here)
- [ ] ClamAV scanning execution (not installed here)
- [ ] Production Razorpay live KYC + webhook configuration
- [ ] Windows agent real-hardware verification
- [ ] Sentry integration (env hook exists only)

### Phase 2.5 — WhatsApp & Pilot Hardening
- [x] Provider abstraction (`mock`, `cloud`), config boot guards
- [x] Webhook verify + raw-body signature + `wamid`/status dedupe
- [x] Persistent conversation state machine + language buttons
- [x] File download → normal upload/analysis pipeline
- [x] Server-priced review, simulated/real payment link, receipt/status messages
- [x] Web order notifications only with phone + consent
- [x] Owner alerts and owner commands
- [x] WhatsApp OTP login with lockout/rate limits/refresh rotation
- [x] Offline E2E suite + `pnpm demo:whatsapp`
- [x] `docs/whatsapp-setup.md`, `docs/whatsapp-templates.md`, runbook
- [ ] Real Meta test-number run + template approvals
- [ ] Production WhatsApp number / business verification
- [ ] Real Razorpay UPI payment through the production webhook
- [ ] Real shop printer (Windows + SumatraPDF) pilot

### Phase 3 — Pilot (Week 6–10)
- [ ] 3–5 shops live; daily check-ins
- [ ] 20 consecutive orders with zero manual intervention at one shop
- [ ] Chaos tests passed (printer unplug, network loss, double pay)

### Phase 4 — Monetise (Week 10–16)
- [ ] Subscriptions + plan limits + txn-fee ledger
- [ ] Route payouts, GST invoices, settlement reports
- [ ] Multi-printer routing, coupons, advanced WhatsApp journeys

### Phase 5 — Scale (Month 5+)
- [ ] Chain console, white-label, API, kiosk mode, photo/ID templates, campus programmes, referral engine

---

## 5. ARCHITECTURE STATE (update as built)

**Implemented architecture:**
Customer PWA / WhatsApp → Fastify API (`/v1/*`) → Memory or Postgres DB (`packages/db`) + local file storage (`CHHAAP_DATA_DIR`) → WebSocket Gateway (`/v1/agent/connect`) → Print Agent (`apps/agent`) → CUPS `lp` / Virtual PDF spooler / Windows SumatraPDF. WhatsApp Cloud API is behind `WhatsAppProvider`; mock is the default for dev/test.

### Component registry
| Component | Path | Tech | Status | Notes |
|---|---|---|---|---|
| shared | `packages/shared` | TypeScript / Zod | ✅ done | Enums, schemas, protocol, pickup tokens, phone helpers |
| pricing | `packages/pricing` | TypeScript | ✅ done | Pure engine, property tests, paise arithmetic, GST once |
| db | `packages/db` | TypeScript / SQL / pg | ✅ done | Memory + Postgres repos, schema, idempotent migration, contract tests |
| api | `apps/api` | Fastify / TS / WS | ✅ done | Route plugins, static UI, SSE, payments, WhatsApp, auth, reconciliation |
| whatsapp | `apps/api/src/whatsapp` | TypeScript | ✅ done (mock) / 🟡 cloud | Provider, webhook, conversation, copy, templates, notifier, owner alerts |
| agent | `apps/agent` | Node.js / WS | ✅ done (Linux) | Drivers, ledger, pairing, reconnect, heartbeat, status reporting |
| web | `apps/web/public` | HTML/CSS/JS | ✅ done | Landing, customer, shop, pay pages served by API |
| infra | `infra/docker-compose.yml` | Docker Compose | 🟡 draft | Postgres 16 + Redis 7 definitions; Redis not yet used by code |
| CI | `.github/workflows/ci.yml` | GitHub Actions | ✅ done | Install PDF tools → pnpm install/build/test/demo |
| Windows packaging | `apps/agent/PACKAGING.md`, `apps/agent/scripts` | PowerShell | 🟡 scaffold | Build/install/uninstall/log rotation; hardware checklist unverified |

### Environments
| Env | URL | Status |
|---|---|---|
| local | `http://localhost:4000` | ✅ working (memory/mock/simulated) |
| staging | — | ⬜ |
| prod | — | ⬜ |

### Env var names (NEVER values)
`NODE_ENV`, `PORT`, `HOST`, `PUBLIC_BASE_URL`, `LOG_LEVEL`, `DB_MODE`, `DATABASE_URL`,
`PAYMENTS_MODE`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
`WEBHOOK_MAX_AGE_SECONDS`, `ORDER_EXPIRY_MINUTES`, `PAYMENT_LINK_TTL_MINUTES`,
`JWT_SECRET`, `AGENT_TOKEN_PEPPER`, `OTP_PEPPER`, `REFRESH_TOKEN_PEPPER`,
`FILE_URL_SECRET`, `RATE_LIMIT_ENABLED`, `TURNSTILE_SECRET`,
`WHATSAPP_MODE`, `WHATSAPP_API_VERSION`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`,
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_PLATFORM_NUMBER`, `WA_SESSION_TTL_MINUTES`, `WA_MESSAGE_RETENTION_DAYS`,
`MAX_UPLOAD_MB`, `MAX_PAGES`, `CHHAAP_DATA_DIR`, `FILE_URL_TTL_SECONDS`,
`CHHAAP_SERVER_URL`, `CHHAAP_AGENT_NAME`, `CHHAAP_PAIRING_CODE`, `CHHAAP_AGENT_ID`,
`CHHAAP_AGENT_TOKEN`, `CHHAAP_SUMATRA_PATH`, `CHHAAP_VIRTUAL_PRINTER`,
`CHHAAP_PRINT_OUTPUT_DIR`, `SENTRY_DSN`, `PRINTER_HEARTBEAT_TIMEOUT_MS`.

---

## 6. DEV ENVIRONMENT NOTES

- Primary dev machine: **Kali/Debian Linux**; Windows packaging is scaffolded, not executed.
- Verified local tools: `node` 20.x, `ghostscript` (GS 10.x), poppler-utils (`pdfinfo`, `pdftoppm`), `gs`.
- Not installed here (so paths are unit-tested only or conditional): Docker, `psql`, LibreOffice, ClamAV (`clamdscan`), CUPS (`lpstat`), Windows/SumatraPDF.
- Package manager: pnpm **12.21.0** (root `packageManager` and `pnpm-lock.yaml`). Use Corepack or any repo-provided `pnpm` wrapper; do not hard-code a wrapper path.
- Build: `pnpm build`.
- Tests: `pnpm test` (58 tests: 9 pricing + 9 db + 40 API/integration; Postgres contract skipped unless `TEST_DATABASE_URL`).
- Offline WhatsApp demo: `pnpm demo:whatsapp`.
- Dev servers: `pnpm dev:api`, `pnpm dev:agent`; database migration: `pnpm db:migrate`.
- Test environment: ephemeral localhost ports, temp data dirs, memory DB, mock WhatsApp, simulated payments; no external network/sandbox bypass.

---

## 7. DECISIONS LOG (append-only, newest first)

| Date | Decision | Why | Alternatives rejected |
|---|---|---|---|
| 2026-11-16 | Production config refuses `DB_MODE!=postgres`, simulated payments and mock WhatsApp | Prevent accidental test-mode production boot and lost orders | Warning-only checks |
| 2026-11-16 | Freeze order settings once checkout creates a payment intent | Razorpay amount and webhook amount must never drift from the order total | Re-pricing after checkout |
| 2026-11-16 | Persist WhatsApp conversation in `wa_sessions`; close previous active session when a new one starts | Restart safety, one current order per `wa_id` | In-memory state machine |
| 2026-11-16 | Store pairing/agent/OTP/refresh secrets as peppered hashes | Single-use pairing and revocable auth without plaintext credentials | Plain tokens in DB |
| 2026-11-16 | Single-port Fastify static UI for pilot | Zero reverse proxy, one deployable process | Separate Next.js/web server |
| 2026-11-16 | TypeScript tests via `tsc` + `node --test` | No new dependency and fully offline | Adding tsx/vitest |
| 2026-11-16 | Replace `@fastify/cookie` with manual cookie parsing/serialisation | Installed plugin required Fastify 5 while repo uses Fastify 4 | Framework upgrade during a bug sweep |
| 2026-11-16 | Local filesystem storage + in-process rate limits for pilot | Scope control; abstraction allows R2/Redis later | Adding R2/Redis now |
| 2026-11-16 | Node agent + PowerShell Scheduled Task, bundled Node runtime | Smaller than Electron, no Node install on shop PC | Electron tray app (deferred) |
| 2026-11-16 | Simulated payment link API gated to non-production and simulated mode | Test/demo convenience without production exposure | Always-on fake-pay |
| 2026-11-16 | Embedded single-port Fastify delivery for Customer PWA & Shop Console | Zero-config standalone dev & pilot execution on shop PC or low-spec VPS | Separate Next.js multi-port setup requiring reverse proxy during Phase 1 |
| 2026-11-16 | Dual-mode printer execution (CUPS `lp` + Virtual PDF file writer) | Enables full end-to-end verification and testing on headless Linux without wasting paper | Mocking WebSocket layer without testing file I/O |
| 2026-11-16 | Outbound-WebSocket agent architecture | Shop networks have no static IP/open ports | Inbound tunnel/port-forward; polling-only |
| 2026-11-16 | Normalise all inputs to PDF before printing | Eliminates driver/font inconsistency; enables accurate previews & pricing | Direct printing of DOCX via Office |
| 2026-11-16 | Free "Starter" tier + txn fee as adoption wedge | Lowers shop-owner risk to zero | Paid-only from day one |

---

## 8. BLOCKERS, RISKS & OPEN QUESTIONS

| ID | Type | Description | Owner | Status |
|---|---|---|---|---|
| Q1 | Question | Which printer models/OS do target shops actually use? | Founder | ⬜ open (Phase 0 field visits) |
| Q2 | Question | Route (platform-collect) vs shop-owned Razorpay — compliance/KYC load? | Founder | ⬜ open |
| Q3 | Question | Min order value / convenience fee to survive gateway fees on ₹5–10 orders? | Founder | ⬜ open (default ₹5 min, ₹1 fee) |
| R1 | Risk | Windows driver/SumatraPDF quirks | Founder/Eng | 🟡 scaffold only; must test on real HP/Canon/Epson/Brother models |
| R2 | Risk | Founder bandwidth (college + multiple projects) | Founder | keep MVP scope strict, weekly milestones |
| R3 | Risk | Privacy incident (Aadhaar/marksheets) | Eng | persisted deletion + spool cleanup + redaction; audit before pilot |
| R4 | Risk | Meta business/template approval lead time | Founder | start now; mock/web path remains usable; label human steps |
| R5 | Risk | WhatsApp 24-hour window / per-message costs | Founder | templates for out-of-window; budget and monitor; free-form only in-window |
| R6 | Risk | WhatsApp number ban / quality rating | Founder | opt-in, STOP, rate limits, no marketing spam |
| R7 | Risk | Postgres live behavior untested here (no `psql`/Docker) | Eng | run `TEST_DATABASE_URL` contract suite and migration drill on a real DB |
| R8 | Risk | LibreOffice/ClamAV not installed; Office uploads may be rejected/scan skipped | Eng | install and verify before accepting Office files in production |
| R9 | Risk | No Sentry transport despite `SENTRY_DSN` name | Eng | add before pilot or use log aggregation |

---

## 9. CHANGELOG (newest first)

### 2026-11-16 — Phase 2: bug-fix sweep + WhatsApp + Windows agent scaffold

- Rewrote shared contracts, pricing engine, DB types/schema/memory+Postgres repositories and idempotent migration runner; added contract tests.
- Hardened API: production config guards, shutdown/cookie handling, tenant-scoped auth, rate limits, upload/document validation, persistent file deletion, payment HMAC/idempotency, reconciliation, split route plugins.
- Added WhatsApp provider abstraction (mock + Cloud API), raw-body webhook verification/dedupe, persistent conversation state machine, copy/templates, payment links, notifications, owner alerts/commands, OTP login.
- Added static web UI (`apps/web/public`) for landing, customer, pay and shop dashboard (OTP, queue, settings, pairing, analytics).
- Hardened agent: `PrinterDriver` (`CupsDriver`, `VirtualPdfDriver`, `WindowsSumatraDriver`), discovery/status, persistent printed-job ledger, pairing bootstrap, backoff+jitter, unfinished-job hello, hash mismatch failure, spool cleanup.
- Replaced JS tests with TypeScript tests: pricing 9, DB contract 9, API/integration 40; added production config and simulated-route tests, WhatsApp E2E/security/OTP/owner tests, notification failure isolation.
- Added `.github/workflows/ci.yml`, root scripts (`build`, `test`, `dev:api`, `dev:agent`, `demo:whatsapp`, `db:migrate`), `.env.example` names, runbook, WhatsApp setup/templates docs, Windows packaging docs/scripts.
- Corrected docs: `implementation.md` §21 records WhatsApp/delivery model and deviations; `Mind.md` statuses now distinguish mock-verified from `UNVERIFIED: live Meta/Windows/Postgres`.
- Final verification: `pnpm build` and `pnpm test` green (58 tests; Postgres contract skipped without `TEST_DATABASE_URL`), `pnpm demo:whatsapp` green. Committed as `3c85146` (shared/db/pricing), `2c07a37` (API/web/WhatsApp), `fc522b9` (agent), `d3fd12d` (docs/CI).

### 2026-11-16 — Phase 1 Walking Skeleton Implementation
- Initialized pnpm monorepo with `packages/shared`, `packages/pricing`, `packages/db`, `apps/api`, `apps/agent`, `apps/web`, `infra/`.
- Implemented shared domain enums/Zod/pickup tokens and the pure paise pricing engine.
- Implemented PostgreSQL DDL, TypeScript records and memory DB with optimistic transitions.
- Implemented API upload/analysis, Razorpay HMAC webhook, SSE, customer/shop UI.
- Implemented outbound WebSocket agent with SHA-256 verification and CUPS/virtual printing.
- Passed the walking-skeleton E2E test (superseded by TypeScript API tests).

### 2026-11-16 — Initial planning session
- Defined product scope, business model, architecture, data model, flows, security, roadmap.
- Created `implementation.md` (full blueprint) and `Mind.md`.

---

## 10. NEXT ACTIONS (ordered, concrete — rewrite every session)

1. **HUMAN:** Create Meta Business account/app/WhatsApp product, use the test number, expose the webhook with `cloudflared`/`ngrok`, and complete the checklist in `docs/whatsapp-setup.md`; submit the six templates from `docs/whatsapp-templates.md`.
2. **HUMAN:** Run a real Razorpay test-mode UPI payment through the production webhook; verify `payment.captured`/`payment_link.paid` dedupe and amount/currency checks.
3. **HUMAN:** Build/install the agent on a Windows shop PC using `apps/agent/PACKAGING.md`; run the hardware checklist (duplex/colour/A3, offline, paper-out, reboot, no reprint after crash).
4. **ENG:** Run the Postgres contract suite and migration/restore drill against a disposable database (`TEST_DATABASE_URL`, `pnpm db:migrate`); fix any live-only differences.
5. **ENG:** Install LibreOffice + ClamAV, wire timeouts/concurrency, and add conversion/scan integration tests before accepting Office files in production.
6. **ENG:** Complete pilot hardening: real QR standee, privacy/refund policy, backup/restore drill, log aggregation/Sentry, and one load test at exam-rush volumes.
7. **HUMAN:** Visit 10 shops; validate printer/OS/pricing/pain points and sign 3 pilot shops before adding features.

---

## 11. DISCOVERY SHEET TEMPLATE (use during shop visits)

```
Shop name / area:
Owner name & phone:
Printers (brand/model, mono/colour, A3?):
PC OS & specs:
Internet (ISP, reliability):
Daily print volume (pages) & peak hours:
Current rates (B&W / colour / A3):
How files arrive today (WhatsApp / pendrive / email):
Biggest pain (billing errors / queue / file clutter / cash):
Would pay ₹___/month? Preferred plan:
Willing to pilot? (Y/N) Start date:
Notes:
```

---

## 12. GLOSSARY

- **Agent** — software on the shop PC that receives jobs from the cloud and drives the printer.
- **WYSIWYP** — What You See Is What You Print (preview is the converted PDF that will actually print).
- **Pay-before-print invariant** — a job is queued only after a verified payment webhook.
- **Route** — Razorpay's marketplace/payout product for splitting payments to sellers.
- **Reconciliation cron** — periodic job that fixes orders whose webhook was missed and retries stale jobs.
- **CUPS-PDF** — virtual printer that "prints" to a PDF file; used for dev/testing.
- **wa_id** — WhatsApp's normalized phone identifier (country code + number, no `+`).
- **24-hour window** — Meta allows free-form replies only within 24 h of the customer's last message; outside it, approved templates are required.
- **Template** — pre-approved WhatsApp message body/category submitted in Meta Business Manager.

---
*End of Mind.md — if you changed anything today, did you update §2, §4, §9, §10?*
