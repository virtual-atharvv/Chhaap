# IMPLEMENTATION.md — Chhaap (working name): QR-to-Print Automation SaaS for Stationery Shops

> Working name: **Chhaap** (छाप = "imprint"). Rename freely; nothing below depends on it.
> Companion file: `Mind.md` (living progress log). **Any AI/dev must read `Mind.md` first, then this file.**

---

## 0. One-Line Thesis

**Turn every photocopy/stationery shop into an unattended, 24x7, cashless print kiosk — customer scans QR, uploads, pays, the shop's own printer prints. Zero WhatsApp-forwarding, zero pen-drives, zero cash handling, zero queue arguments.**

### Why this wins (the real pain, not the imagined one)
| Today (shop owner) | Today (customer) |
|---|---|
| Files arrive via WhatsApp/Bluetooth/pen-drive, owner's PC becomes a malware swamp | Waits in a queue, explains settings verbally ("dono side, black white, 2 copy") |
| Manual page counting → billing errors → revenue leakage | Doesn't know the final price until the end |
| Cash/UPI screenshot fraud, fake "payment done" screens | Files left on shop's PC = privacy risk (Aadhaar, marksheets) |
| Owner is blocked at the counter doing data-entry instead of selling | Shop closes → no printing |

**Your moat is not "upload + pay". That is a weekend project. Your moat is:**
1. **Reliability of the print agent** (the boring, hard part).
2. **Exact billing** (per-page colour detection, so shops never lose money).
3. **Trust** (files auto-deleted, provable privacy).
4. **Distribution** (campus + locality-level QR standees, shop-owner network effects).

---

## 1. Product Scope

### 1.1 Actors
- **Customer** — no login, no app. Scan QR → web PWA.
- **Shop Owner/Operator** — dashboard: live queue, earnings, rates, printer health.
- **Platform Admin (you)** — onboarding, payouts, fraud, support, analytics.
- **Print Agent** — software on the shop's PC; the bridge between cloud and physical printer.

### 1.2 MVP (Phase 1 — ship in ~4–6 weeks)
- Per-shop QR → `https://chhaap.app/s/{shopSlug}`
- Upload: PDF, JPG/PNG/WEBP/HEIC, DOCX, PPTX, XLSX (converted to PDF server-side)
- Settings: B&W / Colour / Auto-detect, copies, single/double-sided, page range, paper size (A4/A3/Legal), orientation, pages-per-sheet (1/2/4/6/9), fit/fill
- Live **WYSIWYP preview** (what you see = what prints)
- Real-time price quote
- Razorpay payment (UPI-first)
- Auto-print via agent, status tracking (queued → printing → done / failed)
- Pickup token (e.g. `B-047`) + optional WhatsApp/SMS receipt
- Shop dashboard (queue, rates, earnings, printer status)
- Auto-delete files after print (default: 15 min) + hard TTL (24 h)

### 1.3 Phase 2 — Retention & Revenue
- Subscription billing for shops (Razorpay Subscriptions)
- Multi-printer routing (colour printer vs mono laser vs A3)
- Binding/lamination/spiral add-ons ("finishing services") with manual-fulfil queue
- Coupons, student pricing, bulk/B2B accounts, shop wallet
- GST invoices, daily/weekly settlement reports
- WhatsApp notifications (Cloud API)
- Refund automation

### 1.4 Phase 3 — Moat & Scale
- Multi-shop chains / franchise console, white-label
- Kiosk mode (tablet at the shop with built-in QR + walk-in flow)
- Passport photo / ID card / Aadhaar-layout / resume templates (high-margin micro-products)
- Marketplace: nearby shops, open/closed status, queue time estimate
- Toner/paper analytics ("toner low in ~900 pages")
- Campus integration (college accounts, department billing, exam-season surge mode)
- API for third parties (colleges, coaching institutes)

### 1.5 Explicit Non-Goals (for MVP)
Native mobile apps, user accounts for customers, in-house payment gateway, OCR/editing of documents, printing from the shop's own device inventory, dynamic pricing ML.

---

## 2. Business Model (Think Like an Owner)

### 2.1 Revenue streams
| Stream | Model | Notes |
|---|---|---|
| **SaaS subscription** | Monthly/annual per shop | Predictable MRR, the core |
| **Transaction fee** | 1–2% (or ₹0.25–0.50 min) per order, on top of gateway fee | Scales with shop success |
| **Add-ons** | WhatsApp notifications, multi-printer, analytics, white-label | Upsell ladder |
| **QR standee / kit** | One-time ₹299–₹999 printed acrylic standee + onboarding | Cash-positive, brand visibility |
| **Hardware (later)** | Pre-configured mini-PC/Raspberry-class "Chhaap Box" | Only after PMF |

### 2.2 Suggested plans (validate with 10 shop owners before fixing)
| Plan | Price | Includes |
|---|---|---|
| **Starter** | ₹0 + 3% txn fee | 1 printer, 150 orders/mo — *land-grab for adoption* |
| **Growth** | ₹499/mo (+1.5% txn) | 1 printer, unlimited orders, dashboard, receipts |
| **Pro** | ₹999/mo (+1% txn) | 3 printers, routing, WhatsApp, GST invoices, analytics |
| **Chain** | ₹2,999+/mo | Multi-shop, roles, white-label, API |

