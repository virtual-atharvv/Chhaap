# PROMPT.md — Phase 2 Master Prompt: Bug-Fix Sweep + WhatsApp Integration (Chhaap)

> **How to use:** Give this file to the coding agent (Antigravity / Claude Code / any AI) together with `Mind.md` and `implementation.md`, with the instruction:
> *"Read Mind.md, then implementation.md (only the relevant sections), then execute prompt.md in the order given. Follow the AI Protocol in Mind.md at the end of the session."*

---

## 0. Your Role & Ground Rules

You are the lead engineer on **Chhaap**, a QR-to-print SaaS for stationery shops. Phase 1 (walking skeleton) exists in the pnpm monorepo. Your job in this session:

1. **Part A — Audit and fix bugs/hardening gaps** in the existing code (reproduce first, fix second).
2. **Part B — Build a fully working WhatsApp integration** (customer ordering over WhatsApp, receipts/status notifications, shop-owner alerts, WhatsApp OTP login).
3. **Part C — Harden the Windows print agent** (design + scaffold; real-hardware testing is a human task).
4. **Part D — Update docs, tests, and `Mind.md`.**

**Non-negotiable rules**
- Read `Mind.md` first. **Trust code over documents**: verify every ✅ in `Mind.md` against the repo; correct any that are false and mark them `UNVERIFIED:` or `🟡`.
- **Reproduce before you fix:** for every bug in Part A, write a failing test first, then fix, then show it green.
- Money is integer **paise**. The **server** computes prices. **Payment webhook (verified) is the only path to `queued`.**
- Never commit secrets. Add new env var *names* to `.env.example` and `Mind.md` §5; never values.
- No absolute machine paths (`/home/elliot/...`) in code, scripts or docs. Provide root scripts: `pnpm build`, `pnpm test`, `pnpm dev:api`, `pnpm dev:agent`.
- Tests must run **without any sandbox bypass** (ephemeral ports, temp dirs, no network except localhost).
- Small, atomic commits with clear messages. Keep `main` green.
- If something is ambiguous, choose the safest sensible default, log it in `Mind.md` §7 (Decisions Log), and continue. Don't stall.
- Dev machine is **Kali Linux**; give shell commands in Kali/Debian form (`apt`, `systemctl`).

---

## 1. Delivery Model (decision — keep consistent everywhere)

Chhaap is **both**, with strictly separate roles:

| Piece | Form | Who uses it | Why |
|---|---|---|---|
| **Cloud platform** | Web app (Fastify API + Customer PWA + Shop Dashboard + WhatsApp bot) | Customers, shop owners, admin | Zero install for customers; owner manages from any device |
| **Print Agent** | Small **Windows** background app/service with tray icon (Linux/CUPS supported for dev) | Runs unattended on the shop PC | Browsers **cannot** silently print to a local printer; an agent must receive jobs and drive the spooler |

The shop owner never "uses the Windows software" day to day; they install the agent once (pairing code), then live in the web dashboard or WhatsApp.

---

## 2. PART A — Bug & Hardening Audit

Work through in priority order. For each item: **(1)** write a failing test that proves the problem, **(2)** fix, **(3)** record in `Mind.md` §9. If an item turns out not to be a bug in the actual code, say so in the report and add a regression test anyway.

### P0 — Must fix (security / money / data-loss)

**A1. Simulated payment must never be reachable in production**
- Symptom (from Mind.md): "instant fake-pay simulation active".
- Fix: `PAYMENTS_MODE=simulated|razorpay`. Server **refuses to boot** if `NODE_ENV=production` and mode is `simulated`. Simulated-pay endpoint is not even registered unless mode is `simulated`. Test both.

