---
# Environment vs DB Configuration — Authoritative Reference

This document is the single source of truth for every secret, key, and configuration value in the system. For each entry it explains: **what it is, what mechanism uses it, how to generate it, where it lives, and what happens if you rotate or lose it.**

Other docs point here for key details. Do not duplicate this content elsewhere.

## 1) How the config system works
There are three tiers of configuration:

1. **Bootstrap / env-only** — must be in the OS environment (`.env` file / VPS secrets manager) before the process starts. Cannot be loaded from the database — the DB connection itself depends on some of these. Rejected if someone tries to store them via Ops UI (`BOOTSTRAP_KEY_NOT_DB_APPLICABLE`).
2. **DB-overlay (`OpsConfigSecret`)** — stored AES-256-GCM encrypted in the database, applied into `process.env` at boot via `applyOpsConfigRuntimeOverlay()` before any provider initializes. Editable live via Ops UI after OTP verification. Changes require process restart to take effect.
3. **StoreSettings** — typed, merchant-facing config stored in a dedicated Postgres table. Validated at boot; missing fields send failure alerts and fail closed.

The authoritative classification source is `scripts/env-runtime-contract.js`. Every CI gate run validates that `.env.example` and the ops config contract match this file.

## 2) Bootstrap / Env-only Keys — Full Detail

These must be set in `.env` (or VPS secrets manager) before the process starts. The server refuses to start if any required one is missing in production.

---

### Core Infrastructure

**`DATABASE_URL`**
- **What:** Full PostgreSQL connection string. Required before anything else — the DB overlay itself reads from here.
- **Format:** `postgresql://user:password@host:5432/dbname`
- **Generation:** Provided by your PostgreSQL host (Supabase, self-hosted, etc.)
- **Rotation:** Requires process restart. Update in `.env` and restart. No other key is affected.

**`REDIS_URL`**
- **What:** Full Redis connection URL used by both the API and worker processes for cache, sessions, BullMQ queues.
- **Format:** `redis://:password@host:6379`
- **Generation:** Provided by your Redis host.
- **Rotation:** Requires process restart. All in-flight queue jobs survive if Redis persistence is enabled.

**`REDIS_PASSWORD`**
- **What:** The password portion of `REDIS_URL`, also passed separately to the Redis Docker container (`--requirepass`). Must match the password in `REDIS_URL`. Blank causes `ECONNRESET` loops in Redis protected-mode.
- **Generation:** `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
- **Rotation:** Update both `REDIS_PASSWORD` and the password segment of `REDIS_URL` simultaneously, then restart.

**Local Docker dev vs production (June 2026):**
- **Dev (`docker-compose.yml`):** Redis port `6379` is published to the host so API/worker processes on Windows/macOS/Linux can connect via `redis://:password@localhost:6379`.
- **Production (`docker-compose.prod.yml`):** `redis.ports: !reset []` removes the host mapping — Redis stays reachable only on the Docker network (VPS internal).
- **Connection hardening:** All ioredis clients created via `src/common/redis/redis-connection.ts` attach throttled `error` listeners and use shared reconnect options. BullMQ worker boot patches `IORedis.prototype.duplicate` so blocking connections inherit the same guard.

**`NODE_ENV`**
- **What:** Runtime profile switch. `production` enables strict placeholder rejection and disallows `noop` providers; disables verbose error output; enables secure cookie flags. `development` and `test` relax some checks for local use.
- **Values:** `production` | `development` | `test`
- **Never** store or overlay from DB — it would allow a DB attacker to switch the runtime to development mode.
- **Note (May 2026, boot tolerance):** Strict mode no longer requires the entire provider dependency chain at boot via `requireEnv` (this caused API crash-loops + nginx 502s during incremental Ops config saves). Boot now validates only enum correctness for provider selectors and rejects placeholder values for keys that *are* set. The full go-live key set is still enforced — but at `GET /api/v1/health/ready` (which returns `runtimeConfigMissingKeys`) rather than at process start.

**`CLIENT_ID`**
- **What:** Short identifier for this client deployment. Used as Docker container name prefix and in alert emails to identify which client's instance is alerting.
- **Format:** kebab-case, e.g. `foodstore-prod`
- **Generation:** Choose once per client. Never change after deployment (breaks container names).

**`PORT` / `HOST`**
- **What:** Process binding. Defaults `3000` / `0.0.0.0`.

---

### Auth Token Signing

**`JWT_SECRET`**
- **What:** HMAC-SHA256 key used to sign and verify customer/admin **access tokens** (short-lived JWTs). If an attacker obtains this, they can forge valid session tokens for any user.
- **Mechanism:** `@fastify/jwt` uses this directly as the signing secret.
- **Generation:** `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- **Rotation:** All existing access tokens immediately become invalid. Users are logged out. Short-lived tokens (15–60 min) minimize disruption. Update `.env` and restart.
- **Must differ from** `JWT_REFRESH_SECRET`.
- **Fallback use:** `REDIS_KEY_PEPPER` and `IDEMPOTENCY_SCOPE_SECRET` both fall back to this if not explicitly set — set those independently in production.

**`JWT_REFRESH_SECRET`**
- **What:** HMAC-SHA256 key used to sign and verify **refresh tokens** (long-lived). Separate from `JWT_SECRET` so that access token rotation doesn't invalidate long-lived refresh tokens and vice versa.
- **Mechanism:** `auth.service.ts` `resolveRefreshSecret()` — fails fast if missing.
- **Generation:** `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- **Rotation:** All existing refresh tokens immediately become invalid. Users must log in again. Update `.env` and restart.
- **Must differ from** `JWT_SECRET`.

---

### Ops Control Plane Encryption

**`OPS_DB_ENCRYPTION_KEY`**
- **What:** AES-256-GCM key used to encrypt and decrypt every value stored in the `OpsConfigSecret` table. Every provider credential (Razorpay keys, MSG91 keys, etc.) stored via Ops UI is encrypted at rest with this key. Without it, the overlay cannot decrypt and the server cannot start.
- **Mechanism:** `src/common/security/ops-config-crypto.ts` — `encryptOpsConfigValue()` and `decryptOpsConfigValue()`. The raw string is SHA-256 hashed to produce a 32-byte AES key. Ciphertext format: `iv.authTag.ciphertext` (base64url, dot-separated).
- **Generation:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **Lives in:** `.env` / VPS secrets manager only. **Never** stored in the DB — it's the key that decrypts the DB. Explicitly excluded from DB overlay; ops save/validate rejects it with `BOOTSTRAP_KEY_NOT_DB_APPLICABLE`.
- **No fallback.** Server refuses to start if missing.
- **Rotation:** Generate a new key, re-encrypt all `OpsConfigSecret` rows with it, update `.env`, restart. All rows encrypted with the old key become unreadable until re-encrypted. Use `OPS_DB_ENCRYPTION_KEY_VERSION` to track which key version encrypted a given row.

