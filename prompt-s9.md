# PROMPT-S9.md — Pilot-Blocker Fix Session (Chhaap)

> **Give this file to the coding agent together with `Mind.md` and `report.md`.**
> Instruction to the agent: *"Read Mind.md, then report.md §14–§16, then execute prompt-s9.md task by task. Checkpoint after every task."*
> Scope: fix everything `report.md` §14 flagged as broken, unsafe, or overclaimed. **No new features.** WhatsApp/payment/agent behaviour must not regress.

---

## 0. Rules (short form)

**Stop-safe protocol (mandatory):** your quota can end at any moment. After **every completed task**: (1) tests green → `git commit -m "S9-Tn: <summary>"`; (2) append one line to `Mind.md` §9 under today's *Checkpoints*; (3) make `Mind.md` §10 item #1 the next unfinished task. Half-done work → `wip/S9-Tn` branch + a note in §10. Never leave `main` red.

**Engineering rules**
- **Reproduce first.** For every defect: write a failing test (or a failing script/CI step), see it fail, fix, see it pass. If something in `report.md` turns out *not* to be a bug in the actual code, say so, add a regression test anyway, and move on.
- Trust code over documents. Money = integer paise; server prices; only a verified payment event moves an order to `queued`.
- Don't weaken any existing guard (production boot refusals, tenant isolation, webhook HMAC, public-token checks).
- No secrets in git; env var *names* only. No absolute machine paths. No sandbox bypass in tests. `prompt.md`, `prompt-lite.md`, `prompt-s9.md` stay **untracked** (do not commit them).
- Ambiguity → choose the safest default, log it in `Mind.md` §7, continue. Don't stop to ask.
- Dev machine is Kali/Debian; use Debian-style commands in docs.

**Priority order = task order.** T1–T4 are pilot blockers. Do them first.

---

## T1 — Dev commands & local config (report §14.1, §14.3)

**Problem:** `pnpm dev:api` / `pnpm dev:agent` fail on Node 20 (`ERR_UNKNOWN_FILE_EXTENSION .ts`); `pnpm dev:web` has no script; `.env` is never loaded locally.

**Do**
1. Make dev runners work on Node 20: add `tsx` as a devDependency and use `tsx watch src/index.ts` for `apps/api` and `apps/agent` (or compile-then-run `node --watch dist/index.js` with a parallel `tsc -w`; choose one, apply to both consistently).
2. Remove `dev:web` from root scripts (web is static, served by the API). If kept, give it a real script.
3. Add a tiny dependency-free `.env` loader at the top of `apps/api/src/config.ts` and the agent entry: load `<repo-root>/.env` if present, **never override variables already set in the environment**, ignore comments/blank lines, support quoted values. Add unit tests (override rule, quotes, missing file).
4. Add `pnpm smoke`: boots the API from a clean build (memory DB, simulated payments, mock WhatsApp) on an ephemeral port, polls `/healthz` + `/readyz` until 200 (timeout 20 s), then shuts down cleanly. Run it in `.github/workflows/ci.yml` **and** a second smoke step that starts the dev runner for 5 s without crashing.
5. Fix `docs/runbook.md` to match reality.

**Done when:** `pnpm dev:api` and `pnpm dev:agent` start on Node 20 from a clean clone; `pnpm smoke` passes locally and in CI; `.env` values are honoured locally.

---

## T2 — Web checkout actually completes a payment (report §14.2)

**Problem:** `customer.html` "Pay now" expects `result.shortUrl`, but `createCheckout` returns Razorpay order fields; simulated mode never calls `fake-pay`; there is no status view (no SSE/polling). The main web flow is not end-to-end.

**Do**
1. **Define the checkout response contract** as a Zod schema in `packages/shared` (discriminated union):
   - `{ mode: 'simulated', orderId, amountPaise, currency, simulatedPayUrl }`
   - `{ mode: 'razorpay', orderId, amountPaise, currency, keyId, razorpayOrderId, prefill?: {contact?} }`
   Update `PaymentService.createCheckout`, the route, and tests to use it. The page must consume **only** these fields.