**A2. Shop console is unauthenticated**
- `/shop/:slug` and its APIs appear reachable by anyone who knows the slug.
- Fix: shop owner auth (see B11 — WhatsApp OTP; also support email magic-link as fallback). Short-lived JWT in httpOnly+Secure+SameSite cookie, refresh rotation. Every shop API scoped by `shop_id` from the token, **never** from the URL/body. Add a **tenant-isolation test suite** that tries cross-shop access on every shop route.
- Agent pairing codes: 6 digits, single-use, expire in 10 min, stored hashed, attempt-limited. Agent token stored hashed (`AGENT_TOKEN_PEPPER`), rotatable.

**A3. Memory DB is the only live data layer**
- Restart = all orders lost.
- Fix: implement the Postgres repository behind the same interface (use the existing `schema.sql` → real migrations, e.g. Drizzle or plain SQL migrations with a runner). Keep the memory repo **for tests only**. Write **repository contract tests** that run against both implementations. Optimistic status transitions must be a single `UPDATE ... WHERE id=$1 AND status=$2` guard. `docker-compose` brings up Postgres for local dev.

**A4. File deletion relies on in-process timers**
- A restart loses the 15-minute deletion schedule → privacy breach.
- Fix: persist `delete_after` on `files`; a sweeper job (every minute, `SELECT ... WHERE delete_after < now() AND deleted_at IS NULL FOR UPDATE SKIP LOCKED`) deletes bytes then marks `deleted_at`. Hard 24h safety net. Test by simulating a restart.

**A5. Guessable/unauthenticated order tracking**
- Fix: public order identifiers are unguessable (UUIDv4/ULID) **plus** a separate random `public_token` required for the SSE stream and status page. Pickup token (`B-047`) is display-only, never an auth credential.

**A6. Payment webhook hardening**
- Verify HMAC on the **raw body** (not re-serialised JSON), compare with `crypto.timingSafeEqual`, reject stale/replayed events, dedupe by event id in a **DB unique constraint** (not memory), return 200 only after the DB transaction commits, and make the handler fully idempotent (double delivery → single transition).
- Server must re-check `amount` and `currency` from the payload against the order before marking `paid`.

**A7. Upload validation**
- Enforce: max size (50 MB), max pages (configurable), allow-list by **magic bytes** (not just extension/mime), sanitised filenames (no path traversal), unique storage keys (never user-supplied paths), temp dir permissions `0700`, stream to disk (no full buffering), reject encrypted PDFs with a clear message (password flow is Phase 3).
- All external-binary calls (`pdfinfo`, `gs`, `pdftoppm`, later `libreoffice`, `clamdscan`) via `execFile` with **argument arrays** (never shell strings), timeouts, output-size limits, and a concurrency limiter.

### P1 — Should fix (reliability / quality)

**A8. Reconciliation cron** — every 5 min, orders stuck in `awaiting_payment` > N min: query Razorpay, repair state, expire if unpaid after TTL. Also reconcile `queued/printing` jobs whose agent vanished (re-dispatch or fail+refund after 3 attempts).

