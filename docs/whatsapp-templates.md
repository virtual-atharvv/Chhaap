# WhatsApp Template Registry — Copy for Meta Business Manager

Submit these in **Meta Business Manager → WhatsApp Manager → Message templates**.
Names, categories and variable order must match `apps/api/src/whatsapp/templates.ts`.
If a name changes in Meta, update `templates.ts` and the notifier/owner-alert
call sites together; there is no schema migration for template names.

Legend: `{{1}}`, `{{2}}`… are positional variables. Examples use Indian English
and INR formatting; replace with realistic pilot values when submitting.

---

## 1. `order_paid_receipt`

- **Category:** Utility
- **Language:** English (en)
- **Used for:** web and WhatsApp orders after a verified payment, when the
  24-hour session window is closed.
- **Variables:** `{{1}}` shop name, `{{2}}` pickup token, `{{3}}` amount.

**Body**

```text
Payment received for your print order at {{1}}. Pickup token: {{2}}. Amount paid: {{3}}. We will message you when it is ready.
```

**Example**

```text
Payment received for your print order at Campus Xerox. Pickup token: B-047. Amount paid: ₹49.00. We will message you when it is ready.
```

---

## 2. `order_ready_pickup`

- **Category:** Utility
- **Language:** English (en)
- **Used for:** completed orders outside the 24-hour window.
- **Variables:** `{{1}}` shop name, `{{2}}` pickup token.

**Body**

```text
Your prints are ready at {{1}}. Collect them using token {{2}}.
```

**Example**

```text
Your prints are ready at Campus Xerox. Collect them using token B-047.
```

---

## 3. `order_failed_refund`

- **Category:** Utility
- **Language:** English (en)
- **Used for:** failed/refunded orders outside the 24-hour window.
- **Variables:** `{{1}}` shop name, `{{2}}` pickup token, `{{3}}` refund amount.

**Body**

```text
We could not print order {{2}} at {{1}}. A refund of {{3}} has been initiated and should reach you in 3-5 working days.
```

**Example**

```text
We could not print order B-047 at Campus Xerox. A refund of ₹49.00 has been initiated and should reach you in 3-5 working days.
```

---

## 4. `shop_printer_alert`

- **Category:** Utility
- **Language:** English (en)
- **Used for:** owner alerts after the printer has been offline/erroring past
  the debounce window.
- **Variables:** `{{1}}` shop name, `{{2}}` printer name, `{{3}}` status.

**Body**

```text
Alert for {{1}}: printer "{{2}}" is {{3}}. New orders may be paused until it is back online.
```

**Example**

```text
Alert for Campus Xerox: printer "HP LaserJet M1005" is offline. New orders may be paused until it is back online.
```

Approved status strings sent by the code include `offline`, `paper_out`,
`error`, and `busy`. Keep the sentence grammatical for all of them.

---

## 5. `shop_daily_summary`

- **Category:** Utility
- **Language:** English (en)
- **Used for:** the owner's configurable end-of-day summary.
- **Variables:** `{{1}}` shop name, `{{2}}` order count, `{{3}}` page count,
  `{{4}}` revenue.

**Body**

```text
Daily summary for {{1}}: {{2}} orders, {{3}} pages printed, revenue {{4}}. Reply QUEUE to see pending orders.
```

**Example**

```text
Daily summary for Campus Xerox: 18 orders, 246 pages printed, revenue ₹1,284.00. Reply QUEUE to see pending orders.
```

---

## 6. `shop_login_otp`

- **Category:** Authentication
- **Language:** English (en)
- **Used for:** owner/staff dashboard login. The code expires in 5 minutes and
  is stored hashed; after five wrong attempts it is locked.
- **Variables:** `{{1}}` six-digit OTP.

**Body**

```text
{{1}} is your Chhaap shop login code. It expires in 5 minutes. Do not share it with anyone.
```

**Example**

```text
482913 is your Chhaap shop login code. It expires in 5 minutes. Do not share it with anyone.
```

Meta authentication templates may require the standard “copy code” button or a
security disclaimer depending on the current template rules. If Meta insists on
its authentication format, use the equivalent authentication template and keep
the single `{{1}}` variable; update `templates.ts` and the owner-login test.

---

## Submission checklist

- [ ] All six names match exactly.
- [ ] Categories are Utility for the first five, Authentication for OTP.
- [ ] Variable order matches the examples above.
- [ ] Sample values are realistic (no “test”, “example”, “Lorem”).
- [ ] English is the submitted language; Hindi/Hinglish free-form copy is used
      only inside the 24-hour window until Hindi templates are approved.
- [ ] Re-test one real message per template after approval.
- [ ] Record approval dates/rejections in `Mind.md` §9.

## Operational behaviour when a template is missing

`CloudApiProvider` sends free-form text only while the 24-hour customer service
window is open. Outside it, a missing/unapproved template is logged as
`template_required` and the notification is skipped. The order and printing
pipeline continue; notifications are best-effort by design.