**`OPS_DB_ENCRYPTION_KEY_VERSION`**
- **What:** Integer version tag incremented on each `OPS_DB_ENCRYPTION_KEY` rotation. Lets the decryption layer know which key generation applies to a given stored row.
- **Generation:** Start at `1`, increment by 1 on each rotation.
- **Default:** `1` if not set.

---

### Ops Browser Login / Cookie Session

**`OPS_COOKIE_SECRET`**
- **What:** HMAC-SHA256 key used by `@fastify/cookie` to **sign** the `ops_session` httpOnly cookie. Signing means the cookie value has a signature appended — the server verifies the signature on every request so the browser cannot forge or tamper with the cookie value.
- **Mechanism:** `src/common/plugins/cookie.plugin.ts`. Cookie signing is HMAC, not AES — the value is still readable but tamper-proof. The actual session token inside the cookie is an opaque random string stored hashed in Redis.
- **Generation:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **Lives in:** `.env` only. Not a DB-overlay key — rotating it immediately invalidates **all** active browser sessions (intentional emergency mechanism).
- **Rotation:** All logged-in ops browser sessions are immediately invalidated. All ops users must log in again via OTP flow. Update `.env` and restart.

**`OPS_BROWSER_SESSION_TTL_SECONDS`**
- **What:** How long a browser session remains valid after login. Controls both the `maxAge` on the `ops_session` cookie and the Redis `EX` TTL on the hashed session token.
- **Default:** `3600` (1 hour).
- **Format:** Any positive integer.

**`OPS_LOGIN_OTP_TTL_SECONDS`**
- **What:** How long the login OTP (stored as a hash in Redis) is valid for verification. After this, the Redis key expires and the user must request a new OTP.
- **Default:** `300` (5 minutes).
- **Format:** Any positive integer.

---

### Security Salts and Integrity Keys

**`AUDIT_ANCHOR_SECRET`**
- **What:** HMAC secret used to sign each ops audit log entry's chain hash, creating a tamper-evident linked chain. If an attacker modifies a past audit row, the chain hash verification fails.
- **Mechanism:** `src/common/plugins/observability.plugin.ts` `appendAuditLog()`. Falls back to `JWT_SECRET` if not set — set it independently in production so audit integrity is not coupled to token rotation.
- **Generation:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **Rotation:** The chain hash of all existing rows is based on the old secret. After rotation, existing rows can no longer be verified with the new secret. Only rotate in case of compromise; treat it as permanent.

**`REDIS_KEY_PEPPER`**
- **What:** HMAC pepper added to guest coupon Redis key derivation to prevent enumeration. Guest coupon Redis keys are `HMAC(sessionToken, pepper)` — an attacker who knows a session token cannot enumerate Redis keys without also knowing this pepper.
- **Mechanism:** `src/modules/cart/cart.service.ts` `getRedisKeyPepper()`. Falls back to `JWT_SECRET` if not set — set it independently in production.
- **Generation:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **Rotation:** All existing guest coupon Redis keys (format `v2:…`) become unreachable because the derived key changes. Guest carts are lost. Only rotate in case of compromise.

**`IDEMPOTENCY_SCOPE_SECRET`**
- **What:** HMAC key used to fingerprint idempotency scope strings. Idempotency keys are scoped per-client so that key `abc` for client A cannot collide with key `abc` for client B. The fingerprint is `HMAC(scope, IDEMPOTENCY_SCOPE_SECRET)`.
- **Mechanism:** `src/common/idempotency/idempotency.ts` `buildScopeFingerprint()`. Falls back to `JWT_SECRET` if not set.
- **Generation:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **Rotation:** All in-flight idempotency records become unresolvable (different fingerprint). Duplicate requests that were previously deduplicated may be replayed. Only rotate in case of compromise.

**`TURNSTILE_SECRET_KEY`**
- **What:** Cloudflare Turnstile server-side secret. The auth routes (`POST /auth/send-otp`, admin login) require a Turnstile challenge token from the frontend. The server verifies it against Cloudflare's API using this secret to block bot traffic.
- **Mechanism:** `src/modules/auth/auth.service.ts`. If unset, Turnstile verification is **skipped** (acceptable for development; not acceptable in production).
- **Generation:** Obtained from Cloudflare Turnstile dashboard → your site → Secret Key.
- **Rotation:** Generate a new secret in Cloudflare dashboard, update `.env`, restart. Old tokens stop being valid immediately (Cloudflare controls this).

---

### Admin Alert Delivery

**`ADMIN_ALERT_EMAIL`**
- **What:** Fallback email address for technical failure alerts when the DB overlay is unavailable (e.g., at first boot before overlay keys are set). Used by workers for startup-check alerts.
- **Format:** Valid email address, e.g. `ops@yourclient.com`
- **Generation:** Choose the ops team inbox.
- **Rotation:** Update `.env` and restart. Safe to change anytime.

---

### URLs and CORS

**`STOREFRONT_URL`**
- **What:** Public URL of the customer-facing storefront. Used for CORS allowed origins, email link generation (order confirmation links, password reset links), and cookie domain.
- **Format:** `https://yourdomain.com`
- **Boot guard (production-like):** `src/config/app.config.ts` throws at startup if this key is missing or still a placeholder — prevents password-reset emails from linking to `localhost` when deploy skips Phase 1 bootstrap.
- **Rotation:** Update `.env` and restart. Update simultaneously with the actual DNS/CDN change.

**`ADMIN_URL`**
- **What:** Public URL of the merchant admin panel. Used for CORS allowed origins.
- **Format:** `https://yourdomain.com/admin` or separate subdomain.

---

### Feature Flags

These are booleans that enable/disable entire product modules. Set once per client based on their contract scope.

| Key | Controls |
|-----|---------|
| `FEATURE_COUPONS_ENABLED` | Coupon/discount module |
| `FEATURE_REVIEWS_ENABLED` | Product review module |
| `FEATURE_WISHLIST_ENABLED` | Wishlist module |
| `FEATURE_GST_INVOICING_ENABLED` | PDF GST invoice generation |
| `FEATURE_RESPONSE_ENVELOPE_ENABLED` | Wrap all API responses in `{ success, data, error }` envelope |

**Frontend mirror (Next.js — prefer runtime `GET /store/config` over build-time flags):**

