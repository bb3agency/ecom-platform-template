# Client Go-Live Validation Guide

Use this guide for **final sign-off** before switching DNS/traffic to production for a **single client** deployment of this template. **Canonical requirements:** `BRD.md` section 12 (Phase 6 acceptance criteria **AC-01–AC-15**), `TRD.md` (technical gates), `ECOM_MASTER.md` (isolation and VPS model). **Deploy procedures:** `docs/CLIENT_VPS_SETUP_GUIDE.md`. **Frontend contract:** `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`. **Reusable checklist set:** `docs/BACKEND_GO_LIVE_CHECKLIST.md` + `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`. **Provider lifecycle runbook:** `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` + `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`.

**Lifecycle:** This is a **Client-Main (Post-Development)** document. Use `docs/CLIENT_HANDOFF_INDEX.md` as the primary entrypoint for the full post-development doc set.

Phase 4 frontend build evidence must follow the mandatory sequence: Foundation -> Ops control plane -> Admin read -> Admin mutation -> Reliability -> Storefront customer journey.

`docs/BACKEND_GO_LIVE_CHECKLIST.md` is mandatory and must validate all required backend env groups (core/auth/data/providers/webhooks/risk/features/notifications/ops/observability), plus implementation parity proof for each enabled capability.

---

## 1. Release record (fill in)

| Field | Value |
| --- | --- |
| Client name | |
| Environment | staging / production |
| Backend git SHA | |
| Storefront git SHA | |
| Admin static build SHA | |
| Deploy timestamp (UTC) | |
| Owner on call | |

---

## 2. Environment & secrets (`TRD.md` §11.4, `.env.example`)

> In addition to the table checks below, execute and attach `docs/BACKEND_GO_LIVE_CHECKLIST.md` section 2 (Environment-to-Implementation Parity).

