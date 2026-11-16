# WhatsApp Cloud API — Setup & Go-Live Checklist

This is the founder-facing checklist for connecting Chhaap to Meta WhatsApp
Cloud API. Everything below is **human work in Meta Business Manager** unless a
command is shown. Verify current Meta limits, API versions, template categories
and pricing in the official docs before production:
<https://developers.facebook.com/docs/whatsapp/cloud-api>.

The code path is implemented and unit/integration tested with the mock provider.
Live calls are **UNVERIFIED: real Meta credentials, template approvals and the
production phone number**.

## 1. Create the Meta assets

- [ ] Create/confirm a **Meta Business account** for the company.
- [ ] Create a **Meta app** of type Business.
- [ ] Add the **WhatsApp** product to the app.
- [ ] Add a **WhatsApp Business Account (WABA)**.
- [ ] For development, use the free **test phone number** and add up to five
      recipient numbers (your own phone and the founder/test team).
- [ ] Record the **Phone Number ID** and **WABA ID** from the WhatsApp dashboard.
- [ ] Generate a **permanent System User access token** with
      `whatsapp_business_messaging` and `whatsapp_business_management` (do not
      ship the 24-hour temporary token).
- [ ] Copy the app's **App Secret** (used for webhook HMAC verification).
- [ ] Choose a long random **verify token** for the webhook handshake.
- [ ] Decide the **platform WhatsApp number** customers will message. One
      platform number serves all shops via `PRINT <shopSlug>` in Phase 2.

Never commit any of these values. Set them only in the deployment environment
or `.env` (which is git-ignored).

## 2. Configure local development

Start the API and expose it with a tunnel:

```bash
# Terminal 1
pnpm dev:api

# Terminal 2 — choose one
cloudflared tunnel --url http://localhost:4000
# or
ngrok http 4000
```

In Meta App Dashboard → WhatsApp → Configuration:

- [ ] Callback URL: `https://<tunnel-host>/v1/webhooks/whatsapp`
- [ ] Verify token: exactly the value of `WHATSAPP_VERIFY_TOKEN`
- [ ] Subscribe to the **messages** webhook field.
- [ ] Use the “Verify and save” button; Chhaap must return the challenge.

Set the minimum Cloud API environment:

```dotenv
WHATSAPP_MODE=cloud
WHATSAPP_API_VERSION=v21.0
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_WABA_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_PLATFORM_NUMBER=91XXXXXXXXXX
PUBLIC_BASE_URL=https://<tunnel-host>
```

The server refuses to boot in cloud mode if a required credential is missing.
Keep `WHATSAPP_MODE=mock` for automated tests; never use mock in production.

## 3. End-to-end test with the test number

- [ ] Add your personal WhatsApp number as a test recipient.
- [ ] Send `PRINT campus-xerox` to the test number.
- [ ] Confirm the language buttons appear; choose English/हिंदी/Hinglish.
- [ ] Send a PDF or image; confirm page count and colour summary.
- [ ] Complete colour → sides → copies → review.
- [ ] Tap **Pay now**; confirm a UPI-first payment link is delivered.
- [ ] Pay using a Razorpay test method.
- [ ] Confirm the webhook moves the order to `queued` and the messages arrive
      in order: receipt → printing → ready (token).
- [ ] Try `HELP`, `STATUS`, `CANCEL`, `STOP`, `START`.
- [ ] Disconnect the agent/printer; confirm the bot refuses a new order before
      payment and the owner alert fires after the debounce period.
- [ ] Verify the phone number and file name are redacted in API logs.

## 4. Submit message templates

Template bodies and variable examples are in
`docs/whatsapp-templates.md`. Submit all six:

- [ ] `order_paid_receipt` — utility
- [ ] `order_ready_pickup` — utility
- [ ] `order_failed_refund` — utility
- [ ] `shop_printer_alert` — utility
- [ ] `shop_daily_summary` — utility
- [ ] `shop_login_otp` — authentication

Approval tips:

- [ ] Use the exact category shown; utility templates may be rejected if they
      look promotional.
- [ ] Keep variables in the same order as the code sends them.
- [ ] Provide realistic sample values; do not use “test”/“example” placeholders.
- [ ] Expect template review to take minutes to a few days; approval is not
      guaranteed.
- [ ] Until approval, free-form messages work only inside the 24-hour customer
      service window. Outside it the provider logs `template_required` and skips
      the notification (printing is never blocked).

## 5. Production go-live

- [ ] Complete **Business Verification** in Meta Business Manager.
- [ ] Complete **display-name approval** for the platform number.
- [ ] Register the production phone number and connect it to the WABA.
- [ ] Generate the final permanent token and store it in the secret manager.
- [ ] Set the production webhook URL to
      `https://<api-domain>/v1/webhooks/whatsapp`.
- [ ] Set `WHATSAPP_MODE=cloud`, `PAYMENTS_MODE=razorpay`,
      `DB_MODE=postgres`, a strong `JWT_SECRET`, and `PUBLIC_BASE_URL`.
- [ ] Confirm the production boot succeeds and `/readyz` is green.
- [ ] Run a real paid order through the production webhook.
- [ ] Re-check Meta per-message pricing and add a low-balance alert.
- [ ] Keep a fallback: if WhatsApp is down, web ordering continues; printing is
      independent of notifications.

## 6. Compliance and abuse

- [ ] Publish the privacy policy and the line “Your file is deleted
      automatically after printing” in the first reply.
- [ ] Record opt-in: a customer messaging first creates a session; web
      customers must tick the notification consent checkbox.
- [ ] Honour `STOP` immediately (stored in `wa_optouts`) and confirm it.
- [ ] Keep phone numbers E.164, never log them in plain text, and retain
      `wa_messages` payloads only `WA_MESSAGE_RETENTION_DAYS` (default 30).
- [ ] Do not store or re-send customer media after printing; reuse the normal
      file deletion pipeline.
- [ ] Rate-limit per `wa_id` and cap concurrent open orders.
- [ ] Monitor quality rating, blocks/reports, and template rejections; a number
      ban is a business risk.

## 7. Exact human steps still required

1. Create the Meta Business account/app and WhatsApp product.
2. Add test recipients and validate the tunnel + webhook handshake.
3. Generate the permanent system-user token and store secrets.
4. Submit the six templates and resolve any review feedback.
5. Complete business verification and display-name approval.
6. Register the production number and connect it to the WABA.
7. Run one real paid production order and record the result in `Mind.md`.