| Key | Controls |
|-----|---------|
| `GET /api/v1/store/config` | **Authoritative** for storefront COD, min order, module flags (`couponsEnabled`, `reviewsEnabled`, `wishlistEnabled`, `gstInvoicingEnabled`), and admin GST field visibility in this repo |
| `NEXT_PUBLIC_IMAGE_CDN_URL` | Prefix for relative product image paths in SSR; must match Ops `R2_PUBLIC_BASE_URL` in production |
| `NEXT_PUBLIC_STOREFRONT_URL` | Canonical storefront origin for links; SSR image fallback only when CDN URL unset (never implicit `localhost`) |
| `NEXT_PUBLIC_FEATURE_*` (legacy) | Deprecated for storefront/admin GST in new work — kept in `.env.example` for backward compatibility only |

### Public store config endpoint

| Endpoint | Auth | Fields returned |
|----------|------|-----------------|
| `GET /api/v1/store/config` | None | `isCodEnabled`, `minOrderValuePaise`, `mobileOtpSignupEnabled`, `couponsEnabled`, `reviewsEnabled`, `wishlistEnabled`, `gstInvoicingEnabled` |

DB-backed fields come from `StoreSettings` singleton. Feature flags mirror backend bootstrap `FEATURE_*` env vars. Never exposes GSTIN, notification keys, or ops credentials.

---

### Risk and Admission Control

These are runtime tuning values — safe to adjust without security concern.

| Key | Purpose | Default |
|-----|---------|---------|
| `RISK_VELOCITY_ENABLED` | Enable payment-init velocity checks | `true` |
| `RISK_PAYMENT_INIT_MAX_PER_HOUR` | Max payment initiations per user per hour | `10` |
| `HOT_SKU_VARIANT_IDS` | Comma-separated variant IDs under admission control | *(empty)* |
| `HOT_SKU_ADMISSION_BUDGET_PER_MINUTE` | Requests allowed through per minute for hot SKUs | `100` |
| `HOT_SKU_USER_RESERVE_CAP` | Max concurrent reservations per user for hot SKUs | `1` |
| `HOT_SKU_COOLDOWN_SECONDS` | Cooldown after hot SKU purchase | `30` |
| `HOT_SKU_SHARD_COUNT` | Redis shard count for hot SKU counters | `8` |
| `CART_RESERVATION_TTL_MINUTES` | How long a cart reservation holds stock | `15` |
| `RECONCILIATION_AUTO_HEAL_ISSUES` | Issue types the reconciliation worker auto-resolves (comma-separated). Unset = default safe set: `PAYMENT_CAPTURED_ORDER_NOT_CONFIRMED`, `REFUNDED_STATUS_MISMATCH`, `STALE_PENDING_PAYMENT` (also heals stale `PAYMENT_FAILED` abandon). Empty string = disable all auto-heals. `ORDER_SHIPPED_WITHOUT_SHIPMENT` is **not** in the default set (manual review). | *(default safe set when unset)* |
| `RESTART_PAYMENT_DRAIN_TIMEOUT_MS` | Max time (ms) the `scheduled-process-restart` BullMQ job waits for all `PENDING_PAYMENT` orders to reach a terminal state before proceeding with the restart. If the timeout elapses, a `ProcessRestartPaymentDrainTimeout` alert is sent and the restart proceeds anyway. **Workers process only** — not consumed by the API process. Set lower (e.g. `10000`) in staging/test environments. | `300000` (5 min) |
| `RESTART_QUEUE_DRAIN_TIMEOUT_MS` | Max time (ms) the `scheduled-process-restart` BullMQ job waits for **all BullMQ queues** to reach `getActiveCount() === 0` after pausing `outboxDispatch` first, then all other producer queues. Timeout → `ProcessRestartQueueDrainTimeout` alert sent (with per-queue active counts); restart proceeds anyway because in-flight jobs that exceed the budget will retry from BullMQ's durable `attempts` state when containers come back. **Workers process only**. Lower this in staging (e.g. `5000`) for fast iteration. | `60000` (60 s) |
| `RESTART_QUEUE_PAUSE_GRACE_MS` | Settle delay (ms) between pausing `outboxDispatch` and pausing all other producer queues. Gives the in-flight outbox publish loop time to commit rows it has already claimed before downstream queues are frozen. Async `sleep()` — workers stay responsive. **Workers process only**. | `1500` |
| `RESTART_PAUSE_AND_DRAIN_QUEUES_ENABLED` | Feature flag for the full queue pause + active-count drain + resume protocol. When `false`, the worker falls back to the legacy payment-status-only drain (skips queue pause/drain/resume entirely). Use only as emergency rollback if a queue-handle bug ever blocks scheduled restarts. **Even with this flag false, every worker container boot still self-heals any queue left paused in Redis** — that recovery lives in `bootstrapWorkers()` (`queues/workers/index.ts`) and is unconditional; it has no env-var toggle because the failure mode it protects against (silent indefinite notification outage) is too costly to opt out of. See `OPS_CONTROL_PLANE_GUIDE.md` §9.2. **Workers process only**. | `true` |
| `MAINTENANCE_QUEUE_DRAIN_TIMEOUT_MS` | Max time (ms) the `maintenance-activation` BullMQ job (`cart-cleanup` queue) waits for **all paused queues** to reach `getActiveCount() === 0` after pausing `outbox-dispatch` first then every other producer queue. Timeout → `MaintenanceQueueDrainTimeout` alert; activation proceeds (stragglers retry via BullMQ at-least-once when queues resume). **Workers process only**. | `120000` (2 min) |
| `MAINTENANCE_PAYMENT_DRAIN_TIMEOUT_MS` | Max time (ms) the `maintenance-activation` job waits for `prisma.order.count({ where: { status: 'PENDING_PAYMENT' } })` to reach 0 before flipping `MaintenanceState.phase` to `active`. Timeout → `MaintenancePaymentDrainTimeout` alert; activation proceeds. **Workers process only**. | `300000` (5 min) |
| `MAINTENANCE_QUEUE_PAUSE_GRACE_MS` | Settle delay (ms) between pausing `outbox-dispatch` and pausing other producer queues inside the `maintenance-activation` handler. Same intent as `RESTART_QUEUE_PAUSE_GRACE_MS`. **Workers process only**. | `1500` |
| `MAINTENANCE_ACTIVATION_GRACE_MS` | Read-side self-heal grace (ms) past `pendingUntil` before `readMaintenanceState` promotes a stuck `mode='maintenance' phase='pending'` row to `phase='active'`. Recovers automatically when the `maintenance-activation` worker job is lost or the worker container is running stale code without the handler. Set above `MAINTENANCE_PAYMENT_DRAIN_TIMEOUT_MS + MAINTENANCE_QUEUE_DRAIN_TIMEOUT_MS` plus a cushion so a healthy worker always wins the race. **API and workers**. | `420000` (7 min) |
| `LOAD_SHED_MODE` | Startup load-shed override: `normal`, `reduced`, or `emergency`. **Cannot force `maintenance`** — that is a durable, DB-backed state set only via the Ops API. When set, this env var overrides the DB-backed mode for `normal/reduced/emergency` (highest priority); leave unset in production so the Ops UI can manage runtime mode dynamically. | `normal` |
| `HEALTH_QUEUE_STALE_WAITING_SECONDS` | Threshold for queue health checks | `300` |

