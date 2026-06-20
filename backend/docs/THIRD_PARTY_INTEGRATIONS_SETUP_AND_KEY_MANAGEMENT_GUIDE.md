# Third-Party Integrations Setup and Key Management Guide

This guide is the production setup and maintenance runbook for all external integrations used by this backend/frontend stack.

Use this with:
- `.env.example` (canonical env contract)
- `docs/BACKEND_GO_LIVE_CHECKLIST.md`
- `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md`
- `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`
- `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`

## 0) Mandatory operational artifacts

Before go-live, create and maintain these artifacts for each client:

1. Credential register (owner + vault path + lifecycle dates):
   - `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`
2. Staging provider dry-run log (all five providers pass at least once).
3. 90-day rotation calendar with primary/backup owners.
4. Quarterly compromise drill evidence (`revoke -> regenerate -> redeploy -> verify`).

### 0.1 Integration timing requirement (simultaneous build + integration)

Provider dry-runs and credential validation must be performed as part of the **vertical slice** that builds the relevant frontend feature — not deferred to a post-completion integration phase.

Required approach per slice:
- Payments slice: validate `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` during the payment initiate/verify integration slice (not after checkout UI is complete).
- Shipping slice: validate `DELHIVERY_API_KEY` or `SHIPROCKET_EMAIL`/`SHIPROCKET_PASSWORD` during the admin ship action integration slice.
- Notifications slice: validate `RESEND_API_KEY` (email), `SMS_PROVIDER` + provider key (`MSG91_AUTH_KEY` or `FAST2SMS_API_KEY`) (SMS), and `META_WHATSAPP_ACCESS_TOKEN` (WhatsApp if enabled) during the notifications/confirmation integration slice.
- Each dry-run result is part of the per-slice integration test evidence required before closing the slice.

