# Meta WhatsApp Business (Cloud API) — Per-Client Setup Guide

Reusable runbook for adding WhatsApp messaging to a client on this platform. Based on the
Raghava Organics rollout (2026-07). Covers Meta Business Suite, the Developer app, WhatsApp
Manager, webhook, templates, App Review, and — critically — **where the credentials actually go
in THIS platform** (the Ops DB config overlay, **not** `.env`).

> **Companion docs**
> - Template body/param contract the backend sends: [`WHATSAPP_TEMPLATE_REGISTRY.md`](./WHATSAPP_TEMPLATE_REGISTRY.md)
> - Env-vs-DB config model: [`ENV_VS_DB_CONFIG_REFERENCE.md`](./ENV_VS_DB_CONFIG_REFERENCE.md)
> - Secret handling: [`THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`](./THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md)

---

## ⚠️ Read this first — how config works on THIS platform

**Do NOT put the WhatsApp provider keys in `backend/.env`.** On this platform, provider secrets
live **encrypted in the `OpsConfigSecret` DB table** and are entered through the **Ops UI →
Config → Notifications** (OTP-protected save), then loaded at runtime via the Ops config overlay.
The `.env` file only holds **bootstrap** keys (DB/Redis/JWT/OPS_DB_ENCRYPTION_KEY). Comet's raw
guide says "put it in `.env`" — that is wrong for us. See Phase 7 for the correct destination.

**Two independent enable switches (both Ops config, both default off):**
- `NOTIFY_WHATSAPP_ENABLED` — turns the WhatsApp channel on for order notifications.
- `OTP_WHATSAPP_ENABLED` — also sends signup/login OTP over WhatsApp (needs the `otp_verify`
  Authentication template; billed per message). Cost estimate shown on Ops → Config
  (`WHATSAPP_OTP_COST_PAISE`, default 14 paise/msg).

**Costs & limits (India, 2026):** utility ≈ ₹0.115/msg, authentication ≈ ₹0.115/msg, marketing
≈ ₹0.86/msg, all + 18% GST; replies inside a customer-opened 24h window are free. An **unverified**
number is capped at **250 business-initiated conversations / rolling 24h**; Business Verification
unlocks the 1k → 10k → 100k → unlimited tiers.

---

## Prerequisites

- Client **Facebook/Meta Business portfolio** (business.facebook.com).
- A **dedicated phone number** for WhatsApp Business — must NOT be active on the WhatsApp
  consumer or Business app (delete/port it out first, or use a fresh number).
- Live **HTTPS site** with a reachable **Privacy Policy** page (e.g. `https://<domain>/privacy`).
- Client **business email**.
- **Backend already deployed** on the production domain with the webhook endpoint live
  (`https://<domain>/api/v1/notifications/webhook/meta-whatsapp`). Set this up AFTER the backend
  is live, or webhook verification fails.

---

## Phase 1 — Meta Business Suite: verify business + create System User

`https://business.facebook.com`

**1.1 Business portfolio + verification** — Settings → Business info: fill name/address/email.
Security Centre → complete **Business Verification** (upload tax ID / incorporation doc / utility
bill). Takes ~2–10 business days. The number sends (throttled to 250/24h) before verification, but
verification is required to lift limits and to publish the app.

**1.2 System User (production token)** — Settings → **Users → System users**:
1. **Add** → name `<Client> Bot` (e.g. `Raghava Bot`), role **Admin** → Create.
2. Open the user → **Add assets** → **WhatsApp accounts** → select the client WABA → **Full control**.
3. **Generate new token**:
   - App: the client's Meta App (Phase 2).
   - Expiry: **Never** if offered (production), else 60 days — **if 60 days, set a rotation reminder; the token 401s on expiry.**
   - Scopes: **`whatsapp_business_messaging`** + **`whatsapp_business_management`**.
   - **Copy the token immediately — shown once.** → this is `META_WHATSAPP_ACCESS_TOKEN`.
4. Record the **System User ID** for reference.

---

## Phase 2 — Developer app + WhatsApp product

`https://developers.facebook.com`

**2.1 Create app** — My Apps → Create App → use case **Business** → name `<Client>` → contact
email → select the verified **business portfolio** → Create.

**2.2 Add WhatsApp** — app dashboard → Add product → **WhatsApp → Set up** → link/select the WABA.

**2.3 Basic settings** — `.../apps/<APP_ID>/settings/basic/`:
- Record **App ID** and **App Secret** (Show → password → copy → `META_WHATSAPP_APP_SECRET`).
- Upload **App icon** 1024×1024 PNG, set **Privacy Policy URL** (`https://<domain>/privacy`),
  **Category** = Shopping, **Contact email** → **Save Changes**. (These also satisfy App Review.)

---

## Phase 3 — WhatsApp Manager: phone number

`https://business.facebook.com/wa/manage/`

**3.1 Add number** — Phone Numbers → **Add phone number** → display name (e.g. `<Client>`; goes
"In Review" 1–3 days but the number works meanwhile) → number with country code → verify via
**SMS/Voice** OTP. Record **Phone Number ID** (click the number) and **WABA ID** (Overview) →
`META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_WABA_ID`.

**3.2 Register (if "Pending")** — Graph API Explorer (`developers.facebook.com/tools/explorer/`),
System User token selected:
```
POST /<PHONE_NUMBER_ID>/register
{ "messaging_product": "whatsapp", "pin": "<YOUR_6_DIGIT_PIN>" }
```
`{"success": true}` = registered. (Raghava hit a portal "Register" button that silently no-op'd
while the display name was In Review — the Graph API call is the reliable path.)

---

## Phase 4 — Webhook

`developers.facebook.com/apps/<APP_ID>/use_cases/customize/wa-settings/`

1. WhatsApp → Configuration → **Webhook → Edit**:
   - **Callback URL**: `https://<domain>/api/v1/notifications/webhook/meta-whatsapp`
     — use the **apex domain**, NOT an `api.` subdomain (that subdomain doesn't resolve on our setup).
   - **Verify token**: a random string → `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` (must match Ops config).
   - **Verify and save** (backend must be live; it echoes `hub.challenge`).
2. **Webhook fields** → subscribe **`messages`** (toggle blue). Delivery/read `statuses` arrive
   nested in the same payload — there is **no separate `message_status` field**.
3. Confirm the app is subscribed to the WABA:
   `GET /<WABA_ID>/subscribed_apps` → should list the app. If not: `POST /<WABA_ID>/subscribed_apps`.

---

## Phase 5 — Message templates

`business.facebook.com/wa/manage/message-templates/`

**The bodies/params must match the backend registry exactly** —
see [`WHATSAPP_TEMPLATE_REGISTRY.md`](./WHATSAPP_TEMPLATE_REGISTRY.md) (authoritative). Two rules:
Meta names are lowercase+underscores; body params are positional `{{1}}..{{n}}` and count/order
must match or Meta returns **132001** (name) / **132000** (param count). A body may **not start or
end with a variable**.

**5.1 Utility templates (order notifications)** — Create template → **Utility** → English → body
only. On this platform the store name is `{{1}}` and the order id is `{{2}}` (so the same templates
work for every client):

| Meta name | Params (order) | Sample body (see registry doc for exact approved text) |
|---|---|---|
| `order_confirmed` | `{{1}}`=store, `{{2}}`=orderId | "Thank you for shopping with {{1}}! Your order {{2}} is confirmed…" |
| `order_shipped` | `{{1}}`=store, `{{2}}`=orderId, `{{3}}`=tracking | "Good news from {{1}} — your order {{2}} has been shipped! Track: {{3}}…" |
| `out_for_delivery` | `{{1}}`=store, `{{2}}`=orderId | "Hi! {{1}}: Your order {{2}} is out for delivery today!…" |
| `order_delivered` | `{{1}}`=store, `{{2}}`=orderId | "Hi! {{1}}: Your order {{2}} has been delivered…" |
| `order_cancelled` | `{{1}}`=store, `{{2}}`=orderId | "Hi! {{1}}: Your order {{2}} has been cancelled…" |
| `payment_failed` | `{{1}}`=store, `{{2}}`=orderId | "Hi! {{1}}: We couldn't process the payment for order {{2}}…" |
| `return_request_update` | `{{1}}`=store, `{{2}}`=orderId, `{{3}}`=statusLine | "Hi! {{1}}: Update on your return request for order {{2}}: {{3}}…" |
| `admin_new_order` | `{{1}}`=store, `{{2}}`=orderId, `{{3}}`=customerName, `{{4}}`=amountLine | MERCHANT-facing (sent only to opted-in admins): "New Order Received! … Order {{2}} … Customer {{3}} … {{4}}" |

Fill a Variable sample for each `{{n}}` → Submit. Utility templates usually auto-approve in minutes.

> **2026-07-04 readability overhaul:** all Utility bodies were rewritten with WhatsApp formatting
> (*bold*, emoji, blank-line spacing) and `order_shipped` explicitly renders the tracking link in
> `{{3}}`. The exact approved bodies live in WHATSAPP_TEMPLATE_REGISTRY.md — edits keep the same
> names + param counts, so in-flight sends are unaffected while Meta re-reviews.

> `return_request_update` carries the stage-specific wording in `{{3}}` (composed by the backend:
> approved / declined / picked up / refunded), so ONE approved template covers the whole return
> lifecycle. Sample for `{{3}}`: `approved — our team will arrange the pickup of your items`.

**5.2 Authentication template (OTP) — REQUIRED to be Authentication, never Utility:**
Create template → **Authentication** → sub-type **One-time Passcode** → Next → name **`otp_verify`**
(a fresh unused name) → English → code delivery **Copy code** → check **Add security
recommendation** → Submit. **Auto-approves immediately.** Meta-fixed body (single param = the code):
```
{{1}} is your verification code. For your security, do not share this code.
```
The backend maps internal `CustomerOtpVerification` → `otp_verify` and sends the code in BOTH the
body param AND a copy-code button component (handled automatically by the adapter).

> ❌ **Never submit OTP content as Utility** — Meta auto-rejects ("Category does not match").
> ❌ **Deleted template names are blocked for 30 days** — always use a fresh name (this is why we
> moved `otp_verification` → `otp_verify`).

---

## Phase 6 — App Review (publish → Live)

`developers.facebook.com/apps/<APP_ID>/app-review/`

Until the app is **published/Live**, only app admins/developers/testers receive webhooks — **real
customers get nothing.** Complete the submission checklist:

| Item | Action |
|---|---|
| Verification | auto-green once Business Verification is done |
| App settings | app icon 1024×1024 + Privacy Policy URL + Category + contact email (Phase 2.3) |
| Allowed usage | `whatsapp_business_messaging` → usage description (below) + **screencast** + compliance checkbox |
| Data handling | confirm |
| Reviewer instructions | site URL + steps (below) + "No" for Facebook Login |

**Usage description:**
```
<App Name> is an e-commerce platform. We use whatsapp_business_messaging to send automated
transactional notifications (order confirmation, shipping, out-for-delivery, delivered,
cancellation, payment-failure) and, where enabled, one-time login/signup verification codes.
All messages are triggered by customer actions; customers provide their phone number at
checkout/registration and consent to order-related communications. No marketing via this API.
```

**Reviewer instructions:**
```
Server-side WhatsApp Business API integration only; no Facebook Login.
Visit <site URL> → place a test order → the app sends WhatsApp notifications to the customer's
number at each order stage.  Phone Number ID: <ID>   WABA ID: <ID>
```

**Screencast (only truly manual step):** MP4/MOV showing (1) a customer places an order, (2) the
WhatsApp message arriving, (3) optional status updates. Submit → review ~5–7 business days → Live.

---

## Phase 7 — Enter credentials in THIS platform (Ops UI, NOT `.env`)

**Ops UI → Config → Notifications** → set each key → **Send OTP to email → Verify OTP and save**
(encrypted into `OpsConfigSecret`). Then **restart API + workers** so the notification provider
re-reads them (`requiresRestart`).

| Ops config key | Value |
|---|---|
| `NOTIFY_WHATSAPP_ENABLED` | `true` (dropdown) |
| `META_WHATSAPP_ACCESS_TOKEN` | System User token (Phase 1.2) |
| `META_WHATSAPP_PHONE_NUMBER_ID` | Phase 3.1 |
| `META_WHATSAPP_API_VERSION` | `v25.0` |
| `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` | must match the Meta webhook config (Phase 4) |
| `META_WHATSAPP_APP_SECRET` | Phase 2.3 |
| `OTP_WHATSAPP_ENABLED` | `false` until `otp_verify` is Approved AND the app is Live; then `true` |
| `WHATSAPP_OTP_COST_PAISE` | `14` (adjust to your BSP's per-message rate; drives the Ops cost estimate) |

Reference-only (not secrets, keep in the client's `VPS_INPUTS.md` vault): `META_WHATSAPP_APP_ID`,
`META_WHATSAPP_WABA_ID`, System User ID.

**Route notifications to WhatsApp:** in the notifications `primaryNotificationChannels` config, set
the templates you want (e.g. `OrderConfirmed`, `OrderShipped`, `CustomerOtpVerification`) to
`WHATSAPP`. Only route a template once its Meta template shows **Approved**.

---

## Gotchas (from the Raghava rollout)

| Symptom | Cause | Fix |
|---|---|---|
| Webhook "Verify and save" fails | backend not live / wrong path / token mismatch | deploy first; use the apex-domain path; match the verify token in Ops |
| Number stuck "In Review", portal Register button no-ops | display name pending | force-register via Graph API `POST /<phone_id>/register` with the 6-digit PIN |
| OTP template auto-rejected as Utility | Meta blocks verification codes in Utility | use **Authentication** category |
| "Category does not match / will be rejected" on a name | that name was last used as another category | use a **fresh name**; deleted names are blocked 30 days |
| Token 401s after ~60 days | 60-day System User token expired | regenerate (prefer "Never expires"); update Ops config + restart |
| No live webhooks / customers get nothing | app still in Development mode | complete App Review → publish Live |
| Zero-tap autofill asks for an app hash | needs Android package + SHA256 | use **Copy code** button instead |
| Saved keys not taking effect | provider built at boot | restart API + workers after the Ops save |

## URLs cheat sheet

| What | URL |
|---|---|
| Business Suite | `business.facebook.com` |
| System Users | `business.facebook.com/latest/settings/system_users` |
| WhatsApp Manager | `business.facebook.com/wa/manage/` |
| Message Templates | `business.facebook.com/wa/manage/message-templates/` |
| Developer Dashboard | `developers.facebook.com` |
| App Basic Settings | `developers.facebook.com/apps/<APP_ID>/settings/basic/` |
| WhatsApp Config / Webhook | `developers.facebook.com/apps/<APP_ID>/use_cases/customize/wa-settings/` |
| Graph API Explorer | `developers.facebook.com/tools/explorer/` |
| App Review | `developers.facebook.com/apps/<APP_ID>/app-review/` |

## Rough time per client

Business Suite + System User ~15 min · App + credentials ~10 min · Phone + register ~10 min ·
Webhook ~10 min · Templates (7 utility + 1 auth) ~20 min · App Review form ~20 min + screencast.
Async waits: Business Verification 2–10 days, display-name approval 1–3 days, App Review 5–7 days.