---

### Admin IAM

| Key | Purpose | Default |
|-----|---------|---------|
| `ADMIN_DEFAULT_PERMISSIONS` | Comma-separated default permissions granted on admin invite | *(empty)* |
| `ADMIN_SCOPE_ENFORCEMENT` | Enforce admin permission scopes | `true` |
| `ALLOW_ADMIN_SCOPE_BYPASS` | Dev-only: bypass scope checks (`false` in production) | `false` |
| `ENABLE_VERBOSE_VALIDATION_ERRORS` | Expose full validation error details in API responses | `false` |

---

### OpenTelemetry

These wire up distributed tracing to your OTel collector (Grafana, Jaeger, etc.).

| Key | Purpose |
|-----|---------|
| `OTEL_TRACING_ENABLED` | Master toggle for OTel tracing |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel collector endpoint |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Traces-specific endpoint (overrides general) |
| `OTEL_EXPORTER_OTLP_HEADERS` | Auth headers, e.g. `Authorization=Bearer token` |
| `OTEL_SERVICE_NAME` | Service identifier in trace data |

## 3) DB-Overlay Keys (OpsConfigSecret) — Full Detail

These are stored AES-256-GCM encrypted in the `OpsConfigSecret` table and applied into `process.env` at boot via `applyOpsConfigRuntimeOverlay()`. They appear as **commented stubs** (`# KEY=`) in `.env.example`. Set and update them via `POST /api/v1/ops/config/save` (requires OTP). All require process restart to take effect.

---

### Payments

**`PAYMENT_PROVIDER`**
- **What:** Selects the active payment provider. Routes all checkout payment calls to the chosen adapter.
- **Values:** `razorpay` | `cod`. Never `noop` in production.
- **Rotation:** Update via Ops UI, restart. Existing pending payments continue to use whichever provider created their order record.

**`RAZORPAY_KEY_ID`**
- **What:** Razorpay publishable key — sent to the frontend so it can open the Razorpay checkout widget. Not secret on its own, but must match `RAZORPAY_KEY_SECRET`.
- **Generation:** Razorpay dashboard → API Keys → Key ID.

**`RAZORPAY_KEY_SECRET`**
- **What:** Razorpay server-side secret. Used to authenticate all Razorpay API calls (order creation, payment capture, refunds). If leaked, an attacker can initiate refunds or read order data.
- **Generation:** Razorpay dashboard → API Keys → Key Secret. Shown once — save immediately.
- **Rotation:** Generate new keys in Razorpay dashboard, update via Ops UI, restart. Old keys stop working immediately on Razorpay's side.

**`RAZORPAY_WEBHOOK_SECRET`**
- **What:** HMAC-SHA256 secret Razorpay uses to sign webhook payloads. The server verifies `X-Razorpay-Signature` against this on every webhook. Without it, the webhook endpoint rejects all events.
- **Mechanism:** `orders.service.ts` webhook handler — HMAC comparison. Fail closed if missing.
- **Generation:** Razorpay dashboard → Webhooks → secret field.
- **Rotation:** Set new secret in Razorpay dashboard. During the transition window, set old secret as `RAZORPAY_WEBHOOK_SECRET_OLD` so both old and new are accepted simultaneously (dual-read). Remove old key after Razorpay stops sending with it.

**`RAZORPAY_WEBHOOK_SECRET_OLD`**
- **What:** Previous webhook secret, accepted alongside the new one during rotation. Set during key rotation, cleared once Razorpay fully switches to the new secret.

**`RAZORPAY_WEBHOOK_ALLOWLIST_CIDR`**
- **What:** Comma-separated CIDR list of Razorpay's outbound webhook IP ranges. Requests from outside this list are rejected before HMAC verification. Defense-in-depth — HMAC is still required even for allowlisted IPs.
- **Format:** `e.g. 103.58.155.0/24,52.66.66.0/24` (get current ranges from Razorpay docs).

**`RAZORPAY_WEBHOOK_MAX_SKEW_SECONDS`**
- **What:** Maximum age of a webhook event's timestamp before it is rejected. Prevents replay attacks of captured webhook payloads.
- **Default:** `300` (5 minutes).

**`PAYMENT_PROVIDER_FAILOVER_ENABLED`**, **`PAYMENT_CB_FAILURE_THRESHOLD`**, **`PAYMENT_CB_COOLDOWN_MS`**
- **What:** Circuit-breaker controls for the payment provider. If the provider fails `THRESHOLD` times, it trips open and returns errors immediately for `COOLDOWN_MS` milliseconds before retrying.

---

### Shipping

> **Dual-provider model (2026-06):** Provider selection is now credential-based, not env-var-based. If `DELHIVERY_API_KEY` is present, Delhivery is active. If `SHIPROCKET_EMAIL` + `SHIPROCKET_PASSWORD` are present, Shiprocket is active. Both can be active simultaneously — the system quotes rates from all configured providers at checkout and selects the cheapest. `SHIPPING_PROVIDER` is **ignored** — do not set it.

**`DELHIVERY_API_KEY`**
- **What:** Delhivery API bearer token. Used for all Delhivery API calls (create shipment, track, cancel).
- **Generation:** Delhivery merchant dashboard → Settings → API.

**`DELHIVERY_BASE_URL`**
- **What:** Delhivery API base URL. Sandbox (`https://staging-express.delhivery.com`) vs production (`https://express.delhivery.com`). Switch to production URL before go-live.

**`DELHIVERY_WEBHOOK_TOKEN`**
- **What:** Bearer token Delhivery sends in webhook headers to authenticate status-update callbacks.
- **Generation:** Set a random string in Delhivery dashboard and mirror it here. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

**`SHIPROCKET_EMAIL`** / **`SHIPROCKET_PASSWORD`**
- **What:** Shiprocket account credentials used to obtain session tokens for API calls. The integration re-auths automatically when the token expires.
- **Generation:** Shiprocket merchant account login credentials.