2. **Simulated mode:** page navigates to the simulated pay page (or calls `fake-pay` then continues to status). Only available when the server says `mode: 'simulated'`.
3. **Razorpay mode:** load Razorpay Checkout (`https://checkout.razorpay.com/v1/checkout.js`) on demand, open it with the returned `keyId` / `razorpayOrderId` / `amountPaise`. **The client success handler must NOT mark anything paid** — it only moves the UI to the status screen. Payment truth comes from the verified webhook.
4. **Status screen** (shareable, survives refresh): route `/o/:orderId`. Keep the `publicToken` in the **URL fragment** (`#t=...`, never sent to server logs) or sessionStorage; read it client-side and call `GET /v1/orders/:id/stream?token=` (SSE) with **polling fallback** (`GET /v1/orders/:id?token=` every 3 s) if SSE fails. Show: Awaiting payment → Paid ✓ → Queued → Printing → Ready (big pickup token like `B-047`) → or Failed/Refunded with a clear message. Add "pending payment" timeout messaging (order expires after `ORDER_EXPIRY_MINUTES`).
5. After checkout creation, if the user returns to the page (back button), restore state from sessionStorage instead of creating a duplicate order (reuse the idempotency key).
6. **Tests:** (a) contract test: checkout response parses against the shared schema in both modes; (b) a Node-level "browser-equivalent" test that performs exactly the page's sequence against the real API in simulated mode: upload → create order → checkout → simulated pay → poll until `completed` with a virtual agent connected; (c) assert the page's JS contains no reference to `shortUrl`.

**Done when:** from `/s/campus-xerox` in a browser (simulated mode) a human can upload, pay and watch the order reach "Ready" with a token — **and the test in 6(b) proves the same sequence in CI.** Razorpay-mode UI path is unit-checked with a fake `Razorpay` global and marked `UNVERIFIED: live Razorpay` in Mind.md.

---

## T3 — Postgres onboarding / provisioning (report §7, §14.4)

**Problem:** memory DB seeds a demo shop; Postgres starts empty and there is **no way to create the first shop or owner**. A real deployment is unusable.

**Do**
1. Add an admin CLI in `apps/api` (e.g. `pnpm admin <command>`), working against whichever `DB_MODE` is configured:
   - `admin create-shop --slug <slug> --name <name> --city <city> --owner-phone <E.164> [--owner-name <name>] [--gst <pct>] [--min-order <paise>] [--fee <paise>]` → creates owner user (role `owner`), shop (status `active`), `shop_members`, default rate cards (same defaults as the memory seed), default settings. **Idempotent** on `slug`; validates phone/slug; prints the shop URLs and next steps (pairing, WhatsApp opt-in), never secrets.
   - `admin list-shops`, `admin set-shop-status <slug> active|suspended`, `admin add-staff --slug --phone --role staff`.
   - `admin seed-demo` → the same demo data as memory mode; **refuses to run when `NODE_ENV=production`**.
2. Put the default rate-card/settings seed in one shared function used by both the memory seed and the CLI (no duplicated defaults).
3. Tests: CLI logic against the memory repo; against Postgres when `TEST_DATABASE_URL` is set (create-shop → owner OTP login → shop route works → tenant isolation still holds).
4. Document the provisioning steps in `docs/runbook.md` ("Onboarding a new shop in 5 minutes").

**Done when:** on an empty database, `pnpm db:migrate && pnpm admin create-shop ...` produces a shop whose public page loads and whose owner can log in via OTP.

---

## T4 — Upload scanning & unsafe-file policy (report §10, §14.5)

**Problem:** `scanStatus` is hard-coded `'clean'` in `routes/public.ts` and `whatsapp/conversation.ts`. No real scanning exists.

**Do**
1. Create a `FileScanner` interface and **one shared `ingestFile()` pipeline** used by **both** web uploads and WhatsApp media (remove the duplicated hard-coded status).
2. Implement `ClamdScanner` (via `clamdscan`/clamd socket using `execFile` with arg arrays, timeout, output cap) and `NoopScanner`.
3. Config: `SCAN_MODE=off|clamav` (default `off` in dev/test). **Production boot refuses `SCAN_MODE=off`** unless `OFFICE_UPLOADS=disabled` **and** `ALLOW_UNSCANNED_PDF_IMAGES=true` is set explicitly (document this as a conscious risk acceptance). 
4. `OFFICE_UPLOADS=enabled|disabled` (default **disabled**). Office formats are rejected with a friendly message unless enabled **and** LibreOffice present **and** scanning on.
5. Behaviour: `infected` → reject, delete bytes, log event (no filename in logs), polite message to user; scanner unreachable/timeout → **fail closed** in production (reject with "try again"), fail-open only in dev/test with a warning.
6. Persist real `scan_status` (`pending|clean|infected|failed`) on `files`.
7. Tests with a fake scanner (infected / failed / clean / timeout) for both web and WhatsApp paths. Add an optional EICAR-based integration test that runs only if `clamdscan` is available.
8. Update docs/runbook with ClamAV install + freshclam steps for Debian/Kali.

