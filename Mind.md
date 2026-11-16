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
| **Core promise** | Customer scans QR, uploads file, sets options, pays; shop's printer prints automatically. No queue, no cash, no file leaks. |
| **Target customer (beachhead)** | Photocopy/stationery shops near colleges in Lucknow |
| **Repo** | `/home/elliot/B2C` — `chhaap` pnpm monorepo initialized on branch `main` |
| **Live URLs** | Local dev: `http://localhost:4000/` (Customer PWA `/s/campus-xerox`, Shop Console `/shop/campus-xerox`) |
| **Last updated** | 2026-11-16 |
| **Last updated by** | Antigravity (Phase 1 Walking Skeleton completion) |

### Elevator state
**Phase 1 Walking Skeleton built, verified, and passing end-to-end automated tests.**
Customer PWA, Shop Dashboard, Fastify WebSocket Gateway, Pure Pricing Engine, and Outbound Print Agent (with virtual CUPS-PDF execution) are functional and tested in monorepo.

---

## 2. STATUS DASHBOARD

| Area | Status | Notes |
|---|---|---|
| Product definition | ✅ done | Scope, MVP, non-goals defined in `implementation.md` §1 |
| Business model | 🟡 draft | Plans/pricing proposed; needs validation with real shop owners in Lucknow |
| Architecture | ✅ done | Cloud API + outbound-WS print agent + storage + pricing engine |
| Repo & CI | ✅ done | Monorepo setup with pnpm workspaces, TypeScript project references, Git repo |
| Database schema | ✅ done | Postgres DDL (`packages/db/src/schema.sql`) + Embedded Memory DB repository with optimistic locking |
| Customer PWA | ✅ done | Mobile PWA flow: Upload → Settings → Live Quote → Preview → Pay → SSE Tracking (`/s/:slug`) |
| Shop dashboard | ✅ done | Live queue with auto-refresh, stat cards, printer health, agent pairing code (`/shop/:slug`) |
| API / order state machine | ✅ done | Fastify API with strict `canTransitionOrder` state machine & audit events table |
| Pricing engine | ✅ done | `@chhaap/pricing` with integer paise arithmetic, n-up, duplex, and 7 unit/property tests |
| File pipeline (convert/scan/preview) | ✅ done | `pdfinfo` page count + Ghostscript `inkcov` color detection + `pdftoppm` previews |
| Razorpay integration | 🟡 in progress | Orders checkout, HMAC SHA-256 webhook validation & event dedupe done; instant fake-pay simulation active |
| Print agent | ✅ done | Outbound WebSocket agent (`@chhaap/agent`) with printer discovery, SHA-256 verification, CUPS/Virtual spooler |
| Security & compliance | 🟡 in progress | 15-min auto-deletion schedule in cloud, immediate temp cleanup on agent, Zod input validation |
| Pilot shops | ⬜ todo | 0 of target 3–5 (Field visits pending) |
| Revenue | — | ₹0 MRR |

**Current phase:** `Phase 1 — Walking Skeleton (Completed) -> Phase 2 — Real MVP & Pilot Prep`
**Overall progress:** ~35% (Full end-to-end loop working & tested)

---

## 3. KEY DECISIONS ALREADY MADE (quick reference)

| # | Decision | Status |
|---|---|---|
| D1 | Agent connects **outbound via WebSocket**; no inbound ports at shops | Decided & Implemented |
| D2 | Payment must be **verified via webhook** before any job is queued (pay-before-print) | Decided & Implemented |
| D3 | Server computes all prices; all money in **paise (integers)** | Decided & Implemented |
| D4 | Normalise every upload to **PDF** server-side; agent only prints PDFs | Decided & Implemented |
| D5 | Stack: Fastify/TS API, WebSocket Gateway, Pure Pricing TS package, Postgres DDL, pnpm monorepo | Decided & Implemented |
| D6 | Files auto-deleted ~15 min after print (hard TTL 24 h) + immediate deletion on agent | Decided & Implemented |
| D7 | Settlement model: Razorpay **Route** (platform collects, pays out shops) vs shop-owned account | **OPEN** — recommended: Route; start with manual weekly payouts |
| D8 | Product/brand name & domain | **OPEN** — "Chhaap" is a placeholder |
| D9 | Dual-mode printer execution: auto-detects CUPS `lp` on Linux; falls back to Virtual CUPS-PDF paperless spooler | Decided & Implemented |