**`SHIPROCKET_WEBHOOK_TOKEN`**
- **What:** Bearer token Shiprocket sends in webhook headers. Same pattern as Delhivery.

**`DELHIVERY_PICKUP_PINCODE`** / **`SHIPROCKET_PICKUP_PINCODE`**
- **What:** Default seller pickup pincode used when creating shipments. Must match a registered pickup location in the respective dashboard.

**`SHIPPING_WEBHOOK_ALLOWLIST_CIDR`**, **`DELHIVERY_WEBHOOK_ALLOWLIST_CIDR`**, **`SHIPROCKET_WEBHOOK_ALLOWLIST_CIDR`**
- **What:** IP allowlists for shipping webhook endpoints, same defense-in-depth pattern as Razorpay.

**`SHIPPING_PROVIDER_FAILOVER_ENABLED`**, **`SHIPPING_CB_FAILURE_THRESHOLD`**, **`SHIPPING_CB_COOLDOWN_MS`**
- **What:** Circuit-breaker controls per shipping provider. In dual-provider mode, each provider maintains its own process-local circuit breaker — if one trips open, the other continues serving requests.

---

### Notifications

**`NOTIFY_EMAIL_ENABLED`** / **`NOTIFY_SMS_ENABLED`** / **`NOTIFY_WHATSAPP_ENABLED`**
- **What:** Master channel on/off toggles. If `NOTIFY_EMAIL_ENABLED=false`, no email is ever sent regardless of per-template configuration. Useful for disabling a broken provider without redeploying.
- **Defaults (env layer):** `NOTIFY_EMAIL_ENABLED` → `true`; `NOTIFY_SMS_ENABLED` → `false` (opt-in); `NOTIFY_WHATSAPP_ENABLED` → `false`.
- **DB-layer override:** `StoreSettings.notifyEmailEnabled` / `notifySmsEnabled` / `notifyWhatsappEnabled` take precedence over the env flag when the `storeSettings` row exists. Manage via direct `PATCH /api/v1/admin/settings/notifications` API call (admin JWT). **Note (2026-06-07):** The merchant admin UI panel for this was removed — notification provider configuration is now consolidated to `/ops/config` (ops console). Only one channel should be active at a time.

**`EMAIL_PROVIDER`**
- **What:** Email provider selection. Currently only `resend` is implemented.

**`RESEND_API_KEY`**
- **What:** Resend transactional email API key. Used for all outbound emails (OTP, order confirmation, invite setup, etc.).
- **Generation:** Resend dashboard → API Keys → Create Key. Grant Send access only — do not grant full access.
- **Rotation:** Create new key in Resend, update via Ops UI, restart. Old key can be revoked in Resend dashboard.

**`RESEND_FROM`**
- **What:** Verified sender email address, e.g. `orders@yourdomain.com`. Must be a verified domain/address in your Resend account.

**`SMS_PROVIDER`**
- **What:** Selects active SMS provider.
- **Values:** `msg91` | `fast2sms` | `noop`. MSG91 requires DLT registration. Fast2SMS does not (simpler for early-stage clients).

**`MSG91_AUTH_KEY`**
- **What:** MSG91 API authentication key. Used for all SMS sends via MSG91.
- **Generation:** MSG91 dashboard → API → Auth Key.

**`MSG91_SENDER_ID`** / **`MSG91_ROUTE`**
- **What:** DLT-registered sender ID (6-char, e.g. `YOURBR`) and DLT route number. Both required by TRAI regulations for Indian SMS.

**`FAST2SMS_API_KEY`**
- **What:** Fast2SMS API key. No DLT registration required.
- **Generation:** Fast2SMS dashboard → Dev API.

**`META_WHATSAPP_ACCESS_TOKEN`**
- **What:** Meta Cloud API permanent access token for sending WhatsApp messages. If leaked, attacker can send messages from your WhatsApp business number.
- **Generation:** Meta for Developers → WhatsApp → API Setup → Permanent Token (generate via System User in Business Manager).
- **Rotation:** Revoke in Meta Business Manager → System Users, generate new token, update via Ops UI, restart.

**`META_WHATSAPP_PHONE_NUMBER_ID`**
- **What:** Numeric ID of the WhatsApp phone number registered in Meta Business Manager. Identifies which number to send from.

**`META_WHATSAPP_APP_SECRET`**
- **What:** Meta App Secret used to verify HMAC-SHA256 signatures on incoming WhatsApp webhook payloads. Same pattern as Razorpay webhook secret.
- **Generation:** Meta for Developers → Your App → Settings → Basic → App Secret.

**`META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`**
- **What:** A custom string Meta sends during webhook verification handshake (`GET` with `hub.verify_token`). The server returns `hub.challenge` only if this matches.
- **Generation:** Any random string — you set it in both Meta dashboard and here. `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`

**`META_WHATSAPP_API_VERSION`**
- **What:** Meta Graph API version string. **Default `v25.0`** (adapter fallback since `backend-core 0.1.26`). Update when Meta deprecates older versions.

**`OTP_WHATSAPP_ENABLED`** *(added `backend-core 0.1.26`)*
- **What:** When `true` **and** WhatsApp is deliverable, the customer signup/login OTP is also sent over WhatsApp **in addition to** the primary channel (usually email) — same OTP, one hash, verified identically. Admin login OTP is unaffected (email-based).
- **Default:** `false`. Read live per request (no restart). Requires an approved Meta **Authentication** template mapped as `CustomerOtpVerification` → `otp_verify` (see `WHATSAPP_TEMPLATE_REGISTRY.md`); until that exists, leave off (email OTP still works).
- **DB-layer:** DB-overlay key, editable as a true/false dropdown in **Ops → Config → Notifications**.

**`WHATSAPP_OTP_COST_PAISE`** *(added `backend-core 0.1.26`)*
- **What:** Integer paise per WhatsApp OTP message, used **only** for the Ops cost estimate shown on Ops → Config (`GET /ops/notifications/whatsapp-otp-cost`, all-time + current calendar-month cycle, counted from `NotificationLog`). Does not affect sending.
- **Default:** `14` (≈ ₹0.115 + 18% GST). Set to your BSP's actual per-message rate for an accurate figure.

> Full per-client Meta onboarding (Business Suite, app, phone, webhook, App Review, and where each of these keys is entered): [`META_WHATSAPP_SETUP_GUIDE.md`](./META_WHATSAPP_SETUP_GUIDE.md). Template body/param contract: [`WHATSAPP_TEMPLATE_REGISTRY.md`](./WHATSAPP_TEMPLATE_REGISTRY.md).

---

### Ops Security