**Done when:** no code path writes `'clean'` without a scanner verdict (except explicit `off` mode), and both channels share one pipeline.

---

## T5 — Authenticated previews & secret hygiene (report §10, §14.13)

1. Previews: stop serving `/previews/*` as unauthenticated static files. Serve via **HMAC-signed, expiring URLs** (same mechanism as agent downloads) or require the order/upload token. Update upload response + customer page + WhatsApp review (if it links previews). Tests: unsigned/expired/tampered URL ⇒ 403.
2. Add `FILE_URL_SECRET` to typed `AppConfig`; **required in production, no fallback to `JWT_SECRET`** (fallback allowed in dev/test only). Add to boot-guard tests and `.env.example`.
3. Dev CORS: restrict to localhost origins instead of reflecting any origin with credentials.
4. Review CSRF posture; add a minimal defence for cookie-authenticated state-changing routes (e.g. require `Content-Type: application/json` plus an `Origin`/`Sec-Fetch-Site` check in production) with tests. Log the decision in §7.

---

## T6 — Agent versioning & minimum-version enforcement (report §14.6)

1. Single source of truth for the agent version (read from `package.json` at build time → exported constant). Remove the 0.1.0 / 0.2.0 mismatch.
2. Server config `MIN_AGENT_VERSION`; gateway sends `config.minAgentVersion` in `ack`. Agent below minimum: show a clear log/status, **refuse new jobs**, report `update_required` in `printer.status`; dashboard shows the badge.
3. Tests: compatible agent receives jobs; outdated agent gets none and the order stays `queued` with a visible reason; semver compare edge cases.

---

## T7 — Notifier correctness & honesty (report §14.7)

1. When a template is required (outside the 24 h window) and none is configured/approved: log `template_required` (no PII), record the notification attempt with status `skipped_template_required`, and **do not consume the `(order_id, event)` dedupe slot** so it can be sent later if a template becomes available or the window opens.
2. Optional in-window-only events (`printing`) skipped outside the window: debug-log, record `skipped_out_of_window`, never counted as delivered.
3. Failure after 3 retries: record `failed` with a reason; surface counts on the owner dashboard (small "Notification issues" indicator).
4. Tests for all four outcomes; ensure printing is never blocked.
5. Fix `implementation.md` §21.4 wording to match actual behaviour.

---

## T8 — Close test gaps (report §14.8, §14.9, §16)

