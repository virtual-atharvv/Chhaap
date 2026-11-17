# Chhaap — Operational Runbook

Last verified: 2026-11-16 on Kali/Debian Linux. Commands are root-relative to
the repository; never use machine-specific absolute paths.

## 1. Prerequisites

| Tool | Version / purpose |
|---|---|
| Node.js | 20 LTS |
| pnpm | `packageManager` in root `package.json` (use Corepack) |
| Ghostscript | page analysis and PDF rendering (`gs`) |
| poppler-utils | `pdfinfo`, `pdftoppm` |
| PostgreSQL 16 | production/persistent mode (optional for dev) |
| LibreOffice | optional, Office→PDF conversion when enabled |
| ClamAV | optional, malware scanning when enabled |

Kali/Debian:

```bash
sudo apt update
sudo apt install -y nodejs npm ghostscript poppler-utils postgresql
sudo corepack enable
```

Use the repository's pnpm version automatically:

```bash
corepack install
pnpm --version
```

## 2. First run

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm smoke
pnpm dev:api
```

Open `http://localhost:4000/`, `/s/campus-xerox` (customer), and
`/shop/campus-xerox` (owner). The owner logs in with the seeded demo phone
`9876543210`; in `WHATSAPP_MODE=mock` the OTP appears in the API log and in the
mock transcript.

The default dev setup uses `DB_MODE=memory`, `PAYMENTS_MODE=simulated`, and
`WHATSAPP_MODE=mock`; all data disappears when the API stops. Production boot
refuses this combination.

## 3. Offline WhatsApp demo

```bash
pnpm demo:whatsapp
```

This starts the API on an ephemeral localhost port, connects a virtual PDF
agent, replays `PRINT campus-xerox → document → colour → sides → copies →
Pay now`, completes the simulated payment link, and prints the full customer
transcript (paid → printing → ready). It contacts no external service.

## 4. Postgres mode (persistent)

```bash
sudo systemctl enable --now postgresql
sudo -u postgres createuser --createdb chhaap
sudo -u postgres psql -c "ALTER USER chhaap WITH PASSWORD 'change_me';"
sudo -u postgres createdb -O chhaap chhaap
```

Set in `.env`:

```dotenv
DB_MODE=postgres
DATABASE_URL=postgresql://chhaap:change_me@localhost:5432/chhaap
```

Run migrations (idempotent) and start:

```bash
pnpm db:migrate
pnpm dev:api
```

`pnpm db:migrate` applies `packages/db/src/schema.sql`. Back up before upgrades:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=chhaap-$(date +%F).dump
pg_restore --clean --if-exists --dbname="$DATABASE_URL" chhaap-YYYY-MM-DD.dump
```

Contract tests against Postgres (optional, skipped without the variable):

```bash
TEST_DATABASE_URL="postgresql://chhaap:change_me@localhost:5432/chhaap_test" \
  pnpm --filter @chhaap/db test
```

Run the Postgres suite only against a disposable test database.

## 5. Print agent (dev / shop PC)

Development on Linux, no printer required:

```bash
CHHAAP_VIRTUAL_PRINTER=1 CHHAAP_PRINT_OUTPUT_DIR=./test-prints pnpm dev:agent
```

The agent writes `PRINTED_<jobId>_<name>.pdf` plus a metadata sidecar under
`test-prints/`. It never needs inbound ports: it dials
`<PUBLIC_BASE_URL>/v1/agent/connect` over WebSocket.

Pairing:

1. Log in to the shop dashboard → **Settings → Agent pairing**.
2. Generate a 6-digit code (single-use, 10 minutes).
3. Start the agent with the code:

```bash
CHHAAP_SERVER_URL=http://localhost:4000 pnpm dev:agent -- --pair=123456
```

Credentials are persisted in `CHHAAP_DATA_DIR` (default `data/agent` on Linux,
`%ProgramData%\Chhaap` on Windows) with mode `0600`. Re-pair if the token is
rotated. Windows packaging and the hardware checklist are in
`apps/agent/PACKAGING.md`.

## 6. Payments

- **Development:** `PAYMENTS_MODE=simulated`. `POST /v1/orders/:id/fake-pay`
  and `/v1/pay/:linkId/pay` exist only when `NODE_ENV !== production`.
- **Production:** `PAYMENTS_MODE=razorpay`; set `RAZORPAY_KEY_ID`,
  `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Configure the Razorpay
  webhook URL as `<PUBLIC_BASE_URL>/v1/webhooks/razorpay`, subscribe to
  `payment.captured` and `payment_link.paid`, and keep the raw-body signature
  verification enabled.