| Check | Pass criteria |
| --- | --- |
| `.env` exists only on server / secret store — **not** in git | Verified |
| **No** placeholder secrets (`replace_with_*`) in prod | Verified |
| **`CLIENT_ID`**, **`BACKEND_PORT`**, **`DATABASE_URL`** unique to this client | Matches runbook |
| **`REDIS_PASSWORD`** unique per client and non-placeholder | Verified |
| **`REDIS_URL`** uses auth format (`redis://:<password>@redis:6379` in Compose) | Verified |
| **`JWT_SECRET`**, **`JWT_REFRESH_SECRET`** unique — **never** shared across clients (`ECOM_MASTER.md` §5). Both fail-fast if missing/empty (config `requireEnv()` + auth service `resolveRefreshSecret()`) | Verified |
| `PAYMENT_PROVIDER` is **not** `noop` — must be `razorpay` (or `cod` for COD-only deployments) | Never `noop` in production-like profiles (`NODE_ENV` is not `development`/`test`) |
| **Shipping provider credentials present** — `DELHIVERY_API_KEY` (Delhivery) and/or `SHIPROCKET_EMAIL`+`SHIPROCKET_PASSWORD` (Shiprocket). Both can coexist. `SHIPPING_PROVIDER` is not a valid config key — detection is credential-based. | At least one provider active in production |
| Razorpay **live** keys for production (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) | Match Razorpay dashboard |
| **Shipping provider credentials verified** — at least one of: Delhivery (`DELHIVERY_API_KEY` + `DELHIVERY_BASE_URL`) or Shiprocket (`SHIPROCKET_EMAIL` + `SHIPROCKET_PASSWORD`) set via Ops UI | Verified via `/api/v1/health/ready` `runtimeConfigMissingKeys: []` |
| **`REPLAY_APPROVAL_TOKEN`** set when production replay endpoints are enabled | Per ops policy |
| **`OPS_METRICS_TOKEN`** (production required) + optional **`OPS_METRICS_ALLOWLIST`** defense-in-depth for `/api/v1/ops/metrics` | Scraper can authenticate |
| Admin permission snapshot caveat acknowledged in ops SOP | Mid-window permission grant/revoke changes require token revocation/logout for immediate effect |
| Fresh-admin fail-closed provisioning validated | Admin with no `AdminPermissionGrant` rows gets no effective privileged access until explicit grants are created |
| Optional **`RAZORPAY_WEBHOOK_ALLOWLIST_CIDR`**, **`SHIPPING_WEBHOOK_ALLOWLIST_CIDR`** (provider-agnostic fallback), **`DELHIVERY_WEBHOOK_ALLOWLIST_CIDR`**, **`SHIPROCKET_WEBHOOK_ALLOWLIST_CIDR`** | Match provider egress; test with real webhook |
| Skew windows **`RAZORPAY_WEBHOOK_MAX_SKEW_SECONDS`**, **`DELHIVERY_WEBHOOK_MAX_SKEW_SECONDS`** / **`SHIPROCKET_WEBHOOK_MAX_SKEW_SECONDS`** | NTP ok on VPS |
| **`STOREFRONT_URL`**, **`ADMIN_URL`** | Exact HTTPS origins |
| **`NOTIFY_EMAIL_ENABLED`**, **`NOTIFY_SMS_ENABLED`**, **`NOTIFY_WHATSAPP_ENABLED`** | Match contracted customer/merchant communication channels for AC-04/AC-10/AC-16 flows |
| **`RESEND_API_KEY`**, **`RESEND_FROM`** | Resend email provider credentials (runtime) |
| **`MSG91_AUTH_KEY`**, **`MSG91_SENDER_ID`**, **`MSG91_ROUTE`** | MSG91 SMS provider credentials (runtime) |
| **`META_WHATSAPP_ACCESS_TOKEN`**, **`META_WHATSAPP_PHONE_NUMBER_ID`**, **`META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`** | Meta Cloud API WhatsApp credentials (required when `NOTIFY_WHATSAPP_ENABLED=true`) |
| **`META_WHATSAPP_API_VERSION`** | Meta Graph API version (default: `v21.0`) |
| **Per-template primary notification channels** | `StoreSettings.primaryNotificationChannels` configured in DB; all 13 templates have primary channel set (`EMAIL` default). Configure via direct API: `PATCH /api/v1/admin/settings/notifications` (admin JWT). **Note (2026-06-07):** Merchant admin UI panel removed — use the API or ops console. No fallback — if primary channel fails, notification fails and triggers alert. |
| **`ENABLE_VERBOSE_VALIDATION_ERRORS`** | Disabled in production (`false`) so validation responses remain minimal/redacted |
| Feature flags (`FEATURE_*`) | Match commercial agreement (`ECOM_MASTER.md` §12.2) |
| **`FEATURE_RESPONSE_ENVELOPE_ENABLED`** matches frontend expectation | If `true`, frontend must parse `{ success, data }` wrapper on all 2xx |
| If flash-sale: **`HOT_SKU_VARIANT_IDS`** populated + `HOT_SKU_SHARD_COUNT` tuned | Run `node scripts/seed-flash-sale-fixtures.js` to seed + verify |
| If OTEL: **`OTEL_TRACING_ENABLED=true`**, endpoint + headers configured | `node scripts/otel-readiness-check.js` passes; traces visible in collector |
| **`OPS_AUDIT_LOCK_TTL_MS`** (default 5000) | Redis lock TTL for audit chain serialization — non-zero positive integer |
| **`OPS_AUDIT_LOCK_WAIT_TIMEOUT_MS`** (default 2000) | Max wait for audit chain lock acquisition — non-zero positive integer |

**Race-Condition Hardening Verification:**

Atomic operations and TOCTOU prevention are code-level patterns requiring verification via:
- Unit test pass: `ops.service.test.ts`, `auth.service.mfa-refresh.test.ts`, `admin-invites.service.test.ts`, `reconciliation.worker.test.ts`, `idempotency.test.ts`
- CAS pattern review: Confirm `updateMany` with guard conditions used in all state transitions (invite consumption, token refresh, reconciliation, webhook inbox claiming)
- Audit chain lock verification: `503 ops_audit_chain_lock_timeout` returned on lock contention (not 500)

---

## 3. Infrastructure