**Strategy:** Free tier is a trojan horse. The shop owner sees ₹3,000+/month of previously leaked/unbilled revenue → upgrades himself.

### 2.3 Unit economics sanity (run the numbers early)
- Gateway cost (Razorpay UPI ≈ 0–2%, cards ≈ 2%) — **model it per ticket size**; a ₹6 order loses money on percentage + flat fees. → **Set a minimum order value** (e.g. ₹10) or a small convenience fee (₹1–2) paid by the customer.
- Infra per shop ≈ ₹15–60/mo at MVP scale (R2 + small VPS share). Gross margin should exceed 85% on paid plans.
- Target: **CAC < 2 months of subscription revenue** (door-to-door in campuses keeps CAC near ₹0).

### 2.4 Go-To-Market (the actual unfair advantage for a Lucknow founder)
1. **Beachhead:** 5 shops around AKTU/BIET/Lucknow university clusters. Install personally. Free for 60 days.
2. **Proof:** Daily screenshots of orders/revenue; one case study ("Shop X: +22% revenue, 0 file leaks").
3. **Demand-side hook:** QR standee on shop counter + sticker on campus notice boards: *"Print without the queue."*
4. **Exam-season spike:** Assignment/exam-week = peak volume → onboard shops 3 weeks prior.
5. **Referral loop:** Shop owner brings another shop → 1 month free each.
6. **Expand** by campus → city → tier-2 cities. Do not go national until one city runs on repeat.

---

## 3. System Architecture

```
┌───────────────┐    scan     ┌──────────────────────────────┐
│  Customer PWA │────────────▶│  Edge (Cloudflare Pages/CDN) │
│ (Next.js)     │             └──────────────┬───────────────┘
└──────┬────────┘                            │ API (HTTPS)
       │ signed upload (direct)              ▼
       │                      ┌──────────────────────────────┐
       ▼                      │ API Server (Node/Fastify)    │
┌───────────────┐             │  - Orders, Pricing, Auth     │
│ Object Store  │◀────────────│  - Razorpay webhooks         │
│ (R2/S3)       │             │  - Job state machine         │
└──────┬────────┘             └───┬───────────┬──────────────┘
       │                          │           │
       │                  ┌───────▼───┐  ┌────▼─────────┐
       │                  │ Postgres  │  │ Redis/Queue  │
       │                  │(Neon/Supa)│  │ (BullMQ)     │
       │                  └───────────┘  └────┬─────────┘
       │                                      │ workers: convert, preview,
       │                                      │ page-count, colour-detect, virus-scan
       │      WebSocket (outbound from shop)  │
       │     ┌────────────────────────────────┘
       ▼     ▼
┌───────────────────────────────────┐
│ Print Agent (on shop PC)          │──▶ Spooler (CUPS / Windows) ──▶ 🖨️ Printer
│ - pulls job, downloads file       │
│ - applies settings, prints        │
│ - reports status/printer health   │
└───────────────────────────────────┘
```

### 3.1 Golden Architectural Principles
1. **Outbound-only from the shop.** Agent opens a WebSocket *to the cloud*. No port forwarding, no static IP, no firewall pain. (This is non-negotiable for Indian shop networks.)
2. **Pay-before-print invariant.** A job can transition to `QUEUED` **only** from a verified, signature-checked payment webhook. Never trust the client redirect.
3. **Idempotency everywhere.** Webhooks retry; agents reconnect. Every mutating call carries an idempotency key.
4. **Server decides price.** The client never sends a price. Server recomputes from file analysis + shop rates.
5. **Files are toxic waste.** Minimise retention, encrypt, scan, delete.
6. **Agent is dumb, cloud is smart.** Agent should be a thin executor so it rarely needs updating (shops will not update software).
7. **Degrade gracefully.** Printer offline → customer told *before* paying, or auto-refund.

