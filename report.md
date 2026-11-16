# Chhaap — Current Project State Report

**Snapshot date:** 2026-11-16  
**Base HEAD:** `bd4c085` (`chore: ignore the local pnpm wrapper`)  
**Phase:** Phase 2 — Real MVP + WhatsApp (implemented; live verification pending)  
**Overall progress:** approximately 55% — the core loop and the WhatsApp mock flow work end-to-end; no real Meta, Razorpay, Postgres, Windows or printer-hardware run has been verified in this environment.

This report is written to be self-contained. A reader who has never seen the repository should be able to understand what exists, what was actually verified, what is only mocked, and what must happen next. Code is treated as the source of truth; where documentation disagrees with code, the discrepancy is called out in §14.

---

## 1. Executive summary

Chhaap is a QR-to-print system for Indian print shops. A customer scans a counter QR, uploads a PDF/image (or sends it on WhatsApp), chooses print settings, pays online, and the shop's PC prints the job automatically. The shop owner manages the queue and settings from a web dashboard. Money is handled server-side in integer paise; in production, a print job is released only after a verified payment webhook.

### What is working now

- A pnpm monorepo with five packages: `shared`, `pricing`, `db`, `api`, `agent`, plus a static `web` app.
- Fastify API serving REST, SSE, WebSocket and the static UI on one port.
- Memory and Postgres repositories behind one `DatabaseRepository` interface.
- Server-side upload validation, PDF normalisation, page count, colour classification, previews and pricing.
- Web order API: upload → settings → server quote → consent → checkout → verified payment → queue → agent dispatch → printing → completed. The static customer page still lacks a working payment handoff (see §14.2).
- WhatsApp mock flow: signed webhook → persisted conversation state machine → file download → settings → review → payment link → simulated payment → notifications.
- WhatsApp Cloud API provider abstraction, template definitions, webhook signature verification and event deduplication.
- Owner OTP login over WhatsApp, short-lived JWT access cookies, rotating refresh tokens, tenant-scoped shop routes.
- Agent pairing with hashed single-use codes, hashed tokens, token rotation, reconnect backoff, heartbeat, status reporting, signed file downloads, SHA-256 verification, a crash-safe job ledger and three printer drivers (CUPS, virtual PDF, Windows SumatraPDF).
- Persisted file-deletion deadlines, post-print spool cleanup, reconciliation loop, payment-refund path and rate limits.
- Static landing, customer, shop dashboard and simulated-payment pages.
- CI workflow that installs Ghostscript/poppler and runs build, tests and the offline WhatsApp demo.

### Verification status at a glance

| Check | Status | Evidence |
|---|---|---|
| `pnpm build` | ✅ Passed | Re-run on 2026-11-16 |
| `pnpm test` | ✅ Passed | 58 tests executed: 40 API, 9 DB (memory), 9 pricing |
| `pnpm demo:whatsapp` | ✅ Passed | 16-message transcript, 1 agent dispatch, no external calls |
| Static web checkout | ❌ Incomplete | Page expects `shortUrl`; API returns Razorpay order fields (see §14.2) |
| `pnpm dev:api` | ❌ Broken on Node 20 | `node --watch src/index.ts` cannot load `.ts` |
| `pnpm dev:agent` | ❌ Broken on Node 20 | Same TypeScript-extension failure |
| `pnpm dev:web` | ❌ No `dev` script | Only `build` exists in `apps/web/package.json` |
| Live Meta Cloud API | 🟡 Unverified | No credentials/template approval |
| Live Razorpay webhook/UPI | 🟡 Unverified | No account/webhook delivery |
| Real Postgres run | 🟡 Unverified here | Contract tests skip without `TEST_DATABASE_URL`; no `psql`/Docker |
| Windows agent + SumatraPDF | 🟡 Unverified | Packaging scaffold only; no Windows hardware |
| Office conversion | 🟡 Unverified | LibreOffice not installed here |
| Malware scanning | ⬜ Not implemented | `scan_status` is always set to `clean` |
| Installable PWA | ⬜ Not implemented | No manifest/service worker; static HTML only |

The dev-command defect is new information discovered while preparing this report. It is discussed in §14.1 and should be fixed before the pilot hand-off.

---

## 2. Reading conventions and source-of-truth order

| Label | Meaning |
|---|---|
| ✅ | Implemented and verified in this environment |
| 🟡 | Implemented in code, but not verified against the real external system/hardware |
| ⬜ | Not implemented |
| ❌ | Implemented but currently broken |

Source-of-truth order:

1. **Code and tests** — especially `apps/api/src`, `packages/*/src`, `apps/*/test`.
2. **`Mind.md`** — the project memory/decision log, updated through Phase 2.
3. **`implementation.md`** — the original product/engineering plan plus §21, which records the Phase 2 delivery model and deviations.
4. **`docs/runbook.md`**, `docs/whatsapp-setup.md`, `docs/whatsapp-templates.md`, `apps/agent/PACKAGING.md` — operational guidance.

`Mind.md` was already updated on 2026-11-16 and was intentionally left unchanged while producing this report. It still needs a small factual amendment for the dev-command defect described in §14.1.

---

## 3. Repository map