This aligns with the mandatory `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §1.2 delivery model and the `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` §8.1 gate.

When mapping dry-runs to slices, follow the mandated build order: Foundation -> Ops control plane -> Admin read -> Admin mutation -> Reliability -> Storefront customer journey.

## 1) Integration inventory (env / ops config mapping)

> **Two-tier config model:** Bootstrap keys (`DATABASE_URL`, `REDIS_URL`, `OPS_DB_ENCRYPTION_KEY`) come from `.env` only. All provider credentials and ops-security parameters listed below are **DB-overlay keys** — in production they must be saved via Ops UI (`POST /api/v1/ops/config/save`) and take effect after container restart. They must **not** be set in `.env` in production. See `docs/ENV_VS_DB_CONFIG_REFERENCE.md` for the full classification.
>
> **Exception — Resend (Phase 1 bootstrap):** `RESEND_API_KEY` and `RESEND_FROM` must be set as live values in `.env` before running `node scripts/ops-newuser.mjs` to send the first ops invite email. After first ops login, rotate and manage them exclusively via Ops UI. See `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`.

Cross-cutting credential governance notes:
- `DATABASE_URL`, initial `REDIS_URL`, and `OPS_DB_ENCRYPTION_KEY` are bootstrap-only deployment env values and cannot be activated from DB-backed Ops config.
- Contract-listed non-bootstrap infrastructure/security secrets can be edited through the developer Ops UI when `mutableViaOps: true` in `src/modules/ops/ops-config-contract.ts`; these edits require ops auth, `ops:write`, verified email OTP, encrypted DB persistence, and API/worker restart before runtime effect.
- Admin access control changes are token-issuance scoped; if permissions are rotated during incident response, force session revocation/logout to enforce changes immediately.
- Financial support runbooks must treat refunds as asynchronous queue/provider workflows; immediate API responses are not authoritative for final refunded state.
- Race-condition hardening: Backend uses atomic Compare-And-Swap (CAS) patterns via Prisma `updateMany` with guard conditions for idempotency, invite consumption, token refresh, and reconciliation. All critical state transitions are protected against TOCTOU races.

### 1.1 Payments (Razorpay)
- `PAYMENT_PROVIDER=razorpay`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `RAZORPAY_WEBHOOK_SECRET_OLD` (temporary overlap during rotation)
- `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR` (defense-in-depth)
- `RAZORPAY_WEBHOOK_MAX_SKEW_SECONDS`
- Frontend: `NEXT_PUBLIC_RAZORPAY_KEY_ID` (only this one is public)

### 1.2 Shipping (Delhivery and/or Shiprocket)

> Provider detection is credential-based — `SHIPPING_PROVIDER` env var is ignored. Set credentials for whichever provider(s) the client uses. Both can be active simultaneously.

- Common:
  - `SHIPPING_WEBHOOK_ALLOWLIST_CIDR`
  - `DELHIVERY_WEBHOOK_MAX_SKEW_SECONDS`
  - `SHIPROCKET_WEBHOOK_MAX_SKEW_SECONDS`
- Delhivery:
  - `DELHIVERY_API_KEY`
  - `DELHIVERY_BASE_URL` (optional override)
  - `DELHIVERY_WEBHOOK_TOKEN`
  - `DELHIVERY_PICKUP_PINCODE`
  - `DELHIVERY_WEBHOOK_ALLOWLIST_CIDR` (legacy fallback)
- Shiprocket:
  - `SHIPROCKET_EMAIL`
  - `SHIPROCKET_PASSWORD`
  - `SHIPROCKET_WEBHOOK_TOKEN`
  - `SHIPROCKET_PICKUP_PINCODE`
  - `SHIPROCKET_PICKUP_LOCATION`
  - `SHIPROCKET_BASE_URL` (optional override)
  - `SHIPROCKET_WEBHOOK_ALLOWLIST_CIDR`

Dispatch policy (applies regardless of provider):
- Shipment creation is manual-only from admin ship action (`POST /api/v1/admin/orders/:id/ship`).
- Payment confirmation/webhook does not auto-book shipments.

### 1.3 Notifications (Resend + MSG91 / Fast2SMS + Meta WhatsApp)

**Channel architecture:**
- **Email:** Resend (runtime provider)
- **SMS:** MSG91 or Fast2SMS (selectable via `SMS_PROVIDER`)
- **WhatsApp:** Meta Cloud API direct (runtime provider) — decoupled from SMS provider choice

**Implementation compliance notes:**
- All three notification channels are validated at startup only when their respective `NOTIFY_*_ENABLED` flag is `true`
- Default behaviors (code-enforced in `src/config/feature-flags.ts` and `src/modules/notifications/notification-provider.ts`):
  - `NOTIFY_EMAIL_ENABLED` — defaults to `true` if unset
  - `NOTIFY_SMS_ENABLED` — defaults to `false` if unset (opt-in channel — enable only after configuring provider credentials)
  - `NOTIFY_WHATSAPP_ENABLED` — defaults to `false` if unset (opt-in channel)
- Provider adapters are instantiated in `createNotificationProviders()` with unavailable adapters returned for disabled channels
- Notification worker (`queues/workers/notifications.worker.ts`) logs provider as `'meta-whatsapp'` for WhatsApp messages; calls `onProviderSuccess` / `onProviderFailure` on each send attempt to track systematic provider outages and emit `sendNotificationFailureAlert` when failure thresholds are exceeded
- Meta WhatsApp credentials are required only when `NOTIFY_WHATSAPP_ENABLED=true` (enforced in both `app.config.ts` and `ops-config-contract.ts`)

**Provider-specific notes:**
- Resend (`EMAIL_PROVIDER=resend`): Transactional email with React Email templates
- MSG91 (`SMS_PROVIDER=msg91`): India-optimized SMS/OTP with DLT compliance
- Fast2SMS (`SMS_PROVIDER=fast2sms`): India-optimized SMS/OTP without DLT registration; supports Quick SMS and OTP routes
- Noop (`SMS_PROVIDER=noop`): SMS channel disabled without provider credentials
- Meta WhatsApp: Direct Meta Graph API integration (no BSP markup), template-based messaging

- Toggles (all support `true`/`false`):
  - `NOTIFY_EMAIL_ENABLED` — defaults to `true` if unset
  - `NOTIFY_SMS_ENABLED` — defaults to `false` if unset (opt-in channel — enable only after configuring provider credentials)
  - `NOTIFY_WHATSAPP_ENABLED` — defaults to `false` if unset (opt-in channel)

- Resend:
  - `EMAIL_PROVIDER=resend`
  - `RESEND_API_KEY`
  - `RESEND_FROM`

- MSG91 (when `SMS_PROVIDER=msg91`):
  - `MSG91_AUTH_KEY`
  - `MSG91_SENDER_ID`
  - `MSG91_ROUTE`

- Fast2SMS (when `SMS_PROVIDER=fast2sms`):
  - `FAST2SMS_API_KEY`

- Meta WhatsApp (required when `NOTIFY_WHATSAPP_ENABLED=true`):
  - `META_WHATSAPP_ACCESS_TOKEN` — Permanent system user token
  - `META_WHATSAPP_PHONE_NUMBER_ID` — WhatsApp Business phone number ID
  - `META_WHATSAPP_API_VERSION` — Graph API version (default: `v21.0`)
  - `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` — Webhook verification token

- Runtime hardening requirements:
  - `RESEND_API_KEY` and the active SMS provider key (`MSG91_AUTH_KEY` or `FAST2SMS_API_KEY`) must be present when respective channels are enabled.
  - `META_WHATSAPP_ACCESS_TOKEN` and `META_WHATSAPP_PHONE_NUMBER_ID` are required only when `NOTIFY_WHATSAPP_ENABLED=true`.
  - Channel toggles (`NOTIFY_*`) are checked at provider initialization; disabled channels skip credential validation.
  - MSG91 delivery normalizes phone numbers to Indian `91XXXXXXXXXX` format; accepted inputs are 10-digit Indian numbers (with or without separators) or already `91`-prefixed values.
  - Meta WhatsApp uses E.164 phone format (`+91XXXXXXXXXX`) for all message sends.

- Per-template primary notification channel (DB-backed):
  - Primary channel for each template is configured in `StoreSettings.primaryNotificationChannels` (JSON object mapping template name to `EMAIL` | `SMS` | `WHATSAPP`).
  - 13 supported templates: `OrderConfirmed`, `PaymentFailed`, `OrderShipped`, `OutForDelivery`, `OrderDelivered`, `OrderCancelled`, `LowStockAlert`, `OtpVerification`, `NotificationDeliveryFailure`, `PasswordReset`, `AdminInviteSetup`, `OpsInviteSetup`, `OpsActionOtp`.
  - Default for all templates is `EMAIL`.
  - No fallback: if the configured primary channel fails (disabled, missing credentials, provider error), the notification fails immediately and triggers a technical failure alert.
  - Per-template channels are configured via direct API: `PATCH /api/v1/admin/settings/notifications` with `primaryChannels` payload (admin JWT). **Note (2026-06-07):** Merchant admin UI for this was removed; use the API directly or set defaults at go-live. Provider availability toggles are in ops config (`/ops/config`).
  - Worker reads primary channel from DB at job processing time, not from environment variables.

### 2.5 Fast2SMS (SMS/OTP — no DLT required)

**Use when:** DLT registration is not available or cost-prohibitive.

**Account setup:**
- Sign up at https://www.fast2sms.com
- Generate API key from dashboard.

**API credentials:**
- Copy API key.

**Env mapping**
- `NOTIFY_SMS_ENABLED=true`
- `SMS_PROVIDER=fast2sms`
- `FAST2SMS_API_KEY=<api key>`

### 1.4 Invoice Storage (local filesystem)
- `INVOICE_STORAGE_ROOT`

### 1.5 Other external services used in production
- Redis (managed/self-hosted): `REDIS_URL`, `REDIS_PASSWORD`
- PostgreSQL: `DATABASE_URL`
- OTEL collector/APM (optional):
  - `OTEL_TRACING_ENABLED`
  - `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
  - `OTEL_EXPORTER_OTLP_HEADERS`

