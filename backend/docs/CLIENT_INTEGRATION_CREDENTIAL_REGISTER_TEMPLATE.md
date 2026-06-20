# Client Integration Credential Register Template

Use this file as the per-client source of truth for third-party credentials and ownership.

- Create one copy per client/environment (for example: `ops/<client>/integration-credential-register.md`).
- Do not store raw secrets in this file.

Shipping policy note:
- Shipment booking is manual-only via admin ship action (`POST /api/v1/admin/orders/:id/ship`).
- There is no `AUTO_SHIP_ON_CONFIRM` credential or runtime secret to track in this register.
- Store only metadata and vault references.

Use together with:
- `docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md` — master sequenced runbook; this register is filled progressively across Phase 1 (credential creation), Phase 4 (dry-run evidence), Phase 10 (live webhook registration), and Phase 13 (rotation calendar)
- `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`
- `docs/BACKEND_GO_LIVE_CHECKLIST.md`
- `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md`

Integration methodology note:
- Credentials must be validated as part of each **vertical slice** that touches the provider (not deferred to a separate "integration phase" after UI completion).
- Staging dry-run evidence (section 4 below) should be gathered when the relevant frontend slice is being built and integrated, not post-hoc.
- Each provider credential test constitutes part of the per-slice integration test requirement for that slice.
- Backend implements atomic CAS (Compare-And-Swap) patterns for all idempotent operations and state transitions — race-condition hardening is active across all provider-integrated flows.

## 1) Register metadata

- Client:
- Environment: `staging` / `production`
- Maintained by:
- Last reviewed on:

## 2) Credential inventory

| Integration | Credential / Env Key | Owner | Vault Path | Created On | Rotated On | Expiry / Next Rotation | Last Tested | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Razorpay | `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` | Payments Owner | `vault://clients/<client>/payments/razorpay/live` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | |
| Razorpay | `RAZORPAY_WEBHOOK_SECRET` | Payments Owner | `vault://clients/<client>/payments/razorpay/webhook` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | |
| Delhivery | `DELHIVERY_API_KEY` | Logistics Owner | `vault://clients/<client>/shipping/delhivery/api` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | |
| Delhivery | `DELHIVERY_WEBHOOK_TOKEN` | Logistics Owner | `vault://clients/<client>/shipping/delhivery/webhook` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | |
| Shiprocket | `SHIPROCKET_EMAIL` + `SHIPROCKET_PASSWORD` | Logistics Owner | `vault://clients/<client>/shipping/shiprocket/auth` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | |
| Shiprocket | `SHIPROCKET_WEBHOOK_TOKEN` | Logistics Owner | `vault://clients/<client>/shipping/shiprocket/webhook` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | |
| Resend | `RESEND_API_KEY` | Notifications Owner | `vault://clients/<client>/notify/resend/api` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | Runtime email provider |
| MSG91 | `MSG91_AUTH_KEY` | Notifications Owner | `vault://clients/<client>/notify/msg91/auth` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | SMS/OTP provider (when `SMS_PROVIDER=msg91`) |
| MSG91 | `MSG91_SENDER_ID` | Notifications Owner | `vault://clients/<client>/notify/msg91/sender` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | SMS sender ID (when `SMS_PROVIDER=msg91`) |
| Fast2SMS | `FAST2SMS_API_KEY` | Notifications Owner | `vault://clients/<client>/notify/fast2sms/api` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | SMS/OTP provider (when `SMS_PROVIDER=fast2sms`) |
| Meta WhatsApp | `META_WHATSAPP_ACCESS_TOKEN` | Notifications Owner | `vault://clients/<client>/notify/meta-wa/token` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | Required when `NOTIFY_WHATSAPP_ENABLED=true` |
| Meta WhatsApp | `META_WHATSAPP_PHONE_NUMBER_ID` | Notifications Owner | `vault://clients/<client>/notify/meta-wa/phone-id` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | WhatsApp Business phone number |
| Meta WhatsApp | `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Notifications Owner | `vault://clients/<client>/notify/meta-wa/webhook-token` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | Webhook verification secret |
| Invoice Storage | `INVOICE_STORAGE_ROOT` | Platform Owner | `vault://clients/<client>/runtime/invoice-storage-root` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | Ensure path exists and is writable by backend/workers |
| Ops Control Plane | `OPS_METRICS_TOKEN` | Security/Ops Owner | `vault://clients/<client>/ops/metrics-token` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | Required for `/api/v1/ops/metrics` authentication |
| Admin Seed | `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` | Engineering Lead | `vault://clients/<client>/admin/seed` | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | YYYY-MM-DD | Active | Used by `upsert-admin.js` / `seed-admin.mjs`; never hardcoded |

## 3) Rotation ownership matrix (90-day default)

| Integration Group | Primary Owner | Backup Owner | Rotation Cadence | Next Rotation Window |
| --- | --- | --- | --- | --- |
| Payments (Razorpay) | | | 90 days | |
| Shipping (Delhivery/Shiprocket) | | | 90 days | |
| Notifications (Resend/MSG91/Meta WA) | | | 90 days | |
| Invoice storage controls | | | 90 days | |

## 4) Staging dry-run evidence log

| Date | Provider | Test Scenario | Result | Evidence Link |
| --- | --- | --- | --- | --- |
| YYYY-MM-DD | Razorpay | Prepaid payment + webhook capture validation | Pass/Fail | |
| YYYY-MM-DD | Delhivery or Shiprocket | Shipment create + tracking + webhook validation | Pass/Fail | |
| YYYY-MM-DD | Resend | Verified sender transactional email | Pass/Fail | |
| YYYY-MM-DD | MSG91 | OTP send + verify | Pass/Fail | |
| YYYY-MM-DD | Meta WhatsApp | Template message send (if enabled) | Pass/Fail | |
| YYYY-MM-DD | Invoice Storage | Local write + authenticated read cycle | Pass/Fail | |

> During VPS Phase 7 execution, also capture startup-gate evidence from `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md`:
> - strict env preflight output,
> - compose overlay command used,
> - host Postgres routing checks (`host.docker.internal` / bridge IP),
> - final stable health response.

## 5) Compromise drill log (quarterly)

| Date | Drill Scope | Revoke | Regenerate | Redeploy | Verify | Total Time | Observations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | Razorpay webhook secret | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | 00m | |

## 6) Sign-off

- Security/Ops lead:
- Engineering lead:
- Date:
