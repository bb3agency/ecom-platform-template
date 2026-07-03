# VPS inputs — Raghava Organics (template)

Copy to `VPS_INPUTS.md` (gitignored) and fill before VPS deploy.

See [README.md](./README.md) for execution order.

| Field | Value |
|-------|-------|
| `PRODUCTION_DOMAIN` | `raghavaorganics.com` |
| `DNS_PROVIDER` | Cloudflare (nameservers at Namecheap) |
| `IMAGE_CDN_HOST` | `cdn.raghavaorganics.com` |
| `VPS_IP` | |
| `DEPLOY_USER` | |
| `GIT_REPO_URL` | |

Ports: `BACKEND_PORT=3001`, `STOREFRONT_PORT=3101`, `CLIENT_ID=raghava-organics`

## Cloudflare R2 (Ops UI — Product Media)

Non-secret values: [CLOUDFLARE_R2_MEDIA.md](./CLOUDFLARE_R2_MEDIA.md). Store `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` only in the filled `VPS_INPUTS.md` vault — never commit.

## Razorpay (Ops UI — Payments)

Runbook: [RAZORPAY_PAYMENTS_SETUP.md](./RAZORPAY_PAYMENTS_SETUP.md). Store `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` only in the filled `VPS_INPUTS.md` vault.

| Field | Value |
|-------|-------|
| `PAYMENT_PROVIDER` | `razorpay` |
| `RAZORPAY_KEY_ID` | |
| `RAZORPAY_KEY_SECRET` | |
| `RAZORPAY_WEBHOOK_SECRET` | generate 32+ char random; same in Razorpay webhook + Ops UI |
| Webhook URL | `https://<domain>/api/v1/payments/webhook` |
| Webhook events | `payment.captured`, `payment.failed`, `refund.processed` |

## Shiprocket (Ops UI — Shipping)

| Field | Value |
|-------|-------|
| `SHIPPING_PROVIDER` | `shiprocket` |
| `SHIPROCKET_EMAIL` | |
| `SHIPROCKET_PASSWORD` | |
| `SHIPROCKET_PICKUP_PINCODE` | warehouse pincode |
| `SHIPROCKET_PICKUP_LOCATION` | pickup nickname in Shiprocket dashboard (default `Primary`) |
| `SHIPROCKET_WEBHOOK_TOKEN` | |
| Webhook URL | `https://<domain>/api/v1/shipping/webhook` |

## Meta WhatsApp (Ops UI — Notifications)

Runbook: `backend/docs/META_WHATSAPP_SETUP_GUIDE.md` (per-client Meta Business/Developer/WhatsApp
Manager setup). Template bodies/params: `backend/docs/WHATSAPP_TEMPLATE_REGISTRY.md`. Store the
access token, app secret and verify token only in the filled `VPS_INPUTS.md` vault — never commit.

| Field | Value |
|-------|-------|
| `META_WHATSAPP_ACCESS_TOKEN` | System User token (never-expiring preferred) |
| `META_WHATSAPP_PHONE_NUMBER_ID` | |
| `META_WHATSAPP_WABA_ID` | |
| `META_WHATSAPP_APP_SECRET` | |
| `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` | random 32+ chars; same in Meta webhook config + Ops UI |
| `META_WHATSAPP_API_VERSION` | `v25.0` (optional — code defaults to v25.0) |
| `NOTIFY_WHATSAPP_ENABLED` | `false` until templates Approved, then `true` |
| `OTP_WHATSAPP_ENABLED` | `false` until `otp_verify` Approved AND app Live; paid per message |
| `WHATSAPP_OTP_COST_PAISE` | `14` (Ops cost-meter estimate only) |
| Webhook URL | `https://<domain>/api/v1/notifications/webhook/meta-whatsapp` (apex domain) |
| Webhook fields | `messages` (statuses arrive nested in the same payload) |

**Templates that must be Approved in WhatsApp Manager (8):** `otp_verify` (Authentication,
copy-code button) + Utility ×7: `order_confirmed`, `order_shipped`, `out_for_delivery`,
`order_delivered`, `order_cancelled`, `payment_failed`, `return_request_update`.