## 2) Provider setup runbooks

## 2.1 Razorpay (production)

### Account setup
1. Create Razorpay account and complete business KYC for live mode.
2. In dashboard, generate both Test and Live API keys.
3. Keep test keys for staging, live keys for production.

### Webhook setup
1. Add webhook endpoint: `https://<domain>/api/v1/payments/webhook`.
2. Subscribe to required events: `payment.captured`, `payment.failed`, `refund.processed` (actively processed). Optionally subscribe to `payment.authorized` and `refund.failed` (received but no-op in current implementation).
3. Set a dedicated webhook secret (not your API key secret).
4. Store in env as `RAZORPAY_WEBHOOK_SECRET`.

### Important implementation alignment
- Signature header: `X-Razorpay-Signature`.
- Validate against raw request body (do not parse/cast before verification).
- Implement idempotency using `x-razorpay-event-id`.

### Outbound request retry/backoff policy (all providers)

- Timeouts: all outbound requests use bounded timeouts (AbortSignal) — no unbounded hangs.
- Idempotency:
  - Only idempotent operations may be retried (for example: rate/label fetch, serviceability checks, payment GETs).
  - Non-idempotent provider operations (create/assign/ship/refund) must be guarded by backend idempotency keys and CAS semantics before considering retries; when in doubt, do not auto-retry.
- Backoff: for retry-eligible calls, use small bounded attempts (max 2) with exponential backoff + jitter (for example, 250ms, then 750±250ms). Do not exceed 2s total budget per logical call.
- Errors: classify transport vs provider business errors — only retry transport (network timeout/5xx) and explicitly retryable 429s. Never retry 4xx business errors.
- Observability: record per-provider latency and outcome labels (accepted/rejected/duplicate/enqueue_failed). For webhook flows, dedupe rates are tracked via event-id or inbox claims and surfaced in metrics.

## 2.2 Delhivery

### Account + token
1. Log into Delhivery One.
2. Go to `Settings -> API Setup`.
3. Generate/request live API token.
4. Copy token immediately and store in vault (visibility is limited).