**A9. Agent reliability (verify; fix what's missing)**
- Reconnect with exponential backoff + jitter; heartbeat/ping every 20 s; server marks agent offline after 60 s of silence and **pre-flight blocks new orders** (web *and* WhatsApp) when no printer is online.
- On reconnect the agent sends its unfinished-job list; server reconciles (no double print, no lost job).
- **Persistent local "printed jobs" ledger** (file/SQLite) so a crash after printing never reprints.
- SHA-256 mismatch ⇒ **do not print**, report `failed: hash_mismatch`.
- Job timeout, spool-error detection, `pagesPrinted` reporting, and a "reprint remaining range" capability on the server.

**A10. Rate limiting & abuse** — per-IP and per-phone limits on upload/order/webhook-adjacent routes; Cloudflare Turnstile hook (feature-flagged) on the web upload; global body-size limits.

**A11. Break up the monolith** — `server.ts` is huge with embedded HTML. Split into route plugins (`routes/public`, `routes/shop`, `routes/agent`, `routes/webhooks`, `routes/whatsapp`), move UIs to static files served from `apps/web` (keep single-port serving for pilot simplicity). No behaviour change; tests must stay green.

**A12. Test & build hygiene** — convert ad-hoc JS tests to TypeScript (vitest or node:test + tsx), run via `pnpm test` at the root, add GitHub Actions CI (install → build → test). E2E must not require sandbox bypass. Remove hard-coded paths and any assumption about the pnpm location/version (**verify the pnpm version claim in Mind.md §6**; fix if wrong).

**A13. Observability** — structured logging (pino) with request IDs and **PII redaction** (phone numbers, file names). `/healthz` and `/readyz`. Optional Sentry via `SENTRY_DSN`.

**A14. Money correctness review** — confirm min-order, convenience fee, GST config, and rounding are applied identically in the quote, the order, the Razorpay amount, and the receipt. Add property tests (monotonic in pages, never negative, `total >= min_order`).

### P2 — Nice to have
A15. OpenAPI spec generated from Zod schemas. A16. i18n scaffolding (en / hi / Hinglish) shared by web and WhatsApp copy. A17. Admin read-only endpoints (shops, agents, failed jobs).

---

## 3. PART B — WhatsApp Integration (the main feature)

### B1. Goals
1. **Order over WhatsApp:** customer scans the shop QR → opens WhatsApp chat → sends a file → chooses options via buttons/lists → pays via UPI link → gets printed, with live status messages.
2. **Notifications for web orders too:** receipt, "printing", "ready — token B-047", failure/refund.
3. **Shop-owner alerts:** printer offline / paper out / daily summary.
4. **WhatsApp OTP login** for shop owners (replaces passwords).

All paths share **one** order pipeline (same pricing engine, same state machine, same agent dispatch). WhatsApp is just another *channel*; add `channel ENUM('web','whatsapp')` to orders.

### B2. Entry flow (multi-shop on one platform number)
- QR on the counter encodes: `https://wa.me/<PLATFORM_NUMBER>?text=PRINT%20<shopSlug>` (and the shop's web URL as a secondary "or use web" option on the standee).
- Inbound text `PRINT <slug>` binds that customer's `wa_id` to the shop for a 30-minute session (`wa_sessions`). Unknown slug → friendly error + help.
- Per-shop dedicated numbers are a Phase 4 upsell; design the code so `phone_number_id` → shop mapping is possible later.

### B3. Provider abstraction (so it works before Meta approval)
```
interface WhatsAppProvider {
  sendText(to, body)
  sendButtons(to, body, buttons[≤3 {id,title}])
  sendList(to, body, buttonLabel, rows[≤10 {id,title,description?}])
  sendDocument(to, urlOrId, filename, caption?)          // receipts as PDF (optional)
  sendTemplate(to, templateName, lang, params[])         // required outside the 24h window
  downloadMedia(mediaId) -> {bytes|stream, mime, sha256?}
  markRead(messageId)
}
```
- `CloudApiProvider` — Meta WhatsApp Business **Cloud API** (Graph API).
- `MockProvider` — records outbound messages in memory/DB and lets tests/dev inject inbound payloads. **Default in dev/test.** `WHATSAPP_MODE=mock|cloud`; refuse to boot `cloud` without all required env vars.
- Put everything under `apps/api/src/whatsapp/` (`provider.ts`, `cloud-provider.ts`, `mock-provider.ts`, `webhook.ts`, `conversation.ts`, `copy.ts`, `templates.ts`, `notifier.ts`), with shared payload schemas in `packages/shared`.

### B4. Webhook (security-critical)
- `GET /v1/webhooks/whatsapp` — verification handshake: check `hub.mode=subscribe` and `hub.verify_token === WHATSAPP_VERIFY_TOKEN`, echo `hub.challenge`.
- `POST /v1/webhooks/whatsapp`
  - Verify header `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(**raw body**, `WHATSAPP_APP_SECRET`), constant-time compare. Reject otherwise (401).
  - **Respond 200 immediately**, then process asynchronously (queue/worker). Meta retries on slow/failed responses.
  - **Dedupe** by message id (`wamid.*`) with a DB unique constraint; statuses by `(wamid, status)`.
  - Handle `value.messages[]` (types: `text`, `document`, `image`, `interactive` → `button_reply` / `list_reply`, `button`) and `value.statuses[]` (sent/delivered/read/failed). Ignore unknown types gracefully (reply with a help message, never crash).
- Inbound payload shape to support (abbreviated):
```json
{ "object": "whatsapp_business_account",
  "entry": [{ "id": "<WABA_ID>", "changes": [{ "field": "messages", "value": {
    "messaging_product": "whatsapp",
    "metadata": { "display_phone_number": "91XXXXXXXXXX", "phone_number_id": "<ID>" },
    "contacts": [{ "profile": { "name": "Customer" }, "wa_id": "91XXXXXXXXXX" }],
    "messages": [{ "from": "91XXXXXXXXXX", "id": "wamid.XXX", "timestamp": "1731700000",
      "type": "document",
      "document": { "id": "<MEDIA_ID>", "mime_type": "application/pdf", "filename": "assignment.pdf", "sha256": "..." } }]
  }}]}]}
```
- Outbound: `POST https://graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages` with `Authorization: Bearer <WHATSAPP_ACCESS_TOKEN>`. Media download is two-step: `GET /{media_id}` → temporary URL → `GET` that URL with the same bearer token; URLs expire quickly, so **download immediately** on receipt, then run through the normal upload pipeline (A7 validation, page count, colour detection, previews).
- **Check the current Meta documentation** for API version, message limits, template categories, pricing and window rules before coding; don't rely on memory. Keep versions/limits in config, not hard-coded.

### B5. Conversation state machine (`conversation.ts`)
Persist per `wa_id` in `wa_sessions` (survives restarts). Every transition is idempotent against duplicate webhooks.

| State | Trigger | Bot action | Next |
|---|---|---|---|
| `IDLE` | `PRINT <slug>` | Pre-flight: shop open? printer online? If not, say so **before** anything else. Welcome + ask for file | `AWAITING_FILE` |
| `AWAITING_FILE` | document/image | Download media → validate → analyse (pages, colour pages). Reply with summary: "assignment.pdf · 12 pages (3 colour)" | `CONFIGURING` |
| `CONFIGURING` | button/list replies | Ask in order: **Colour mode** (B&W / Colour / Smart) → **Sides** (Single / Double) → **Copies** (1 / 2 / 5 / Other) → paper size if shop supports >1 | repeat until complete |
| `CONFIGURING` | "Add file" / more files | Support up to N files per order (default 5), each with its own settings or "same settings for all" | |
| `REVIEW` | all options set | Itemised price (server-computed) + buttons: **Pay now** / **Change options** / **Cancel** | `AWAITING_PAYMENT` |
| `AWAITING_PAYMENT` | — | Create Razorpay **Payment Link** (UPI-first) for the exact server amount; send link. Expires in 15 min (`reminder` at 10 min) | wait for webhook |
| `TRACKING` | verified `payment_link.paid` / `payment.captured` | "Payment received ✅ Token **B-047**" → job dispatched → "Printing…" → "Ready for pickup 🖨️" | `DONE` |
| any | "cancel" / "menu" / "help" | Reset or help (idempotent) | `IDLE` |
| any | no activity for 30 min | Expire session; if an unpaid order exists mark `expired` | `IDLE` |

Rules:
- Free-text commands recognised (case-insensitive, Hinglish tolerant): `cancel`, `menu`, `help`, `status`, `stop`, `repeat` (reprint last order's settings).
- Buttons ≤ 3, button titles ≤ 20 chars, list rows ≤ 10, body text within WhatsApp limits (confirm in docs). Use **lists** when there are >3 options.
- Never accept price/amount from the chat. The bot only ever *displays* server-computed totals.
- **Pay-before-print is unchanged:** only the verified payment webhook moves the order to `queued`. A user typing "paid" does nothing.
- Per-`wa_id` rate limit (e.g. 30 msgs/min) and max concurrent open orders (1–2).

### B6. Copy & language
- `copy.ts` holds all strings keyed by id, with `en`, `hi`, and `hinglish` variants; language chosen by a first-message choice buttons ("English / हिंदी / Hinglish") and remembered on the session.
- Keep messages short, one decision per message, emojis sparingly. Always show shop name and token. Example review message:
  `Order summary — Campus Xerox\n• assignment.pdf: 9 B&W × ₹2 + 3 colour × ₹10 = ₹48\nConvenience fee ₹1\n*Total ₹49*`

### B7. Razorpay for WhatsApp
- Use **Payment Links** API (UPI-enabled), `reference_id = order.id`, `callback`-less (status comes via webhook), `expire_by` = now + 15 min, `notify` off (we send the message ourselves).
- Handle `payment_link.paid` (and keep `payment.captured` handling idempotent — one order, one transition regardless of which event arrives first).
- Reuse A6 hardening and the same `payments` table; add `payment_link_id`.
- In `PAYMENTS_MODE=simulated`, the mock provider exposes a "pay" simulation so the full WhatsApp E2E test runs offline.

### B8. Notifications (`notifier.ts`) — works for web *and* WhatsApp orders
Triggered from **order state events**, not from route handlers (single source of truth):
| Event | Customer message | Template needed? |
|---|---|---|
| `paid` | Receipt: token, shop, itemised total | Yes (utility) if outside 24 h window |
| `printing` | "Your print has started" | Optional (in-window only) |
| `completed` | "Ready — collect with token B-047" | Yes (utility) |
| `failed → refunded` | Apology + refund ETA | Yes (utility) |
Rules: respect opt-out; send only if a phone number exists (web checkout phone field becomes optional-but-encouraged with an explicit consent checkbox); **fall back gracefully** (log + skip) if sending fails — **never block printing on notification failure**. Retry with backoff; dedupe per `(order_id, event)`.

Template registry in `templates.ts` (names are examples; keep configurable): `order_paid_receipt`, `order_ready_pickup`, `order_failed_refund`, `shop_printer_alert`, `shop_daily_summary`, `shop_login_otp` (authentication category). Provide the exact template bodies in `docs/whatsapp-templates.md` for the founder to submit in Meta Business Manager, with variable examples. Until templates are approved, `CloudApiProvider` falls back to free-form text **only if** the 24 h window is open; otherwise log `template_required`.

### B9. Shop-owner alerts
- Owner registers a WhatsApp number in dashboard settings (verified via OTP).
- Alerts: printer offline > 2 min, paper out/error, order failed after retries, daily summary at a configurable time (orders, pages, revenue). Debounce (no alert storms), quiet hours, per-alert toggles.
- Owner commands (from their verified number only): `queue`, `pause`, `resume`, `today`. Strictly authenticated by `wa_id` ↔ owner record.

### B10. Compliance & abuse (India / DPDP + WhatsApp policy)
- **Opt-in:** the customer initiating the chat counts as session consent; for template notifications to web customers use an explicit checkbox. Honour `STOP` immediately (`wa_optouts`), and confirm.
- **Data minimisation:** store phone as E.164, **never log it in plain text** (redact in pino), purge `wa_messages` payloads after N days (default 30), never store media after printing (reuse A4 deletion).
- Block non-print abuse (spam, huge files, repeated invalid files) with escalating cool-downs.
- Include privacy line in the first reply: "Your file is deleted automatically after printing."

### B11. WhatsApp OTP login for shop owners
- `POST /v1/auth/otp/request {phone}` → generate 6-digit OTP (hashed in DB, 5-min expiry, 5 attempts, per-phone + per-IP rate limits) → send via `shop_login_otp` template (or mock) → `POST /v1/auth/otp/verify` → issue JWT cookie (A2). Phone must belong to a registered owner/staff record. Same endpoint works with the mock provider in dev (OTP printed to server log **only** when `WHATSAPP_MODE=mock`).

### B12. Data model additions (migration)
```sql
ALTER TABLE orders ADD COLUMN channel text NOT NULL DEFAULT 'web',
                   ADD COLUMN customer_wa_id text NULL,
                   ADD COLUMN public_token text NOT NULL;

CREATE TABLE wa_sessions (
  id uuid PRIMARY KEY, wa_id text NOT NULL, shop_id uuid REFERENCES shops(id),
  state text NOT NULL, lang text NOT NULL DEFAULT 'hinglish',
  order_id uuid NULL REFERENCES orders(id), context jsonb NOT NULL DEFAULT '{}',
  last_inbound_at timestamptz, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX wa_sessions_active_idx ON wa_sessions(wa_id) WHERE state <> 'DONE';

CREATE TABLE wa_messages (
  id uuid PRIMARY KEY, wamid text UNIQUE, direction text NOT NULL,  -- 'in'|'out'
  wa_id text NOT NULL, type text NOT NULL, payload jsonb, status text,
  order_id uuid NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE wa_optouts (wa_id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE otp_codes (id uuid PRIMARY KEY, phone text NOT NULL, code_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL, consumed_at timestamptz);
ALTER TABLE payments ADD COLUMN payment_link_id text NULL;
```
(Adapt names to existing conventions. Provide a matching memory-repo implementation for tests.)

### B13. Env vars (add to `.env.example`, names only)
`WHATSAPP_MODE`, `WHATSAPP_API_VERSION`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PLATFORM_NUMBER`, `PAYMENTS_MODE`, `OTP_PEPPER`, `PUBLIC_BASE_URL`.

### B14. Local dev & go-live checklist (Kali)
```bash
# expose local webhook to Meta (pick one)
cloudflared tunnel --url http://localhost:4000      # or: ngrok http 4000
# then in Meta App Dashboard → WhatsApp → Configuration:
#   Callback URL = <tunnel>/v1/webhooks/whatsapp ; Verify token = $WHATSAPP_VERIFY_TOKEN
#   Subscribe to the "messages" field
```
Human tasks (document in `docs/whatsapp-setup.md`, step by step): create Meta Business account + app, add WhatsApp product, use the free **test number** + add up to 5 recipient numbers for development, generate a **permanent system-user token** (not the 24 h temp token), submit templates, complete business verification and display-name approval for production, register the platform number. Mark each as a checklist for the founder.

### B15. Tests (all must pass offline using `MockProvider`)
1. Webhook verify handshake (valid / invalid token).
2. Signature check: valid, tampered body, missing header.
3. Duplicate delivery of the same `wamid` ⇒ processed once.
4. **Full E2E:** inbound `PRINT campus-xerox` → document → button replies for colour/sides/copies → review → simulated payment → agent prints (virtual CUPS-PDF) → customer receives *paid → printing → ready* messages in order.
5. Printer offline ⇒ bot refuses before payment.
6. Invalid/huge/encrypted file ⇒ polite error, state not corrupted.
7. Session expiry; `cancel`; `STOP` opt-out; `repeat`.
8. Cross-shop isolation (customer bound to shop A cannot touch shop B's orders).
9. OTP: success, wrong code ×5 lockout, expiry, rate limit.
10. Notification failure does **not** block printing.
11. Web order with phone + consent receives notifications; without consent receives none.
12. Restart mid-conversation ⇒ state restored from DB.

---

## 4. PART C — Windows Print Agent Hardening (scaffold + design)

Deliver code where it can be tested on Linux, and clear scaffolding where it needs Windows hardware.
- Abstract a `PrinterDriver` interface with `CupsDriver` (Linux/macOS, `lp`), `VirtualPdfDriver` (tests), and **`WindowsSumatraDriver`** (`SumatraPDF.exe -print-to "<printer>" -print-settings "<duplex|simplex>,<color|monochrome>,<N>x,paper=A4,fit" -silent file.pdf`). Build args safely (array, no shell).
- Printer discovery on Windows (PowerShell `Get-Printer` / `Get-PrintConfiguration` via `execFile`) reporting duplex/colour/paper capabilities and status (offline, paper out, error).
- Packaging plan: Node SEA/`pkg` or Electron tray app, installed as an auto-start Windows Service/Scheduled Task, config in `%ProgramData%\Chhaap`, logs rotated, auto-update channel with min-version enforcement from server `hello.ack`. Provide `apps/agent/PACKAGING.md` and a build script; **mark real-printer verification as a human task** in `Mind.md`.
- Agent-side WhatsApp is **not** needed; the agent stays dumb. Owner alerts originate from server-observed printer status.

---

## 5. PART D — Docs, Housekeeping & Mind.md

- Update `docs/runbook.md` (new flows, commands, troubleshooting) and add `docs/whatsapp-setup.md`, `docs/whatsapp-templates.md`.
- Update `implementation.md` only where the design changed (add a "WhatsApp channel" section and the delivery-model table); note deviations in `Mind.md` §7.
- Update `Mind.md` per its protocol: §2 dashboard (new rows: WhatsApp channel, Owner auth, Postgres repo, CI), §4 checklist (honest ticks; add Phase 2.5 "WhatsApp" items), §5 component registry/env vars, §7 decisions, §8 risks (Meta approval lead time, template approval, 24 h window, per-message costs, number-ban risk), §9 changelog, §10 next actions (max 7, with **human tasks clearly labelled**).

---

## 6. Execution Order (suggested)

1. Baseline: run build + tests; record results; fix root scripts/CI (A12).
2. A1 → A2 → A3 → A4 → A5 → A6 → A7 (P0 block), each with tests.
3. A8–A14 (P1).
4. B3 provider abstraction + B12 migration + B4 webhook skeleton (mock-first).
5. B5–B7 conversation + payment link; B15 E2E tests green.
6. B8 notifier, B9 owner alerts, B11 OTP login.
7. `CloudApiProvider` real implementation (cannot be fully verified without Meta credentials ⇒ unit-test with recorded fixtures and mark `UNVERIFIED: live Meta call` in Mind.md).
8. Part C scaffolding, Part D docs, final full test run.

---

## 7. Definition of Done

- [ ] `pnpm build && pnpm test` green from a clean clone, no sandbox bypass, CI workflow present.
- [ ] Production boot refuses simulated payments and mock-only configs.
- [ ] Orders, sessions, files, payments survive an API restart (Postgres).
- [ ] No unauthenticated shop routes; tenant-isolation tests green.
- [ ] Files provably deleted by the persistent sweeper, including after restart.
- [ ] WhatsApp E2E (mock) passes end-to-end; webhook signature/dedupe tests pass.
- [ ] Web orders and WhatsApp orders both generate receipts/status notifications; failures never block printing.
- [ ] Owner login via WhatsApp OTP works (mock) with rate limits.
- [ ] `.env.example`, runbook, WhatsApp setup + templates docs complete.
- [ ] `Mind.md` fully updated and honest (unverified items labelled).

---

## 8. Required Final Report (print at end of session)

1. **Restatement** (3 lines: phase, last completed item, what was done now).
2. **Bug table:** ID · confirmed? · fix summary · test name.
3. **WhatsApp:** what works in mock, what is implemented-but-unverified-live, exact human steps still needed from the founder.
4. **Commands** to run API, agent, tests, and the mock WhatsApp demo (include a script such as `pnpm demo:whatsapp` that replays a sample conversation and prints the transcript).
5. **Known gaps / risks** and the updated **Next Actions** list.

*Build boring parts perfectly: money, state, deletion, and auth first; features second.*