- Only a verified webhook moves an order from `awaiting_payment` to `queued`.
  The reconciliation cron (every 5 minutes) retries stale dispatched jobs and
  expires unpaid orders after `ORDER_EXPIRY_MINUTES`.

## 7. WhatsApp

Mock mode is the default for local work. Cloud setup, template submission and
founder checklist: `docs/whatsapp-setup.md`; copy-paste template bodies:
`docs/whatsapp-templates.md`.

Webhook endpoint: `GET|POST /v1/webhooks/whatsapp`. The POST handler verifies
`X-Hub-Signature-256` against the exact raw body and acknowledges immediately;
processing is asynchronous and deduplicated by `wamid`.

## 8. Health and logs

```bash
curl -s localhost:4000/healthz
curl -s localhost:4000/readyz
journalctl -u chhaap-api -f          # if installed as a systemd unit
```

Logs are structured JSON when `NODE_ENV` is not `test`/`silent`. Phones, file
names, cookies, authorization headers and payment IDs are redacted. Set
`SENTRY_DSN` only when the Sentry integration is enabled.

Suggested systemd unit (adjust user/paths, no secrets in the unit file):

```ini
[Unit]
Description=Chhaap API
After=network.target postgresql.service

[Service]
Type=simple
User=chhaap
WorkingDirectory=/opt/chhaap
EnvironmentFile=/opt/chhaap/.env
ExecStart=/usr/bin/node apps/api/dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now chhaap-api
sudo systemctl status chhaap-api
```

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| `readyz` database error | `DB_MODE`, `DATABASE_URL`, Postgres service, migrations |
| Production refuses to boot | It will name the offending setting; production requires `DB_MODE=postgres`, `PAYMENTS_MODE=razorpay`, `WHATSAPP_MODE=cloud`, strong `JWT_SECRET`, and `PUBLIC_BASE_URL` |
| Upload rejected as unsupported | Magic bytes must be PDF/JPEG/PNG; encrypted PDFs are rejected by design |
| `printer offline` on web/WhatsApp | Agent connected? Dashboard shows last seen; check printer discovery and the 60 s heartbeat timeout |
| Agent says “not paired” | Generate a fresh code and run `--pair=<code>`; inspect `config.json` ownership |
| Agent reconnect loop after token rotation | Re-pair; close codes 4000/4001 are permanent auth failures |
| Payment succeeded but order not queued | Check Razorpay webhook secret/signature, raw-body forwarding by any proxy, event age, amount/currency; run reconciliation |
| WhatsApp webhook 401 | `WHATSAPP_APP_SECRET` mismatch or a proxy rewrote/re-encoded the JSON body |
| WhatsApp 200 but no reply | Check `WHATSAPP_MODE`, provider logs, `wamid` dedupe, and opt-out state |
| Notification missing | Customer phone/consent, `STOP` opt-out, 24 h window (template required outside it), Meta outage; printing must continue regardless |
| OTP not received | Registered owner phone, per-phone/per-IP rate limits, mock log when `WHATSAPP_MODE=mock` |
| Tests cannot find `gs`/`pdfinfo` | Install Ghostscript and poppler-utils; tests never skip validation silently |
| `fake-pay` returns 404 | Correct outside non-production simulated mode; use Razorpay/test webhooks in production |

## 10. Command reference

```bash
pnpm build            # all packages
pnpm test             # TS tests (memory DB + mocked WhatsApp/payments)
pnpm smoke            # boots clean build on ephemeral port and tests /healthz + /readyz
pnpm dev:api          # API + static web UI with watch
pnpm dev:agent        # print agent with watch
pnpm demo:whatsapp    # offline transcript
pnpm db:migrate       # apply Postgres schema
```
