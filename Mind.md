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
| **Repo** | UNVERIFIED: not created yet — `chhaap` monorepo planned |
| **Live URLs** | none yet |
| **Last updated** | 2026-11-16 |
| **Last updated by** | Claude (initial planning session) |

### Elevator state
Idea validated on paper only. Blueprint (`implementation.md`) written. **No code, no infra, no pilot shop yet.**

---

## 2. STATUS DASHBOARD

| Area | Status | Notes |
|---|---|---|
| Product definition | ✅ done | Scope, MVP, non-goals defined in implementation.md §1 |
| Business model | 🟡 draft | Plans/pricing proposed; **needs validation with real shop owners** |
| Architecture | ✅ done (design) | Cloud + outbound-WS print agent; see implementation.md §3 |
| Repo & CI | ⬜ todo | |
| Database schema | ⬜ todo | Draft SQL in implementation.md §4 |
| Customer PWA | ⬜ todo | |
| Shop dashboard | ⬜ todo | |
| API / order state machine | ⬜ todo | |
| Pricing engine | ⬜ todo | |
| File pipeline (convert/scan/preview) | ⬜ todo | |
| Razorpay integration | ⬜ todo | Razorpay account/KYC not started |
| Print agent | ⬜ todo | Dev on Kali + CUPS-PDF first |
| Security & compliance | ⬜ todo | |
| Pilot shops | ⬜ todo | 0 of target 3–5 |
| Revenue | — | ₹0 MRR |

**Current phase:** `Phase 0 — Validate`
**Overall progress:** ~5% (planning only)

---

## 3. KEY DECISIONS ALREADY MADE (quick reference)

| # | Decision | Status |
|---|---|---|
| D1 | Agent connects **outbound via WebSocket**; no inbound ports at shops | Decided |
| D2 | Payment must be **verified via webhook** before any job is queued (pay-before-print) | Decided |
| D3 | Server computes all prices; all money in **paise (integers)** | Decided |
| D4 | Normalise every upload to **PDF** server-side; agent only prints PDFs | Decided |
| D5 | Stack: Next.js (Cloudflare Pages), Fastify/TS API, Postgres, Redis/BullMQ, Cloudflare R2, Razorpay | Proposed — confirm at repo creation |
| D6 | Files auto-deleted ~15 min after print (hard TTL 24 h) | Decided |
| D7 | Settlement model: Razorpay **Route** (platform collects, pays out shops) vs shop-owned account | **OPEN** — recommended: Route; start with manual weekly payouts |
| D8 | Product/brand name & domain | **OPEN** — "Chhaap" is a placeholder |

---

## 4. PHASE CHECKLIST

### Phase 0 — Validate (target: Week 0–1)
- [ ] Visit ≥10 shops; record: printer models, OS, internet quality, current rates, pain points
- [ ] Get ≥3 shops to commit to a pilot
- [ ] Finalise name + domain
- [ ] Decide settlement model (D7)
- [ ] Create monorepo, CI, dev/staging/prod environments

### Phase 1 — Walking Skeleton (Week 1–2)
- [ ] DB schema + migrations
- [ ] Shop auth (OTP)
- [ ] Signed upload to R2, PDF page-count
- [ ] Agent ↔ WebSocket ↔ dispatch ↔ CUPS-PDF print (end-to-end, ugly UI OK)
- [ ] Order state machine + `events` log

### Phase 2 — Real MVP (Week 3–6)
- [ ] Pricing engine (+ per-page colour detection) with property tests
- [ ] DOCX/PPTX/XLSX/image → PDF conversion in sandbox; ClamAV; PDF sanitisation
- [ ] Previews (WYSIWYP)
- [ ] Razorpay Orders + webhooks + reconciliation cron + auto-refunds
- [ ] Customer PWA (Upload → Settings → Review & Pay → Status), SSE
- [ ] Shop dashboard (queue, rates, QR generator, printer health)
- [ ] Windows agent installer, pairing code, auto-start, auto-update
- [ ] Retention/deletion jobs, privacy policy, T&C
- [ ] Sentry, uptime checks, logs

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

**Planned (from implementation.md §3):**
Customer PWA → API (Fastify) → Postgres + Redis/BullMQ → R2 storage → WebSocket gateway → Print Agent (shop PC) → CUPS/Windows spooler → Printer.

**Actually built so far:** nothing.

### Component registry (fill in as created)
| Component | Path | Tech | Status | Notes |
|---|---|---|---|---|
| web | apps/web | Next.js | ⬜ | |
| api | apps/api | Fastify/TS | ⬜ | |
| worker | apps/worker | BullMQ | ⬜ | |
| agent | apps/agent | Node/Electron or Python | ⬜ | |
| pricing | packages/pricing | TS | ⬜ | |
| db | packages/db | Drizzle/Prisma | ⬜ | |

### Environments
| Env | URL | Status |
|---|---|---|
| local | — | ⬜ |
| staging | — | ⬜ |
| prod | — | ⬜ |

### Env var names (NEVER values)
`DATABASE_URL`, `REDIS_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `JWT_SECRET`, `AGENT_TOKEN_PEPPER`, `TURNSTILE_SECRET`, `SENTRY_DSN`, `WHATSAPP_TOKEN` *(planned — create as needed)*

---

## 6. DEV ENVIRONMENT NOTES

- Primary dev machine: **Kali Linux**. Use CUPS + **CUPS-PDF** as a virtual printer for development (no paper).
- Setup commands: see implementation.md §10 ("Linux/Kali dev loop").
- Windows agent (Sumatra) must be tested on a real Windows machine/VM before pilot.
- Test printers wanted: HP LaserJet / Canon / Epson / Brother (most common in Indian shops).

---

## 7. DECISIONS LOG (append-only, newest first)

| Date | Decision | Why | Alternatives rejected |
|---|---|---|---|
| 2026-11-16 | Outbound-WebSocket agent architecture | Shop networks have no static IP/open ports | Inbound tunnel/port-forward; polling-only |
| 2026-11-16 | Normalise all inputs to PDF before printing | Eliminates driver/font inconsistency; enables accurate previews & pricing | Direct printing of DOCX via Office |
| 2026-11-16 | Free "Starter" tier + txn fee as adoption wedge | Lowers shop-owner risk to zero | Paid-only from day one |

---

## 8. BLOCKERS, RISKS & OPEN QUESTIONS

| ID | Type | Description | Owner | Status |
|---|---|---|---|---|
| Q1 | Question | Which printer models/OS do target shops actually use? | Founder | ⬜ open (Phase 0 field visits) |
| Q2 | Question | Route (platform-collect) vs shop-owned Razorpay — compliance/KYC load? | Founder | ⬜ open |
| Q3 | Question | Min order value / convenience fee to survive gateway fees on ₹5–10 orders? | Founder | ⬜ open |
| R1 | Risk | Windows driver quirks | — | mitigated by PDF normalisation + Sumatra; test on real models |
| R2 | Risk | Founder bandwidth (college + multiple projects) | — | keep MVP scope strict, weekly milestones |
| R3 | Risk | Privacy incident (Aadhaar/marksheets) | — | auto-delete, sandboxing, audit logs |

---

## 9. CHANGELOG (newest first)

### 2026-11-16 — Initial planning session
- Defined product scope, business model, architecture, data model, flows, security, roadmap.
- Created `implementation.md` (full blueprint) and `Mind.md` (this file).
- No code written. Phase 0 begins next.

---

## 10. NEXT ACTIONS (ordered, concrete — rewrite every session)

1. Decide the product name + check domain availability (`.in` / `.app`).
2. Visit 3 shops near campus this week; fill the discovery sheet (printer model, OS, rates, pain points) → record answers in §8 Q1/Q3.
3. Create GitHub monorepo `chhaap` (pnpm + Turborepo) with the structure from implementation.md §13; commit both .md files at the root.
4. On Kali: install CUPS + CUPS-PDF + Ghostscript + qpdf + poppler + LibreOffice; confirm `lp -d PDF test.pdf` works.
5. Create Razorpay account (test mode) and start business KYC in parallel (it takes time).
6. Build **Phase 1 walking skeleton**: upload → fake pay → agent → CUPS-PDF print.
7. Update this file at the end of the session.

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