1. **`REPEAT`**: test (new session, copies last order's settings, asks for file, respects opt-out/shop-closed/printer-offline).
2. **Multi-file WhatsApp orders**: add a test that documents the shared-settings behaviour **and** change the review message to say clearly *"Same settings apply to all N files"* (en/hi/hinglish). (Per-item settings are explicitly out of scope.)
3. **Agent ledger recovery**: crash between `printing` and `printed` → restart reports unfinished job, never reprints.
4. **Driver selection**: platform/driver chooser unit test (Linux+CUPS present, Linux without CUPS → virtual, Windows → Sumatra with missing exe → clear error).
5. **Postgres contract tests** remain conditional on `TEST_DATABASE_URL`; add a `docker compose` helper script `pnpm test:pg` that starts Postgres, runs migrations + the contract suite, tears down (documented; may be unrunnable in this environment — then mark `UNVERIFIED`).

---

## T9 — Rate-card editor in the shop dashboard

The API (`GET/PUT /v1/shop/rates`) exists; the UI does not expose it. Add a compact rate editor to `shop.html`: table by paper size × colour × sides (₹ input → paise, integer validation), min order, convenience fee, GST %, "Reset to defaults", dirty-state + save with success/error toast, owner/admin only. Server-side validation (non-negative integers, sane maxima). Tests for the validation; manual checklist for the UI. Preview of "example order total" using the new rates is a nice-to-have.

---

## T10 — Naming, docs & Mind.md truth-up (report §14.10, §2)

1. **PWA:** either (a) rename everywhere to "mobile web app" (default, zero code), or (b) if time remains, add a minimal `manifest.webmanifest` + icons + a service worker that caches **only** the static shell (never API, previews or uploads). Pick (a) unless (b) is cheap; log it in §7.
2. **Redis:** note in docs that Redis is provisioned but unused; remove it from `docker-compose.yml` if nothing needs it (preferred).
3. **Correct `Mind.md` honestly.** Apply at least these corrections to §2/§4 (use `🟡`/`❌`/`⬜`, add `UNVERIFIED:` where needed), then re-tick after the tasks above are done:

   | Item | Was | Should read (until fixed) |
   |---|---|---|
   | Repo & CI | ✅ | 🟡 dev scripts were broken; no smoke in CI → ✅ after T1 |
   | Customer PWA | ✅ | ❌ checkout incomplete, no status view, not a PWA → ✅ "mobile web app" after T2/T10 |
   | Shop dashboard | ✅ | 🟡 no rate editor → ✅ after T9 |
   | File pipeline | ✅ | 🟡 scan hard-coded clean → ✅ after T4 |
   | Print agent | ✅ | 🟡 version mismatch / no min-version → ✅ after T6 |
   | Database layer | ✅ | 🟡 no Postgres onboarding; live PG unverified → ✅ (code) after T3, `UNVERIFIED: live` remains |
   | WhatsApp notifications | ✅ | 🟡 template-failure behaviour overstated → ✅ after T7 |
   | Observability | 🟡 | stays 🟡 (Sentry hook only) |

4. Update `report.md` §14: mark each item **Fixed (commit hash)** / **Still open** and refresh the verification table (build, test count, new smoke step). Keep `report.md` self-contained.
5. Update `Mind.md` §3 (new decisions), §5 (new env var names: `SCAN_MODE`, `OFFICE_UPLOADS`, `ALLOW_UNSCANNED_PDF_IMAGES`, `FILE_URL_SECRET`, `MIN_AGENT_VERSION`), §6 (commands: `pnpm smoke`, `pnpm admin`, `pnpm test:pg`), §8 (risks status), §9 (changelog), §10 (next actions).

---

## T11 — Final verification (always last)

Run and paste results into the final report:
```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test            # report total / skipped counts
pnpm smoke
pnpm demo:whatsapp
NODE_ENV=production node apps/api/dist/index.js   # must REFUSE to boot with dev/mock/simulated config
```
Also re-run the T2(b) end-to-end web test and a manual walk-through of `/s/campus-xerox` → pay → status.

---

## Definition of Done

- [ ] `pnpm dev:api`, `pnpm dev:agent`, `pnpm smoke` work on Node 20; CI runs the smoke check
- [ ] Web checkout completes in simulated mode (test + manual) and has a refresh-safe status page; Razorpay path wired (live = UNVERIFIED)
- [ ] Empty Postgres → `admin create-shop` → owner OTP login → public page works
- [ ] No hard-coded `'clean'`; one shared ingest pipeline; production boot guards for scanning/Office
- [ ] Previews are signed/expiring; `FILE_URL_SECRET` required in production
- [ ] Agent version single-sourced; `minAgentVersion` enforced and tested
- [ ] Notifier statuses honest; docs match behaviour
- [ ] New tests: REPEAT, multi-file messaging, ledger recovery, driver selection, env loader, checkout contract
- [ ] Rate editor in dashboard
- [ ] `Mind.md` and `report.md` corrected and honest; checkpoints logged for every task

## Final Report (print at the end)

1. Restatement (phase · last completed task · what was done).
2. Table: task · confirmed bug? · fix summary · test name · commit.
3. Anything half-done (branch/stash) and how to resume.
4. Test counts before/after; what remains `UNVERIFIED`.
5. **Human tasks still pending** (Meta test-number run + templates, Razorpay test-mode UPI, Windows agent + real printer, ClamAV/LibreOffice install on the host, Postgres contract run, 10 shop visits).
6. Updated Next Actions (max 7).

*Fix the pay button before anything else. A product that can't take money isn't a product yet.*