```text
.
├── apps/
│   ├── api/                     Fastify API, static UI, WhatsApp, payments, reconciliation
│   │   ├── src/
│   │   │   ├── index.ts         Process entry point
│   │   │   ├── server.ts        Fastify assembly, plugins, static routes
│   │   │   ├── config.ts        Env parsing and production guards
│   │   │   ├── auth.ts          JWT, cookies, shop auth helpers
│   │   │   ├── payments.ts      Razorpay order/link/refund + verified capture
│   │   │   ├── storage.ts       Upload storage, signed URLs, deletion sweeper
│   │   │   ├── document-processor.ts  PDF conversion, page/colour analysis, previews
│   │   │   ├── reconciliation.ts      Expiry, stale-job retry, WA retention, daily summary
│   │   │   ├── rate-limit.ts    In-process fixed-window limiters + Turnstile hook
│   │   │   ├── websocket-gateway.ts   Agent handshake, dispatch, heartbeat, reconcile
│   │   │   ├── routes/          auth, public, shop, webhooks, whatsapp
│   │   │   └── whatsapp/        provider, conversation, notifier, owner alerts, templates
│   │   ├── test/                api, config, whatsapp tests
│   │   └── scripts/             demo-whatsapp.mjs
│   ├── agent/                   Shop-PC print agent
│   │   ├── src/index.ts         WS client, pairing, job handling, reconnect
│   │   ├── src/drivers.ts       CupsDriver, VirtualPdfDriver, WindowsSumatraDriver
│   │   ├── src/ledger.ts        Crash-safe printed-job ledger
│   │   ├── scripts/             PowerShell install/run/uninstall/build scaffold
│   │   └── PACKAGING.md         Windows packaging notes/checklist
│   └── web/
│       └── public/              index, customer, shop, pay HTML pages (served by API)
├── packages/
│   ├── shared/                  Enums, Zod schemas, money helpers, state machine, agent protocol
│   ├── pricing/                 Pure integer-paise pricing engine + property tests
│   └── db/                      Memory + Postgres repositories, schema.sql, migration runner
├── docs/                        runbook, WhatsApp setup, template copy
├── infra/docker-compose.yml     Postgres 16 + Redis 7 (Redis unused by code)
├── .github/workflows/ci.yml     Install PDF tools → build → test → demo
├── .env.example                 Env names, no real secrets
├── implementation.md            Product/engineering plan, §21 Phase 2 notes
├── Mind.md                      Canonical project memory and status
├── report.md                    This state report
├── package.json                 Workspace scripts
└── pnpm-workspace.yaml          `packages/*`, `apps/*`
```

Known untracked file: `prompt.md` (the original user brief). It is not part of the deliverable and should not be committed.

---

## 4. Architecture

```text
Customer browser / WhatsApp
        │
        ├── HTTPS REST, SSE, static pages
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Fastify API (apps/api)                                       │
│                                                              │
│  routes: auth · public · shop · webhooks · whatsapp          │
│  auth: JWT cookie + refresh token + OTP over WhatsApp        │
│  payments: Razorpay order / payment link / verified webhook  │
│  storage: local disk, signed URLs, persisted deletion        │
│  document: Ghostscript + poppler + optional LibreOffice      │
│  whatsapp: provider abstraction + conversation state machine │
│  reconciliation: 5-minute cron, expired orders/jobs/WA data  │
│  static UI: landing, customer, shop, simulated pay page      │
└───────────────┬──────────────────────────────┬───────────────┘
                │ SQL                          │ WebSocket
                ▼                              ▼
┌───────────────────────────┐      ┌────────────────────────────┐
│ Memory or Postgres DB     │      │ Print Agent (apps/agent)   │
│ packages/db               │      │ outbound WS only           │
│                           │      │ pairing → hello → jobs     │
│ users, shops, orders,     │      │ ledger + hash check        │
│ files, items, payments,   │      │ CUPS / virtual PDF /       │
│ print_jobs, wa_*, etc.    │      │ Windows SumatraPDF         │
└───────────────────────────┘      └─────────────┬──────────────┘
                                                 │
                                                 ▼
                                      Shop printer (or PDF spool)
```

### Runtime boundaries

- **One API process** serves all HTTP, SSE, WebSocket and static content. There is no separate web dev server or reverse proxy in development.
- **The agent dials out** to `/v1/agent/connect`. Shops do not open inbound ports.
- **The database is swappable** through `DB_MODE=memory|postgres`. Memory is seeded with demo data; Postgres starts empty.
- **Files live on local disk** under `CHHAAP_DATA_DIR` (default `data/` relative to the process working directory), not in object storage.
- **Rate limiting, connected-agent state, and the reconciliation timer are in-process.** The current design assumes a single API instance. Redis is present in `infra/docker-compose.yml` but is not used by code.
- **WhatsApp and payments have provider seams**, so tests and the demo run entirely offline with mock implementations.

---

## 5. End-to-end flows

### 5.1 Web order flow

1. Customer opens `/s/:slug` (for example `/s/campus-xerox`).
2. The page calls `GET /v1/shops/:slug` to show the shop, open/closed state, printer availability and rates.
3. Customer uploads a file to `POST /v1/uploads` (multipart, one file, maximum `MAX_UPLOAD_MB`, default 50 MB).
4. The server:
   - validates extension, declared MIME and magic bytes;
   - rejects encrypted PDFs and ZIPs;
   - converts images to PDF with Ghostscript; Office files require LibreOffice;
   - counts pages with `pdfinfo` (with a byte-scan fallback);
   - classifies pages as colour/B&W with Ghostscript `inkcov`;
   - generates up to six PNG previews with `pdftoppm`;
   - stores the print-ready PDF and returns `fileId`, page count, classification and preview URLs.
5. Customer selects settings. The browser calls `POST /v1/orders` with `shopSlug`, `fileId`, settings, optional consented phone, and an optional idempotency key.
6. The server creates a draft order and order item, computes the quote with `packages/pricing`, and returns a per-order `publicToken`. The token is required for every later public operation.
7. Setting changes use `PATCH /v1/orders/:orderId/items/:itemId`; the server re-prices the entire order. Settings are frozen once the order leaves `draft`.
8. Checkout calls `POST /v1/orders/:id/checkout`. The order moves to `awaiting_payment`; in Razorpay mode the server creates a Razorpay order and stores a payment record. In simulated mode it creates a fake order record.
9. In production, only `POST /v1/webhooks/razorpay` with a valid HMAC over the exact raw body can mark the order paid. Amount and currency are re-checked against the stored order and payment. `payment.captured`, `order.paid` and `payment_link.paid` all converge on one idempotent handler. Local simulated payment uses the separately registered fake-pay routes, which do not exist in production.
10. On verified payment the order moves `awaiting_payment → paid → queued`, and one `print_jobs` row per order item is created.
11. The WebSocket gateway dispatches pending jobs to the shop's connected agent with a short-lived signed file URL, SHA-256, settings and target printer.
12. The agent downloads, verifies the hash, spools, prints, and reports progress/result. The order moves `queued → printing → completed`.
13. The API exposes state changes over SSE at `GET /v1/orders/:id/stream?token=...`, but the current static customer page does not open that stream or poll for status. It hands the browser to the payment provider and stops there.
14. After completion, the file's deletion deadline is set to 15 minutes in the database. A sweeper deletes the file and previews even after an API restart.

### 5.2 WhatsApp order flow

1. Meta calls `GET /v1/webhooks/whatsapp` for verification; the verify token is compared timing-safely.
2. Meta calls `POST /v1/webhooks/whatsapp` with `X-Hub-Signature-256`. The handler verifies the HMAC over raw bytes, acknowledges with 200 immediately, and processes messages on a serial queue.
3. Duplicate `wamid`s are deduplicated; status events are recorded.
4. A customer sends `PRINT <shop-slug>` (or arrives through a QR/deep link) and chooses a language: English, Hindi or Hinglish.
5. The session is persisted in `wa_sessions`. The state machine is:
   `AWAITING_FILE → CONFIGURING → REVIEW → AWAITING_PAYMENT → TRACKING → DONE`.
6. Media is downloaded immediately from Meta, then goes through the same validation/analysis/pricing pipeline as a web upload. A conversation can hold up to five files.
7. After each file, the bot asks for colour, sides and copies. All files in a WhatsApp order share the current settings set; changing options later re-prices every item with that set.
8. The review shows a server-computed total. “Pay now” creates a Razorpay Payment Link (UPI-first, 15-minute expiry by default) or a simulated link.
9. Typing “paid” never changes state. Only the verified Razorpay webhook (`payment_link.paid`) can mark the order paid and release print jobs.
10. Notifications are event-driven and deduplicated per `(order_id, event)`: paid receipt, printing started, ready for pickup, failed, refunded. A failed notification is retried but never blocks printing.
11. Outside the 24-hour WhatsApp customer-service window, utility templates are required. The template names and copy are listed in `docs/whatsapp-templates.md`.

### 5.3 Agent pairing and dispatch flow

1. Owner opens the shop dashboard and requests a pairing code: `POST /v1/shop/agents/code`.
2. The server creates an agent row with a 6-digit code stored as `sha256(code + AGENT_TOKEN_PEPPER)`, expiring in 10 minutes.
3. Owner runs the agent with `--pair=<code>` (or `CHHAAP_PAIRING_CODE`).
4. Agent calls `POST /v1/agents/pair`; the server checks the hash, expiry and attempt count, then returns a raw `agent_tok_...` token once and clears the pairing code.
5. Agent stores server URL, agent ID and token with mode `0600` in its data directory.
6. Agent opens a WebSocket to `/v1/agent/connect` and sends `hello` with agent ID, token, version, OS, printers and unfinished jobs.
7. Server verifies the token hash, replaces any older connection, marks the agent online, upserts printers and sends `ack` with heartbeat interval and printer IDs.
8. Agent sends `pong` to server `ping`; server marks agents offline after the heartbeat timeout (default 60 seconds).
9. Pending print jobs are dispatched only when a shop agent is connected and at least one printer is available.
10. Token rotation is available at `POST /v1/shop/agents/:agentId/rotate-token`; the old token stops working.

### 5.4 Print safety and reconciliation

- The agent writes `printing` to its on-disk ledger **before** invoking the spooler, and `printed` after success. On restart, a stale `printing`/`spooling` entry is reported as unfinished.
- The server treats a reconnect-reported `printing`/`spooling` job as already printed and completes the order, rather than risking a duplicate copy.
- A job that was only `dispatched` is put back into `pending` after reconnect.
- A dispatched job with no result for five minutes is retried by reconciliation. After three attempts the job is failed; the order moves to `failed`, the customer is notified and the payment is refunded (real Razorpay refund when configured).
- Unpaid orders expire after `ORDER_EXPIRY_MINUTES` (default 15).
- WhatsApp sessions expire after `WA_SESSION_TTL_MINUTES` (default 30); message content is purged after `WA_MESSAGE_RETENTION_DAYS` (default 30).
- The reconciliation loop runs every five minutes and also sends the optional owner daily summary.

---

## 6. Implemented surfaces

### 6.1 HTTP/WebSocket API

Public routes:

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | Liveness, uptime |
| GET | `/readyz` | Readiness; checks DB ping |
| GET | `/v1/shops/:slug` | Public shop view, rates, printer availability |
| POST | `/v1/uploads` | Multipart upload, rate-limited, optional Turnstile |
| POST | `/v1/orders` | Create draft order; returns `publicToken` |
| PATCH | `/v1/orders/:orderId/items/:itemId` | Change settings and re-price; requires token |
| GET | `/v1/orders/:id` | Order status; requires `?token=` |
| GET | `/v1/orders/:id/stream` | SSE status stream; requires `?token=` |
| POST | `/v1/orders/:id/checkout` | Create/reuse payment intent; requires token |
| GET | `/v1/pay/:linkId` | Simulated payment-link view (non-production only) |
| POST | `/v1/pay/:linkId/pay` | Simulated payment (non-production only) |
| POST | `/v1/orders/:id/fake-pay` | Simulated web-order payment (non-production only) |
| GET | `/v1/files/:fileId/download` | Signed, expiring agent download URL |
| POST | `/v1/agents/pair` | Exchange a 6-digit code for an agent token |

Authentication routes:

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/auth/otp/request` | Sends a 6-digit OTP over WhatsApp; rate-limited per phone/IP |
| POST | `/v1/auth/otp/verify` | Verifies OTP; sets access + refresh cookies |
| POST | `/v1/auth/refresh` | Rotates the refresh token |
| POST | `/v1/auth/logout` | Clears cookies |
| GET | `/v1/auth/me` | Returns the current shop user |
| POST | `/v1/auth/token/verify` | Verifies an access JWT |

Shop routes (all require a shop-scoped JWT; shop ID always comes from the token, never from a URL/body):

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/shop/me` | Current user + shop |
| GET | `/v1/shop/queue` | Active orders and summary counts |
| GET | `/v1/shop/orders/:id` | Order detail |
| POST | `/v1/shop/orders/:id/cancel` | Cancel eligible order |
| POST | `/v1/shop/orders/:id/reprint` | Manual reprint for completed/failed orders |
| POST | `/v1/shop/orders/:id/collect` | Log pickup by token |
| GET | `/v1/shop/rates` | Rate cards |
| PUT | `/v1/shop/rates` | Replace rates (owner/admin) |
| GET | `/v1/shop/printers` | Printers + agent online state |
| GET | `/v1/shop/agents` | Agents and pairing expiry |
| POST | `/v1/shop/agents/code` | Generate 6-digit pairing code |
| POST | `/v1/shop/agents/:agentId/rotate-token` | Rotate agent token (owner/admin) |
| GET | `/v1/shop/settings` | Shop settings |
| PUT | `/v1/shop/settings` | Update shop settings (owner/admin) |
| GET | `/v1/shop/analytics` | Basic order/revenue analytics |

Webhooks and WebSocket:

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/webhooks/whatsapp` | Meta verification challenge |
| POST | `/v1/webhooks/whatsapp` | Signature-verified inbound messages/statuses |
| POST | `/v1/webhooks/razorpay` | Raw-body HMAC, timestamp freshness, event dedupe |
| GET | `/v1/agent/connect` | WebSocket upgrade for print agents |

Static pages served by the API:

| Path | File |
|---|---|
| `/` | `apps/web/public/index.html` |
| `/s/:slug` | `apps/web/public/customer.html` |
| `/shop/:slug` | `apps/web/public/shop.html` |
| `/pay/:linkId` | `apps/web/public/pay.html` |
| `/previews/*` | Generated PNG previews from the data directory |

### 6.2 Web UI

- **Landing** (`index.html`): product explanation and links to demo shop/customer/dashboard.
- **Customer** (`customer.html`): upload, page previews, print settings, live server quote, optional consented phone, order creation and a “Pay now” button. The button currently requests a `shortUrl` from checkout, but `createCheckout` returns Razorpay order fields, not a short URL; the page also has no SSE/polling status view. The backend order/payment path is tested, but this page is not a working end-to-end checkout.
- **Shop dashboard** (`shop.html`): OTP login, analytics, queue, order actions (cancel/refund, reprint, collected), shop settings, printer/agent state and pairing-code generation. Rate-card editing exists in the API (`GET/PUT /v1/shop/rates`) but is not exposed in this page yet.
- **Pay** (`pay.html`): simulated payment link for local/demo use.

This is a static multi-page UI, not an installable PWA. There is no service worker, web app manifest, offline cache or push notification support. The customer page is mobile-friendly but should not be described as a complete PWA.

### 6.3 Agent

- **Drivers:**
  - `CupsDriver` — sends PDFs to a CUPS queue with `lp`, using paper size, sides, copies and scaling options.
  - `VirtualPdfDriver` — writes `PRINTED_<jobId>_<name>.pdf` plus a metadata sidecar; used for local development and tests.
  - `WindowsSumatraDriver` — invokes SumatraPDF with print settings.
- **Pairing:** `--pair=` or `CHHAAP_PAIRING_CODE`, with credentials persisted.
- **Connection:** outbound WebSocket, exponential backoff with jitter, capped at 30 seconds, automatic reconnect.
- **Reliability:** serialised job queue, heartbeat, status reporting every 45 seconds, downloaded-file SHA-256 verification, crash-safe ledger, spool cleanup older than 24 hours.
- **Windows scaffold:** `apps/agent/scripts/*.ps1` and `PACKAGING.md`. Not executed on Windows in this environment.

### 6.4 Packages

| Package | Responsibility |
|---|---|
| `@chhaap/shared` | Enums, order transition table, Zod request schemas, phone/token/hash helpers, agent protocol types |
| `@chhaap/pricing` | Pure paise pricing for one item and whole orders, page-range parsing, colour classification helper |
| `@chhaap/db` | `DatabaseRepository` interface, `MemoryDatabase`, `PostgresDatabase`, schema SQL, migration runner |
| `@chhaap/api` | Fastify server, routes, auth, payments, storage, WhatsApp, reconciliation, static UI |
| `@chhaap/agent` | WebSocket client, drivers, ledger, pairing |
| `@chhaap/web` | Static HTML/CSS/JS assets; no separate server |

---

## 7. Data model

`packages/db/src/schema.sql` is idempotent and is applied by `pnpm db:migrate` (or on first Postgres container start in `infra/docker-compose.yml`).

| Table | Purpose |
|---|---|
| `users` | Shop owners/staff; phone, email, role, optional password hash |
| `plans` | Subscription plan definitions |
| `shops` | Shop identity, owner, city, status, plan, JSON settings |
| `shop_members` | Additional users linked to a shop with a role |
| `agents` | Shop-PC agents; hashed token, hashed pairing code, version, last seen, status |
| `printers` | Per-agent printer capabilities and live status |
| `rate_cards` | Per-shop prices by paper size, colour mode and sides |
| `addons` | Optional add-on definitions |
| `orders` | Order totals, status, pickup token, public token, channel, customer contact, timestamps |
| `files` | Upload metadata, hashes, scan status, converted PDF key, preview keys, page count, classification, deletion deadline |
| `order_items` | One file + settings + computed line totals per item |
| `payments` | Razorpay order/payment/link IDs, amount, status, signature verification, raw payload |
| `refunds` | Refund records |
| `print_jobs` | Per-item print jobs, printer, status, attempts, errors, timestamps |
| `wa_sessions` | Persisted WhatsApp conversation state, language, order, context, last inbound |
| `wa_messages` | Inbound/outbound message log for dedupe/audit; retention-limited |
| `wa_status_events` | Meta delivery/read status events |
| `wa_optouts` | Customers who sent STOP |
| `otp_codes` | Hashed OTPs, expiry and attempt state |
| `refresh_tokens` | Hashed refresh tokens, expiry, consumed timestamp |
| `notification_log` | `(order_id, event)` dedupe for customer notifications |
| `events` | Order/audit event log |
| `webhook_events` | Provider event IDs for idempotency |

Key relationships:

```text
shop 1─* agent 1─* printer
shop 1─* rate_card
shop 1─* order 1─* order_item *─1 file
order 1─* payment
order 1─* print_job *─1 order_item
order 1─* event / notification_log
wa_session *─1 shop, 0..1 order
```

Money columns are integer paise. `orders.public_token` is the unguessable customer credential; `orders.token` is the human pickup token and is display-only, never an authorization credential.

**Important production gap:** `MemoryDatabase` seeds a demo shop, owner, agent, printer and rate cards. `PostgresDatabase` does not seed anything, and there is no admin API or CLI to create the first shop/user. A fresh production database therefore starts with no shop that a customer can reach and no owner who can log in. Onboarding currently requires manual SQL or a new seed script.

---

## 8. Money and pricing rules

### Invariants

- All money is **integer paise**. No floating point is used for stored amounts.
- The **server** computes every price. Client-supplied totals are ignored; settings only affect the server calculation.
- The quote is re-computed on the server when an item is created or changed.
- After checkout creates a payment intent, the order leaves `draft` and settings/amounts are frozen.
- The Razorpay amount is checked against the order total when the order is created.
- The verified webhook re-checks amount and currency before marking payment captured.
- A print job is created only after `paid`; `queued` is reached only through the verified payment path (or the explicit non-production simulation route).

### Formula (per item)

```text
selectedPages      = pageRange parsed within totalPages
bwPages / colorPages = settings.colorMode, or per-page Ghostscript classification for "smart"
sheets             = ceil(selectedPages / (pagesPerSheet × (duplex ? 2 : 1))) × copies
pageCost           = bwPages × bwRate × copies + colorPages × colorRate × copies
subtotal           = pageCost + addons
fee                = platform convenience fee (once per order)
gst                = round((subtotal + fee) × gstRatePercent / 100)
total              = max(subtotal + fee + gst, minOrderPaise)
```

For a multi-item order, subtotals are summed; the convenience fee and GST are applied once at order level; the minimum-order floor is applied once.

### Defaults

- Minimum order: ₹5 (`500` paise).
- Convenience fee: ₹1 (`100` paise).
- GST: 0% by default, configurable per shop.
- Seeded rates:

| Paper | B&W single | B&W duplex | Colour single | Colour duplex |
|---|---:|---:|---:|---:|
| A4 | ₹2 | ₹1.50 | ₹10 | ₹8 |
| A3 | ₹10 | ₹8 | ₹30 | ₹25 |
| Legal | ₹3 | ₹2 | ₹12 | ₹10 |

The pricing engine has property-style tests for monotonicity/non-negativity, page-range parsing, duplex/sheet accounting, smart colour classification, minimum order and single application of fee/GST.

---

## 9. State machines

### Order

Defined once in `packages/shared/src/index.ts`:

| From | Allowed to |
|---|---|
| `draft` | `awaiting_payment`, `expired` |
| `awaiting_payment` | `paid`, `expired` |
| `paid` | `queued`, `refunded` |
| `queued` | `printing`, `failed`, `refunded` |
| `printing` | `completed`, `failed`, `refunded` |
| `completed` | — |
| `failed` | `queued`, `refunded` |
| `refunded` | — |
| `expired` | — |

Every transition goes through `db.transitionOrderStatus`, which validates the transition and writes an event.

### Print job

`pending → dispatched → printing → done | failed`; cancellation is represented by `cancelled`. Jobs are dispatched only to a connected agent with an available printer. A failed job may be retried manually (`reprint`) or by reconciliation.

### WhatsApp session

`IDLE → AWAITING_FILE → CONFIGURING → REVIEW → AWAITING_PAYMENT → TRACKING → DONE`.

- `cancel` ends the active session and marks it `DONE`.
- `REPEAT` starts a new session using the last order's first item settings.
- Sessions expire after 30 minutes of inactivity.
- STOP is global opt-out and bypasses the session state.

### Agent

- Credentials absent → refuses to start and tells the operator to pair.
- WebSocket disconnected → reconnect with exponential backoff and jitter.
- Handshake accepted → online, printers upserted, pending jobs dispatched.
- Heartbeat missed → server marks agent and its printers offline.
- Token rotated → old token fails authentication; agent must re-pair or receive the new token.

---

## 10. Security model

### Authentication and tenant isolation

- Owner login is WhatsApp OTP only. OTPs are 6 digits, hashed with `OTP_PEPPER`, expire in 5 minutes, lock after 5 wrong attempts, and are rate-limited per phone and IP.
- Access JWTs are HS256, 30-minute lifetime, stored in an httpOnly/SameSite cookie (also accepted as `Authorization: Bearer`).
- Refresh tokens are 30-day random values, stored hashed with `REFRESH_TOKEN_PEPPER`, rotated on use.
- Every shop route derives `shopId` from the JWT. The tests explicitly try URL/body shop IDs and verify they are ignored.
- Role checks restrict rate changes, settings changes and token rotation to owner/admin.
- Agent tokens are random 32-byte values, stored as `sha256(token + AGENT_TOKEN_PEPPER)`, and rotatable.
- Pairing codes are 6 digits, single-use, 10-minute expiry, hashed with the agent pepper, attempt-limited and IP rate-limited.

### Payment security

- Razorpay webhook signature is HMAC-SHA256 over the exact raw request bytes (`req.rawBody`), compared timing-safely.
- `WEBHOOK_MAX_AGE_SECONDS` (default 900) rejects stale events when `created_at` is present.
- Event IDs are recorded in `webhook_events` with a unique constraint; duplicate deliveries are acknowledged without repeating effects.
- Amount and currency are re-checked against both the order and the payment record.
- Orders in `expired`/`refunded` cannot be paid; already-paid orders are idempotently acknowledged.
- Simulated payment routes are **not registered at all** unless `PAYMENTS_MODE=simulated` and `NODE_ENV !== production`.
- Production boot refuses simulated payments, mock WhatsApp, memory DB, a missing/placeholder JWT secret, or a missing public base URL.

### Upload and file security

- Extension allowlist, MIME check, magic-byte check (`%PDF`, JPEG, PNG).
- Encrypted PDFs and ZIP archives are rejected.
- One file per multipart request; size and page limits enforced.
- Server-generated storage keys; original filenames are display-only and sanitised for download headers.
- Uploads and previews directories are created with mode `0700`.
- Agent downloads use an HMAC-signed URL with expiry; the file route rejects missing/invalid signatures.
- Files are deleted after a persisted deadline (24 hours by default, 15 minutes after successful printing); previews are deleted with the file.

### WhatsApp security

- Webhook verification token compared timing-safely.
- Every POST payload verified with `X-Hub-Signature-256` over raw bytes.
- `wamid` dedupe prevents replay/duplicate side effects.
- Conversation processing is serialised per process.
- Inbound rate limiting; STOP/opt-out honoured globally.
- Media is downloaded from Meta and then passed through the same validation pipeline as web uploads.
- Owner commands are accepted only from the shop's configured owner WhatsApp number.

### Logging and privacy

- Fastify/pino structured JSON logs with request IDs.
- Redaction for authorization headers, cookies, signatures, phone numbers, WhatsApp IDs, filenames, access tokens and payment IDs.
- Sentry is only an env hook (`SENTRY_DSN`); there is no Sentry SDK/integration in code.
- Web orders store a phone only when `customerPhoneConsent=true`.

### Known security limitations

- **No malware scanning.** `scan_status` is hard-coded to `clean` on upload. ClamAV is named in docs but not implemented.
- **Preview URLs are unauthenticated.** They rely on unguessable UUID-based filenames, not an access check. Treat a leaked preview URL as public.
- **Rate limiting is in-process and fixed-window.** It resets on restart and does not coordinate across multiple API instances.
- **The file-download secret falls back to `JWT_SECRET`** when `FILE_URL_SECRET` is unset. This works, but the variable is not part of the typed `AppConfig` and is not validated at boot.
- **CORS in development reflects any origin with credentials.** Production restricts the origin to `PUBLIC_BASE_URL`.
- **No CSRF token.** Auth uses SameSite cookies; state-changing requests are JSON and require the token cookie/header. This is acceptable for the pilot but should be reviewed for production.

---

## 11. Configuration

Configuration is read from `process.env` in `apps/api/src/config.ts`. There is **no dotenv loader**; a local `.env` file is not read automatically.

### API variables

| Group | Variables |
|---|---|
| Runtime | `NODE_ENV`, `PORT`, `HOST`, `PUBLIC_BASE_URL`, `LOG_LEVEL`, `CHHAAP_DATA_DIR` |
| Database | `DB_MODE` (`memory`/`postgres`), `DATABASE_URL` |
| Payments | `PAYMENTS_MODE` (`simulated`/`razorpay`), `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `WEBHOOK_MAX_AGE_SECONDS`, `ORDER_EXPIRY_MINUTES`, `PAYMENT_LINK_TTL_MINUTES` |
| Auth/secrets | `JWT_SECRET`, `AGENT_TOKEN_PEPPER`, `OTP_PEPPER`, `REFRESH_TOKEN_PEPPER`, `FILE_URL_SECRET`, `RATE_LIMIT_ENABLED`, `TURNSTILE_SECRET` |
| WhatsApp | `WHATSAPP_MODE` (`mock`/`cloud`), `WHATSAPP_API_VERSION`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PLATFORM_NUMBER`, `WA_SESSION_TTL_MINUTES`, `WA_MESSAGE_RETENTION_DAYS` |
| Uploads/files | `MAX_UPLOAD_MB`, `MAX_PAGES`, `FILE_URL_TTL_SECONDS` |
| Observability | `SENTRY_DSN` (hook only) |

### Agent variables

| Variable | Purpose |
|---|---|
| `CHHAAP_SERVER_URL` | API base URL |
| `CHHAAP_AGENT_NAME` | Display name during pairing |
| `CHHAAP_PAIRING_CODE` | Alternative to `--pair=` |
| `CHHAAP_AGENT_ID`, `CHHAAP_AGENT_TOKEN` | Pre-provisioned credentials |
| `CHHAAP_DATA_DIR` | Config/ledger/spool directory |
| `CHHAAP_VIRTUAL_PRINTER=1` | Use the virtual PDF driver |
| `CHHAAP_PRINT_OUTPUT_DIR` | Output directory for virtual prints |
| `CHHAAP_SUMATRA_PATH` | SumatraPDF executable path on Windows |

### Production boot guards

The API refuses to start in `NODE_ENV=production` unless:

- `PAYMENTS_MODE` is not `simulated`;
- `WHATSAPP_MODE` is not `mock`;
- `DB_MODE=postgres` and `DATABASE_URL` are set;
- `JWT_SECRET` exists and does not contain the development placeholder;
- `PUBLIC_BASE_URL` is set.

`WHATSAPP_MODE=cloud` additionally requires the access token, phone-number ID, app secret, verify token and platform number. Razorpay production additionally requires key ID, key secret and webhook secret.

These guards are covered by `apps/api/test/config.test.ts`.

---

## 12. Verification and tests

### Commands run for this report

```bash
pnpm test
pnpm demo:whatsapp
```

`pnpm build` is invoked by each package's test script. Both commands completed successfully on 2026-11-16. No real external service was contacted.

### Test inventory

| Suite | Tests | Coverage |
|---|---:|---|
| `apps/api/test/api.test.ts` | 17 | Health/readiness, public shop, tenant isolation, upload validation, pricing, public token enforcement, settings freeze, persistent file deletion, Razorpay webhook HMAC/dedupe/amount checks, reconciliation, rate limiting, money invariants |
| `apps/api/test/config.test.ts` | 7 | Production config refusals, simulated routes registration-gated |
| `apps/api/test/whatsapp.test.ts` | 16 | Webhook signature/verification, full mock order E2E, file errors, opt-out, cancellation, session expiry, cross-shop isolation, web-order notifications, owner commands/alerts, OTP lockout/rate limit |
| `packages/db/test/repository.test.ts` | 9 | Memory repository contract: idempotent orders, transitions, refunds, notifications, rate cards, OTPs, refresh tokens |
| `packages/db/test/postgres.test.ts` | 3 skipped | Postgres contract suite; requires `TEST_DATABASE_URL` |
| `packages/pricing/test/pricing.test.ts` | 9 | Page ranges, duplex/sheets, smart colour, min order, fee/GST, monotonicity, whole-order aggregation |
| **Total executed** | **58** | |

The Postgres suite is compiled and present but **skipped** without `TEST_DATABASE_URL`; no real Postgres server was available in this environment.

### What the tests prove

- Tenant isolation is enforced from the token, not from client input.
- Upload spoofing, encrypted PDFs and unsupported extensions are rejected.
- The public token is required for order status, SSE and checkout.
- Settings cannot change after checkout; the server re-prices before payment.
- Payment webhooks require a valid HMAC, reject amount/currency mismatches and deduplicate events.
- File deletion survives an API restart (deadline is persisted).
- Reconciliation expires orders, retries stale jobs and fails/refunds after repeated timeouts.
- Production boot refuses unsafe settings; simulated payment routes do not exist in production.
- The full WhatsApp mock path works: language, file, settings, review, payment link, payment, receipt, printing, ready.
- WhatsApp webhook signatures and duplicate `wamid`s are handled.
- OTP lockout and rate limits work.

### Offline WhatsApp demo

```bash
pnpm demo:whatsapp
```

The demo:

- starts the real API with `DB_MODE=memory`, `PAYMENTS_MODE=simulated`, `WHATSAPP_MODE=mock`;
- connects a virtual agent over the real WebSocket gateway;
- posts signed Meta-shaped webhooks to the real handler;
- runs the real conversation, pricing and payment code;
- prints to a virtual agent (not the agent binary/driver);
- uses localhost only.

Observed result on 2026-11-16:

- 16 outbound WhatsApp messages: language menu, file prompt, colour menu, sides menu, copies menu, review, payment link, receipt, “printing started”, “print ready”;
- 1 agent dispatch;
- no Meta or Razorpay account contacted.

The demo does **not** exercise the real Cloud API, real Razorpay, the agent binary, CUPS, SumatraPDF, Postgres, LibreOffice or ClamAV.

---

## 13. Operations and run commands

### Local development (after fixing §14.1)

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm dev:api        # currently broken; see §14.1
pnpm demo:whatsapp
```

The default local configuration is memory DB, simulated payments and mock WhatsApp. The memory DB seeds:

- shop slug `campus-xerox`;
- owner phone `9876543210`;
- agent ID `agent-campus-1` with a development token;
- a virtual printer and the default rate cards.

The owner login OTP appears in the API log and mock transcript. The API serves:

- `/` — landing;
- `/s/campus-xerox` — customer flow;
- `/shop/campus-xerox` — owner dashboard.

### Postgres

```bash
export DB_MODE=postgres
export DATABASE_URL='postgresql://...'
pnpm db:migrate
pnpm build
node apps/api/dist/index.js
```

The migration runner applies `packages/db/src/schema.sql`. It is idempotent and safe to re-run. Production requires the same variables plus real payment/WhatsApp credentials.

### Agent

```bash
pnpm build
CHHAAP_SERVER_URL=http://localhost:4000 pnpm --filter @chhaap/agent start -- --pair=123456
```

Virtual printing on Linux:

```bash
CHHAAP_VIRTUAL_PRINTER=1 CHHAAP_PRINT_OUTPUT_DIR=./test-prints pnpm --filter @chhaap/agent start
```

### Health and logs

```bash
curl -s localhost:4000/healthz
curl -s localhost:4000/readyz
```

Production deployment guidance, systemd unit, backup/restore and troubleshooting are in `docs/runbook.md`.

---

## 14. Known gaps, defects and documentation drift

### 14.1 Critical: dev commands are broken as shipped

Observed on Node `v20.20.2`:

- `pnpm dev:api` runs `node --watch src/index.ts` and fails with
  `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"`.
- `pnpm dev:agent` fails the same way.
- `pnpm dev:web` has no `dev` script; `apps/web/package.json` only defines `build`.

The docs and `Mind.md` list `pnpm dev:api` and `pnpm dev:agent` as available commands, and the project brief lists them as required root commands. This is a real defect, not an environment quirk: Node 20 does not strip TypeScript types by default, and neither package has `tsx`/`ts-node`.

Recommended fix (small, no new runtime architecture): add a development runner that compiles once and then watches `dist`, or add `tsx` as a dev dependency and use `tsx watch src/index.ts`. For the agent, the same choice applies. `pnpm dev:web` should either be removed from the root scripts or given a static-server script.

### 14.2 Critical: the static customer checkout cannot complete a payment

The customer page's “Pay now” button does this:

```js
const result = await api('/v1/orders/' + id + '/checkout?token=' + token, { method: 'POST' });
if (!result.shortUrl) throw new Error('Payment link missing');
location.href = result.shortUrl;
```

But `PaymentService.createCheckout` returns `razorpayOrderId`, `amountPaise`, `currency`, `keyId`, `orderToken`, `publicToken` and `orderId`. It never returns `shortUrl`. In simulated mode the page also does not call `/v1/orders/:id/fake-pay`, and in Razorpay mode it does not load Razorpay Checkout or use the returned order fields. Consequently, clicking “Pay now” fails with “Payment link missing”.

The API-level web-order tests pass because they call `fake-pay` directly or exercise webhooks, not this page. The WhatsApp payment-link flow is separate and does return a real/simulated `shortUrl`. Fix options: add Razorpay Checkout to the page, return a payment-link URL from checkout, or wire the simulated page to `fake-pay`/`/pay/:linkId`. This must be fixed before claiming the web UI is end-to-end.

### 14.3 `.env` is not loaded locally

`apps/api/src/config.ts` reads `process.env` only. `docs/runbook.md` says `cp .env.example .env`, but no code loads that file. Local users must export variables or run Node with `--env-file=.env` (not currently wired into any script). Production systemd uses `EnvironmentFile`, so the production path is unaffected.

### 14.4 Postgres has no seed or onboarding path

The memory repository seeds a demo shop/owner; the Postgres repository does not. There is no admin route, CLI or seed script to create the first shop, owner and rate card. A fresh production database is unusable until rows are inserted manually. This must be solved before a real pilot deployment.

### 14.5 No malware scanning

`apps/api/src/routes/public.ts` and `apps/api/src/whatsapp/conversation.ts` set `scanStatus: 'clean'` unconditionally. There is no ClamAV integration, despite references in `implementation.md`, `Mind.md` and the runbook. Accepting Office/PDF uploads in production without scanning is a risk.

### 14.6 Agent version mismatch and unused minimum-version handshake

- `apps/agent/src/index.ts` declares `AGENT_VERSION = '0.2.0'`.
- `apps/agent/package.json` declares version `0.1.0`.
- The agent reads `message.config.minAgentVersion`, but `apps/api/src/websocket-gateway.ts` never sends it.

Version negotiation is therefore dead code. Pick one source of truth and populate `minAgentVersion` from server config if enforcement is intended.

### 14.7 WhatsApp template-failure logging is overstated

`implementation.md` §21.4 says a missing template “logs `template_required` and is skipped.” The notifier has no such log. It retries a failing send three times, then logs a generic `[Notifier] ... failed after 3 attempts`. Optional in-window-only events (`printing`) are silently skipped outside the window after the notification row is already recorded. The docs should be corrected or the logging should be implemented.

### 14.8 WhatsApp `REPEAT` has no automated test

`handleRepeat` exists and is reachable from the conversation, but no test exercises it. It copies the first item's settings and starts a new file prompt. Given its role in reordering, it needs a dedicated test.

### 14.9 Multi-file WhatsApp orders share one settings set

When a file is added or options are changed, `priceOrder(orderId, settingsOverride)` applies the same settings to every item in the order. This is a deliberate simplification but not obvious to the customer: adding a second file and changing colour/sides re-prices the first file too. Either document it clearly or support per-item settings.

### 14.10 Customer UI is not a PWA

`Mind.md` calls it a “Customer PWA”, but there is no manifest, service worker, offline support or install prompt. It is a responsive static page. Rename it in docs or implement the PWA pieces.

### 14.11 Single-instance assumptions

- Rate limits live in process memory.
- Connected agents and WebSocket state live in process memory.
- The reconciliation cron runs in every API process; multiple instances would race.
- Redis is defined in `infra/docker-compose.yml` but unused.

This is acceptable for a single-shop/single-VPS pilot. Scaling horizontally requires a shared limiter, a shared agent-presence mechanism and leader election or a distributed scheduler.

### 14.12 Live integrations and hardware remain unverified

No real credentials or hardware were available for:

- Meta WhatsApp Cloud API, media download and approved templates;
- Razorpay order/payment-link creation, UPI payment and webhook delivery;
- Postgres with real data and concurrent connections;
- Windows agent installation, Scheduled Task, SumatraPDF and real printer drivers;
- CUPS printing and `lpstat` status;
- LibreOffice conversion;
- ClamAV scanning.

These are correctly labelled 🟡/⬜ in this report and must not be treated as production-proven.

### 14.13 Smaller observations

- `FILE_URL_SECRET` is read directly in `storage.ts` but is not part of `AppConfig`, so it is not validated or documented with defaults.
- `SENTRY_DSN` is stored but no Sentry SDK is initialized.
- The shop analytics endpoint is basic; there is no admin console or multi-shop operator view.
- The data directory contains generated uploads/previews from earlier local runs under `apps/api/data/`; these are runtime artefacts, not source.
- `prompt.md` is untracked and contains an absolute-path example. It should stay out of version control.
- CI does not run the dev commands, so their breakage was not caught.

---

## 15. Production readiness checklist

Before a real pilot, complete these in order:

1. **Fix `pnpm dev:api` / `pnpm dev:agent`** and add a smoke check to CI.
2. **Add a first-shop provisioning path** for Postgres (seed script or admin CLI).
3. **Run the Postgres contract suite** against a disposable database:
   `TEST_DATABASE_URL=... pnpm --filter @chhaap/db test`.
4. **Install and verify Ghostscript, poppler, LibreOffice and ClamAV** on the target host; replace the hard-coded `scanStatus: 'clean'` with real scanning.
5. **Register the Meta app**, configure the webhook, approve utility templates, and test media download and 24-hour-window behaviour.
6. **Configure Razorpay**, create a real payment link and order, deliver `payment.captured`/`payment_link.paid` webhooks, and test refunds.
7. **Package and test the Windows agent** on shop hardware with SumatraPDF, including crash/restart and duplicate-print scenarios.
8. **Verify CUPS printing** on the pilot Linux box, including paper sizes, duplex and colour.
9. **Decide the deployment topology.** For one API instance, document that rate limits and agent presence are in-process. For more than one, add Redis-backed coordination and a single reconciliation leader.
10. **Add a real PWA manifest/service worker** or stop calling the customer UI a PWA.
11. **Correct the documentation drift** in §14.5–§14.9 and add the missing `REPEAT` test.
12. **Set production secrets** (`JWT_SECRET`, peppers, `FILE_URL_SECRET`, Razorpay and WhatsApp credentials) outside the repository and verify the boot guards with `NODE_ENV=production`.
13. **Exercise the full web and WhatsApp flows** on staging, including file deletion, opt-out, closed shop, printer offline, payment failure and refund.

---

## 16. Next actions

### Immediate (before more feature work)

- Fix the dev scripts.
- Fix the static customer checkout handoff.
- Add Postgres onboarding/seed.
- Either implement malware scanning or explicitly reject Office uploads and document the risk.
- Correct `Mind.md` and the docs for the dev commands, ClamAV, template logging, agent version and PWA claim.

### Then (pilot hardening)

- Live Meta sandbox/production test with approved templates.
- Live Razorpay test-mode webhook and UPI payment.
- Windows agent packaging and hardware print test.
- Staging deployment with Postgres, HTTPS, backups and log shipping.
- Add tests for `REPEAT`, multi-file WhatsApp orders, agent ledger recovery and driver selection.

### Later (post-pilot)

- Redis-backed rate limiting and presence.
- Real PWA/offline support.
- Admin console and shop onboarding UI.
- Object storage instead of local disk.
- Observability integration (Sentry/metrics) and alerting.
- Multi-shop analytics and subscription billing.

---

## 17. Commit history relevant to this state

| Commit | Summary |
|---|---|
| `c1bc73f` | Walking skeleton implementation for Chhaap QR-to-print automation |
| `a9e3a8b` | Update `Mind.md` for Phase 1 completion |
| `3c85146` | Persistent Postgres repository and hardened contracts |
| `2c07a37` | Secure order pipeline and WhatsApp channel |
| `fc522b9` | Agent driver abstraction, crash-safe ledger and Windows packaging |
| `d3fd12d` | Phase 2 delivery, WhatsApp go-live and operations docs |
| `a2dec1c` | Final Phase 2 verification results |
| `bd4c085` | Ignore the local pnpm wrapper |

The working tree at snapshot time contained only the untracked `prompt.md` before this report was added. `prompt.md` should remain untracked.

---

## 18. Bottom line

The repository contains a coherent, test-backed Phase 2 implementation of the core print loop and a mock-verified WhatsApp channel. The strongest parts are the server-side money invariants, tenant isolation, payment-webhook verification, upload validation, persistent deletion, agent crash safety and the offline demo. The weakest parts are the broken development commands, the missing Postgres onboarding path, the absent malware scanner, and the fact that every real external integration and hardware path is still unverified.

A new model should treat the code and the 58 passing tests as the reliable baseline, use §14 as the list of things not to claim, and start with §16 before adding features.