### 3.2 Recommended Stack
| Layer | Choice | Why |
|---|---|---|
| Customer UI | **Next.js (App Router) + Tailwind**, PWA, deployed on **Cloudflare Pages** | Fast on cheap Android phones, matches your existing infra habits |
| API | **Node.js + Fastify + TypeScript** (or NestJS if you want structure) | Fast, typed, huge ecosystem |
| DB | **PostgreSQL** (Neon / Supabase) + **Drizzle/Prisma** | Relational money data needs ACID |
| Queue | **Redis + BullMQ** | Conversion/preview jobs, retries, delays |
| Storage | **Cloudflare R2** (S3-compatible, zero egress) | Cheap; signed URLs; lifecycle TTL rules |
| Payments | **Razorpay** (Orders, Webhooks, Subscriptions, Route for payouts) | UPI-first, India-native |
| Realtime | **WebSocket (ws / Socket.IO)** agent↔cloud; SSE for customer status | Simple, firewall-friendly |
| Doc conversion | **LibreOffice headless** in a sandboxed container | DOCX/PPTX/XLSX → PDF |
| PDF tooling | **qpdf, Ghostscript, poppler-utils, pdf-lib, sharp** | Sanitise, count, colour detect, render previews |
| Malware | **ClamAV** (clamd) | Upload scanning |
| Agent | **Node (pkg/Electron tray app) or Python + PyInstaller** | Windows .exe installer is key; shops run Windows |
| Print exec | **SumatraPDF CLI** (Windows), **CUPS `lp`** (Linux/macOS) | Reliable silent printing with options |
| Observability | **Sentry + Better Stack/Grafana + Uptime checks** | You must know before the shop owner calls |
| Notifications | **WhatsApp Cloud API / MSG91 / Gupshup** | Receipts, "ready" pings |
| CI/CD | **GitHub Actions**, Railway/Fly/Hetzner for API | Cheap and fast |

> Honest recommendation: **a single Hetzner/Railway box + managed Postgres + R2** carries you to the first 100 shops. Do not touch Kubernetes.

---

## 4. Data Model (PostgreSQL)

```sql
-- Tenancy
shops(id, slug UNIQUE, name, owner_id, city, phone, gst_no NULL,
      status ENUM('pending','active','suspended'), plan_id, created_at)
users(id, email UNIQUE, phone, name, role ENUM('owner','staff','admin'), password_hash, created_at)
shop_members(shop_id, user_id, role)

-- Devices
agents(id, shop_id, name, token_hash, version, last_seen_at, os, status)
printers(id, shop_id, agent_id, system_name, display_name,
         capabilities JSONB,   -- {color:true, duplex:true, papers:['A4','A3'], dpi:600}
         status ENUM('online','offline','paper_out','error','busy'), last_status_at)

-- Pricing
rate_cards(id, shop_id, printer_id NULL, paper_size, color_mode, sides,
           price_per_page_paise INT, min_order_paise INT)
addons(id, shop_id, type ENUM('spiral','lamination','staple','binding'), price_paise)

-- Orders
orders(id UUID, shop_id, token VARCHAR(8),   -- human pickup code 'B-047'
       customer_phone NULL, customer_email NULL,
       status ENUM('draft','awaiting_payment','paid','queued','printing',
                   'completed','failed','refunded','expired'),
       subtotal_paise, fee_paise, gst_paise, total_paise, currency DEFAULT 'INR',
       idempotency_key UNIQUE, created_at, paid_at, completed_at, expires_at)

order_items(id, order_id, file_id, settings JSONB, page_count, colour_pages INT,
            bw_pages INT, sheets INT, line_total_paise, printer_id NULL)

files(id, order_id, storage_key, original_name, mime, size_bytes, sha256,
      scan_status ENUM('pending','clean','infected','failed'),
      converted_pdf_key, preview_keys JSONB, delete_after TIMESTAMPTZ, deleted_at)

-- Payments
payments(id, order_id, razorpay_order_id UNIQUE, razorpay_payment_id UNIQUE NULL,
         status, method, amount_paise, signature_verified BOOL, raw JSONB, created_at)
refunds(id, payment_id, amount_paise, reason, status, razorpay_refund_id)

-- Print jobs
print_jobs(id, order_item_id, printer_id, status ENUM('pending','dispatched','printing','done','failed','cancelled'),
           attempts INT, last_error, dispatched_at, finished_at)

-- SaaS billing
plans(id, name, price_paise, limits JSONB, txn_fee_bps)
subscriptions(id, shop_id, plan_id, razorpay_sub_id, status, current_period_end)

-- Audit & events
events(id, order_id NULL, shop_id NULL, type, payload JSONB, created_at)  -- append-only
webhook_events(id, provider, event_id UNIQUE, payload, processed_at)      -- dedupe
```

**Indexes:** `orders(shop_id, status, created_at)`, `print_jobs(printer_id, status)`, `files(delete_after) WHERE deleted_at IS NULL`.
**Row-Level Security** (if on Supabase) or strict `shop_id` scoping in every query — **tenant isolation bugs are the #1 SaaS killer.**

---

## 5. Core Flows