### API test/validation
- Use Delhivery developer portal (`ucp.delhivery.com`) to validate serviceability and shipment APIs.

### Env mapping
- `DELHIVERY_API_KEY=<token>` — presence of this key activates Delhivery (no `SHIPPING_PROVIDER` needed)
- `DELHIVERY_WEBHOOK_TOKEN=<shared secret/token used for webhook auth>`
- `DELHIVERY_PICKUP_PINCODE=<client pickup pin>`

## 2.3 Shiprocket

> **Important:** Shiprocket integration uses the **REST API** approach for custom e-commerce sites. Do NOT use the "Connect My Store" button in the Shiprocket dashboard — that is designed for pre-built platforms (Shopify, WooCommerce, etc.) only.

### Account + API Credentials

1. **Register/Login** at [app.shiprocket.in](https://app.shiprocket.in/seller/homepage)
2. **Complete KYC** — submit business documents (GST, bank details) for full API access
3. **Generate API Credentials:**
   - Navigate to `Settings → API` (or visit directly: `app.shiprocket.in/seller/settings/api`)
   - Click **"Generate API Token"** or create a dedicated API user
   - Note down the email/password — these are used to obtain a JWT token

### Authentication Flow

Shiprocket uses JWT tokens valid for ~10 days (240 hours). The backend handles automatic token refresh.

**Auth endpoint:**
```http
POST https://apiv2.shiprocket.in/v1/external/auth/login
Content-Type: application/json

{
  "email": "your-api-user@example.com",
  "password": "your-api-password"
}
```

**Response:**
```json
{
  "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "expires_in": 864000
}
```

**Authenticated requests:**
```http
Authorization: Bearer <token>
Content-Type: application/json
```

### Key API Endpoints Used

| Action | Endpoint | Purpose |
|--------|----------|---------|
| **Create Order** | `POST /v1/external/orders/create/adhoc` | Create a new shipping order in Shiprocket |
| **Assign AWB** | `POST /v1/external/courier/assign/awb` | Generate tracking number (AWB) and assign courier |
| **Schedule Pickup** | `POST /v1/external/courier/generate/pickup` | Request courier pickup from warehouse |
| **Track Shipment** | `GET /v1/external/courier/track/awb/{awb}` | Get real-time tracking status |
| **Check Serviceability** | `GET /v1/external/courier/serviceability` | Check if a pincode is serviceable |
| **Calculate Rates** | `GET /v1/external/courier/serviceability` | Get shipping rates from available couriers |
| **Cancel Order** | `POST /v1/external/orders/cancel` | Cancel a shipment before pickup |
| **Generate Label** | `POST /v1/external/courier/generate/label` | Download shipping label PDF |

### Typical Order Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Customer Order │────▶│  Admin Ship Action │────▶│ Create Shiprocket│
│   Confirmed     │     │  (POST /admin/     │     │    Order         │
└─────────────────┘     │  orders/:id/ship)│     └────────┬────────┘
                          └──────────────────┘              │
                                                            ▼
                          ┌──────────────────┐     ┌─────────────────┐
                          │  Update Order    │◄────│  Assign AWB     │
                          │  Status → SHIPPED│     │  (Tracking #)   │
                          └────────┬─────────┘     └─────────────────┘
                                   │
                                   ▼
                          ┌──────────────────┐
                          │ Schedule Pickup  │
                          │ (Optional step)  │
                          └────────┬─────────┘
                                   │
                                   ▼
                          ┌──────────────────┐
                          │  Webhook Updates │◄──── Real-time status
                          │  (IN_TRANSIT →   │      from Shiprocket
                          │   OUT_FOR_DELIVERY│
                          │   → DELIVERED)   │
                          └──────────────────┘
```

### Webhook Setup

Receive real-time shipment status updates without polling.

1. **In Shiprocket Dashboard:**
   - Go to `Settings → API → Webhooks`
   - Add your webhook endpoint URL: `https://yourdomain.com/api/v1/shipping/webhook`

2. **Configure Events:**
   - `shipment_status` — tracking updates (IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED)
   - `order_status` — order lifecycle events

3. **Security:**
   - Set a webhook secret/token in Shiprocket dashboard
   - Store it as `SHIPROCKET_WEBHOOK_TOKEN` in your environment
   - Backend validates the token from (in priority order):
     1. `x-api-key: <token>` — **primary** (official Shiprocket docs format)
     2. `x-shiprocket-token: <token>` — alternate header
     3. `Authorization: Bearer <token>` — backward compatibility
   - Optional: Configure `SHIPROCKET_WEBHOOK_ALLOWLIST_CIDR` for IP-level defense

### Environment Mapping

```bash
# No SHIPPING_PROVIDER needed — presence of credentials activates Shiprocket
# API credentials (from Settings → API)
SHIPROCKET_EMAIL=your-api-user@example.com
SHIPROCKET_PASSWORD=your-api-password

# Webhook security (from Settings → API → Webhooks)
SHIPROCKET_WEBHOOK_TOKEN=your-webhook-secret

# Optional: IP allowlist for webhook ingress defense
SHIPROCKET_WEBHOOK_ALLOWLIST_CIDR=

# Pickup location pincode (your warehouse/fulfillment center)
SHIPROCKET_PICKUP_PINCODE=560001

# Pickup address nickname — must match Shiprocket Dashboard → Settings → Pickup Addresses
# (defaults to Primary when unset)
SHIPROCKET_PICKUP_LOCATION=Primary

# Optional: Override base URL (defaults to https://apiv2.shiprocket.in/v1/external)
SHIPROCKET_BASE_URL=
```

### API Test/Validation

1. **Test Authentication:**
   ```bash
   curl -X POST https://apiv2.shiprocket.in/v1/external/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"YOUR_EMAIL","password":"YOUR_PASSWORD"}'
   ```

2. **Test Serviceability:**
   ```bash
   curl "https://apiv2.shiprocket.in/v1/external/courier/serviceability?\
     pickup_postcode=560001&delivery_postcode=110001&weight=0.5&cod=0" \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

3. **Full E2E Test (via admin API):**
   - Create a test order
   - Call `POST /api/v1/admin/orders/:id/ship`
   - Verify shipment created with AWB in response
   - Check `GET /api/v1/admin/orders/:id` returns tracking URL

### Official Resources

- **Full API Docs:** https://apidocs.shiprocket.in/
- **Developer Portal:** https://www.shiprocket.in/developers/
- **API Helpsheet:** https://support.shiprocket.in/support/solutions/articles/43000337456-shiprocket-api-document-helpsheet

## 2.4 Resend

### Domain + sender setup
1. Add sending domain/subdomain in Resend (recommended subdomain for transactional mail).
2. Publish DNS records for SPF and DKIM.
3. (Recommended) publish DMARC.
4. Wait for domain status `verified`.

### API key setup
1. Create API key scoped for sending.
2. Store key as `RESEND_API_KEY`.
3. Set `RESEND_FROM` to a verified sender identity.

### Env mapping
- `NOTIFY_EMAIL_ENABLED=true`
- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY=<api key>`
- `RESEND_FROM="Brand <noreply@yourdomain.com>"`

## 2.5 MSG91

### Account + compliance setup
1. Create MSG91 account.
2. Configure sender ID according to target-country rules.
3. For India traffic, complete DLT requirements (entity/header/template alignment).

### OTP template setup
1. In MSG91 dashboard, open OTP section.
2. Create template and include OTP placeholder (`##OTP##`).
3. Keep template metadata for operations and audits.

### API credentials
- Create/collect auth key and sender id.
- Configure route value according to your MSG91 account setup.

### Env mapping
- `NOTIFY_SMS_ENABLED=true`
- `SMS_PROVIDER=msg91`
- `MSG91_AUTH_KEY=<auth key>`
- `MSG91_SENDER_ID=<approved sender id>`
- `MSG91_ROUTE=<route code>`

## 2.6 Meta WhatsApp (Meta Cloud API direct)

**Architecture decision:** Meta Cloud API direct integration (no BSP like Interakt/Wati). This eliminates platform fees on top of Meta conversation charges.

### Account setup — step by step

**Step 1: Create Meta Business Account**
1. Go to https://business.facebook.com
2. Create Business Account (if not exists)
3. Name: Client's business name
4. Business Email: Client's email
5. Verify business (submit documents if required)

**Step 2: Create Meta Developer App**
1. Go to https://developers.facebook.com
2. My Apps → Create App
3. Select: **Business** type
4. App Name: `[ClientName]-ecommerce`
5. Business Account: Select the client's Meta Business Account
6. Add Product: **WhatsApp** → Set Up

**Step 3: WhatsApp Business Account (WABA)**
1. In the app: WhatsApp → Getting Started
2. Add phone number:
   - Use a **dedicated number for WhatsApp** (not personal)
   - Can be a new SIM or ported number
   - Verify via OTP
3. Note down:
   - **Phone Number ID** (from the WhatsApp setup page)
   - **WhatsApp Business Account ID** (WABA ID)
   - **Temporary Access Token** (generate permanent token next)

**Step 4: Generate Permanent Access Token**
```
Meta Business Settings → System Users → Add System User
  → Role: Admin
  → Generate Token → Select App
  → Permissions: whatsapp_business_messaging, whatsapp_business_management
  → Generate Token → Save this (shown once only)
```

**Step 5: Create Message Templates**
Go to WhatsApp Manager → Message Templates → Create Template

Template example for order shipped:
```
Category: Utility
Name: order_shipped_notification
Language: English (India) [en]

Header (Text): Your Order is Shipped! 🚚
Body: 
Hi {{1}}, your order #{{2}} has been shipped via {{3}}.
Tracking ID: {{4}}
Expected delivery: {{5}}
Track here: {{6}}

Footer: Reply STOP to opt out
Buttons: [Quick Reply: Track Order]
```

Meta reviews templates in 24-48 hours. Utility templates (order updates, auth) are approved faster than marketing.

**Step 6: Configure Webhook**
```
WhatsApp → Configuration → Webhook
  Callback URL: https://<client-domain>/api/v1/notifications/webhook/meta-whatsapp
  Verify Token: Set to match META_WHATSAPP_WEBHOOK_VERIFY_TOKEN env value

  Subscribe to: messages, message_status_updates
```

Backend webhook handler (implemented):
- `GET /api/v1/notifications/webhook/meta-whatsapp` — Webhook verification (returns challenge)
- `POST /api/v1/notifications/webhook/meta-whatsapp` — Event ingestion (message status updates)

**Step 7: Test Integration**
1. Enable WhatsApp notifications: `NOTIFY_WHATSAPP_ENABLED=true`
2. Configure env vars (see below)
3. Trigger test order → shipment → verify WhatsApp template message sent

### Meta WhatsApp Pricing (India — 2026)

| Message Type | Cost per Message |
|---|---|
| Utility (order updates, auth) | ~₹0.11 – ₹0.12 |
| Authentication (OTPs) | ~₹0.11 |
| Marketing (promotions) | ~₹0.86 |
| Service (customer-initiated) | Free (first 1000/month) |

### Env mapping
- `NOTIFY_WHATSAPP_ENABLED=true` — Enable WhatsApp channel (defaults to `false`)
- `META_WHATSAPP_ACCESS_TOKEN=<permanent_system_user_token>`
- `META_WHATSAPP_PHONE_NUMBER_ID=<phone_number_id>`
- `META_WHATSAPP_API_VERSION=v21.0` — Graph API version
- `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN=<random_verify_string>` — Must match webhook config in Meta dashboard

### Security notes
- `META_WHATSAPP_ACCESS_TOKEN` is a **never-expose** secret (backend-only)
- Webhook verification token must match between Meta dashboard and env
- Store all tokens in vault; rotate on compromise or every 90 days
- Webhook endpoint is rate-limited under `webhook` tier
- Invalid webhook verification attempts return HTTP 403 (handled via `AppError` → global error handler)
- Webhook event processing returns HTTP 200 for successful ingestion with `{ received: true }` body

## 2.7 Invoice local storage

### Server setup
1. Create a persistent invoice directory on VPS (for example `/var/www/<client>/storage/invoices`).
2. Ensure backend and workers have read/write access.
3. Include path ownership and permissions in deployment runbook.

### Storage security
- Keep invoice files in backend-managed filesystem paths only.
- Never expose writable filesystem paths to frontend clients.
- Serve invoice PDFs through authenticated backend routes.
- Customer route: `GET /api/v1/orders/:id/invoice.pdf`
- Admin route: `GET /api/v1/admin/orders/:id/invoice.pdf`
- Order APIs expose invoice metadata (`invoice.hasPdf`) instead of raw/public PDF URLs.

### Env mapping
- `INVOICE_STORAGE_ROOT=<absolute invoice directory>`

Related ops configuration hardening:
- `OPS_DB_ENCRYPTION_KEY` is bootstrap-only and required from real deployment environment for encrypted persistence and boot-time DB runtime overlay.
- `DATABASE_URL` and initial `REDIS_URL` are also bootstrap-only because the process needs them before DB-backed Ops config can be read.
- Provider credentials saved through `/api/v1/ops/config/save` are encrypted in `OpsConfigSecret`, override env only for contract-allowed non-bootstrap keys, and apply after API/worker restart.

## 3) Frontend vs backend secret boundaries

- Safe in frontend (`NEXT_PUBLIC_*`):
  - `NEXT_PUBLIC_API_BASE_URL`
  - `NEXT_PUBLIC_STOREFRONT_URL`
  - `NEXT_PUBLIC_RAZORPAY_KEY_ID`
- Never expose in frontend:
  - Any `*_SECRET`
  - `RAZORPAY_KEY_SECRET`
  - `RAZORPAY_WEBHOOK_SECRET`
  - Shipping credentials/tokens
  - `RESEND_API_KEY`, `MSG91_AUTH_KEY`
  - `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`
  - Local invoice storage path (`INVOICE_STORAGE_ROOT`) remains backend-only configuration

## 4) Key management policy (recommended baseline)

### 4.0 Script credential safety (audit-verified May 2026)
- Merchant admin production provisioning is invite-only through `POST /api/v1/admin/invites` and `/admin/setup`; do not use seed scripts for go-live admin creation.
- Legacy/local admin scripts (`scripts/upsert-admin.js`, `scripts/seed-admin.mjs`) read credentials from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` env vars — no hardcoded production credentials.
- `scripts/ops-newuser.mjs` reads invite/email/encryption configuration from env and does not hardcode credentials.
- For local development, safe fallback defaults are used when env vars are absent. In production, prefer invite-only setup; if any emergency local script is used, always set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` and record an incident exception.

## 4.1 Storage and access
- Store all secrets in a vault/secret manager, not in git, chat, or tickets.
- Restrict edit/read access by role (least privilege).
- Use separate credentials per environment (dev/staging/prod).
- Never reuse one client's credentials for another client.

## 4.2 Rotation cadence
- Payment/shipping webhook secrets: rotate every 90 days (or faster on incident).
- API keys/password-style credentials: rotate every 90–180 days.
- Immediate rotation on staff offboarding or suspected leak.

## 4.3 Zero-downtime rotation pattern
1. Create new key/secret in provider dashboard.
2. Update vault entry and credential register metadata.
3. Save the new key via Ops UI (`POST /api/v1/ops/config/save`) — requires ops auth, `ops:write` permission, and email OTP challenge.
4. If supported, keep overlap window before revoking old key:
   - Example: `RAZORPAY_WEBHOOK_SECRET_OLD` during transition.
5. Restart containers to apply the DB-overlay change. Two options:
   - **Ops UI (preferred, no SSH):** `POST /api/v1/ops/system/restart` with OTP. The cart-cleanup worker pauses `outboxDispatch` first, drains all queues (`RESTART_QUEUE_DRAIN_TIMEOUT_MS`, default 60 s) and `PENDING_PAYMENT` orders (`RESTART_PAYMENT_DRAIN_TIMEOUT_MS`, default 5 min), resumes queues, then publishes a restart signal. No queue job is lost; ~3–5 s downtime window.
   - **SSH/VPS:** `docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d backend workers`.
6. Verify live traffic succeeds with new credential.
7. Revoke old key/secret after verification window.

## 4.4 Audit and ownership
- Maintain owner, last-rotated date, and expiry date per integration.
- Keep runbook evidence in release artifacts.
- Include key lifecycle checks in go-live checklist.

## 5) Staging dry-run runbook (mandatory once per provider)

Record all outcomes in the client credential register under "Staging dry-run evidence log".

### 5.1 Razorpay payment + webhook validation
1. Place prepaid order in staging storefront.
2. Complete payment in Razorpay test/live sandbox mode.
3. Confirm backend receives webhook and signature validation passes.
4. Confirm duplicate webhook delivery does not duplicate side effects.
5. Archive evidence: order timeline, webhook headers, and final status proof.

### 5.2 Delhivery/Shiprocket shipment + webhook validation
1. Create shipment from admin flow.
2. Confirm AWB generation and tracking fetch works.
3. Trigger or wait for shipping status webhook.
4. Confirm webhook auth token/signature and skew validation pass.
5. Archive evidence: AWB, tracking timeline, webhook processing proof.

### 5.3 MSG91 OTP send/verify
1. Trigger OTP send flow using staging number set.
2. Verify OTP through the product flow.
3. Confirm sender/template compliance (DLT where applicable).
4. Confirm phone normalization behavior (`9876543210` -> `919876543210`) and that invalid formats are rejected before provider call.
5. Archive evidence: send + verify request IDs and successful auth/session proof.

### 5.4 Resend verified sender test
1. Send transactional email from verified `RESEND_FROM` identity.
2. Confirm message accepted by provider and delivered to test inbox.
3. Validate SPF/DKIM alignment for sending domain.
4. Archive evidence: provider message ID + inbox receipt screenshot/log.

### 5.5 Invoice local storage write/read cycle
1. Generate representative invoice PDF through backend flow.
2. Confirm file exists under configured `INVOICE_STORAGE_ROOT`.
3. Validate authenticated invoice download endpoints return expected PDF content.
4. Validate access controls (customer/admin auth) for invoice download routes.
5. Archive evidence: file path proof, route response sample, and auth verification notes.

## 6) Rotation calendar (90-day default) and ownership

Use 90 days as default for all integration secrets unless stricter policy applies.

| Integration Group | Primary Owner | Backup Owner | Cadence | Next Rotation |
| --- | --- | --- | --- | --- |
| Payments (Razorpay keys + webhook secret) | Payments Owner | Ops Backup | 90 days | YYYY-MM-DD |
| Shipping (Delhivery/Shiprocket auth + webhook tokens) | Logistics Owner | Ops Backup | 90 days | YYYY-MM-DD |
| Notifications (MSG91 + Resend) | Notifications Owner | Ops Backup | 90 days | YYYY-MM-DD |
| Invoice storage path controls | Platform Owner | Ops Backup | 90 days | YYYY-MM-DD |

Rotation execution checklist:
1. Generate new provider credential.
2. Update vault entry and credential register metadata.
3. Save new credential via Ops UI (`POST /api/v1/ops/config/save`) — ops auth + email OTP required.
4. Restart containers (Ops UI preferred — `POST /api/v1/ops/system/restart` with OTP runs the graceful queue+payment drain protocol; SSH fallback: `docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d backend workers`).
5. Verify provider flow in staging/production-safe path.
6. Revoke old credential after overlap window.

## 7) Compromise drill (run once immediately, then quarterly)

Objective: prove the team can rotate and recover quickly under key leak conditions.

Drill sequence (`revoke -> regenerate -> ops-save -> restart -> verify`):
1. Revoke selected credential in provider dashboard.
2. Regenerate replacement credential.
3. Update vault and save new credential via Ops UI (`POST /api/v1/ops/config/save`) — ops auth + email OTP required.
4. Restart containers — full recreate, not `docker restart` (because env-var overlay only re-reads on container start). Ops UI: `POST /api/v1/ops/system/restart` with OTP (the graceful drain protocol pauses queues, drains in-flight jobs and `PENDING_PAYMENT` orders, then exits — Docker `restart: unless-stopped` brings them back with fresh overlay). SSH fallback: `docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d backend workers`.
5. Verify affected flow succeeds and old credential is unusable.
6. Record elapsed time, blockers, and remediation actions.

Success criteria:
- End-to-end recovery completed inside agreed SLA (recommended: <= 30 min).
- No long-lived outage on critical checkout/shipping/notification path.
- Register and incident notes updated with exact timestamps.

## 8) Frontend rules sync control (for every frontend repo)

Before frontend release, ensure latest rules are synced from backend template:

1. Copy latest rules file:
   - `cp ../backend/frontend-agent-rules.md .agents/rules/dev-rules.md`
2. Verify file is current (hash or diff check).
3. Commit rules update in frontend repo when changed.

Recommended verification commands:

```bash
diff -u ../backend/frontend-agent-rules.md .agents/rules/dev-rules.md
```

Windows PowerShell equivalent:

```powershell
Compare-Object (Get-Content ..\backend\frontend-agent-rules.md) (Get-Content .agents\rules\dev-rules.md)
```

## 9) Official references used (web research)

- Razorpay Quickstart: https://razorpay.com/docs/payments/quickstart/
- Razorpay Webhook Validation: https://razorpay.com/docs/webhooks/validate-test/
- Delhivery token generation/help: https://help.delhivery.com/docs/api-token-generation
- Delhivery developer portal/help: https://help.delhivery.com/docs/client-developer-portal-1
- Shiprocket developer page: https://www.shiprocket.in/developers/
- Shiprocket API helpsheet: https://support.shiprocket.in/support/solutions/articles/43000337456-shiprocket-api-document-helpsheet
- Resend domain verification: https://resend.com/docs/dashboard/domains/introduction
- MSG91 OTP setup help: https://msg91.com/help/sendotp/step-by-step-process-to-configure-otp
- MSG91 OTP template help: https://msg91.com/help/where-to-find-the-sendotp-api-how-to-get-template-id

---

> **Provider setup spans multiple onboarding phases.** Phase 1 (account creation and initial credentials), Phase 4 (staging dry-runs per provider per vertical slice), Phase 10 (live webhook URL registration after VPS + HTTPS are active), and Phase 13 (90-day rotation calendar and compromise drill setup). The full sequenced execution order for all of these is in **[`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](CLIENT_ONBOARDING_EXECUTION_ORDER.md)**. Never complete all provider setup in one batch at the start — dry-runs must happen alongside the frontend slice that integrates each provider.

---

## Phase 7 bootstrap caveat (May 2026)

First VPS startup now hard-fails only on bootstrap keys. DB-overlay runtime keys (provider/security) can be configured after first Ops login. For deterministic startup:

- pass bootstrap env preflight before container startup,
- complete provider/security config in Ops UI,
- restart backend/workers and confirm `GET /api/v1/health/ready` returns `runtimeConfigMissingKeys: []` before launch.

Reference:

- `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md`
