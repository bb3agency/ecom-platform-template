# Backend Go-Live Checklist

Use this checklist before promoting any client backend deployment to production traffic.

This checklist validates both:
- Environment correctness (values are present, valid, secure)
- Implementation parity (configured env values actually drive backend behavior as intended)

## 1) Runtime Profile & Global Environment Safety

- [ ] `NODE_ENV` is explicitly set for target environment.
- [ ] Runtime profile classification is enforced:
  - `development` or `test` => development-like
  - any other value (`production`, `staging`, `qa`, `uat`, custom, or unset) => production-like
- [ ] No placeholder secrets remain (`replace_with_*`, `change_me*`, `<...>`).
- [ ] `ENABLE_VERBOSE_VALIDATION_ERRORS=false` in production-like profiles.
- [ ] `.env` inventory is reviewed against `.env.example` and required keys for enabled modules are present.
- [ ] Bootstrap keys (`DATABASE_URL`, `REDIS_URL`, `OPS_DB_ENCRYPTION_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, feature flags, OTEL, etc.) are set as **live values** in `.env`.
- [ ] DB-overlay keys (provider credentials, webhook tokens, ops-security params — all keys marked `dbOverlay: true` in `scripts/env-runtime-contract.js`) are **not** populated in `.env` — they must be stored in `OpsConfigSecret` and applied via `applyOpsConfigRuntimeOverlay()` at boot.
- [ ] `npm run config:parity-check` passes — validates `.env.example` two-tier layout (live values for bootstrap keys, commented stubs for DB-overlay keys).
- [ ] `npm run ops:config-contract-drift-check` passes — validates ops config contract is consistent with `env-runtime-contract.js`.

## 2) Environment-to-Implementation Parity (Mandatory)

### 2.1 Core runtime, routing, and isolation
- [ ] `CLIENT_ID`, `BACKEND_PORT`, `STOREFRONT_URL`, `ADMIN_URL` are correct for this client.
- [ ] `STOREFRONT_URL` is set to the real HTTPS storefront origin — production-like boot **throws** if missing or placeholder (`app.config.ts`); prevents password-reset emails linking to `localhost`.
- [ ] Nginx and backend route wiring matches env (`/api/` to backend, storefront/admin origin correctness).
- [ ] Nginx HTTPS server block includes all six mandatory security headers: `Strict-Transport-Security` (HSTS with 2-year max-age, includeSubDomains, preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection: 1; mode=block`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`. Verify against `nginx/client.conf.template`.
- [ ] Nginx TLS hardening: `ssl_ciphers` ECDHE-only AEAD suite, `ssl_session_cache shared:SSL:10m`, `ssl_session_timeout 1d`, `ssl_session_tickets off`, `ssl_stapling on`, `ssl_stapling_verify on`.
- [ ] Nginx `limit_req_zone` directives placed in `http {}` context (top-level `nginx.conf`), not inside `server {}` block. Per-route `limit_req` uses dedicated `location` blocks, not `if` blocks.
- [ ] CORS behavior matches `STOREFRONT_URL` / `ADMIN_URL` in real browser preflight checks.
- [ ] Client isolation proof is recorded (database, Redis, secrets not shared across clients).

### 2.2 Data layer and persistence
- [ ] `DATABASE_URL` points to the intended client database only. `DATABASE_URL` uses `requireEnv()` fail-fast — missing value throws at config-read time.
- [ ] PostgreSQL credential match verified: `POSTGRES_PASSWORD` in `.env` matches actual DB user password (run `docker exec <postgres-container> psql -U postgres -c "\du"` or connect via Prisma CLI to confirm).
- [ ] Prisma migrations for release SHA are applied (`migrate deploy`) and validated.
- [ ] `REDIS_URL` + `REDIS_PASSWORD` are consistent; Redis auth works from app containers. `REDIS_URL` uses `requireEnv()` fail-fast — missing value throws at config-read time.
- [ ] Redis readiness timeout (20s) is operational — startup fails fast with clear error if Redis is unavailable.
- [ ] Redis persistence settings are verified (AOF enabled, volume mounted).
- [ ] Prisma global client cache is scoped to development-like runtime only (`development`/`test`) — no global caching in production-like profiles.

### 2.3 Auth and session security
- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` are unique, non-placeholder, and rotated per policy.
- [ ] `JWT_SECRET` fail-fast validation is active — `jwt.plugin.ts` throws `AppError(INTERNAL_ERROR)` if missing/empty at plugin registration. `JWT_REFRESH_SECRET` fail-fast validation is active — `auth.service.ts` `resolveRefreshSecret()` throws if missing/empty at token sign/verify time.
- [ ] JWT signing and verification pinned to `HS256` algorithm for both access tokens (`@fastify/jwt`) and refresh tokens (`jsonwebtoken`) — no algorithm downgrade risk.
- [ ] Auth flows behave correctly in target env (OTP/login/refresh/logout).
- [ ] Phone OTP signup route `POST /api/v1/auth/signup-phone` is validated end-to-end (phone + otp required; optional `firstName`, `lastName`, `email`; issues auth tokens and sets refresh cookie).
- [ ] Refresh/session behavior aligns with secure cookie expectations and no regression in 401 refresh flow.
- [ ] Admin permission snapshot behavior is acknowledged in runbook and operator SOP: admin access tokens embed permissions at issuance and mid-window grant/revoke changes require token revocation/logout to take immediate effect.

### 2.4 Payment and shipping providers
- [ ] `PAYMENT_PROVIDER` is valid for business mode (`razorpay` or `cod`). Invalid/missing runtime config yields call-time `CONFIG_NOT_READY` and must be resolved before launch.
- [ ] At least one shipping provider's credentials are set: `DELHIVERY_API_KEY` (Delhivery) and/or `SHIPROCKET_EMAIL`+`SHIPROCKET_PASSWORD` (Shiprocket). Both can be active simultaneously — cheapest rate wins at checkout. `SHIPPING_PROVIDER` env var is ignored (detection is credential-based). Missing all credentials yields noop mode — not acceptable in production.
- [ ] `PAYMENT_PROVIDER=noop` is not used in production-like profiles (startup guard rejects it).
- [ ] Production-like startup guard rejects placeholder secrets (`replace_with_*`, `change_me*`, `<...>`) for **any provider key that is actually set** (boot tolerance — May 2026 — does **not** require missing provider chain keys at startup; readiness gate enforces completeness).
- [ ] All external provider adapters have fetch timeouts configured (10s for Delhivery/Razorpay/Resend/MSG91).
- [ ] Razorpay env vars are only required when `PAYMENT_PROVIDER=razorpay` (COD-only stores skip them).
- [ ] Provider credentials are real, non-placeholder, and validated with live/sandbox handshake tests.
- [ ] **Go-live gate:** `GET /api/v1/health/ready` reports `status: ready` and `runtimeConfigMissingKeys: []` before opening production traffic. On HTTP 503, read `data.runtimeConfigMissingKeys` from envelope — `error.code` is `CONFIG_NOT_READY`. This is the canonical "is the system go-live ready?" check; CD (`vps-deploy.sh`) no longer blocks on it but go-live must.
- [ ] Ops UI `/ops/config` is used for incremental saves. Partial-save validation (`POST /api/v1/ops/config/save`) only checks keys in the batch — operators can save 1–5 keys, restart, save the rest. Boot tolerates incomplete provider chains.
- [ ] Client credential register exists and is filled with owner, vault path, created on, rotated on, expiry/next rotation, and last-tested values (`docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`).
- [ ] Circuit breaker behavior is understood in multi-replica deployments: payment/shipping circuit breaker state is process-local and not shared across replicas unless explicitly redesigned with shared Redis state.

### 2.5 Webhook security and replay controls
- [ ] Webhook tokens/secrets are configured and signature/token verification is validated in target env.
- [ ] Meta WhatsApp webhook endpoint `/api/v1/notifications/webhook/meta-whatsapp` is configured with `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `META_WHATSAPP_APP_SECRET`.
- [ ] Meta webhook POST event deliveries include valid `x-hub-signature-256` HMAC signatures and are rejected when signature verification fails.
- [ ] Webhook IP allowlists are configured for production-like profiles (`RAZORPAY_WEBHOOK_ALLOWLIST_CIDR` and shipping allowlist via `SHIPPING_WEBHOOK_ALLOWLIST_CIDR` or provider fallback envs). Allowlists hard-fail in production-like profiles if missing.
- [ ] Webhook raw body preserved as `Buffer` for HMAC integrity (no UTF-8 roundtrip).
- [ ] Webhook skew controls are explicitly configured per provider (`RAZORPAY_WEBHOOK_MAX_SKEW_SECONDS`, `DELHIVERY_WEBHOOK_MAX_SKEW_SECONDS`, `SHIPROCKET_WEBHOOK_MAX_SKEW_SECONDS`) per policy.
- [ ] `REPLAY_APPROVAL_TOKEN` and replay controls match ops approval policy.
- [ ] Duplicate webhook deliveries are confirmed idempotent (single downstream state transition).

### 2.6 Risk, feature flags, and behavior toggles
- [ ] Risk envs (for example `RISK_VELOCITY_ENABLED`, `RISK_PAYMENT_INIT_MAX_PER_HOUR`) match policy and are functionally verified.
- [ ] Feature flags (`FEATURE_*`) match the contracted release scope.
- [ ] `FEATURE_RESPONSE_ENVELOPE_ENABLED` matches frontend parser expectations and is validated via real responses.

### 2.7 Notifications, assets, and document outputs

- [ ] Notification toggles/channels (`NOTIFY_*`) and providers are configured and smoke-tested:
  - Email: `RESEND_API_KEY` + `RESEND_FROM` (Resend runtime provider)
  - SMS: active provider key — `MSG91_AUTH_KEY` + `MSG91_SENDER_ID` + `MSG91_ROUTE` when `SMS_PROVIDER=msg91`; `FAST2SMS_API_KEY` when `SMS_PROVIDER=fast2sms`. Merchant SMS templates override defaults via `StoreSettings.smsTemplates` (DB-backed JSON field).
  - WhatsApp: `META_WHATSAPP_ACCESS_TOKEN` + `META_WHATSAPP_PHONE_NUMBER_ID` + `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` + `META_WHATSAPP_APP_SECRET` (Meta Cloud API direct)
- [ ] Invoice storage env (`INVOICE_STORAGE_ROOT`) is valid and writable by backend/workers.
- [ ] Authenticated invoice routes are validated end-to-end:
  - `GET /api/v1/orders/:id/invoice.pdf` (customer-owned order only)
  - `GET /api/v1/admin/orders/:id/invoice.pdf` (admin `orders:read`)
- [ ] Order APIs expose invoice metadata via `invoice.hasPdf` only (no direct/public/signed invoice URLs).
- [ ] Store/invoice profile (DB-backed `StoreSettings`) produces correct invoice and legal document outputs (GST fields, totals, seller metadata). No `STORE_*` env fallbacks.

### 2.8 Ops metrics and observability
- [ ] `OPS_METRICS_TOKEN` and optional `OPS_METRICS_ALLOWLIST` are configured and validated.
- [ ] `OPS_DB_ENCRYPTION_KEY` is configured and `/api/v1/ops/config/save` fails closed when missing (security behavior verified).
- [ ] If OTEL enabled, `OTEL_*` envs are valid and traces are visible in collector/APM.
- [ ] Alert routing/on-call ownership is configured for go-live window.
- [ ] All SLO alert rules in `observability/slo-rules.yml` have corresponding test cases in `observability/slo-rules.test.yml` (including `QueueDLQDepthHigh` and `AuthChallengeFailureSpike`).
- [ ] `npm run test:slo-rules` passes (requires `promtool` in CI).
- [ ] System-wide technical failure alerting is verified: at least one active Ops user and one active Admin user exist in DB (`role IN ('OPS', 'ADMIN')`, `isActive: true`). Resend (`RESEND_API_KEY` + `RESEND_FROM`) is configured for alert delivery.
- [ ] `StoreSettings.storeName` and `StoreSettings.websiteUrl` are populated — alert emails carry client-identifying metadata. No env fallbacks.
- [ ] Per-template primary notification channels are configured in `StoreSettings.primaryNotificationChannels` (DB JSON field). All 13 templates have primary channel set (`EMAIL` default). Configure via direct API: `PATCH /api/v1/admin/settings/notifications` with `primaryChannels` payload (admin JWT). **Note:** Merchant admin UI panel for this was removed 2026-06-07 — use the API directly or ops console for channel provider toggles.

### 2.9 Ops control plane hardening
- [ ] `/api/v1/ops/*` routes are protected by browser session cookie (`ops_session`) issued via email-OTP login — not by merchant admin JWT flow. Privileged write actions additionally require an email OTP challenge (`challengeId`, `otpCode`) in the request body — verified by `opsAuthGuard` before the action commits.
- [ ] Ops users are isolated from `User` admin identities (mutually exclusive email domains).
- [ ] First ops identity invite bootstrap is performed via `npm run ops:newuser -- --email=<ops@email> --name="Primary Ops" --setup-base-url="https://<client-domain>" --yes` on trusted VPS host session (SSH) only.
- [ ] Merchant admin invite bootstrap is performed via `npm run admin:newuser -- --email=<admin@email> --name="Merchant Admin" --setup-base-url="https://<client-domain>" --yes` (or ops-authenticated admin invite API fallback), never via local seed scripts.
- [ ] Invite `setupBaseUrl` is passed as frontend base origin only (for example, `https://<client-domain>`), never path URLs like `/ops/setup` or `/admin/setup`; backend appends setup paths.
- [ ] Cross-domain invite email boundaries are verified: ops invite fails `409 CONFLICT` when email exists in `User` (except explicit deactivated-merchant-admin message); admin invite fails `409 CONFLICT` when email exists in `OpsUser`; admin invite allows **deactivated** merchant admin emails and reactivates the same `User` on consume.
- [ ] Invite setup link expires within 10 minutes; expired unconsumed invite records are cleaned and auditable.
- [ ] Ops write actions require email OTP challenge verification (`ops:write`) before committing.
- [ ] Ops write actions persist tamper-evident audit-chain records (`OpsAuditLog` chain hash continuity).
- [ ] Ops setup, endpoint usage, and frontend integration follow `docs/OPS_CONTROL_PLANE_GUIDE.md`.
- [ ] Invite lifecycle boundaries are verified and documented: `GET /api/v1/admin/invites` (ops:read), `POST /api/v1/admin/invites` (ops:write), `POST /api/v1/admin/invites/:inviteId/revoke` (ops:write, OTP-gated), and `POST /api/v1/admin/invites/cleanup-expired` (ops:write) are all ops-authenticated Layer C controls; `POST /api/v1/admin/invites/consume` and `POST /api/v1/ops/invites/consume` are public, rate-limited, one-time token bootstrap endpoints only; neither consume endpoint creates an invite or grants permissions without a valid unexpired token.
- [ ] Coupon soft delete and audit trail (`CouponAuditLog`) are operational: deleted coupons have `deletedAt` and `deletedBy` populated, are excluded from active coupon lists, and can be restored via `POST /api/v1/admin/coupons/:id/restore` (**no request body**). `DELETE /api/v1/admin/coupons/:id` is **bodyless**. All mutations create corresponding audit log entries.
- [ ] Coupon `CouponAuditLog` tamper-evident hash chain is intact: every row contains a non-null `chainHash` (SHA-256 of `previousChainHash + payload`), and the first row for each coupon has `previousChainHash = 'GENESIS'`. Verify via `GET /api/v1/admin/coupons/:id/audit` that consecutive entries chain correctly.
- [ ] Per-admin coupon mutation rate limits are enforced by `AdminRateLimitStore` (Redis-backed, local fallback): create 10/min, update 20/min, status 20/min, delete 5/min, restore 5/min. Exceeding limits returns `429` with `RATE_LIMIT_EXCEEDED` code.
- [ ] `FEATURE_COUPONS_ENABLED=true` is set only when the client actively wants promo codes. Disabled by default to prevent unused endpoint exposure.
- [ ] DB-backed ops config secrets are encrypted at rest (`OpsConfigSecret`) and only masked values are returned by read APIs.
- [ ] Ops config key lifecycle is contract-driven (`src/modules/ops/ops-config-contract.ts`) with deny-by-default mutability.
- [ ] Current contract policy is validated in release evidence: bootstrap-only keys (`DATABASE_URL`, initial `REDIS_URL`, `OPS_DB_ENCRYPTION_KEY`) are real-env only, while DB-overlay keys are editable only through developer Ops UI/API with ops auth + verified OTP + encrypted persistence + restart-required behavior.
- [ ] API and worker processes apply the encrypted DB runtime overlay (`applyOpsConfigRuntimeOverlay`) **before** provider/notification/shipping/payment initialization, and DB values override `process.env` only for contract-allowed non-bootstrap keys.
- [ ] `npm run ops:config-contract-drift-check` passes and is included in guardrails before release cut.
- [ ] **DB-overlay config verification steps (run after first ops invite bootstrap):**
  - [ ] All `dbOverlay: true` keys have entries in `OpsConfigSecret` (verify via `GET /api/v1/ops/config/stored` with ops auth — returns per-row `{ maskedValue, plaintextValue }`; `plaintextValue` is returned for every active row, INCLUDING real cryptographic secrets, as a deliberate operator-UX policy — see `HARDENING_HISTORY.md`). Confirm operator-only access to this endpoint by exercising 401/403 with non-ops sessions.
  - [ ] `GET /api/v1/ops/config/overview` shows no required keys with `present: false` or `isPlaceholder: true` in the `strictProfileHealth` check.
  - [ ] Backend and worker processes are restarted after saving all overlay values — `applyOpsConfigRuntimeOverlay()` is a boot-time operation.
  - [ ] Confirm provider credentials in DB overlay are functional: complete a Razorpay test payment (or shipping dry-run) after overlay is applied to confirm the overlay values actually reach provider SDK calls.
  - [ ] `POST /api/v1/ops/config/validate` with the full config payload returns no `required` or `unknown` key errors.

### 2.10 Atomic Operations & Concurrency Control (Race-Condition Hardening)

- [ ] Critical state transitions use guarded CAS updates (`updateMany`/transaction guards) and return structured conflict/retry-safe errors.
- [ ] CAS coverage includes admin invites, refresh tokens, reconciliation, webhook inbox claims, inventory, outbox dispatch, coupons, idempotency, and order confirmation paths.
- [ ] Ops audit chain lock behavior is validated, including lock timeout as structured `503 ops_audit_chain_lock_timeout`.
- [ ] CAS regression tests pass for hardened auth/admin/ops/reconciliation/idempotency/inventory/outbox/order paths.
- [ ] Mock compatibility remains intact for unit tests while production paths keep guarded writes.

### 2.11 JSON Schema and input validation
- [ ] All `type: 'object'` JSON schema declarations across all 14 module schema files include `additionalProperties: false` (only webhook header schemas intentionally use `additionalProperties: true`).
- [ ] Route-level JSON schema validation is present on every non-health endpoint.
- [ ] Every admin route has rate limiting (`routeRateLimitProfiles.*`) and load-shed protection (`loadShedGuard`).
- [ ] `npm run route:discipline-check` passes, and any exemption in `scripts/route-discipline-check.js` remains narrowly justified. Current allowed invite exemptions are ops-controlled admin invite creation/cleanup and public one-time consume endpoints for admin/ops setup; do not add broad `/admin/*` or `/ops/*` exemptions.

### 2.12 Script and seed security
- [ ] `scripts/upsert-admin.js` and `scripts/seed-admin.mjs` read admin credentials from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` environment variables — no hardcoded production credentials.
- [ ] `scripts/ops-newuser.mjs` reads invite/email/encryption configuration from env and does not hardcode credentials. `RESEND_API_KEY` and `RESEND_FROM` must be set as live values in `.env` before running this script (Phase 1 bootstrap — see `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`). After first ops login they are managed via Ops UI.
- [ ] `scripts/admin-contract-check.js` reads test admin credentials from `ADMIN_EMAIL` / `ADMIN_PASSWORD` environment variables and hard-fails at startup when either is absent — no hardcoded credentials that could leak into production environments.

## 3) Database & Prisma Readiness

- [ ] Current Prisma schema validates.
- [ ] Prisma client generation succeeds.
- [ ] Migration history is consistent and no drift is detected.
- [ ] Prisma delegate drift cleanup is complete: native Prisma delegates are used directly (`prisma.returnRequest`, `prisma.storeSettings`), and no drift workaround file/script remains in the repository.
- [ ] `OpsUser.mfaSecretEncrypted` nullable migration is applied in target DB and guard behavior is validated (`mfaEnabled=true` with missing secret fails closed, requires reprovision).
- [ ] Backup/restore readiness is confirmed before cutover.

## 4) Webhook, Idempotency, and Reliability Controls

- [ ] Razorpay webhook signature verification validated in target env.
- [ ] Shipping webhook token verification validated in target env.
- [ ] Critical mutation idempotency is validated via tests/logs (orders/payments/admin critical writes).
- [ ] Outbox/inbox reliability behavior is validated (no duplicate side-effects under retries).

## 5) Queue, Worker, and Reconciliation Health

- [ ] Worker processes are running and connected to Redis. Workers service uses `command: ["node", "bootstrap-workers.js"]` (not `npm run` — npm is stripped from production image). Worker/API Redis clients use shared error listeners (`src/common/redis/redis-connection.ts`) — transient `ECONNRESET` should log as throttled warnings, not unhandled ioredis events.
- [ ] API boot passes admin endpoint policy registry integrity (`assertAdminPolicyRegistryIntegrity`) — includes `DELETE /api/v1/admin/categories/:id/permanent` mapped to `categories:write`.
- [ ] SQL injection guard passes: `npm run security:sql-injection-guard` must report zero unsafe raw Prisma patterns (`$executeRawUnsafe`, `$queryRawUnsafe`, `Prisma.raw`) in `src/`, `queues/`, `scripts/`.
- [ ] Outbox/inbox flows process normally (no growing dead-letter backlog).
- [ ] Reconciliation jobs run and produce expected outputs.
- [ ] Low-stock and cleanup schedulers are healthy.
- [ ] Periodic housekeeping jobs are registered and running: `purge-expired-idempotency-records` (daily 3 AM), `purge-published-outbox-messages` (weekly Sunday 4 AM), `purge-expired-refresh-tokens` (daily 3 AM).
- [ ] Docker image uses `npm prune --omit=dev` — no devDependencies in production. `prisma` CLI and `@types/jsonwebtoken` are in `devDependencies`.
- [ ] CI security scans pass: npm audit (`--omit=dev`), OSV Scanner (respects `osv-scanner.toml` dev-group ignore), Trivy container scan. See `MASTER_DEPLOYMENT_PLAYBOOK.md` Appendix G.0.
- [ ] Notification worker has no fall-through bug (SMS → WhatsApp execution path is isolated).
- [ ] Queue DLQ depth SLO evaluates against explicitly recorded dead-letter queue depth series.
- [ ] Refund worker uses two-phase CAS: `refundPendingAmountPaise` is incremented atomically inside a `$transaction` gate *before* the external `initiateRefund()` call. Concurrent refund jobs for the same order cannot both win the gate (double-spend proof).
- [ ] Deferred refund lifecycle is validated in admin/API behavior: requesting `REFUNDED` enqueues refund work and does not guarantee immediate order status flip in the synchronous response.
- [ ] Reconciliation `PAYMENT_CAPTURED_ORDER_NOT_CONFIRMED` auto-heal enqueues a `process-order-update` job to the `order-processing` queue (not a raw `prisma.order.update`) so inventory deduction, coupon `usesCount` increment, reservation release, notifications, invoice generation, and analytics all fire through the canonical path. `jobId` is `reconcile-process-order-update:<orderId>` for idempotency.
- [ ] `confirm-order` and `deduct-inventory` jobs in `order-processing.worker.ts` are thin delegation stubs — they resolve the `orderId` from webhook data and immediately enqueue `process-order-update`. No order/payment status mutations occur in those handlers directly. `process-order-update` is the single authoritative entry point for order status transitions to `CONFIRMED`.
- [ ] `process-order-update` is present in the `knownQueueJobs` set in `src/common/observability/metrics.ts` so queue metrics (retries, failures, backlog) are correctly tracked for this job.
- [ ] `RECONCILIATION_AUTO_HEAL_ISSUES` env var is set intentionally: comma-separated list enables only named heal types; empty string disables all auto-heals for incident triage. **Default (unset):** `PAYMENT_CAPTURED_ORDER_NOT_CONFIRMED`, `REFUNDED_STATUS_MISMATCH`, `STALE_PENDING_PAYMENT` (includes stale `PAYMENT_FAILED` abandon cleanup). **`ORDER_SHIPPED_WITHOUT_SHIPMENT` is not auto-healed by default** — manual review.
- [ ] Coupon checkout reservation includes `PAYMENT_FAILED` in usage-limit counts (`COUPON_RESERVED_ORDER_STATUSES`); stale cancel and reconciliation paths call `clearUnfinalizedCouponLinks` / `releaseCouponUsageForOrder` as documented in `coupon-usage.ts`.
- [ ] COD cancel inventory restore is gated on `COD_ORDER_CREATED` status history before incrementing stock (`restore-inventory-on-cancel.ts`).
- [ ] `GET /api/v1/store/config` returns expected public fields and requires no auth (storefront ISR + admin GST panels depend on it).
- [ ] Cancel paths enqueue `cancel-shipment` on the shipping queue when an AWB exists.
- [ ] `RESTART_PAYMENT_DRAIN_TIMEOUT_MS` is set in the **workers** `.env` (not the API env). Default `300000` (5 min) is appropriate for production. In staging/test environments, set to a lower value (e.g. `10000`) to prevent long waits during scheduled-process-restart job testing. Verify it is present in `docker-compose.yml` workers service environment section.
- [ ] **Graceful queue drain envs** (`RESTART_QUEUE_DRAIN_TIMEOUT_MS`, `RESTART_QUEUE_PAUSE_GRACE_MS`, `RESTART_PAUSE_AND_DRAIN_QUEUES_ENABLED`) are set on the **workers** container only. Defaults (`60000` / `1500` / `true`) are appropriate for production. Verify the protocol works end-to-end in staging: trigger `POST /api/v1/ops/system/restart`, watch `cartCleanup` worker logs for "Pausing outboxDispatch queue", "Pausing producer queues", "Active count drained to 0" (or "Queue drain timeout reached"), "Resuming queues", "Publishing restart signal". Container restart timing must be ~3–5 s end-to-end; longer windows indicate a stuck consumer that needs investigation.
- [ ] Verify **no queue job is lost** during a scheduled restart: enqueue test jobs in `notification`/`shipping`/`payments` queues immediately before triggering `POST /api/v1/ops/system/restart`. After restart, confirm those jobs are claimed and completed by the new worker container (BullMQ `attempts` state is durable in Redis through the pause/resume cycle).
- [ ] Shipment booking (`create-shipment` job) does NOT hold a DB connection during the external provider HTTP call. The handler uses three phases: read-only validation → external call → write-only transaction. Verify no interactive transaction wraps the `createShipment()` call.
- [ ] Credit note generation jobs carry a deterministic `jobId` on both the outbox path and the direct BullMQ fallback path, ensuring no duplicate credit note documents are generated on retry.
- [ ] API (`start`) and workers (`start:workers`) are running as separate supervised long-lived processes/services; both remain stable (no crash loop) for at least 30 minutes.
- [ ] Runtime memory trend evidence is captured for both API and worker processes during load (`process_resident_memory_bytes`, `nodejs_heap_size_used_bytes`, `nodejs_heap_size_total_bytes`) and shows stabilization after warm-up.
- [ ] Sustained OTP/login soak test is executed (30–60 minutes) against `POST /api/v1/auth/send-otp` and `POST /api/v1/auth/verify-otp`; p95/p99, error rate, queue depth, and memory trend are recorded.
- [ ] Notification worker liveness is explicitly verified during OTP soak: `send-sms` jobs are consumed continuously, no unbounded backlog, and no sustained DLQ growth.

## 6) Release Validation Commands (CMD)

Run from backend repo root:

```cmd
cmd /c npm run typecheck
cmd /c npm run test:unit
cmd /c npm run test:e2e
cmd /c npm run test:security
cmd /c npm run test:guardrails
cmd /c npm run build
cmd /c npx prisma validate --schema prisma/schema.prisma
cmd /c npm run prisma:generate:safe
cmd /c npm run edge:drift-check
cmd /c npm run release:policy-state
cmd /c npm run release:guard
cmd /c npm run test:slo-rules
cmd /c npm run stress:flash-sale:api:matrix
cmd /c npm run parity:scorecard
```

Pass criteria:
- [ ] All commands exit `0`.
- [ ] `release:guard` reports pass.
- [ ] Guardrails pass for admin/docs/config parity.
- [ ] Flash-sale stress matrix passes invariant enforcement and does not fail on fixture precondition checks.
- [ ] `contract:admin` / full `ci:reliability-gates` evidence is captured only against a running backend at the configured `BASE_URL` with seeded/known admin credentials. If local execution fails at `contract:admin` with `TypeError: fetch failed` and no backend is running, classify it as an environment precondition failure and rerun in a controlled running environment.

## 7) Functional UAT Gates (Backend-Centric)

- [ ] OTP auth flow works with expected rate limiting and error codes.
- [ ] Guest cart merge on login works without data loss.
- [ ] PREPAID order path works end-to-end with webhook confirmation.
- [ ] COD order path works end-to-end without Razorpay initiate/verify.
- [ ] Cancel/refund flow works with correct status transitions.
- [ ] Manual-only shipping policy is enforced: payment confirmation does not auto-create shipments.
- [ ] Admin ship action (`POST /api/v1/admin/orders/:id/ship`) enforces ship eligibility (`canShipNow`) and returns meaningful `shipBlockReason` when blocked.
- [ ] AWB/tracking updates propagate correctly from shipping provider callbacks.
- [ ] Merchant receives shipment dispatch notifications on admin ship action (SMS always when enabled, WhatsApp only when WhatsApp notifications are enabled).
- [ ] One staging dry run is completed and archived for each provider class:
  - Razorpay payment + webhook validation
  - Delhivery/Shiprocket shipment + webhook validation
  - SMS provider OTP send/verify (MSG91 or Fast2SMS per `SMS_PROVIDER`)
  - Resend verified sender test
  - Invoice local storage write/read cycle

## 8) Evidence Package and Sign-Off

- [ ] Environment snapshot (non-secret) archived for release record.
- [ ] Env-to-implementation parity evidence archived (logs, health checks, feature behavior proof).
- [ ] Client credential register archived with full lifecycle metadata (`docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`).
- [ ] 90-day rotation calendar is recorded with primary and backup owners for payments/shipping/notifications/assets.
- [ ] Compromise drill evidence is recorded (`revoke -> regenerate -> redeploy -> verify`) with elapsed time and findings.
- [ ] Rollback plan is documented and tested for this deployment window.
- [ ] Release owner, ops owner, and QA owner sign-off recorded.
- [ ] Frontend contract alignment confirmed using `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`.
- [ ] Frontend/admin/ops execution evidence confirms simultaneous build + integration via vertical slices (contract freeze -> typed client -> UI -> real route integration -> tests), not deferred API integration after page completion.
- [ ] Admin provisioning evidence shows fail-closed posture for fresh admins (no `AdminPermissionGrant` rows => no effective permissions) and explicit permission grant workflow before first privileged operation.
- [ ] Crash-boundary observability evidence archived: `process_crash_total{reason}` appears in metrics snapshot and alerting stack scrape path is verified.
- [ ] Phase 7 deploy hardening evidence archived: `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md` preflight gates passed (strict env check, host DB routing checks, compose overlay usage).

---

## Quick Reuse Note (Per Client)

For each new client deployment:
1. Duplicate this checklist in client release records.
2. Fill pass/fail and owner notes for each item.
3. Archive with deployment artifacts and post-go-live observations.

---

> **This checklist is used twice in the client onboarding process:** first as part of **Phase 5** (full local integration testing gate — run against the local dev environment before any VPS work) and again as part of **Phase 12** (go-live validation against the live VPS deployment). For the full sequenced execution order — from client intake through DNS cutover — see **[`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](CLIENT_ONBOARDING_EXECUTION_ORDER.md)**. That runbook defines what must be complete *before* each execution of this checklist, and what evidence must be filed alongside it.