### 5.1 Customer Order Flow
1. Scan QR → `/s/{slug}` → API returns shop status (open/closed, printer online?, rates).
2. **Pre-flight:** If no printer is online → show *"Shop's printer is offline"* and block payment. (Never take money you can't fulfil.)
3. Upload via **signed direct-to-R2 URL** (chunked for large files, show progress).
4. Worker pipeline: `virus-scan → sanitise → convert-to-PDF → page-count → per-page colour detect → render previews`.
5. Customer configures settings; **price recalculates live** from server.
6. Customer enters phone (optional but recommended, for receipt/ready ping).
7. Server creates `order` + Razorpay order (amount from server).
8. Razorpay checkout (UPI intent/QR preferred on mobile).
9. **Webhook `payment.captured`** → verify signature → idempotent transition `awaiting_payment → paid → queued`.
10. Dispatcher pushes job to the agent over WebSocket.
11. Agent downloads (signed URL), prints, streams status back.
12. Customer screen (SSE) shows: *Paid ✓ → Printing → Ready — Token B-047*.
13. File deletion job fires (15 min after completion).

### 5.2 Order State Machine (enforce in code, one place)
```
draft → awaiting_payment → paid → queued → printing → completed
                │             │       │         └──▶ failed → (retry ≤3) → refunded
                └──▶ expired  └── (printer dead) ─▶ refunded
```
Transitions live in a single `OrderService.transition(from, to, actor)` with DB-level `WHERE status = :from` optimistic guards.

### 5.3 Agent Protocol (JSON over WebSocket)
```
Agent → Cloud : hello {agentId, token, version, printers:[...]}
Cloud → Agent : ack {serverTime, config}
Cloud → Agent : job.dispatch {jobId, fileUrl(signed, 5min), sha256, settings, printerId}
Agent → Cloud : job.accepted {jobId}
Agent → Cloud : job.progress {jobId, state:'spooling'|'printing'}
Agent → Cloud : job.result {jobId, ok, pagesPrinted, error?}
Agent → Cloud : printer.status {printerId, status, supplies?}
Both          : ping/pong every 20s; reconnect with exponential backoff + jitter
```
- On reconnect, agent sends its **unfinished job list**; cloud reconciles (prevents double-print or lost jobs).
- Verify **sha256** of downloaded file before printing.
- **Duplicate-print guard:** `jobId` is idempotent; agent persists a small local SQLite/JSON "printed jobs" ledger.

### 5.3.1 Printing Mechanics
- **Windows:** `SumatraPDF.exe -print-to "<printer>" -print-settings "duplex,color,2x,paper=A4,fit" -silent file.pdf`
- **Linux/macOS (CUPS):** `lp -d <printer> -n <copies> -o sides=two-sided-long-edge -o ColorModel=Gray -o media=A4 -o number-up=2 -o page-ranges=1-5 file.pdf`
- Pre-normalise everything to **PDF**; apply imposition (n-up) and page ranges server-side with `qpdf`/`pdf-lib` so the agent just prints a final file. *Printer-driver quirks are your biggest source of bugs — the fewer options the driver must interpret, the better.*
- Colour-mode enforcement: for B&W requests, convert to grayscale with Ghostscript (`-sColorConversionStrategy=Gray`) before dispatch so a colour cartridge never fires accidentally.

---

## 6. Pricing & Billing Engine (Where Shops Make or Lose Money)

### 6.1 Per-page colour detection (god-tier detail)
Customers say "colour" for a 50-page doc with 3 coloured pages. Bill honestly **and** give choice:
- Use Ghostscript `inkcov` device (or render pages + histogram) to classify **each page** as B&W / colour.
- Offer modes: **All B&W**, **All Colour**, **Smart (colour only where needed)** → priced exactly.
- Show: *"47 pages B&W × ₹2 + 3 pages colour × ₹10 = ₹124."* Transparent price builds trust and increases conversion.

### 6.2 Formula
```
sheets = ceil(pages_selected / pages_per_sheet / (duplex ? 2 : 1)) * copies
page_cost = Σ (page_class × rate[paper][class][sides])
subtotal  = page_cost + Σ addons
fee       = platform_convenience_fee (configurable; min ₹1)
gst       = per shop GST config (usually included/ not applied for small shops; make configurable)
total     = max(subtotal + fee + gst, shop.min_order)
```
All values in **paise (integers)**. Never floats for money.

### 6.3 Rate-card UX for shop owners
- Preset: "Standard Indian shop" (A4 B&W ₹2 single / ₹1.5 double; Colour ₹10; A3 ₹10/₹30 ...) editable in 1 minute.
- Bulk-discount tiers (e.g. >100 pages = ₹1.5).
- Time-based pricing (exam rush) — Phase 3.

---

## 7. Payments Architecture

- **Razorpay Orders API**; amount set server-side; `receipt = order.id`.
- **Webhooks:** `payment.captured`, `payment.failed`, `refund.processed`, `subscription.*`. Verify `X-Razorpay-Signature` (HMAC SHA256) on **raw body**; dedupe via `webhook_events.event_id`.
- **Reconciliation cron** (every 5 min): orders stuck in `awaiting_payment` > N min → query Razorpay → fix state. *Webhooks fail. Cron fixes it.*
- **Settlements:** Decide early — (a) money to **platform** then payout to shops (needs Razorpay Route + KYC per shop, gives you the transaction-fee revenue) or (b) shop's own Razorpay account (simpler, harder to monetise). **Recommend (a) with Route**; start with manual weekly UPI payouts for the first 10 shops, automate after.
- **Refund policy automation:** printer failure after payment → auto-refund after 3 failed retries; customer is notified.
- **Subscriptions:** Razorpay Subscriptions for shop plans; grace period (7 days) before feature lock; never lock a shop mid-queue.

---

## 8. Security, Privacy & Compliance (This Is Your Brand)

### 8.1 File Handling
- Signed, short-lived upload and download URLs; objects private by default.
- Encrypt at rest (R2 default) + per-object keys optional later.
- **Allow-list MIME & magic-byte check**; max size (e.g. 50 MB) and page caps.
- Run conversion/ClamAV in **sandboxed containers** (no network, read-only FS, CPU/mem limits, time-out 60s). Office files are an attack surface.
- Sanitise PDFs (`qpdf --linearize` / Ghostscript re-distill) to strip JS/embedded files.
- **Retention:** delete from cloud 15 min after print; agent deletes its local temp copy immediately after spooling; hard lifecycle rule at 24 h as safety net. Surface this promise in the UI: *"Your file is deleted automatically after printing."*
- Password-protected PDFs: prompt for password, decrypt client-side/in-sandbox, never store the password.

### 8.2 Application Security
- Agent auth: per-agent long-lived token (hashed in DB), rotate on demand; mTLS optional later.
- Shop dashboard: email/phone OTP + optional TOTP; short-lived JWT + refresh rotation.
- Rate limiting + Cloudflare Turnstile on upload/order endpoints (stop abuse and print-bombing).
- Strict CORS, CSP, input validation (Zod), parameterised queries only.
- Secrets in env/secret manager; never in the agent binary.
- Tenant isolation tests in CI (try cross-shop access on every endpoint).
- Audit trail (`events`) for every money/state change.

### 8.3 Compliance (India)
- **DPDP Act 2023:** consent notice, purpose limitation, deletion on request, grievance contact, breach process.
- Don't store Aadhaar contents; warn users that sensitive documents are auto-deleted.
- GST-compliant invoices for the SaaS fee; configurable GST for shop receipts.
- Razorpay KYC for shops; keep T&C: shop is the merchant of record for print service.
- Content policy: block illegal content on reports (a simple report + takedown flow).

---

## 9. Reliability Engineering (Where Competitors Die)

| Failure | Mitigation |
|---|---|
| Agent offline | Shop banner + customer block pre-payment; auto-refund if mid-order |
| Printer out of paper/toner/jam | Agent reads spooler state; pauses queue; owner alert (WhatsApp/push) |
| Duplicate prints | Job-ID ledger on agent + idempotent dispatch |
| Partial print (jam at page 30/50) | Record `pagesPrinted`; owner can **reprint remaining range** with one click |
| Power cut / PC restart | Agent as auto-start Windows Service; resumes unfinished jobs |
| Corrupt/odd fonts in DOCX | Always show the **converted PDF preview** to the customer before paying |
| Huge/slow uploads on 4G | Chunked resumable upload; client-side image downscale (>300 DPI unneeded) |
| Webhook lost | Reconciliation cron |
| Cloud outage | Agent shows local status; queue persists in cloud; status page |
| Double payment | Idempotency + auto-refund duplicates |

**SLOs to commit to:** order-to-print-start < 15 s (p95), payment webhook processing < 5 s, agent heartbeat gap alert > 60 s, 99.9% API uptime.

---

## 10. Print Agent — Detailed Design

- **Form factor:** signed Windows installer (`.msi/.exe`), tray icon, runs as service, auto-update (rolling channel, forced min version from `hello.ack`).
- **Pairing UX (zero-friction):** Dashboard shows 6-digit pairing code → agent asks for code once → receives token. No terminal, no config files.
- **Printer discovery:** enumerate system printers, read capabilities (duplex/colour/paper), upload to cloud; owner maps them to rate cards.
- **Local safety:** temp dir with restricted permissions, wipe after job; log rotation; no inbound ports.
- **Self-test page:** "Print test page" button from dashboard.
- **Diagnostics bundle:** one click uploads logs for support.
- **Kiosk-lite mode:** optional local status window showing queue + "Reprint" for the owner.
- **Linux/Kali dev loop (for you, as the builder):**
  ```bash
  sudo apt update && sudo apt install -y cups cups-client printer-driver-cups-pdf \
       poppler-utils ghostscript qpdf libreoffice clamav clamav-daemon redis-server
  sudo systemctl enable --now cups
  # virtual PDF printer for testing without paper:
  lpstat -p -d            # list printers
  lp -d PDF -n 1 sample.pdf   # test print → ~/PDF/ folder
  ```
  Develop against **CUPS-PDF** first (no paper wasted), then test on a real printer, then port the Windows (Sumatra) driver layer.

---

## 11. Frontend Specification

### 11.1 Customer PWA (design for a ₹10k Android on 4G)
- **< 120 KB JS** initial, skeleton loaders, offline-tolerant retries.
- 4-screen flow: **Upload → Settings → Review & Pay → Status**.
- Large touch targets; Hinglish/Hindi/English toggle (i18n from day one).
- Page thumbnails with per-page selection, drag to reorder, rotate, crop (image), "colour pages" highlighted.
- Sticky price footer; payment button in thumb-reach zone.
- Status page is a shareable URL (`/o/{orderId}`) → survives refresh; shows token big and bold.
- Add-to-home-screen prompt after first successful order.

### 11.2 Shop Dashboard
- **Live Queue** (drag to prioritise, cancel/refund, reprint, mark collected).
- **Printer Health** card (online, paper, toner if available).
- **Today's Earnings**, orders, pages printed, colour vs B&W split.
- **Rate Card Editor** with live preview.
- **QR Generator** (PDF standee templates, A4/A5 print-ready + sticker sizes).
- **Settlements & Invoices**, staff roles, opening hours, "pause orders" toggle.
- Sound alert on new order (shops are loud and busy).

### 11.3 Admin Console
Shop approvals, agent versions, fraud flags, refund queue, MRR/churn charts, feature flags, support impersonation (audited).

---

## 12. API Surface (REST, versioned `/v1`)

```
Public (customer)
GET   /v1/shops/:slug                      -> shop status, rates, printers online
POST  /v1/uploads/sign                      -> signed upload URL(s)
POST  /v1/orders                            -> create draft order
PATCH /v1/orders/:id/items/:itemId          -> update settings (server re-prices)
POST  /v1/orders/:id/checkout               -> create Razorpay order
GET   /v1/orders/:id/stream                 -> SSE status
POST  /v1/webhooks/razorpay                 -> signature-verified

Shop (JWT)
GET   /v1/shop/queue
POST  /v1/shop/orders/:id/(cancel|refund|reprint|collect)
GET/PUT /v1/shop/rates
GET   /v1/shop/printers  |  POST /v1/shop/agents/pair
GET   /v1/shop/analytics
POST  /v1/shop/billing/subscribe

Agent (token)
WS    /v1/agent/connect
POST  /v1/agent/jobs/:id/result  (fallback HTTP)

Admin
/v1/admin/*   (shops, payouts, flags, audit)
```
Document with **OpenAPI**; generate typed client SDKs for web + agent.

---

## 13. Repo Structure (Monorepo — pnpm + Turborepo)

```
chhaap/
├─ apps/
│  ├─ web/            # Next.js: customer PWA + shop dashboard + admin
│  ├─ api/            # Fastify API + WebSocket gateway
│  ├─ worker/         # BullMQ workers: convert, scan, preview, colour-detect, cleanup
│  └─ agent/          # Print agent (Node/Electron or Python)
├─ packages/
│  ├─ db/             # schema, migrations, seeds
│  ├─ pricing/        # pure pricing engine (heavily unit-tested)
│  ├─ shared/         # zod schemas, types, protocol definitions
│  └─ ui/             # shared components
├─ infra/             # docker-compose, Dockerfiles, terraform (later), CI
├─ docs/              # ADRs, runbooks
├─ Mind.md            # ← living progress file (AI-readable)
└─ implementation.md  # ← this file
```

---

## 14. Phased Roadmap (Execution Order)

### Phase 0 — Validate (Week 0–1) 🧪
- [ ] Visit 10 shops; record real workflows, rates, printer models, OS, internet quality.
- [ ] Pre-sell: get 3 owners to commit to a pilot (signed WhatsApp message is enough).
- [ ] Choose name/domain; set up repo, CI, environments (dev/staging/prod).
- [ ] Decide settlement model (Route vs shop-owned Razorpay).

### Phase 1 — Walking Skeleton (Week 1–2) 🦴
End-to-end *ugly* flow with CUPS-PDF: upload PDF → fixed price → fake payment → agent prints to PDF.
- [ ] Monorepo, DB schema, auth for shop.
- [ ] Signed uploads, PDF page-count.
- [ ] Agent ↔ WebSocket ↔ dispatch ↔ CUPS print.
- [ ] Order state machine + events table.

### Phase 2 — Real MVP (Week 3–6) 🚀
- [ ] Pricing engine + colour detection + previews.
- [ ] DOCX/PPTX/XLSX/image conversion, ClamAV, sanitisation.
- [ ] Razorpay Orders + webhooks + reconciliation cron + refunds.
- [ ] Customer PWA polish, SSE status, pickup token.
- [ ] Shop dashboard (queue, rates, QR generator, printer health).
- [ ] Windows agent installer + pairing code + auto-start + auto-update.
- [ ] Retention/deletion jobs; privacy page; T&C.
- [ ] Sentry/uptime/logs.

### Phase 3 — Pilot (Week 6–10) 🏪
- Install at 3–5 shops; daily check-ins; fix every papercut; track KPIs (below).
- Chaos tests: unplug printer, kill internet, jam simulation, double-click pay.

### Phase 4 — Monetise (Week 10–16) 💰
- [ ] Subscriptions + plan limits + transaction fee ledger.
- [ ] Razorpay Route payouts, GST invoices, settlement reports.
- [ ] WhatsApp notifications, coupons, multi-printer routing.

### Phase 5 — Scale (Month 5+) 📈
- Chain console, white-label, API, kiosk mode, photo/ID-card templates, campus programmes, referral engine.

---

## 15. Testing Strategy

- **Unit:** pricing engine (property-based tests: price never negative, monotonic with pages, paise integers), state machine, signature verification.
- **Integration:** webhook replay/duplication, concurrent status transitions, tenant isolation on every route.
- **E2E (Playwright):** full customer flow with Razorpay test mode.
- **Agent tests:** simulated printer (CUPS-PDF) + fault injection (kill spooler, corrupt file, hash mismatch).
- **Fixture corpus:** 200 nasty real-world files (scanned PDFs, 500-page decks, weird fonts, rotated pages, HEIC from iPhones, password-protected PDFs, zip-bombs, malformed PDFs).
- **Load:** 200 concurrent uploads, 50 simultaneous orders per shop in exam rush (k6).
- **Chaos:** randomly drop WS connections during print.

---

## 16. KPIs & Analytics

| Category | Metric |
|---|---|
| Activation | % of shops printing first paid order within 24 h of install |
| Conversion | Scan → upload → paid funnel (target >60% upload→paid) |
| Reliability | Print success rate (>99%), median order-to-print time, refund rate (<1%) |
| Revenue | MRR, ARPU, txn-fee revenue, churn (<3%/mo), LTV:CAC (>3) |
| Product | Avg pages/order, colour share, repeat customers/week |
| Ops | Agent uptime, support tickets per 100 orders |

Instrument with PostHog/Plausible (privacy-friendly), plus SQL views for your own dashboards.

---

## 17. Competitive & Defensibility Notes

- **Threats:** Existing campus print-kiosk startups, "PrintShop" WhatsApp-bot hacks, shop-owner DIY with Google Forms.
- **Defence:** (1) Reliability agent (hard to copy well), (2) exact per-page billing, (3) shop-side workflow & analytics (switching cost), (4) local relationships/distribution, (5) data on demand patterns → pricing intelligence.
- **Later flywheel:** more shops → better coverage → more customers scan "Chhaap" brand everywhere → shops *need* to be on the network (marketplace effect).

---

## 18. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Printer driver chaos on Windows | High | Normalise to PDF, SumatraPDF, test on top-10 Indian printer models (HP, Canon, Epson, Brother) |
| Shop owners non-technical | High | 1-click installer, pairing code, WhatsApp support, video onboarding in Hindi |
| Low-ticket orders vs gateway fees | Medium | Min order + convenience fee, UPI-first |
| Fraud / abusive uploads | Medium | Turnstile, rate limits, content reporting, payment-before-print |
| Privacy incident | Critical | Auto-delete, sandboxing, minimal retention, audit logs |
| Single-city dependence | Medium | Expand deliberately after repeatability |
| Founder bandwidth (college + other projects) | High | Strict MVP scope, weekly milestones tracked in `Mind.md`, automate ops early |

---

## 19. Definition of Done (MVP Launch Checklist)

- [ ] 20 consecutive real orders at a pilot shop with 0 manual intervention
- [ ] Print success ≥ 99%; every failure auto-refunded or retried
- [ ] Webhook + reconciliation proven under duplicate/lost events
- [ ] Files verifiably deleted (automated test + weekly audit)
- [ ] Tenant-isolation test suite green
- [ ] Agent survives reboot, network loss, and printer unplug
- [ ] Privacy policy, T&C, refund policy published
- [ ] Runbooks: "agent offline", "stuck order", "refund failed", "printer jam"
- [ ] Backups + restore drill done once
- [ ] `Mind.md` fully up to date

---

## 20. Working Agreement for Humans & AI Models

1. **Always read `Mind.md` first.** It is the single source of truth for *current state*.
2. **This file (`implementation.md`) is the *plan*; `Mind.md` is the *reality*.** If they diverge, log it in `Mind.md` → "Decisions & Deviations".
3. After **every meaningful work session**, update `Mind.md` (status, checklist, changelog, next actions).
4. Never store secrets in either file. Reference env var *names* only.
5. Prefer small, shippable increments; keep `main` always deployable.
6. Money, state transitions, and deletion logic require tests before merge.

---

---

## 21. Phase 2 Delivery Model & WhatsApp Channel (implemented)

This section records the design that was actually built in Phase 2. It
supplements, and where noted supersedes, the earlier Phase 1 plan.

### 21.1 Delivery model

| Piece | Form | Who uses it | Why |
|---|---|---|---|
| Cloud platform | Fastify API + static Customer PWA + Shop Dashboard + WhatsApp bot | Customers, shop owners, admin | Zero install for customers; owner works from any device |
| Print Agent | Small Windows background app/Scheduled Task (Linux/CUPS for dev) | Runs unattended on the shop PC | Browsers cannot silently print; an agent drives the local spooler |

One order pipeline serves both channels. `orders.channel` is `web` or
`whatsapp`; pricing, payment verification, job dispatch and deletion are
shared. The agent remains intentionally dumb: it receives a signed PDF,
verifies SHA-256, prints, and reports status.

### 21.2 WhatsApp entry and conversation

1. The counter QR opens `https://wa.me/<WHATSAPP_PLATFORM_NUMBER>?text=PRINT%20<shopSlug>`.
2. The webhook validates `X-Hub-Signature-256` on the exact raw body, responds
   `200` immediately, then processes asynchronously.
3. `PRINT <slug>` binds the customer's `wa_id` to a shop for
   `WA_SESSION_TTL_MINUTES` (default 30). Pre-flight checks shop/printer state
   before accepting a file.
4. Sessions are persisted in `wa_sessions` and every transition is idempotent
   against duplicate `wamid`s. Conversation states:
   `AWAITING_FILE → CONFIGURING → REVIEW → AWAITING_PAYMENT → TRACKING → DONE`.
5. Media is downloaded immediately from Meta, then normalised through the same
   upload validation, page count, colour classification and preview pipeline as
   web uploads.
6. The bot only displays server-computed totals. Typing “paid” never changes
   payment state; only a verified Razorpay webhook moves an order to `queued`.

### 21.3 Provider abstraction

`WhatsAppProvider` has `sendText`, `sendButtons`, `sendList`, `sendDocument`,
`sendTemplate`, `downloadMedia`, and `markRead`.

- `CloudApiProvider`: Graph API calls using `WHATSAPP_API_VERSION`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`; two-step media download;
  bearer-auth redirect handling; bounded payload sizes.
- `MockWhatsAppProvider`: records every outbound message and stores media in
  memory. Default in development/test; powers `pnpm demo:whatsapp`.
- `WHATSAPP_MODE=mock|cloud`; cloud refuses to boot without all required
  credentials, and production refuses mock.

### 21.4 Payments and notifications

- Web checkout creates a Razorpay order; WhatsApp creates a UPI-first Payment
  Link with `reference_id = order.id` and `expire_by = now + 15 min`.
- Both `payment.captured` and `payment_link.paid` converge on one idempotent
  handler. Amount and currency are re-checked; event IDs are deduplicated in the
  database; raw-body HMAC is timing-safe.
- Settings are frozen once checkout creates a payment intent, so the Razorpay
  amount can never drift from the order total.
- Customer notifications are triggered by order state events
  (`paid`, `printing`, `completed`, `failed`, `refunded`), deduplicated per
  `(order_id, event)`, retried with backoff, and never block printing. Web
  customers receive them only when phone + explicit consent were captured.
- Owner alerts cover printer offline/error, failed orders and a daily summary,
  with debounce and quiet hours. Owner commands are authenticated by the
  verified `wa_id`.
- Outside the 24-hour WhatsApp window, notifications require approved utility
  templates; a missing template logs `template_required` and is skipped.

### 21.5 Shop-owner auth and agent pairing

- `POST /v1/auth/otp/request` and `/verify` implement WhatsApp OTP login.
  OTPs are hashed with `OTP_PEPPER`, expire in 5 minutes, lock after 5 wrong
  attempts, and are rate-limited per phone and IP.
- Access JWT is short-lived and stored in an httpOnly/SameSite cookie; refresh
  tokens rotate and are stored hashed with `REFRESH_TOKEN_PEPPER`.
- Every shop route derives `shop_id` from the JWT, never from a URL/body.
- Agent pairing codes are 6 digits, single-use, expire in 10 minutes, stored as
  SHA-256 hashes, and attempt-limited. Agent tokens are stored hashed with
  `AGENT_TOKEN_PEPPER` and are rotatable.

### 21.6 Delivery deviations from the earlier plan

| Planned | Implemented | Reason |
|---|---|---|
| Separate web app/dev server | Static UI served by the API on one port | Pilot simplicity; no reverse proxy required |
| `@fastify/cookie` | Manual cookie parse/serialise in `auth.ts` | Installed plugin required Fastify 5; avoided a risky framework upgrade |
| Vitest/tsx test runner | `tsc` → `dist-test` → `node --test` | No new dependencies; TypeScript tests run offline |
| Redis/R2 | Local filesystem storage + in-process rate limiters | Pilot scope; storage keys and TTLs are abstraction-friendly |
| Electron tray app | Node agent + PowerShell Scheduled Task scaffold | Smaller install; real Windows packaging remains a human task |
| LibreOffice/ClamAV execution | Optional binary detection + clear errors | Not installed in this environment; see Next Actions |

### 21.7 Verification status

- Automated: memory repository contract, Postgres contract (conditional on
  `TEST_DATABASE_URL`), pricing property tests, web order API, tenant isolation,
  upload validation, deletion after restart, payment webhook hardening,
  reconciliation, rate limits, WhatsApp webhook signature/dedupe, full mock
  WhatsApp order/payment/notification flow, opt-out, session expiry, OTP
  lockout/rate limit, notification failure isolation, `pnpm build`, `pnpm test`,
  `pnpm demo:whatsapp`.
- `UNVERIFIED`: live Meta Cloud API calls, template approval, real Razorpay
  production webhooks, Windows/SumatraPDF/hardware printing, LibreOffice/ClamAV
  conversion/scanning, real Postgres run in this environment (no `psql`/Docker).

---

*Build the boring parts perfectly. Shops don't pay for features — they pay for never having to think about printing again.*