**`OPS_MFA_ENFORCE`**
- **What:** Legacy TOTP enforcement switch — no longer has any effect. Ops MFA is now implemented as a mandatory email OTP challenge on every privileged write action (`ops:write`); there is no per-user or org-level toggle. Key is retained in env contract for backward-compat but is not read by any live auth path.
- **Values:** `true` | `false`. **Ignored at runtime.**

**`OPS_METRICS_TOKEN`**
- **What:** Static bearer token sent as `x-ops-token` header to access `GET /api/v1/ops/metrics` (Prometheus scrape endpoint). Plain string comparison — not a JWT. Configure your Prometheus scraper to send this in its scrape config.
- **Generation:** `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
- **Rotation:** Update via Ops UI, restart, update Prometheus scrape config simultaneously.

**`OPS_METRICS_ALLOWLIST`**
- **What:** Comma-separated CIDR list of IPs allowed to access `/ops/metrics`. Defense-in-depth only — in production, even allowlisted IPs still require `OPS_METRICS_TOKEN`.
- **Format:** e.g. `10.0.0.1/32` (your Prometheus server IP).

**`TRUSTED_PROXY_ALLOWLIST_CIDR`**
- **What:** Comma-separated CIDR of your trusted reverse proxies (nginx, load balancer). Solves a specific problem: Node.js sees `socket.remoteAddress = nginx_ip`, not the real client IP. nginx puts the real IP in `X-Forwarded-For`. This CIDR tells the server which connections to trust for forwarded headers.
  - If `socket.remoteAddress` is in this CIDR → trust `X-Forwarded-For` as the real client IP.
  - If not → use `socket.remoteAddress` directly (direct connection, no proxy — spoofed headers ignored).
- **Format:** e.g. `10.0.0.1/32` (your nginx/LB IP).
- **Why important:** Required for accurate request IP logging and webhook IP allowlist enforcement.

**`REPLAY_APPROVAL_TOKEN`**
- **What:** Bearer token required to call the analytics data replay endpoints (`POST /api/v1/admin/analytics/replay`). Prevents accidental or unauthorized replay of analytics pipelines. Plain string comparison.
- **Generation:** `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
- **Rotation:** Update via Ops UI, restart, communicate new token to whoever runs replays.

**`REPLAY_AUDIT_RETENTION_DAYS`**
- **What:** Number of days to retain replay audit NDJSON log files on disk.
- **Default:** `30`.

**`INVOICE_STORAGE_ROOT`**
- **What:** Filesystem path where PDF GST invoices are stored. Must be writable by the process user. Only relevant when `FEATURE_GST_INVOICING_ENABLED=true`.

**Product media (Ops UI → Product Media / Cloudflare R2)** — all keys are **DB-overlay** (encrypted in `ops_config_secret`), applied to `process.env` at API boot. **Do not** put R2 credentials in bootstrap `.env`.

| Key | Purpose |
|-----|---------|
| `MEDIA_STORAGE_PROVIDER` | `local` (dev) or `r2` (production). When `r2`, each admin upload **automatically** `PutObject`s to Cloudflare R2. |
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | R2 API token access key (non-secret in Ops UI — public id) |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | Target bucket |
| `R2_PUBLIC_BASE_URL` | Public CDN hostname on bucket — pair with storefront `NEXT_PUBLIC_IMAGE_CDN_URL` |
| `R2_ENDPOINT` | Optional S3 API endpoint override |
| `MEDIA_STORAGE_ROOT` | Local provider disk root (dev / legacy delete fallback) |
| `MEDIA_CDN_BASE_URL` | Fallback origin for local provider URLs |

**Go-live:** `GET /api/v1/health/ready` lists missing keys until `MEDIA_STORAGE_PROVIDER=r2` and R2 chain are saved in Ops UI. Restart API/workers after save. Preflight: `npm run verify:r2-media` (fails if legacy keys remain in `.env`).

**`PUBLIC_STORE_URL`**
- **What:** Fallback storefront origin when `MEDIA_CDN_BASE_URL` is unset. Usually same as `STOREFRONT_URL`.

---

## 3.5) MaintenanceState — DB-backed, Ops-facing (durable runtime mode)

Added May 2026 alongside the `maintenance` load-shed mode. A single-row Postgres table that is the **source of truth** for the maintenance lifecycle. Fronted by a Redis cache (`ops:maintenance:state`, 5-min TTL) for fast reads, but the cache is treated as an optimisation — every read falls back to Postgres when the Redis key is missing and rehydrates the cache. This is what lets maintenance mode survive Redis flushes, container restarts, and full infra resets.

| Column | Purpose |
|--------|---------|
| `singletonKey` | Always `'global'` — unique constraint enforces a single row |
| `mode` | One of `normal | reduced | emergency | maintenance` |
| `phase` | `null` outside maintenance; `pending` during the 2-min warning; `active` after the worker drain completes |
| `pendingUntil` | ISO timestamp when `pending` → `active` is scheduled (null otherwise) |
| `activatedAt` | ISO timestamp the row flipped to `active` (null otherwise) |
| `reason` | Operator-supplied reason for the mode change (min 10 chars) |
| `setByOpsUserId` | Ops user who last wrote the row |
| `setAt` / `updatedAt` | Audit timestamps |

Write path:
- `POST /api/v1/ops/load-shed` → `OpsService.setLoadShedModeDirect()` → `writeMaintenanceState()` (Postgres `upsert` + Redis cache + Redis fast-path key).
- For `mode: 'maintenance'`: also enqueues a delayed `maintenance-activation` job on the `cart-cleanup` queue.
- For any other mode while currently `maintenance`: clears `phase`/`pendingUntil`/`activatedAt` and enqueues a `maintenance-deactivation` job that resumes every paused queue.

Read path:
- Load-shed guard: `readMaintenanceStateFromRequest()` — request-scoped 5 s cache → Redis cache → Postgres fallback.
- Boot: `backend/src/main.ts` calls `readMaintenanceState()` after `fastify.listen` to rehydrate the Redis cache from Postgres, so a cold-started backend keeps serving the maintenance page if it boots mid-window.

No env fallback. The mode never returns to `normal` "by accident" — it requires an explicit ops mode change.

---

## 4) StoreSettings — DB-backed, Merchant-facing

Set via `PATCH /api/v1/admin/settings`. Validated at boot — missing required fields send `sendTechnicalFailureAlert` and fail closed. No env fallback.