---

## 4. PHASE CHECKLIST

### Phase 0 — Validate (target: Week 0–1)
- [ ] Visit ≥10 shops; record: printer models, OS, internet quality, current rates, pain points
- [ ] Get ≥3 shops to commit to a pilot
- [ ] Finalise name + domain
- [ ] Decide settlement model (D7)
- [x] Create monorepo, CI, dev/staging/prod environments

### Phase 1 — Walking Skeleton (Week 1–2)
- [x] DB schema + migrations (`packages/db/src/schema.sql`)
- [x] Shop auth / 6-digit agent pairing code
- [x] Upload pipeline + PDF page-count (`pdfinfo`) + colour detection (`gs inkcov`)
- [x] Agent ↔ WebSocket ↔ dispatch ↔ CUPS/Virtual-PDF print (end-to-end tested)
- [x] Order state machine (`canTransitionOrder`) + `events` audit log

### Phase 2 — Real MVP (Week 3–6)
- [x] Pricing engine (+ per-page colour detection) with property tests (`packages/pricing`)
- [x] Previews (WYSIWYP) via `pdftoppm`
- [x] Customer PWA (Upload → Settings → Review & Pay → Status), SSE streaming
- [x] Shop dashboard (queue, rates, QR generator, printer health)
- [ ] DOCX/PPTX/XLSX/image → PDF conversion in sandbox container; ClamAV virus scanning
- [ ] Production Razorpay live KYC + webhooks configuration
- [ ] Windows agent installer (SumatraPDF CLI + Windows Service / Tray app)
- [ ] Sentry error monitoring & telemetry

### Phase 3 — Pilot (Week 6–10)
- [ ] 3–5 shops live; daily check-ins
- [ ] 20 consecutive orders with zero manual intervention at one shop
- [ ] Chaos tests passed (printer unplug, network loss, double pay)

### Phase 4 — Monetise (Week 10–16)
- [ ] Subscriptions + plan limits + txn-fee ledger
- [ ] Route payouts, GST invoices, settlement reports
- [ ] WhatsApp notifications, coupons, multi-printer routing

### Phase 5 — Scale (Month 5+)
- [ ] Chain console, white-label, API, kiosk mode, photo/ID templates, campus programmes, referral engine

---

## 5. ARCHITECTURE STATE (update as built)

**Implemented Architecture:**
Customer PWA (`/s/:slug`) → Fastify API (`/v1/*`) → Memory/Postgres DB (`packages/db`) + File Storage (`data/uploads`) → WebSocket Gateway (`/v1/agent/connect`) → Print Agent (`apps/agent`) → CUPS `lp` or Virtual CUPS-PDF Spooler (`test-prints/`).

### Component registry
| Component | Path | Tech | Status | Notes |
|---|---|---|---|---|
| shared | `packages/shared` | TypeScript / Zod | ✅ done | Enums, schemas, protocol definitions, pickup tokens |
| pricing | `packages/pricing` | TypeScript | ✅ done | Pure engine, 7 unit & property tests, paise arithmetic |
| db | `packages/db` | TypeScript / SQL | ✅ done | Postgres DDL, seed data, Memory DB repo with optimistic locks |
| api | `apps/api` | Fastify / TS / WS | ✅ done | REST endpoints, WebSocket Gateway, SSE streams, payment webhook |
| agent | `apps/agent` | Node.js / WS | ✅ done | Outbound WS, printer discovery, SHA-256 verify, Virtual PDF execution |
| web | `apps/web` / `apps/api` | HTML5 / Tailwind | ✅ done | Mobile Customer PWA (`/s/:slug`), Shop Owner Dashboard (`/shop/:slug`) |
| infra | `infra/` | Docker Compose | ✅ done | Postgres 16 + Redis 7 compose definitions |

### Environments
| Env | URL | Status |
|---|---|---|
| local | `http://localhost:4000` | ✅ working |
| staging | — | ⬜ |
| prod | — | ⬜ |

### Env var names (NEVER values)
`PORT`, `HOST`, `DATABASE_URL`, `REDIS_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `JWT_SECRET`, `AGENT_TOKEN_PEPPER`, `TURNSTILE_SECRET`, `SENTRY_DSN`, `WHATSAPP_TOKEN`.

---

## 6. DEV ENVIRONMENT NOTES

- Primary dev machine: **Linux**. Virtual CUPS-PDF printer mode is built-in (`test-prints/` folder).
- System tools verified: `ghostscript` (v10.05.1), `poppler-utils` (`pdfinfo`, `pdftoppm`).
- Package manager: `pnpm` (v12.21.0) with Turborepo monorepo layout.
- Build command: `/home/elliot/B2C/.tools/bin/pnpm -r run build`
- Test commands:
  - Unit tests: `/home/elliot/B2C/.tools/bin/pnpm --filter @chhaap/pricing test`
  - E2E walking skeleton: `/home/elliot/B2C/.tools/bin/pnpm --filter @chhaap/api test`

---

## 7. DECISIONS LOG (append-only, newest first)

| Date | Decision | Why | Alternatives rejected |
|---|---|---|---|
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
| Q3 | Question | Min order value / convenience fee to survive gateway fees on ₹5–10 orders? | Founder | ⬜ open (Default ₹5 min, ₹1 fee) |
| R1 | Risk | Windows driver quirks | — | mitigated by PDF normalisation + Sumatra; test on real models |
| R2 | Risk | Founder bandwidth (college + multiple projects) | — | keep MVP scope strict, weekly milestones |
| R3 | Risk | Privacy incident (Aadhaar/marksheets) | — | auto-delete, sandboxing, audit logs |

---

## 9. CHANGELOG (newest first)

### 2026-11-16 — Phase 1 Walking Skeleton Implementation
- Initialized pnpm monorepo with `packages/shared`, `packages/pricing`, `packages/db`, `apps/api`, `apps/agent`, `apps/web`, `infra/`.
- Implemented `packages/shared` with domain enums, Zod validation schemas, pickup token generator, and WebSocket agent protocol types.
- Implemented `packages/pricing` with pure paise-based pricing engine, per-page colour calculations, duplex sheet math, and 7 unit/property tests.
- Implemented `packages/db` with PostgreSQL DDL schema (`schema.sql`), TypeScript records, and memory database with optimistic status transitions and audit logging.
- Implemented `apps/api` with Fastify HTTP + WebSocket server, document analysis pipeline (`pdfinfo` + Ghostscript `inkcov` + `pdftoppm` previews), Razorpay webhook verification with HMAC SHA-256 signature checks, and Server-Sent Events (SSE) order status stream.
- Built interactive Customer PWA (`/s/:slug`) and Shop Dashboard (`/shop/:slug`) with live queue and audible chime.
- Implemented `apps/agent` with outbound WebSocket client, printer discovery, SHA-256 integrity verification, CUPS `lp`/Virtual PDF printing, and immediate temp spool cleanup.
- Wrote and passed comprehensive E2E walking skeleton test (`apps/api/test/e2e-walking-skeleton.test.js`) verifying the entire loop from scan to print completion.

### 2026-11-16 — Initial planning session
- Defined product scope, business model, architecture, data model, flows, security, roadmap.
- Created `implementation.md` (full blueprint) and `Mind.md`.

---

## 10. NEXT ACTIONS (ordered, concrete — rewrite every session)

1. Carry out discovery visits to 3 stationery shops near campus using the template in §11; record printer models and OS.
2. Sign up for a Razorpay test account to configure webhook secrets and test UPI checkout flows with real gateway popups.
3. Test the Print Agent on a Windows machine with `SumatraPDF.exe` CLI against a physical laser printer (HP/Canon).
4. Add LibreOffice headless container conversion for DOCX/PPTX/images into PDF in `apps/api/src/document-processor.ts`.
5. Integrate ClamAV scanning daemon for uploaded files.
6. Design printable QR counter standee SVG/PDF template for pilot shops.
7. Update `Mind.md` after shop field visits.

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
- **Reconciliation cron** — periodic job that fixes orders whose webhook was missed.
- **CUPS-PDF** — virtual printer that "prints" to a PDF file; used for dev/testing.

---
*End of Mind.md — if you changed anything today, did you update §2, §4, §9, §10?*