| Check | Pass criteria |
| --- | --- |
| Docker **`backend`**, **`workers`**, **`postgres`**, **`redis`** healthy | `docker compose ps` |
| **`npm run start`** command parity | Image runs `node bootstrap-backend.js` (`Dockerfile` / `package.json`) |
| Workers processing BullMQ | No sustained backlog; **`GET /api/v1/ops/queues`** accessible with ops session (`ops:read`) |
| Postgres reachable | `/api/v1/health` → DB **connected** |
| Redis reachable | `/api/v1/health` → Redis **connected** |
| Redis secure mode | `docker compose exec redis redis-cli -a "$REDIS_PASSWORD" ping` returns `PONG`; no public Redis port exposed |
| Redis persistence | `INFO persistence` shows `aof_enabled:1`; named volume is mounted |
| Dependency outage behavior | During controlled fault drill, `/api/v1/health` returns **503** when DB or Redis is unavailable (`TRD.md` health contract) |
| Migrations | `prisma migrate deploy` applied for this release SHA |
| Prisma delegate drift cleanup | Native Prisma delegates are in use (`prisma.returnRequest`, `prisma.storeSettings`) and no drift workaround file/script remains in the repository |
| Ops MFA nullable migration behavior | `OpsUser.mfaSecretEncrypted` nullable migration is applied and guard fails closed if `mfaEnabled=true` with missing secret |
| Nginx | `/api/` → `127.0.0.1:<BACKEND_PORT>`; frontend upstream serves storefront and admin routes (for example `/` and `/admin`) |
| Nginx security headers | HTTPS server block includes six mandatory headers: `Strict-Transport-Security` (HSTS 2yr + preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection: 1; mode=block`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`. Verify against `nginx/client.conf.template`. |
| Nginx TLS hardening | `ssl_ciphers` ECDHE-only AEAD suite, `ssl_session_cache shared:SSL:10m`, `ssl_session_timeout 1d`, `ssl_session_tickets off`, `ssl_stapling on`, `ssl_stapling_verify on`. |
| Nginx rate-limit context | `limit_req_zone` directives in `http {}` context (top-level `nginx.conf`), per-route `limit_req` in dedicated `location` blocks (not `if` blocks). |
| TLS | Valid cert; HTTP→HTTPS **301**; TLS **1.2+** |
| **Isolation** | This client’s DB + Redis + secrets not reused (`BRD.md` **AC-14**) |

---

## 4. BRD Phase 6 — acceptance criteria matrix

Map each test to evidence (screenshot, request log, admin UI export). Criteria reproduced from **`BRD.md` §12**.

| ID | Acceptance test | Validation approach |
| --- | --- | --- |
| **AC-01** | Customer OTP login | End-to-end OTP via MSG91; receive access token + session works |
| **AC-02** | Guest cart → logged-in merge | Guest adds item → login → **`POST /api/v1/cart/merge`** outcome matches (`TRD.md` §7.6) |
| **AC-03** | Pincode serviceability | **`POST /cart/check-pincode`** + delivery rates; reject unserviceable with clear UX (`PINCODE_NOT_SERVICEABLE`) |
| **AC-04** | Prepaid full flow | Coupon + checkout + Razorpay (**UPI or card**) + confirmation **SMS/email < 60s** + GST invoice PDF attached to confirmation email |
| **AC-04-COD** | COD full flow | `isCodEnabled=true`; `POST /orders` with `paymentMode: COD` → `CONFIRMED` immediately; no Razorpay; payment `CREATED` → **`CAPTURED` only after `DELIVERED` shipping webhook** (see Postman **3.13** / **3.14** in `docs/postman/E2E-FLOW-TEST-LOG.md`); admin fulfilment: `POST /admin/orders/:id/ship` → `schedule-pickup` → `print-label` (Shiprocket `payment_method: COD`); **no** `POST /admin/orders/:id/cod-collected` (not in API). Merchant collects product cash via courier; Shiprocket remits net COD per their settlement cycle (`ECOM_MASTER.md` COD flow §6) |
| **AC-05** | Payment webhook idempotency | Duplicate **`payment.captured`** delivery → single confirmation / invoice (`TRD.md` §10.3, Redis idempotency) |
| **AC-06** | Prepaid lifecycle integrity | Order stays **`PENDING_PAYMENT`** until capture; no status bypass (`BRD.md` wording) |
| **AC-07** | Insufficient stock | **`INSUFFICIENT_STOCK`**; **no** order created; **no** inventory decrement |
| **AC-08** | Shipment creation | Manual-only dispatch: payment confirmation alone does not create shipment. Admin **`POST /api/v1/admin/orders/:id/ship`** → AWB visible **< 10s**; visible in shipping provider portal |
| **AC-09** | Shipment tracking | Customer tracking matches **`GET /shipping/track/:awb`** after provider webhook processed |
| **AC-10** | Cancel + refund | Admin cancel prepaid confirmed → Razorpay refund → **`REFUNDED`** + customer cancellation confirmation via **SMS + email** |
| **AC-10A** | Deferred refund behavior visibility | Admin/API response after requesting `REFUNDED` can still show pre-refund status until refund worker confirms provider refund and updates final order status |
| **AC-16** | Merchant ship notifications | On admin ship action, merchant receives SMS (when SMS enabled) and WhatsApp message (only when WhatsApp enabled) |
| **AC-11** | Low stock alert | Setting variant quantity to **0** triggers low-stock alert email + dashboard low-stock widget visibility |
| **AC-12** | GST invoice accuracy | PDF: buyer state, GSTIN, FSSAI if food, HSN lines, correct tax split, total matches order (**paise**) |
| **AC-13** | Dashboard KPIs | Revenue / orders / AOV match manual sum for statuses **CONFIRMED + PROCESSING + SHIPPED + DELIVERED** |
| **AC-14** | Client isolation | Cross-client negative tests — order on domain A **not** visible on client B admin, and client A API keys/database are inaccessible from client B environment |
| **AC-15** | Second client deploy time | Second stack from **`git clone`** to live HTTPS with **working Razorpay checkout** **&lt; 30 min** (`ECOM_MASTER.md` timing table) |
| **AC-17** | Coupon admin lifecycle | (Only when `FEATURE_COUPONS_ENABLED=true`) Admin creates coupon → applies at storefront checkout → pauses coupon → storefront rejects paused coupon → admin soft-deletes → coupon absent from active list → admin restores → coupon active again. Audit log at `GET /api/v1/admin/coupons/:id/audit` shows all six actions with non-null `chainHash` entries. |

---

### 4.1 AC evidence traceability (required)

| AC | Required evidence artifact |
| --- | --- |
| AC-01 | OTP request/verify logs + successful authenticated `GET /api/v1/users/me` response |
| AC-02 | Guest cart state before login + `POST /api/v1/cart/merge` result + merged cart snapshot |
| AC-03 | Serviceable and non-serviceable pincode request/response pair with `PINCODE_NOT_SERVICEABLE` proof |
| AC-04 | Razorpay successful payment trace + confirmation SMS/email timestamp + GST invoice PDF attachment evidence |
| AC-04-COD | COD order `CONFIRMED` response (customer-facing confirmation), payment status evidence showing `CREATED` then `CAPTURED`, plus proof shipment was created only after admin `POST /api/v1/admin/orders/:id/ship`; admin COD-collected API call success + `GET /admin/settings/cod` showing `isCodEnabled: true` |
| AC-05 | Duplicate webhook delivery IDs + single downstream order/invoice side-effect proof |
| AC-06 | Order timeline proving no transition to paid statuses before capture/webhook confirmation |
| AC-07 | Failed order attempt with `INSUFFICIENT_STOCK` and unchanged variant quantity evidence |
| AC-08 | `POST /api/v1/admin/orders/:id/ship` success log + shipping provider AWB evidence |
| AC-09 | Provider webhook receipt + `GET /api/v1/shipping/track/:awb` customer-visible timeline |
| AC-10 | Admin cancel action + Razorpay refund evidence + final `REFUNDED` order state + customer SMS and email delivery proof |
| AC-10A | Timeline proof that refund request acceptance can precede final `REFUNDED` state, plus eventual worker/provider-confirmed convergence to `REFUNDED` |
| AC-16 | Admin ship action log + merchant SMS delivery proof; if WhatsApp enabled, merchant WhatsApp delivery proof |
| AC-11 | Inventory update to quantity `0` + alert email + dashboard low-stock widget screenshot |
| AC-12 | GST PDF sample (redacted if needed) proving buyer state, GSTIN/HSN/tax split/total accuracy |
| AC-13 | KPI totals export/manual roll-up sheet matching dashboard values |
| AC-14 | Cross-client access-denied evidence for data, API keys, and database connectivity paths |
| AC-15 | Timestamped deployment checklist proving second stack ready in `< 30 min` with proof of a working Razorpay checkout transaction |

Invoice delivery/access contract evidence (required):
- Customer invoice download route evidence: `GET /api/v1/orders/:id/invoice.pdf` (owner-only access).
- Admin invoice download route evidence: `GET /api/v1/admin/orders/:id/invoice.pdf` (`orders:read`-authorized access).
- Order API evidence that invoice metadata uses `invoice.hasPdf` and does not include public/signed invoice URLs.

Ops config save hardening evidence (required):
- `OPS_DB_ENCRYPTION_KEY` present in runtime env and validated.
- `/api/v1/ops/config/save` write path proven to require verified OTP and encrypted masked persistence behavior.

---

## 5. API contract & automated gates

Run from backend repo and **archive stdout**:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TS |
| `npm run test:unit:coverage` | Unit coverage signal for touched domains |
| `npm run coverage:ratchet` | Coverage floor enforcement |
| `npm run ci:security-gates` | Security and policy gates |
| `npm run ci:reliability-gates` | Reliability posture and deployment readiness |

Additional evidence to archive from runtime:
- `process_crash_total{reason="unhandled_rejection|uncaught_exception"}` is present in `/api/v1/ops/metrics` scrape output.
- Queue/outbox alert-rule tests (`npm run test:slo-rules`) include and pass queue backlog, queue failure, DLQ depth, and auth challenge spike scenarios.
- Circuit breaker operational note is accepted by SRE/on-call: payment/shipping breaker state is per-process and not shared across replicas.

Full parity (when CI infra available): **`npm run ci:reliability-gates`** (`package.json`).

CI also runs **Security Scans** (`.github/workflows/security.yml`): CodeQL, npm audit (`--omit=dev`, critical/high gate), OSV Scanner (dev-group ignores via `osv-scanner.toml`), and Trivy container scan. See `MASTER_DEPLOYMENT_PLAYBOOK.md` Appendix G.0.

Important parity note: CI also validates additional build/reliability workflows beyond this local mandatory subset. Local green is necessary but not sufficient for merge parity.

Safety note: run `contract:admin` only against a controlled non-production target because it performs authenticated admin operations.

### 5.1 Postman monitor execution constraint (required classification)

- Postman MCP monitor runs execute from Postman cloud infrastructure, **not** from your local machine.
- If environment `baseUrl` points to `127.0.0.1`/`localhost`, monitor failures such as `NETERR: getaddrinfo ENOTFOUND 127.0.0.1` are classified as **config/env blocker** (not code defect).
- Required evidence when this occurs:
  1. Monitor `jobId` and monitor/environment identifiers
  2. Error signature (`ENOTFOUND 127.0.0.1` or equivalent)
  3. Fallback route validation evidence from local mandatory subset (`typecheck`, `test:unit:coverage`, `coverage:ratchet`, `test:security`, `route:discipline-check`, `serializer:exposure-check`, `test:guardrails`, `contract:admin`) or a reachable non-local environment

---

## 6. Payment validation (Razorpay)

| Check | Notes |
| --- | --- |
| `POST /api/v1/payments/initiate` works from storefront | Matches **`RISK_VELOCITY`** behaviour if enabled |
| Success path calls **`POST /api/v1/payments/verify`** | Signature validated server-side |
| **`POST /api/v1/payments/webhook`** | HMAC on **raw body** (`src/main.ts`); **200** fast; job enqueued (`TRD.md` §7.10–§10.3) |
| Duplicate webhook | Idempotent — **AC-05** |
| Invalid signature | **401** with `PAYMENT_VERIFICATION_FAILED`; no order confirmation side effects |

---

## 7. Shipping validation (Delhivery or Shiprocket)

| Check | Notes |
| --- | --- |
| Pincode + rates | Align with **AC-03** |
| **`POST /api/v1/shipping/webhook`** | Token verification on raw payload; optional IP allowlist + timestamp skew (`TRD.md` §7.12) |
| Shipment jobs | `shipping` queue in **`TRD.md` §10.2 |
| Tracking UX | Customer sees timeline only for **own** orders |

---

## 8. Data & business integrity

| Topic | Rule |
| --- | --- |
| Money | **Int paise** everywhere — UI divides by 100 for display (`TRD.md` §5.3, C-01) |
| Coupons | Expiry, usage limits, `RATE_LIMIT_EXCEEDED` (429) on rapid mutations — codes from §4.5. Soft-delete only; restore via `POST .../coupons/:id/restore`. |
| Stock | Order creation transactional; racing requests → **`INSUFFICIENT_STOCK`** |
| Order items | Snapshots immutable after creation (C-03) |
| Refunds | Queue-driven (`refunds` jobs §10.2) |

---

## 9. Security checklist

Canonical source note: keep route/control ownership and permission matrix canonical in `TRD.md` (admin/ops route sections). This guide is an execution checklist, not the source of route-policy truth.

| Check | Reference |
| --- | --- |
| Refresh + cart cookies **`httpOnly`**, **`secure`**, **`sameSite: strict`** | C-20 |
| Admin routes — JWT + role + permissions | §6.3, §7.9 |
| `/api/v1/ops/*` routes use browser session cookie (`ops_session`) issued via email-OTP login; privileged write actions require email OTP challenge in request body | `docs/OPS_CONTROL_PLANE_GUIDE.md` |
| First ops identity invite was provisioned via trusted CLI (`npm run ops:newuser ... --setup-base-url="https://<client-domain>" --yes`) on VPS via SSH and completed from email within 10 min | Release evidence must include operator + timestamp + invite completion proof |
| Ops write actions require email OTP challenge (`ops:write`) and are audit-logged | Validate OTP challenge flow and audit log entries |
| **`/api/v1/ops/metrics`** not public | Production token required; allowlist is defense-in-depth |
| Logs — no raw secrets | Pino redact paths in **`src/main.ts`** |
| Webhooks — verify on buffer/string pipeline | §7.10 |
| CORS — storefront/admin origins only | §11.2 |

---

## 10. Observability & SLO

| Check | Location |
| --- | --- |
| Metrics scrape succeeds | `GET /api/v1/ops/metrics` |
| Prometheus rules loaded | `npm run test:slo-rules`; YAML under **`observability/`** |
| Alerts routed | `observability/alert-routing.yml` (adapt to your Alertmanager) |
| Queue depth acceptable post-test | Bull Board |
| Webhook latency SLO | Payment/shipping webhook handlers ACK fast (<200ms target) and stay within configured alerting threshold (`slo:webhook_latency:p95_5m > 0.5` breach in `observability/slo-rules.yml`) |
| SLO alert test coverage | All alert rules in `observability/slo-rules.yml` have matching test cases in `observability/slo-rules.test.yml` (including `QueueDLQDepthHigh` and `AuthChallengeFailureSpike`). `npm run test:slo-rules` passes in CI. |
| JSON schema strictness | All 14 module schema files enforce `additionalProperties: false` on every `type: 'object'` declaration (only webhook header schemas use `additionalProperties: true` by design). |
| Metrics endpoint protection | `/api/v1/ops/metrics` requires production token and is inaccessible publicly (allowlist optional defense-in-depth) |

---

## 11. Disaster readiness (baseline)

| Check | Notes |
| --- | --- |
| Postgres backup job | Off-site; documented restore owner |
| DR scripts executed recently | `npm run dr:drill:*` family (`package.json`) per policy |
| Release policy | `npm run release:policy-state`, `npm run release:guard` if part of your pipeline |

---

## 12. Frontend & admin integration sign-off

> Execute and attach: `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`.

### 12.1 Storefront (`docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`)

- Correct **`NEXT_PUBLIC_*`** URLs per client
- Auth refresh loop works
- Checkout never trusts browser-only success
- Error codes mapped for UX
- Uses canonical env names: `NEXT_PUBLIC_API_BASE_URL` + `NEXT_PUBLIC_STOREFRONT_URL`
- API client supports both success shapes (enveloped/raw)
- Checkout/admin critical mutations send `idempotency-key`
- COD flow skips `/payments/initiate`; PREPAID flow uses initiate + verify
- Browser does not call webhook endpoints directly
- **Frontend delivery evidence shows contract-first simultaneous build + integration via vertical slices** (contract freeze → typed API client → UI → real route integration → tests); page-complete screenshots alone are not accepted as release evidence.
- Admin and ops surfaces were delivered in the required sequence: Foundation → Admin reads → Admin mutations → Reliability surfaces → Ops control plane surfaces.
- Each slice was closed only after: happy path + negative path verified, permission-aware UX + backend `401/403` handling confirmed, `idempotency-key` behavior confirmed on critical writes, and both an integration test and a UI interaction test passing.

### 12.2 Admin — industry-grade control plane (`NEXTJS` guide §9)

### 12.0 Control ownership validation (A/B/C)

| Check | Expected |
|---|---|
| Layer A routes (`/api/v1/admin/*` standard ops) | Writable by `merchant` role |
| Layer B routes (refund/replay sensitive actions) | Writable by `merchant` role with required permissions/audit metadata |
| Layer C routes (`/api/v1/ops/*`) | `merchant` cannot mutate; `developer` can mutate with reason/audit trail |

Merchant admins should operate **almost entirely inside the admin app** (same expectation as top-tier commerce platforms: full visibility and actions on **every** `TRD.md` §7.9 capability, permission‑gated). Before **Go**, confirm:

| Area | Pass criteria |
| --- | --- |
| **Matrix coverage** | For **§9.1** in **`docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`**, every listed module has a real screen or embedded tool (Bull Board at **`/api/v1/ops/queues`**, ops plane only) — no "API-only" levers for day‑two ops |
| **Settings depth** | **Shipping**, **store** profile, **notification** toggles, and **inventory defaults** are all editable (not a single thin settings page) |
| **Order desk** | List filters, order 360°, manual status, ship, cancel/refund, CSV export, notification retrigger |
| **Reliability** | Reconciliation issues list; outbox dead-letter + inbox failure lists; **replay-preview** before **replay**; approval token path works when required |
| **Permissions** | Navigation and buttons respect admin scopes — not only post‑click **403** |
| **AC-13** | Dashboard KPIs match manual roll‑up / export (`BRD.md`) |

Optional evidence: short screen recording walking **dashboard → order → shipment → reconciliation** without leaving the admin.

---

## 13. Evidence package (archive together)

- CI run links / command outputs (section 5)
- Completed checklist: `docs/BACKEND_GO_LIVE_CHECKLIST.md` (filled and signed)
- Completed checklist: `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` (filled and signed)
- Completed credential register with owner/vault/lifecycle fields: `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`
- Staging dry-run evidence for each provider class (Razorpay, shipping, MSG91, Resend)
- 90-day rotation calendar with primary + backup owner assignment
- Compromise drill evidence (`revoke -> regenerate -> redeploy -> verify`) with measured recovery time
- Ops invite bootstrap evidence (`ops:newuser` command record, operator identity, timestamp, invite completion proof, and vault receipt)
- Ops session verification evidence (`GET /api/v1/ops/session` from allowlisted IP with MFA)
- Razorpay webhook delivery logs + idempotency proof (**AC-05**)
- Shipping provider dashboard screenshot for AWB (**AC-08**)
- Sample GST PDF (**AC-12**) — redact if stored externally
- Deploy manifest: image digest, git SHAs, **non-secret** env fingerprint
- Signed Go / No-Go with names

---

## 14. Decision

| Outcome | Condition |
| --- | --- |
| **Go** | Sections **2–10** pass; **section 12** (storefront + **admin control plane**); **BRD AC-01–AC-15** evidenced; no open **sev-1** defects |
| **No-Go** | Any critical failure — rollback plan; fix forward only with explicit risk acceptance |

---

## 15. Post-launch monitoring window (first 48h)

- Payment success rate vs baseline
- Webhook **4xx/5xx** rates near zero
- Queue dead-letter / failed jobs stable
- Auth anomaly volume normal
- Elevated alert sensitivity per **`observability/`** runbooks

---

## 16. Doc cross-reference index

| Topic | Primary doc |
| --- | --- |
| **Full onboarding execution order (start here)** | **`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`** |
| VPS / Docker / Nginx | `ECOM_MASTER.md` §5, `docs/CLIENT_VPS_SETUP_GUIDE.md` |
| Phase 7 restart-loop triage | `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md` |
| All routes & envelopes | `TRD.md` §4, §7 |
| Queues & webhooks | `TRD.md` §10 |
| Provider setup and key lifecycle | `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` |
| Client credential register template | `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md` |
| Phase 6 business acceptance | `BRD.md` §12 |
| Frontend behaviour | `TRD.md` §12, `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` |
| Backend release gates | `docs/BACKEND_GO_LIVE_CHECKLIST.md` |
| Frontend AI release gates | `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` |

---

> **This guide is the Phase 12 sign-off record** in the client onboarding sequence — go-live validation against the live VPS deployment. Note: a local validation pass must already have been completed in **Phase 5** before the VPS was touched. For the complete ordered process — client intake → local dev and testing (Phases 0–5) → VPS deployment (Phases 6–11) → **go-live validation here (Phase 12)** → DNS cutover → handoff — see **[`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](CLIENT_ONBOARDING_EXECUTION_ORDER.md)**.