| Field | What it controls |
|-------|-----------------|
| `storeName` | Appears in all alert emails and notification footers to identify the client |
| `websiteUrl` | Used in order email links and alert email bodies |
| `logoUrl` / `contactEmail` / `contactPhone` | Branding shown in email templates |
| `primaryNotificationChannels` | Per-template map: `{ "OrderConfirmed": "EMAIL", "OtpVerification": "SMS" }` — controls which channel is primary for each notification type |
| `smsTemplates` | Merchant-override SMS template text per notification type |
| `gstin` | GST invoice seller GSTIN — required when `FEATURE_GST_INVOICING_ENABLED=true` |
| `sellerLegalName` / `sellerAddress` / `sellerState` | Seller details on GST invoices |
| `fssaiNumber` | FSSAI license number printed on invoices for food businesses |
| `notifyEmailEnabled` / `notifySmsEnabled` / `notifyWhatsappEnabled` | Per-channel toggles — same as env keys but merchant-configurable via admin UI |

---

## 5) `.env.example` Parity Model

Two-tier layout enforced by `scripts/config-runtime-parity-check.js`:

- **Bootstrap keys** (`dbOverlay: false`) → **live values** with placeholder text. CI fails if absent or placeholder.
- **DB-overlay keys** (`dbOverlay: true`) → **commented stubs** (`# KEY=`). CI passes even without a value — documents existence without requiring a value in `.env`.

Copying `.env.example` → `.env` gives a working bootstrap configuration for local dev. In production, DB-overlay keys come from `OpsConfigSecret`, not from `.env`.

Guardrail scripts (both wired into `npm run ci:reliability-gates`):
- `npm run config:parity-check` — `.env.example` layout vs `env-runtime-contract.js`
- `npm run ops:config-contract-drift-check` — ops config contract vs `env-runtime-contract.js`

---

## 6) Runtime Overlay Boot Sequence

1. `applyOpsConfigRuntimeOverlay(prisma)` runs in `src/main.ts` (API) and `queues/workers/index.ts` (workers) **before** any provider, notification, or shipping initialization.
2. Reads all `OpsConfigSecret` rows where `isActive: true`, decrypts each with `OPS_DB_ENCRYPTION_KEY`, writes into `process.env`.
3. After overlay: `process.env` for overlay keys reflects the DB value, not the original env value.
4. Bootstrap-only keys (`DATABASE_URL`, `REDIS_URL`, `OPS_DB_ENCRYPTION_KEY`, `NODE_ENV`, `CLIENT_ID`) are **never** overwritten by the overlay.
5. Missing `OPS_DB_ENCRYPTION_KEY` → overlay fails → server refuses to start.

---

## 7) Ops Config API

- `GET /api/v1/ops/config/overview` — per-domain items with `mutableViaOps`, `requiresRestart`, `runtimeSource`, present/placeholder flags.
- `GET /api/v1/ops/config/stored` — DB-backed config rows. Per item: `{ domain, key, maskedValue, plaintextValue, keyVersion, requiresRestart, updatedAt }`. **`plaintextValue` is required and returned for every active row — INCLUDING real cryptographic secrets** (`_SECRET`, `_TOKEN`, `_PASSWORD`, `_API_KEY`, `_AUTH_KEY`, `_APP_SECRET`, ops cookie secret, signed approval tokens). This is a deliberate operator-UX policy for the Ops console (gated by ops login + email OTP for writes, fail-closed `ops:read`/`ops:write`, audit chain logging) — see `docs/OPS_CONTROL_PLANE_GUIDE.md`, `docs/HARDENING_HISTORY.md`, and `docs/DECISIONS.md`. `maskedValue` is still returned alongside (`ab****cd` format) for summary/list views. The frontend `isOpsConfigSecretKey()` mirror predicate controls only input-rendering kind (password-type with eye toggle vs plain text) — it no longer gates plaintext disclosure at the HTTP boundary.
- `POST /api/v1/ops/config/validate` — dry-run: allowlist / bootstrap rejection / provider enum / placeholder checks for the **submitted batch only**. Body: `{ domain?, values }`.
- `POST /api/v1/ops/config/save` — OTP required (`action: config-save` on `otp/request`). Body: `{ values, challengeId, otpCode, domain? }`.
  - **`domain` optional:** omit to save keys across multiple contract domains in one request (domain resolved per key via `resolveOpsConfigDomainForKey`).
  - **`null` / empty value:** deactivates the DB overlay row (`isActive: false`) without erasing audit history.
  - **Partial saves:** validation runs against the submitted batch only — saving `PAYMENT_PROVIDER=razorpay` does **not** require `RAZORPAY_KEY_ID`/`RAZORPAY_WEBHOOK_SECRET` to be in the batch or in `process.env`. Operators can fill provider chains incrementally.
  - **Restart:** all saved overlay keys set `requiresRestart: true`; restart is **manual** — operators use `/ops/system` (OTP-protected) or restart containers on the VPS. There is no automatic in-app restart prompt.
- Bootstrap keys rejected with `BOOTSTRAP_KEY_NOT_DB_APPLICABLE`.

**Readiness gate:** `GET /api/v1/health/ready` lists missing strict-profile keys in `runtimeConfigMissingKeys` (also returned in `data` on HTTP 503 with `CONFIG_NOT_READY`). This is now the single canonical "is the system go-live ready?" check — boot-time validation no longer enforces the full provider chain; it only enforces enums and placeholder safety.

---

## 8) Testing

- Unit tests: use `vi.stubEnv` or direct `process.env` assignment in `beforeEach`/`afterEach`. Never rely on DB overlay in unit tests.
- `NotificationsWebhookService` and notifications worker have test-only shims that read `META_WHATSAPP_*` from `process.env` when overlay is unavailable (`NODE_ENV==='test'`).
- Production never reads `process.env` for DB-backed keys — only the overlay path applies.

---

## 9) Key Files

| File | Role |
|------|------|
| `scripts/env-runtime-contract.js` | **Authoritative classification** — `dbOverlay` flag drives all guardrails |
| `scripts/config-runtime-parity-check.js` | Validates `.env.example` live/stub layout |
| `scripts/ops-config-contract-drift-check.js` | Validates ops contract against `env-runtime-contract.js` |
| `src/modules/ops/ops-config-runtime.ts` | `applyOpsConfigRuntimeOverlay()` |
| `src/modules/ops/ops-config-contract.ts` | Per-key domain/mutability/restart metadata; `resolveOpsConfigDomainForKey()` for batch saves |
| `src/common/security/ops-config-crypto.ts` | AES-256-GCM encrypt/decrypt (reads `OPS_DB_ENCRYPTION_KEY` — bootstrap only) |
| `src/common/plugins/cookie.plugin.ts` | Registers `@fastify/cookie` with `OPS_COOKIE_SECRET` |
| `src/common/guards/ops-auth.guard.ts` | Dual auth: cookie session (Path A) or API key headers (Path B) |
| `prisma/schema.prisma` | `OpsConfigSecret`, `StoreSettings`, `OpsUser` models |

---

## 10) Operational Playbook

1. **Set bootstrap keys in `.env`:** `DATABASE_URL`, `REDIS_URL`, `REDIS_PASSWORD`, `OPS_DB_ENCRYPTION_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PORT`/`HOST`, `STOREFRONT_URL`, `ADMIN_URL`, `ADMIN_ALERT_EMAIL`, `TURNSTILE_SECRET_KEY`, `AUDIT_ANCHOR_SECRET`, `REDIS_KEY_PEPPER`, `IDEMPOTENCY_SCOPE_SECRET`, `OPS_COOKIE_SECRET`, `OPS_BROWSER_SESSION_TTL_SECONDS`, `OPS_LOGIN_OTP_TTL_SECONDS`, `CLIENT_ID`, feature flags, OTEL vars, and **workers-only** tuning vars: `RECONCILIATION_AUTO_HEAL_ISSUES`, `RESTART_PAYMENT_DRAIN_TIMEOUT_MS`, `RESTART_QUEUE_DRAIN_TIMEOUT_MS`, `RESTART_QUEUE_PAUSE_GRACE_MS`, `RESTART_PAUSE_AND_DRAIN_QUEUES_ENABLED`.
2. **Start the server** and complete ops user bootstrap (first invite + consume).
3. **Apply DB-overlay keys via Ops UI** (`POST /api/v1/ops/config/save` with OTP): payment credentials, shipping credentials, notification credentials, ops security params (`OPS_METRICS_TOKEN`, `REPLAY_APPROVAL_TOKEN`, `TRUSTED_PROXY_ALLOWLIST_CIDR`, etc.).
4. **Restart API + workers** to apply overlay.
5. **Verify:** `GET /api/v1/ops/config/overview` — all required keys present, no placeholders.
6. **Set StoreSettings** via admin UI: store name, contact details, invoice seller fields. **Notification provider config is ops-only** (step 3 above); per-template channel routing via direct `PATCH /api/v1/admin/settings/notifications` API if non-default routing needed.
7. **Observe startup alerts** — any missing config emits `sendTechnicalFailureAlert`. Resolve all before go-live.

---

## 11) Redis Key and Channel Naming Registry

All Redis keys and pub/sub channels follow the project-wide convention: `<module>:<entity>:<id>`. Every cache key **must** have a TTL — no indefinite caching.

### Cache Keys

| Key pattern | TTL | Set by | Used by | Notes |
|---|---|---|---|---|
| `products:detail:<productId>` | 5 min | `products.service.ts` | Product detail reads | Invalidated on product update/delete |
| `products:list:<hash>` | 5 min | `products.service.ts` | Product list reads | Hash of query params |
| `cart:guest:<hmac>` | Session TTL | `cart.service.ts` | Guest cart reads | HMAC of `sessionToken + REDIS_KEY_PEPPER` |
| `inventory:stock:<variantId>` | 1 min | `inventory.service.ts` | Stock level reads | Invalidated on stock mutation |
| `hot-sku:budget:<variantId>:<shard>` | Dynamic | Load-shed admission | Hot SKU rate control | Shard count = `HOT_SKU_SHARD_COUNT` |
| `cart:reservation:<variantId>:<userId>` | `CART_RESERVATION_TTL_MINUTES` | `cart.service.ts` | Stock hold during checkout | Released on order confirm or expiry |
| `idempotency:<scopeFingerprint>:<key>` | 24 h | `idempotency.ts` | All idempotent mutation routes | Fingerprint = `HMAC(scope, IDEMPOTENCY_SCOPE_SECRET)` |
| `rate-limit:admin:<userId>:<action>` | 1 min | `AdminRateLimitStore` | Admin coupon mutation rate limits | Local fallback on Redis error |
| `ops:browser-session:<tokenHash>` | `OPS_BROWSER_SESSION_TTL_SECONDS` | `ops.service.ts` / opsAuthGuard | Ops browser login sessions | SHA-256 hash only — plaintext token never stored |
| `ops:otp:<email>` | `OPS_LOGIN_OTP_TTL_SECONDS` | `ops.service.ts` | Ops OTP verification | SHA-256 hashed OTP value |
| `refresh:<tokenHash>` | Refresh token TTL | `auth.service.ts` | JWT refresh flow | SHA-256 hashed token; DB record is primary |

### BullMQ Job ID Patterns

| Job ID pattern | Queue | Job name |
|---|---|---|
| `ops-restart:<uuid>` | `cartCleanup` | `scheduled-process-restart` |
| `reconcile-process-order-update:<orderId>` | `order-processing` | `process-order-update` |

### Pub/Sub Channels

| Channel | Publisher | Subscribers | Message payload | Notes |
|---|---|---|---|---|
| `system:restart` | `cart-cleanup.worker.ts` (via `publishRestartSignal()`) | `src/main.ts` (API process), `queues/workers/index.ts` (worker process) | `{ jobId, requestedBy, scheduledFor }` JSON | Constant `SYSTEM_RESTART_CHANNEL` exported from `src/common/restart/system-restart.ts`. Both subscribers initiate graceful shutdown on receipt. Subscriber ioredis connections are closed inside each process's `shutdown()` / `gracefulShutdown()` function — no dangling connections on SIGINT/SIGTERM. |

---

## Phase 7 strict-startup reminder (May 2026 incident learnings)

> **Updated May 2026 (boot tolerance fix):** the startup process no longer crashes when DB-overlay provider chains are incomplete. `validateConditionalEnv` in `src/config/app.config.ts` now validates only provider enums and placeholder safety; it does **not** call `requireEnv` on the full Razorpay / Shiprocket / MSG91 / Resend / WhatsApp dependency sets. This eliminates the boot crash-loop → nginx 502 cycle that occurred when operators saved a provider selector before filling its secrets. Strict go-live coverage is now enforced by `GET /api/v1/health/ready` only.
>
> For first deploy you still want all keys filled before traffic — the items below are still recommended for clean first boot — but if any are missing the API will boot and `/health/ready` will report the gap instead of refusing to start.

At a minimum, ensure these are populated before opening the site to traffic:

- `REPLAY_APPROVAL_TOKEN`
- `OPS_METRICS_TOKEN`
- explicit payment provider mode and compatible keys (`PAYMENT_PROVIDER` + `RAZORPAY_*`), plus at least one shipping provider's credentials (`DELHIVERY_API_KEY` or `SHIPROCKET_EMAIL`/`SHIPROCKET_PASSWORD`)

See:

- `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md`
- `scripts/verify-client-bootstrap-env.mjs`
