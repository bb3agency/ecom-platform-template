# Master Playbook — Building & Deploying a Client E-Commerce Site

> **Mental model:** You have a backend **template** (this repo). For each client you clone the backend, then **build** a brand-new Next.js frontend from scratch. Both live in one project folder on your dev laptop. VPS deployment is the final step.
>
> **Lifecycle:** This is a **build-time engineering/SOP playbook**. After development/go-live, use `docs/CLIENT_HANDOFF_INDEX.md` as the primary post-development documentation entrypoint.

---

## Configuration Source of Truth (read first)

- Read `docs/ENV_VS_DB_CONFIG_REFERENCE.md` for the authoritative env vs DB map, validation/alerting behaviors, and May 2026 hardening summary.
- Bootstrap/infra keys are env-only (e.g., `DATABASE_URL`, initial `REDIS_URL`, `OPS_DB_ENCRYPTION_KEY`).
- Mutable runtime provider keys/toggles/allowlists/tokens/skew limits are DB-backed via OpsConfigSecret (encrypted overlay) and edited through Ops UI/API (restart required). No runtime env fallbacks in production.
- Merchant-facing settings (store profile, notification primary channels/templates, GST/FSSAI) are DB-backed via `StoreSettings`. No runtime env fallbacks.

---

## Project folder structure (per client)

```
client-foodstore/                ← project root on dev laptop
├── backend/                     ← cloned from ecom-backend-template, configured
│   ├── prisma/
│   ├── src/
│   ├── docker-compose.yml
│   ├── .env                     ← filled from .env.example
│   └── nginx/client.conf.template
│
└── frontend/                    ← built from scratch (Next.js App Router)
    ├── src/app/
    │   ├── (storefront)/        ← public pages
    │   └── admin/               ← admin dashboard
    ├── .env.local
    └── package.json
```

---

## Phase overview

> **Core delivery model: dev-first. The VPS is not touched until Phase 6 — after everything is fully built, integrated, and tested locally.**

| # | Phase | Where | Approx time |
|---|-------|-------|-------------|
| 0 | Client intake and scoping | — | 1–2 hours |
| 1 | Third-party account setup | Browser | 1–2 hours |
| 2 | Backend clone, configure, local E2E baseline | Dev laptop | 30–60 min |
| 3 | Third-party staging dry-runs (per slice, simultaneous with Phase 4) | Dev laptop | Throughout frontend build |
| 4 | Frontend build — vertical slice model | Dev laptop | 2–4 weeks |
| **5** | **Full local integration testing — mandatory gate before VPS** | **Dev laptop** | **1–2 days** |
| 6 | VPS baseline provisioning (first VPS step) | VPS | 30 min (once per VPS) |
| 7 | VPS backend deployment (DB, Docker Compose, Nginx, TLS) | VPS | 30–60 min |
| 8 | Ops control plane bootstrap | VPS | 30 min |
| 9 | Admin provisioning | VPS | 15 min |
| 10 | Frontend deployment and domain wiring | VPS | 30 min |
| 11 | Provider webhook endpoint registration | Browser + VPS | 30 min |
| 12 | Go-live validation against live domain | VPS + browser | 1 day |
| 13 | DNS cutover | DNS registrar | 15 min + propagation wait |
| 14 | Post-go-live handoff and maintenance setup | — | 1–2 hours |

See **[`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](CLIENT_ONBOARDING_EXECUTION_ORDER.md)** for the complete phase-by-phase execution detail with evidence gates.

### Progress trackers (recommended)

These files live in the client project folder (not in the backend template repo) and help track phase progress and handoffs.

| Log | Template | Create at | Contains |
|---|---|---|---|
| `client-<id>/CLIENT_DEV_LOG.md` | `docs/CLIENT_DEV_LOG_TEMPLATE.md` | **Phase 0** | Backend config, credential status, Phase 3 dry-runs, Phase 4 frontend milestones, Phase 5 gate |
| `client-<id>/frontend/docs/FRONTEND_DEV_LOG.md` | `docs/FRONTEND_DEV_LOG_TEMPLATE.md` | **Phase 4 start** | All 6 frontend build tiers and per-slice status |
| `client-<id>/CLIENT_VPS_DEPLOYMENT_LOG.md` | `docs/CLIENT_VPS_DEPLOYMENT_LOG_TEMPLATE.md` | **Phase 6 start** (only after Phase 5 cleared) | Phase-by-phase VPS deployment checklist, Phases 6–14 |

> The project folder structure above should also include:
> ```
> client-foodstore/
> ├── CLIENT_DEV_LOG.md            ← phases 0–5 (closed after Phase 5 clears)
> ├── CLIENT_VPS_DEPLOYMENT_LOG.md ← phases 6–14 (opened at Phase 6)
> ├── backend/
> └── frontend/
>     └── docs/
>         └── FRONTEND_DEV_LOG.md  ← phase 4 slice tracker (closed after Phase 5)
> ```

---

## Recent hardening changes

This playbook now keeps only the deployment-operational summary here so development context stays focused.

Detailed engineering hardening history is preserved in:
- `docs/HARDENING_HISTORY.md` (full narrative retained)
- `docs/DECISIONS.md` (decision log + rationale)

Current operational highlights (required for go-live checks):
- TOCTOU/CAS hardening across critical mutation and worker paths.
- Coupon control-plane hardening (`CouponAuditLog` chain integrity + admin mutation rate limits).
- Startup fail-fast for critical env/provider misconfiguration.
- Webhook integrity, replay controls, and strict schema/error handling.
- SQL injection guardrail wired into CI (`security:sql-injection-guard`).
- Observability + alert-test coverage for reliability gates.
- System-wide technical failure alerting via email to all active Ops + Admin users (every `catch`/`log.error` path emits `sendTechnicalFailureAlert`).
- **Worker boot self-heals paused BullMQ queues (May 26, 2026)** — `bootstrapWorkers()` checks `isPaused()` on every drainable queue before starting any `Worker` and calls `Queue.resume()` on any queue left paused by an incomplete drain protocol exit. Emits `Detected queues paused at boot — likely incomplete drain from a prior restart. Auto-resumed.` warn log on recovery. Manual recovery tool `scripts/resume-paused-queues.js` ships inside the production image for explicit operator break-glass via `docker exec <client-id>-workers node scripts/resume-paused-queues.js`. Full failure-mode runbook in `OPS_CONTROL_PLANE_GUIDE.md` §9.2.

---

## PHASE 1 — Third-Party Accounts

Set up accounts/keys before coding and record ownership/rotation evidence.

Canonical provider + credential runbook:
- `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`
- `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`

Minimum deliverables:
- Payment provider keys/webhook secret
- Shipping provider credentials/webhook token
- Resend + SMS/WhatsApp credentials as contracted
- Invoice storage path plan
- Ops/config bootstrap secret planning (`OPS_DB_ENCRYPTION_KEY`)
- Credential ownership, rotation schedule, and dry-run plan

---

## PHASE 2 — Clone & Configure Backend

### 2.1 Create project folder and clone backend

```bash
mkdir client-foodstore
cd client-foodstore

# Clone the template as the backend folder
git clone https://github.com/you/ecommerce-backend-template backend
cd backend

# Detach from template — this is now THIS client's backend
rm -rf .git
git init
git add .
git commit -m "init: bootstrapped from ecommerce-backend-template v2.0"
```

### 2.2 Fill `.env`

```bash
cp .env.example .env
```

Open `.env` and fill **bootstrap/infra keys only**. Generate unique secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Two-tier config model:** `.env` is for bootstrap/infra keys only. Provider credentials, webhook tokens, and ops-security parameters are **DB-overlay keys** — they are stored encrypted in `OpsConfigSecret` via the Ops UI after first invite bootstrap (Phase 8). Do **not** put them in `.env` in production. See `docs/ENV_VS_DB_CONFIG_REFERENCE.md` §2–§3 for full detail on every key including generation, rotation impact, and mechanism.
>
> **First-deploy exception:** `RESEND_API_KEY` and `RESEND_FROM` must be set as live values in `.env` before running `node scripts/ops-newuser.mjs` to send the first ops invite email. After first ops login, manage via Ops UI. See `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`.

**Bootstrap keys to set in `.env` (dev mode):**
*(Rule for AI Agents: Before running any backend infrastructure or databases, proactively ask the user for their client-specific details, database name, and API keys, and automatically generate this `.env` file for them based on `.env.example`.)*

```env
NODE_ENV=development
CLIENT_ID=foodstore
BACKEND_PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/foodstore_dev
REDIS_URL=redis://:localpassword@localhost:6379
REDIS_PASSWORD=localpassword
STOREFRONT_URL=http://localhost:3000
ADMIN_URL=http://localhost:3000
JWT_SECRET=<64-char-hex>
JWT_REFRESH_SECRET=<different-64-char-hex>
REDIS_KEY_PEPPER=<32-char-hex>
OPS_DB_ENCRYPTION_KEY=<32-char-hex>
OPS_COOKIE_SECRET=<32-char-hex>
ADMIN_ALERT_EMAIL=ops@yourclientdomain.com
TURNSTILE_SECRET_KEY=<from Cloudflare>
AUDIT_ANCHOR_SECRET=<32-char-hex>
IDEMPOTENCY_SCOPE_SECRET=<32-char-hex>
# Phase 1 bootstrap — needed for ops-newuser.mjs invite email; manage via Ops UI after first login
RESEND_API_KEY=<your Resend API key>
RESEND_FROM=My Store <noreply@yourdomain.com>

# Feature flags — match what client needs
FEATURE_COUPONS_ENABLED=true
FEATURE_REVIEWS_ENABLED=true
FEATURE_WISHLIST_ENABLED=true
FEATURE_GST_INVOICING_ENABLED=true
FEATURE_RESPONSE_ENVELOPE_ENABLED=false
```

**DB-overlay keys (provider credentials) — set via Ops UI after Phase 8, NOT in `.env`:**

In local dev (`NODE_ENV=development`), you may temporarily set provider keys in `.env` to test locally before ops bootstrap. In production, these must live in `OpsConfigSecret` only.

```env
# LOCAL DEV ONLY — remove from .env before production deployment
# PAYMENT_PROVIDER=razorpay
# RAZORPAY_KEY_ID=rzp_test_xxxxx
# RAZORPAY_KEY_SECRET=<from phase 1>
# RAZORPAY_WEBHOOK_SECRET=<from phase 1>
# SHIPPING_PROVIDER is ignored — provider detection is credential-based
# DELHIVERY_API_KEY=<from phase 1>
# ... etc — full list in .env.example commented stubs
```

**Store/GST seller profile** — set via admin settings API (`PATCH /api/v1/admin/settings`) stored in `StoreSettings` DB row. Not env-based: `storeName`, `sellerLegalName`, `sellerAddress`, `sellerState`, `gstin`, `fssaiNumber`.

> See `.env.example` for the complete variable list with descriptions. All `dbOverlay: true` keys appear as commented stubs (`# KEY=`) there.

### 2.2.1 How `docker-compose.yml` reads your `.env` (critical concept)

> **Key insight:** `docker-compose.yml` is a **write-once** infrastructure file. You never edit it when changing configuration values. You only edit `.env`.

**How it works:**

The `backend` and `workers` services use `env_file: .env`, which injects **every variable** from your `.env` file directly into the container’s environment. A small `environment:` block then overrides `NODE_ENV=production` and `OTEL_SERVICE_NAME` so containers always run in production mode.

```yaml
# In docker-compose.yml (you don’t touch this)
env_file: .env                     # ← injects ALL vars from .env
environment:
  - NODE_ENV=production            # ← override: containers always run prod
  - OTEL_SERVICE_NAME=${CLIENT_ID:-ecom}-backend
```

```env
# In .env (this is what you edit — bootstrap keys only in production)
JWT_SECRET=a0b1c2d3e4f5...
DATABASE_URL=postgresql://postgres:secret@localhost:5432/mydb
FEATURE_COUPONS_ENABLED=true
```

When Docker starts the container, it sees these values inside the container environment — no `${...}` interpolation needed for application vars.

> **DB-overlay keys (provider credentials, webhook tokens, ops-security params) are stored in `OpsConfigSecret` via Ops UI, not in `.env`. `applyOpsConfigRuntimeOverlay()` writes them into `process.env` at boot time after connecting to the DB.**

**The daily operational workflow is:**

| Task | What you do | What you don’t do |
|------|------------|-------------------|
| Change a bootstrap/infra key | Edit `.env` → restart containers | Edit docker-compose.yml |
| Rotate a provider API key | Ops UI (`POST /api/v1/ops/config/save`) → restart containers | Edit `.env` |
| Toggle a feature flag | Edit `.env` → restart containers | Edit docker-compose.yml |
| Add a new client | Copy the whole project folder, create new `.env` | Share docker-compose.yml between clients |

**Restart after `.env` changes:**

```bash
# After editing .env, apply changes:
docker compose up -d      # recreates containers with new env values

# If you also changed Dockerfile or source code:
docker compose up -d --build
```

> **Why not `docker compose restart`?** — `restart` reuses the old container with old env values. `up -d` recreates the container and picks up the new `.env` values. This is a common gotcha.

**Why `env_file` instead of inline `${VAR}` interpolation?**

The old approach listed every env var as `- DELHIVERY_API_KEY=${DELHIVERY_API_KEY}` in the compose file. This caused Docker Compose to emit “variable is not set” warnings whenever you ran `docker compose up -d postgres redis` without having all 90+ app vars configured. With `env_file`, Docker Compose doesn’t need to interpolate anything — the file is passed directly to the container.

**When would you actually need to edit `docker-compose.yml`?**

Only in rare infrastructure-level changes:
- Adding a new service (e.g. Elasticsearch sidecar)
- Changing port bindings or volume mounts
- Modifying resource limits or health check configuration

For normal operation (secret rotation, feature toggles, provider key updates, adding new app env vars), `.env` is always sufficient — `env_file` automatically picks up any new variables.

### 2.3 Customise Prisma schema (if needed)

If the client needs domain-specific fields (e.g. food store needs nutrition data):

```bash
# Edit prisma/schema.prisma — add fields to Product model:
#   nutritionInfo  Json?
#   allergens      String[]
#   shelfLife      String?
```

### 2.4 Start backend locally

```bash
npm install
npx prisma generate

# Start infrastructure (Postgres + Redis)
docker compose up -d postgres redis

# Wait a moment for PostgreSQL to be ready, then apply migrations
npx prisma migrate dev

# Run backend on host (recommended for dev)
npm run dev
```

> **Dev workflow:** On your laptop, only `postgres` and `redis` run in Docker. The Node backend runs directly on the host so you get fast restarts, hot-reload, and debugger access. The `backend` and `workers` Docker services are only used for VPS production deployments.

### 2.5 Verify

```bash
curl http://localhost:3000/api/v1/health
# → { "success": true, "data": { "status": "ok", "db": "connected", "redis": "connected" } }
```

> If you override `PORT` in `.env` (for example `PORT=3001` when Next.js runs on 3000), use that port in the health URL.

### 2.6 Run the Postman E2E simulation (no live credentials needed)

Before building the frontend or wiring real payment/shipping accounts, validate the **full order lifecycle** using the bundled Postman collection with noop providers.

**What the simulation covers:** deterministic admin test fixture data → Raj registers + adds to cart + creates prepaid order + simulates Razorpay webhook → Ramu registers + adds to cart + creates COD order → admin views kanban board → ships both orders → shipping webhooks → DELIVERED + COD auto-capture.

**Terminal 1 — Backend server:**

```cmd
npm run dev:e2e
```

**Terminal 2 — Workers:**

```cmd
npm run dev:e2e:workers
```

> Both `npm run dev:e2e` and `npm run dev:e2e:workers` invoke idempotent orchestrator scripts (`scripts/dev-up.cmd` and `scripts/dev-up-workers.cmd`) that:
> - Auto-start `ecom-postgres` and `ecom-redis` containers (fixes recurring `ECONNREFUSED 127.0.0.1:6379` after Docker Desktop restart or laptop sleep)
> - Wait for Redis readiness (`redis-cli ping`) and Postgres readiness (`pg_isready`, up to 30s) before proceeding — prevents `EPERM rename query_engine-windows.dll.node` when Postgres container is started but server isn't accepting connections yet
> - Kill all stale `node.exe` processes + port-3000 PID **before** Prisma bootstrap (fixes `EPERM: operation not permitted, rename query_engine-windows.dll.node` on Windows when a previous `tsx watch` holds the DLL)
> - Ensure Prisma target DB exists from `DATABASE_URL`, then run `prisma generate` + `prisma migrate deploy` against the squashed `0_init` baseline before API/worker boot (fixes first-clone `Database "..." does not exist`)
> - Set all noop/E2E env vars (`PAYMENT_PROVIDER=noop`, `RAZORPAY_WEBHOOK_SECRET=test_webhook_secret`, `SHIPROCKET_WEBHOOK_TOKEN=test_webhook_token`, `NODE_ENV=development`). For shipping noop mode: leave all shipping credentials empty — no `SHIPPING_PROVIDER` env var needed.

> ⚠️ Shipping webhook token relaxation applies only when no shipping credentials are configured (noop mode: empty `DELHIVERY_API_KEY` and no Shiprocket credentials). In that simulation mode any non-empty `Authorization` header is accepted. Real provider credentials enforce strict token validation.

> Workers process the `payment-webhook` → `process-order-update` job chain after the Razorpay payment webhook, transitioning Raj's order from `PENDING_PAYMENT` → `CONFIRMED`. `confirm-order` and `deduct-inventory` are now thin delegation stubs that resolve the `orderId` and enqueue `process-order-update`; all status mutations, inventory deduction, and side effects execute inside the `process-order-update` handler. Without workers, step 3.4 (admin ship Raj) returns `409` — the test still passes with a warning, but the full flow will not complete to `DELIVERED`.

**In Postman:**
1. Import `docs/postman/E2E-Flow-Simulation.postman_collection.json`
2. Import `docs/postman/E2E-Sim-Env.postman_environment.json`
3. Select **E2E Sim Env** environment
4. Run folders in strict order: **0 → 1 → 2 → 3** — do not skip or re-run folder 3 alone; order IDs set in folders 1 and 2 are consumed by folder 3
5. Re-running the full sequence is safe — order idempotency keys are timestamp-based so each run creates fresh orders

**Expected outcomes without workers:** all steps PASS (tests are resilient), but steps 3.4/3.5 ship with `409` warning and webhooks 3.8–3.15 yield `401` warning until server is restarted after the fix.

**Expected outcomes with workers + restarted server:** all steps return `200`; final board shows both orders in `DELIVERED`; Ramu's payment status is `CAPTURED`.

See `docs/postman/E2E-FLOW-TEST-LOG.md` for full per-step assertion details, environment variable chain, failure-mode table, and fix history.

> ⚠️ `PAYMENT_PROVIDER=noop` must **never** be set in production `.env`. For shipping noop mode: leave all shipping credentials unset (no `SHIPPING_PROVIDER` env var exists). Both bypass live API calls and accept relaxed webhook auth — intended exclusively for local E2E simulation.

### 2.7 Create first admin user

1. Issue merchant admin invite via `POST /api/v1/admin/invites` (ops-authenticated, `ops:write`).
2. Complete setup at `/admin/setup?token=...` within 10 minutes (name + password creation + email OTP).
3. Login via 2-step email OTP: `POST /api/v1/auth/admin/login/request-otp` → `POST /api/v1/auth/admin/login/verify-otp`.

---

## PHASE 3 — Build Frontend From Scratch

> The frontend is **not** a template. You build it new every time using Next.js App Router.
> **API contract reference:** `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`

### 3.0 Frontend AI execution contract (mandatory)

If you use an AI agent to generate frontend code, enforce this baseline:
- Use env vars: `NEXT_PUBLIC_API_BASE_URL` (must include `/api/v1`) and `NEXT_PUBLIC_STOREFRONT_URL`.
- Support both backend success shapes (enveloped/raw) based on `FEATURE_RESPONSE_ENVELOPE_ENABLED`.
- Send `idempotency-key` on critical order/payment/admin mutations.
- Implement checkout split exactly: PREPAID uses Razorpay initiate/verify; COD skips Razorpay.
- Never call backend webhook endpoints from browser code.
- Treat `PAYMENT_PROVIDER=noop` as local simulation only. Shipping noop mode is inferred from absence of credentials — no env var to set.
- For release, complete `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` and pair it with `docs/BACKEND_GO_LIVE_CHECKLIST.md` (full backend env-to-implementation parity).

### 3.0.1 Recommended execution model: simultaneous build + integration (required)

Use **vertical slices** end-to-end instead of page-only delivery.

Do not complete all UI pages first and “integrate later”.

For each capability slice:

1. freeze route contract + schemas,
2. implement typed API client methods,
3. build UI states (loading/empty/error/success),
4. integrate with real backend module data,
5. validate permissions and idempotency,
6. ship only when slice tests pass.

This is mandatory for this backend because order/payment/shipping/refund flows are async and queue-driven. UI-only completion cannot validate final behavior.

### 3.0.2 Concrete slice plan (admin + ops)

Use this sequence by default:

1. **Foundation (must ship first)**
   - shared API client with envelope/raw parser
   - auth bootstrap + refresh-on-401
   - global `error.code` mapper
   - permission-aware nav scaffold (`admin` and `ops` split)
2. **Ops control plane surfaces**
   - `GET /ops/session`
   - `GET/POST /ops/load-shed`
   - `GET /ops/audit/logs`
   - `POST /ops/system/restart` (schedule payment-safe container restart — `delayMinutes: 0` = immediate, `> 0` = deferred; job persists in Redis and survives logout)
3. **Admin read surfaces**
   - dashboard KPIs/charts
   - orders list + order detail
   - inventory list + low-stock
4. **Admin mutation surfaces (high risk)**
   - order status update
   - ship action
   - cancel/refund
   - stock adjustment
   - settings updates
5. **Reliability surfaces**
   - reconciliation issues
   - outbox dead-letter list
   - inbox failures list
   - replay preview + replay actions
6. **Storefront customer journey surfaces (build after ops/admin tiers are stable)**
   - catalogue and product detail
   - cart + merge-on-login + coupons/pincode
   - PREPAID/COD checkout
   - order history/detail/tracking
   - customer auth and profile/addresses

### 3.0.3 Definition of done per slice (strict gate)

A slice is done only if all are true:

- real backend integration (not mocks only),
- happy path + negative path working,
- proactive permission-based UI hide/disable,
- backend 401/403 handling mapped to actionable UX,
- critical mutation uses `idempotency-key`,
- one integration test for route behavior,
- one UI interaction test,
- no regression in shared API/auth layer.

### 3.0.4 Daily and milestone cadence

**Per-slice (daily) checks:**

- frontend unit/component tests for touched features,
- one backend integration scenario for touched route,
- one permission negative test,
- one idempotency retry test for critical writes.

**Milestone checks (every 4-6 slices):**

- run backend release subset from `docs/BACKEND_GO_LIVE_CHECKLIST.md`,
- validate BRD acceptance coverage mapping,
- run end-to-end manual scenario for newest high-risk mutation.

### 3.0.5 Admin and ops security boundaries (non-negotiable)

- Merchant operation UX must use `/api/v1/admin/*` only.
- Runtime/infra control UX must use `/api/v1/ops/*` only.
- Never proxy merchant actions through ops APIs.
- Never expose ops credentials in browser storage/query params/logs.
- Ops load-shed change is applied immediately via `POST /ops/load-shed` (single-step with OTP confirmation).

### 3.1 Initialise Next.js project

```bash
cd client-foodstore
npx -y create-next-app@latest frontend --typescript --app --src-dir --tailwind --eslint
cd frontend
```

### 3.2 Frontend `.env.local`

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_STOREFRONT_URL=http://localhost:3000
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxx
```

### 3.2.1 Sync latest frontend AI rules (mandatory)

Before generating frontend code, sync backend rules into frontend repo:

```bash
cd ../frontend
mkdir -p .agents/rules
cp ../backend/frontend-agent-rules.md .agents/rules/dev-rules.md
```

Verify synced file is up to date:

```bash
diff -u ../backend/frontend-agent-rules.md .agents/rules/dev-rules.md
```

If diff output is non-empty, commit the updated `.agents/rules/dev-rules.md` in frontend repo before continuing feature work.

### 3.2.2 Co-development backend upstream SOP (manual commands)

Canonical source: `CO_DEVELOPMENT_SYNC_GUIDE.md` (git mechanics) + `docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md` (semver'd `backend-core`/`frontend-core`, changelog-as-propagation-recipe, design-isolation, and the `check-core-drift` / `check-token-contract` gates).

Use that guide for:
- Flow A (`frontend/` + `backend/` in one repo) subtree sync commands.
- Flow B (separate template clone) branch/PR commands.
- Template-worthy vs client-specific classification.
- Copy/paste safety checklist and validation gates.

After template PR merge, pull/rebase template updates into active client repos before final QA/go-live checks.

### 3.3 API client layer

Build a shared API client that every page/component uses:

**Rules (non-negotiable):**
- Success responses may be wrapped or raw depending on `FEATURE_RESPONSE_ENVELOPE_ENABLED`; always parse both.
- Error responses use `{ success: false, error: { code, message, statusCode } }`.
- Branch on `error.code` (e.g. `INSUFFICIENT_STOCK`), never on `error.message`
- Money is **integer paise** everywhere — display as `₹${(paise / 100).toFixed(2)}` in UI only
- On 401 → call `POST /api/v1/auth/refresh` once → retry → force login
- Keep `accessToken` in memory, **never** in `localStorage`
- `refresh_token` and `cart_session` are httpOnly cookies set by the backend

**Error codes to handle in UI** (full list in `TRD.md` §4.5):

| Code | User-facing message |
|------|-------------------|
| `INSUFFICIENT_STOCK` | "Sorry, this item is out of stock" |
| `PINCODE_NOT_SERVICEABLE` | "Delivery not available to this pincode" |
| `COUPON_EXPIRED` | "This coupon has expired" |
| `RATE_LIMIT_EXCEEDED` | "Too many attempts, try again shortly" |
| `INVALID_STATUS_TRANSITION` | "This action is not available for the current order status" |

### 3.4 Storefront pages to build

Canonical endpoint/UI matrix: `docs/API_ENDPOINT_INDEX.md`.
Frontend implementation details: `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`.

Required storefront surfaces:
- Home/catalog/product detail
- Cart + coupon + pincode
- Checkout (strict PREPAID/COD split)
- Order confirmation/history/tracking
- Customer auth/profile/address
- Wishlist/reviews only when feature flags enable them

### 3.5 Admin dashboard to build (`/admin/*`)

> Admin routes live inside the **same** Next.js app under `/admin`.
> Full endpoint matrix: `docs/API_ENDPOINT_INDEX.md`

**Auth:** 2-step email OTP — `POST /api/v1/auth/admin/login/request-otp` (verifies password, sends OTP) → `POST /api/v1/auth/admin/login/verify-otp` (verifies OTP, returns JWT + sets refresh cookie).
**Rule:** Hide/disable nav items based on JWT permissions. Don't rely on 403 as UX.

Required admin surfaces:
- Dashboard, products, orders, inventory, customers
- Coupons/reviews/settings/analytics when enabled
- Queue/reliability visibility for operators
- Permission-aware navigation and disabled states

### 3.6 Pagination

All list endpoints use `page` (default 1) + `limit` (default 20, max 100).
Response includes `meta: { page, limit, total, totalPages }`.

### 3.7 Feature flags

Mirror backend toggles in frontend — hide UI when feature is off:
- `FEATURE_COUPONS_ENABLED` → hide coupon input in cart
- `FEATURE_REVIEWS_ENABLED` → hide review section on product page and homepage testimonials (`TestimonialsSection` renders nothing when API returns empty)
- `FEATURE_WISHLIST_ENABLED` → hide wishlist icon/page
- `FEATURE_GST_INVOICING_ENABLED` → hide/show invoice download
- `FEATURE_RESPONSE_ENVELOPE_ENABLED` → when `true`, frontend receives `{ success, data, meta? }` wrapper on all 2xx JSON

### 3.8 Security rules for frontend

- No secret keys in browser bundles (only `NEXT_PUBLIC_RAZORPAY_KEY_ID`)
- No PAN/CVV in your app — Razorpay hosted checkout only
- CSP headers on pages loading Razorpay script
- Never call webhook endpoints from browser
- Never store refresh token in localStorage

### 3.9 Backend security hardening (built-in)

The backend template ships with these security measures already implemented. Verify they are active for every client deployment:

| Area | Implementation | File(s) |
|------|---------------|---------|
| **JWT algorithm pinning** | HS256 explicitly pinned for both `@fastify/jwt` (access) and `jsonwebtoken` (refresh) sign + verify paths. Prevents algorithm downgrade attacks. | `src/common/plugins/jwt.plugin.ts`, `src/modules/auth/auth.service.ts` |
| **Webhook HMAC integrity** | Razorpay webhook body forwarded as raw `Buffer` (not string) to HMAC computation. Prevents byte-level mismatches from encoding roundtrips. | `src/main.ts` content-type parser |
| **Timing-safe comparisons** | All signature and token comparisons use `crypto.timingSafeEqual`. | `razorpay.adapter.ts`, `orders.service.ts`, `observability.plugin.ts` |
| **Webhook replay prevention** | Razorpay: timestamp skew check (default 300s) + Redis event-ID lock. Shipping: `occurredAt` skew check + `WebhookInboxEvent` deduplication. | `orders.service.ts` |
| **Redis fail-fast** | API Redis bootstrap times out after 20s instead of hanging indefinitely. Workers use `connectTimeout: 10_000`. | `redis.plugin.ts`, `queues/workers/index.ts` |
| **Rate limiting** | Tiered policies per route class (auth/checkout/admin/catalog/webhook) with adaptive load-shed modes. Edge policy with challenge escalation for auth abuse. | `rate-limit-policies.ts`, `edge-policy.ts` |
| **Sensitive data redaction** | Error responses, audit logs, persisted idempotency payloads, and analytics replay audit metadata are redacted to avoid leaking secrets and raw webhook identifiers (`eventKey` values are stored in redacted/hash form). | `redaction.ts`, `analytics.service.ts` |
| **Nginx security headers** | HSTS (2yr + preload), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, X-XSS-Protection 1; mode=block, Permissions-Policy camera/microphone/geolocation/interest-cohort disabled. TLS: ECDHE-only AEAD ciphers, session cache, OCSP stapling. Rate-limit zones in `http {}` context. | `nginx/client.conf.template` |
| **JSON schema strictness** | All 300+ `type: 'object'` declarations across 14 module schema files enforce `additionalProperties: false`. Only webhook header schemas intentionally use `additionalProperties: true`. | `src/modules/*/schemas.ts` |
| **Admin provisioning safety** | Production merchant admin provisioning is invite-only via `POST /api/v1/admin/invites` + `/admin/setup`; legacy/local seed scripts read env credentials and are not go-live provisioning paths. | `admin-invites.service.ts`, `scripts/upsert-admin.js`, `scripts/seed-admin.mjs` |
| **SLO alert test coverage** | All alert rules in `observability/slo-rules.yml` have corresponding `promtool` test cases (including `QueueDLQDepthHigh` and `AuthChallengeFailureSpike`). | `observability/slo-rules.test.yml` |
| **Table housekeeping** | Scheduled purge of expired `IdempotencyRecord`, `RefreshToken`, and published `OutboxMessage` rows to prevent unbounded growth. | `cart-cleanup.worker.ts`, `bullmq.plugin.ts` |
| **Password storage** | bcrypt cost 12. Refresh tokens bcrypt-hashed before DB storage. | `auth.service.ts` |
| **MFA encryption** | Admin login uses mandatory 2-step email OTP (request-otp → verify-otp). TOTP fully removed from hot path. Legacy `mfaSecretEncrypted` field retained as schema stub only. | `auth.service.ts` |

> For the full decision log with rationale, see [`docs/DECISIONS.md`](DECISIONS.md).

---

## PHASE 4 — Local Integration Testing

### 4.1 Backend quality gates

```bash
cd client-foodstore/backend
npm run typecheck
npm run test:unit
npm run test:e2e
npm run test:security
npm run test:guardrails
npm run build
npx prisma validate --schema prisma/schema.prisma
npm run prisma:generate:safe
npm run edge:drift-check
npm run release:policy-state
npm run release:guard
npm run test:slo-rules
npm run stress:flash-sale:api:matrix
npm run parity:scorecard
```

**Release stamp criteria (mandatory):**
- Every command above exits `0`.
- `release:guard` reports pass (no active freeze/critical reliability block without approved exception).
- `test:guardrails` passes the three drift contracts: admin layer, docs-runtime, config-runtime parity.
- `stress:flash-sale:api:matrix` passes invariant enforcement and does not fail fixture precondition checks.
- Prisma schema validates and client generation succeeds.
- Backend boot in production-like profiles hard-fails on unsafe provider config (`PAYMENT_PROVIDER=noop`, missing shipping provider credentials, or placeholder provider/auth secrets).
- Unrecognised `PAYMENT_PROVIDER` values (typos) are rejected at startup in **all** profiles — not just production-like. `SHIPPING_PROVIDER` is not a runtime config key; provider detection is credential-based.
- Razorpay env vars (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) are only required when `PAYMENT_PROVIDER=razorpay`.
- `database.config.ts` and `redis.config.ts` fail fast on missing URLs (no silent `undefined` from `as string`).
- Completed `docs/BACKEND_GO_LIVE_CHECKLIST.md` is attached, including env-to-implementation parity checks (not provider-only checks).

### 4.1A Production readiness sign-off (release candidate)

Use this section as the final release candidate sign-off artifact before deployment approval.

#### Pre-release gate matrix (last validated run)

| Gate | Command | Result | Notes |
|------|---------|--------|-------|
| TypeScript typecheck | `npm run typecheck` | ✅ PASS | 0 errors after `prisma:generate:safe` |
| ESLint | `npm run lint` | ✅ PASS | Fixed `no-base-to-string` in `meta-whatsapp.adapter.ts` |
| Unit tests | `npm run test:unit` | ✅ PASS | 121 files · 416 tests |
| Guardrails | `npm run test:guardrails` | ✅ PASS | 35 governance checks · route discipline · config/doc parity |
| Security tests | `npm run test:security` | ✅ PASS | 14 files · 57 tests |
| Route discipline | `npm run route:discipline-check` | ✅ PASS | Added `setup/send-otp` invite routes to explicit public-bootstrap exempt set |
| Admin layer drift | `npm run admin:layer-drift-check` | ✅ PASS | 89 endpoint mappings · 89 guarded routes |
| Docs runtime drift | `npm run docs:runtime-drift-check` | ✅ PASS | |
| Config runtime parity | `npm run config:runtime-parity-check` | ✅ PASS | |
| Ops config contract drift | `npm run ops:config-contract-drift-check` | ✅ PASS | |
| Edge policy drift | `npm run edge:drift-check` | ✅ PASS | |
| Serializer exposure | `npm run serializer:exposure-check` | ✅ PASS | |
| Parity scorecard | `npm run parity:scorecard` | ✅ PASS | All axes 100% |
| Release guard | `npm run release:guard` | ✅ PASS | |
| Release policy state | `npm run release:policy-state` | ✅ PASS | `releaseDecision: approved` · error budget 100% |
| CI reliability gates (build) | `npm run ci:reliability-gates` | ✅ PASS (partial) | `contract:admin` requires running backend — CI-only gate; all static gates pass |

#### Fixed in latest hardening cycle

- **Deep codebase audit (type-safety hardening)** — Full audit of all production service files, route handlers, plugins, adapters, and workers for unsafe casts, incorrect types, and error-handling gaps. Findings and fixes:
  - `orders.types.ts` — Local `ReturnRequestStatus` string union (`'REQUESTED' | 'APPROVED' | ...`) replaced with a re-export of the Prisma-generated enum (`import { ReturnRequestStatus } from '@prisma/client'`). This eliminates a parallel definition that could drift from the schema.
  - `orders.service.ts adminUpdateReturnRequest` — `input.status` parameter re-typed from `string` to `ReturnRequestStatus`; `as never` cast removed.
  - `orders.service.ts adminListReturnRequests` — query parameter type tightened from `status?: string` to `status?: ReturnRequestStatus`; removed cast from the Prisma `where` clause entirely.
  - `orders.routes.ts return requests contracts` — list query `status` now enforces enum validation (`REQUESTED | APPROVED | REJECTED | PICKED_UP | REFUNDED`) and return-request response schemas now expose this same enum contract instead of unconstrained `string`.
  - `orders.routes.ts adminUpdateReturnRequest` — Route body cast updated from `{ status: string }` to `{ status: ReturnRequestStatus }`, consistent with service signature.
  - `observability.plugin.ts` — `sanitizeSummary(...) as never` replaced with `sanitizeSummary(...) as Prisma.InputJsonValue`; `Prisma` added to import. The cast is still required because `sanitizeSummary` returns `unknown` by design (recursive sanitizer), but the narrowed cast is correct and precise.
  - Remaining `as unknown as` patterns in `cart.service.ts`, `order-processing.worker.ts`, and `ops.service.ts` — reviewed and confirmed as intentional testability/interface-narrowing patterns, not bugs. The delegate-optional pattern (`(tx as unknown as { model?: ... }).model`) is the accepted pattern for optional Prisma model injection in tests.
  - All `as never` casts in route handlers for `request.body/query/params` — these are a Fastify JSON-Schema-mode limitation (not TypeBox mode). The JSON schema validates input before the handler runs; the cast is a TypeScript workaround, not a runtime risk. Refactoring to TypeBox generics is a larger future improvement.
  - `process.env` direct reads in `settings.service.ts`, `orders.service.ts`, `checkout-risk.service.ts`, `orders.routes.ts` — all reviewed. Reads are either (a) fallback env values after a DB miss (correct), (b) webhook-validation config read at request time (must be live), or (c) feature-flag reads (must be live). None bypass the config layer for startup-critical values.
- **Node 24 + Windows npm script compatibility** — `tsc` and `eslint` invocations were broken by Node 24's experimental TypeScript stripping when called via `cmd /c` (as npm does on Windows). Fixed by introducing `scripts/typecheck.js`, `scripts/build.js`, and `scripts/lint.js` wrappers that call the tool entry points directly via `spawnSync`/ESLint API, bypassing the `.cmd` shim entirely. `typecheck` and `lint` now both exit `0`.
- **`products.service.ts` CSV import error handling** — bare `throw new Error(...)` in `adminImportProductsCsv` for invalid price and duplicate-SKU checks was replaced with `AppError(ERROR_CODES.VALIDATION_ERROR, ..., 422)` and `AppError(ERROR_CODES.CONFLICT, ..., 409)` respectively. Raw `Error` objects bypass Fastify's error handler and can leak stack traces to the client.
- **`orders.service.ts` COD payment provider cast** — `'COD' as unknown as PaymentProvider` replaced with `PaymentProvider.COD` (the enum value exists in the Prisma schema; no cast was ever necessary).
- **`orders.service.ts` `adminShipOrder` `paymentMode` cast** — `(existing as unknown as Record<string, unknown>)['paymentMode']` replaced with direct `existing.paymentMode` access; the field is a first-class scalar on the Prisma `Order` model and is included via `findUnique`.
- Prisma client was stale (enums/types missing from generated client) — regenerated via `prisma:generate:safe`; typecheck now exits 0.
- ESLint `no-base-to-string` in `meta-whatsapp.adapter.ts` — fixed value coercion for template data fields to handle object, null, and primitive cases safely.
- Route discipline check false-positive on `POST /api/v1/admin/invites/setup/send-otp` and `POST /api/v1/ops/invites/setup/send-otp` — both added to `AUTH_ADMIN_EXEMPT_ROUTES` with documented rationale (invite token is the credential; pre-auth bootstrap endpoint).
- Ops audit-chain lock timeout now returns structured transient `503` (`ops_audit_chain_lock_timeout`) with retry metadata.
- Ops system audit actor bootstrap is race-safe under concurrent first-time creation (`ops-system@local.internal` create-fallback-read pattern).
- Meta webhook route tests now register global error handler so invalid verification token correctly resolves to `403` (not fallback `500`).

#### Residual non-blocking risks

- Circuit breaker state is process-local per replica for payment/shipping unless explicitly redesigned for shared state.
- Shipping webhook `noop` acceptance remains intentionally permissive for development-like simulation and is blocked by production-like startup guardrails.
- `promtool`-based SLO tests may be skipped locally on dev machines; CI remains source of truth.
- `contract:admin` gate requires a running seeded backend — cannot pass in offline/local environment; runs only in CI with provisioned environment. Requires `ADMIN_EMAIL` and `ADMIN_PASSWORD` set in `.env` matching a real seeded admin account. The script auto-reads the OTP from Redis when `NODE_ENV != production` (backend writes a `ci-plaintext` key); set `NODE_ENV=development` in `.env` for local runs. See `.env.example` CI/contract-check section.

#### Rollback strategy (backend)

If release validation regresses after deploy:

```bash
# 1) Roll back app image/container to previous known-good tag (VPS)
docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml pull backend workers
docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d backend workers

# 2) Verify health + metrics
curl -f http://127.0.0.1:<BACKEND_PORT>/api/v1/health
curl -f http://127.0.0.1:<BACKEND_PORT>/api/v1/health/ready

# 3) Validate queue processing resumes
docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml logs workers --tail 200

# 4) Re-run critical smoke checks
npm run release:guard
npm run test:guardrails
```

#### Mandatory pre-deploy command sequence

All commands must exit `0` in CI or controlled release environment:

```bash
npm run prisma:generate:safe
npm run typecheck
npm run lint
npm run test:unit
npm run test:guardrails
npm run ci:reliability-gates
npm run release:guard
npm run parity:scorecard
npm run edge:drift-check
npm run test:security
```

#### Deployment approval gate

Approve deployment only when all below are true:

- No open P0/P1 findings in release audit.
- Backend and worker startup logs show no provider/env bootstrap errors.
- Webhook security checks validated (`allowlist`, signature/token verification, replay safety).
- Ops control plane actions (`invite`, `otp`, `approval`, `audit`) pass smoke tests.
- All mandatory pre-deploy commands above exit `0`.

`NODE_ENV` profile classification:

| `NODE_ENV` value | Runtime profile | Behavior |
|---|---|---|
| `development` | development-like | `noop` providers allowed |
| `test` | development-like | `noop` providers allowed |
| `production`, `staging`, `qa`, `uat`, or any other value | production-like | `noop` blocked; placeholder secrets blocked |

> Rule: Unknown/custom `NODE_ENV` values default to **production-like** (safe-by-default).

> `npm run test:slo-rules` can skip locally when `promtool` is unavailable. Treat this as acceptable on dev laptops; CI should execute it in a provisioned environment.

### 4.2 End-to-end flow checklist

| # | Flow | Verify |
|---|------|--------|
| 1 | Register + OTP | Tokens returned, profile accessible |
| 1a | Phone OTP signup | `POST /api/v1/auth/signup-phone` creates customer with required phone + optional profile |
| 2 | Browse products | Categories, search, filters, pagination |
| 3 | Guest cart | Add items without login, persists via cookie |
| 4 | Login + merge | Guest cart merges into auth cart |
| 5 | Pincode check | Serviceable vs non-serviceable |
| 6 | Apply coupon | Discount applied, error for invalid |
| 7 | Checkout | Order created as PENDING_PAYMENT |
| 8 | Razorpay payment | Modal opens, test payment works |
| 9 | Payment verify | Signature verified, order confirmed via webhook |
| 10 | Notifications | Email/SMS sent (check provider dashboards) |
| 11 | Admin: ship order | Manual trigger only (no payment-confirmation auto-dispatch) and AWB generated |
| 12 | Admin: cancel + refund | Refund initiated, status → REFUNDED |
| 13 | GST invoice | PDF correct with tax breakdown |
| 14 | Dashboard KPIs | Numbers match manual calculation |

### 4.3 Webhook testing locally

```bash
# Expose local backend for webhook callbacks
ngrok http 3001
# Update Razorpay webhook URL to https://<ngrok>/api/v1/payments/webhook
```

---

## PHASE 5 — VPS Deployment

> **Full reference:** `docs/CLIENT_VPS_SETUP_GUIDE.md`

### 5.1 VPS requirements

| Item | Recommended |
|------|------------|
| OS | Ubuntu 22.04 LTS |
| Specs | 4 vCPU / 8 GB RAM / 80 GB SSD (handles 5–10 sites) |
| Software | Docker, Nginx, Certbot, PostgreSQL 16, Node.js 22 |

### 5.2 First-time VPS setup (once per server)

```bash
# Create deploy user, install Docker, Nginx, Certbot, PostgreSQL 16, Node.js 22
# Configure firewall: allow 22, 80, 443 only
# See CLIENT_VPS_SETUP_GUIDE.md for full commands
```

Required hardening checks before first production client:
- `PermitRootLogin no` and `PasswordAuthentication no`
- `ufw` allows only `22`, `80`, `443`
- `fail2ban` enabled and running
- `unattended-upgrades` enabled
- `timedatectl` shows synchronized clock

> **Port 22 after runner setup:** Once the self-hosted GitHub Actions runner is registered and confirmed Online (see `CLIENT_VPS_SETUP_GUIDE.md` §22), port 22 no longer needs to be open to `0.0.0.0/0`. Restrict it to your office CIDR only — deployments use HTTPS outbound from the runner, not inbound SSH.

Capacity signals before onboarding each additional client:
- RAM sustained usage should stay <75%
- CPU sustained usage should stay <70%
- Disk usage should stay <70%
- If thresholds are exceeded, stabilize or resize VPS before onboarding next client

### 5.3 Port convention

| Client # | Backend port | Frontend port |
|----------|-------------|--------------|
| 1 | 3001 | 3101 |
| 2 | 3002 | 3102 |
| N | 3000+N | 3100+N |

### 5.4 Deploy this client

> **First-time bootstrap only.** The steps below (git clone, docker compose up) are run once to set up the client stack. After completing [`docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md`](GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md) (Phase 7.6 — self-hosted runner per client repo + GitHub Variables/Secrets), all subsequent deploys happen automatically — every `git push` to `main` triggers: Reliability CI (cloud) → Deploy to VPS (runner on client VPS polls GitHub) → `vps-deploy.sh` + optional `vps-frontend-deploy.sh`. No SSH required for re-deploys.

```bash
ssh deploy@your-vps

# 1. Create client directory
mkdir -p /var/www/foodstore
cd /var/www/foodstore

# 2. Clone both repos
git clone https://github.com/you/client-foodstore-backend backend
git clone https://github.com/you/client-foodstore-frontend frontend

# 3. Create PostgreSQL database
sudo -u postgres psql
CREATE DATABASE foodstore_prod;
CREATE USER foodstore_user WITH PASSWORD 'strong_password';
GRANT ALL PRIVILEGES ON DATABASE foodstore_prod TO foodstore_user;
\q

# 4. Configure backend .env (PRODUCTION — bootstrap keys ONLY)
cd /var/www/foodstore/backend
cp .env.example .env
nano .env
# NODE_ENV=production
# DATABASE_URL=postgresql://foodstore_user:password@host.docker.internal:5432/foodstore_prod
# REDIS_URL=redis://:strong_redis_password@redis:6379
# REDIS_PASSWORD=strong_redis_password
# BACKEND_PORT=3001
# STOREFRONT_URL=https://foodstore.com
# ADMIN_URL=https://foodstore.com
# OPS_DB_ENCRYPTION_KEY=<unique 32-char hex>  ← NEVER reuse across clients
# ENABLE_VERBOSE_VALIDATION_ERRORS=false
# Generate NEW JWT_SECRET and JWT_REFRESH_SECRET (different from dev!)
# ⚠️ Provider credentials (RAZORPAY_*, SHIPPING_*, NOTIFY_*, etc.) are NOT set here.
# They are stored in OpsConfigSecret via the Ops UI after Phase 8 ops bootstrap.

# 5. Start infrastructure (if using Docker-based Postgres instead of host Postgres)
# docker compose up -d postgres redis

# 6. Run migrations (applies single squashed 0_init baseline)
npm ci
npx prisma generate --schema prisma/schema.prisma
# VPS host shell: NEVER bare `npx prisma migrate deploy` when .env uses host.docker.internal (P1001).
# Override to 127.0.0.1 for migrate only; containers keep host.docker.internal in .env.
MIGRATE_DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/host\.docker\.internal/127.0.0.1/')"
DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma
# If this DB was previously built from the old incremental migrations (pre-squash):
# DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate resolve --applied 0_init --schema prisma/schema.prisma

# 7. Start backend Docker stack (VPS host-Postgres mode)
docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend workers
curl http://127.0.0.1:3001/api/v1/health  # verify db + redis connected
curl http://127.0.0.1:3001/api/v1/health/ready  # Phase 7: informational; go-live requires status=ready and runtimeConfigMissingKeys=[]

# 7.5 Install daily automated cleanup script (one-time per client — prevents disk space exhaustion)
cd /var/www/<client-id>/backend
sudo ./scripts/install-vps-cleanup.sh "<client-id>" "/var/www/<client-id>" "<client-id>-frontend"
# Verify: cat /var/log/vps-cleanup-<client-id>.log (runs daily at 06:25 AM via system cron)

# 7. Build and start frontend (FIRST-TIME BOOTSTRAP ONLY)
# After completing §22 (runner setup), all subsequent frontend deploys are automated:
# git push → CI → runner → vps-frontend-deploy.sh → npm run build → pm2 reload (zero downtime)
cd /var/www/foodstore/frontend
npm ci
# Set production env vars in .env.local (CLIENT_ID, STOREFRONT_PORT, NEXT_PUBLIC_* keys)
nano .env.local
npm run build
pm2 start npm --name "foodstore-frontend" -- start -- -p 3101
pm2 save          # persist process list (survives pm2 restarts)
pm2 startup       # install boot hook — run the printed sudo command to survive reboots

# 8. Nginx config
sudo cp /var/www/foodstore/backend/nginx/client.conf.template \
        /etc/nginx/sites-available/foodstore.com
sudo cp /var/www/foodstore/backend/nginx/rate-zones.conf.template \
        /etc/nginx/snippets/rate-zones.conf
# Deploy maintenance page (served on 502/503 during restarts/outages)
sudo mkdir -p /etc/nginx/maintenance
sudo cp /var/www/foodstore/backend/nginx/maintenance.html \
        /etc/nginx/maintenance/maintenance.html
sudo nano /etc/nginx/sites-available/foodstore.com
# Replace: server_name → foodstore.com
# Replace: certificate paths → /etc/letsencrypt/live/foodstore.com/
# Replace: proxy_pass ports → 3001 (backend), 3101 (frontend)
# Ensure your top-level nginx.conf http {} includes:
#   include /etc/nginx/snippets/rate-zones.conf;
sudo ln -s /etc/nginx/sites-available/foodstore.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 9. SSL
sudo certbot --nginx -d foodstore.com -d www.foodstore.com

# 10. DNS — point A records to VPS IP
# 11. Update Razorpay/shipping provider webhook URLs to production domain
```


> **Mandatory runtime gate before go-live sign-off:** `/api/v1/health/ready` must return `status: "ready"` with `runtimeConfigMissingKeys: []` (after Phase 8 Ops config save + restart). Also execute the runtime stability validation in `docs/CLIENT_VPS_SETUP_GUIDE.md` section **10.1** (separate API/workers supervision, RSS/heap trend capture, sustained OTP/login soak, and notification worker liveness verification).

### 5.5a Runtime validation — Per-template primary notification channels (DB-backed, API-only)

> **Note (2026-06-07):** Merchant admin UI panel for notification settings was removed. The API endpoints below remain valid for deployment validation and direct configuration — they are admin-JWT authenticated, no UI required.

Perform these steps on staging before switching traffic:

- Read current notification settings:
  - `GET /api/v1/admin/settings/notifications`
  - Confirm `primaryChannels` is present and lists 13 templates with defaults (`EMAIL`).
- Pick a non-critical template and set a temporary primary channel:
  - `PATCH /api/v1/admin/settings/notifications` with `{ "primaryChannels": { "LowStockAlert": "SMS" } }` (example)
  - Verify response reflects the change; re-read with `GET` and confirm.
- Trigger a test notification for that template (via admin action or test job) and observe delivery only on the configured primary channel.
  - Confirm there is no fallback to other channels.
  - If delivery fails (disabled channel or bad credentials), verify:
    - `NotificationLog.status` is `FAILED` for that attempt
    - A technical failure alert email was sent to active Ops and verified Admin users.
- Revert the temporary change (`LowStockAlert` back to `EMAIL`).

### 5.5 Production `.env` checklist

> **Pre-launch audit.** Verify each bootstrap variable below before running `docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend workers`.
> All application env vars are injected via `env_file: .env`. See §2.2.1 for how that works.
>
> **DB-overlay keys (provider credentials, webhook tokens, ops-security params) are NOT set here** — they are stored in `OpsConfigSecret` via the Ops UI after Phase 5.6 ops bootstrap. They appear as commented stubs in `.env.example`.

**Bootstrap keys — must be live values in `.env`:**

| Variable | Must be | Why |
|----------|---------|-----|
| `NODE_ENV` | `production` | Activates strict-profile validation |
| `CLIENT_ID` | Client-unique slug | Container names and OTEL service names |
| `DATABASE_URL` | Uses `host.docker.internal` | Container can't reach `localhost` PostgreSQL |
| Host-side `prisma migrate deploy` | Must use `127.0.0.1` override | Bare migrate on VPS shell reads `.env` → P1001 at `host.docker.internal` (see `CLIENT_VPS_SETUP_GUIDE.md` §9, `PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md` §C) |
| `REDIS_URL` | Uses `redis` (service name) | Points to the docker-compose Redis container |
| `REDIS_PASSWORD` | Unique per client, 32+ chars | Must match the password in `REDIS_URL` |
| `STOREFRONT_URL` / `ADMIN_URL` | `https://clientdomain.com` | CORS + cookie domain — must be HTTPS in production |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Unique per client, 64+ chars | Generate fresh: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `OPS_DB_ENCRYPTION_KEY` | Unique per client, 32-char hex | Required to decrypt `OpsConfigSecret`; bootstrap-only — never in DB |
| `ADMIN_ALERT_EMAIL` | Valid ops email | Fallback alert delivery if DB overlay unavailable |
| `TURNSTILE_SECRET_KEY` | From Cloudflare | Bot protection on auth endpoints |
| `AUDIT_ANCHOR_SECRET` | 32-char hex | Tamper-evident audit chain |
| `IDEMPOTENCY_SCOPE_SECRET` | 32-char hex | Scopes idempotency keys per client |
| `REDIS_KEY_PEPPER` | 32-char hex | Token storage hardening |
| Feature flags | `true`/`false` | Modules enabled per client contract |

**DB-overlay keys — set via Ops UI after Phase 5.6, NOT in `.env`:**

All provider credentials, webhook tokens, and ops-security parameters are stored in `OpsConfigSecret` and applied by `applyOpsConfigRuntimeOverlay()` at startup. After saving via `POST /api/v1/ops/config/save`, restart containers:

| Domain | Representative keys | Notes |
|--------|--------------------|----|
| Payments | `PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PAYMENT_CB_*` | Live keys — never test keys in production |
| Shipping | `DELHIVERY_API_KEY`, `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPPING_CB_*` | Both providers can be active simultaneously; detection is credential-based. Allowlist + token also overlay. `SHIPPING_PROVIDER` is not a configurable key. |
| Webhook security | `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR`, `DELHIVERY_WEBHOOK_TOKEN`, `SHIPROCKET_WEBHOOK_TOKEN`, skew windows | Strict-profile requires non-empty |
| Notifications | `RESEND_API_KEY`, `RESEND_FROM`, `MSG91_AUTH_KEY`, `FAST2SMS_API_KEY`, `META_WHATSAPP_*`, `SMS_PROVIDER` | `RESEND_FROM` must use verified domain |
| Invoice | `INVOICE_STORAGE_ROOT` | PDF storage path — must be writable |
| Product media | `MEDIA_STORAGE_PROVIDER`, `R2_*`, `R2_PUBLIC_BASE_URL` | **Ops UI** (Product Media domain) — automatic R2 upload; pair with `NEXT_PUBLIC_IMAGE_CDN_URL` |
| Ops security | `OPS_METRICS_TOKEN`, `REPLAY_APPROVAL_TOKEN`, `TRUSTED_PROXY_ALLOWLIST_CIDR` | DB-overlay runtime keys; enforce before go-live via `/health/ready` |

**After editing `.env`:**

```bash
# ALWAYS use `up -d`, never `restart`
docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d backend workers   # VPS: picks up new .env values
docker compose logs -f backend    # verify no startup errors
```

> **Gotcha:** `docker compose restart` does NOT re-read `.env` — it reuses the old container environment. Always use `docker compose up -d` after any `.env` change.

> **Ops config overlay gotcha:** DB-backed Ops config changes are encrypted in `OpsConfigSecret` and are applied only during API/worker startup. After saving non-bootstrap keys through `/api/v1/ops/config/save`, restart/recreate backend and worker containers so both processes load the same overlay before providers initialize. Bootstrap-only keys (`DATABASE_URL`, initial `REDIS_URL`, `OPS_DB_ENCRYPTION_KEY`) must still be changed in deployment env/secret manager.
>
> **Two ways to restart after a config save:** (1) **SSH/VPS:** `docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d backend workers` — recreates containers and picks up the new overlay. (2) **Ops UI (no SSH required):** `POST /api/v1/ops/system/restart` — schedules a graceful restart via BullMQ. The `cartCleanup` worker runs a 6-step drain protocol before exiting: (a) pause `outboxDispatch` queue (primary job producer), (b) wait `RESTART_QUEUE_PAUSE_GRACE_MS` (default `1500` ms), (c) pause all other producer queues, (d) poll `getActiveCount()` until all paused queues drain to 0 or `RESTART_QUEUE_DRAIN_TIMEOUT_MS` elapses (default `60000` ms), (e) drain `PENDING_PAYMENT` orders (default 5 min via `RESTART_PAYMENT_DRAIN_TIMEOUT_MS`), (f) resume all queues, send `ProcessRestartAlert`, reset load-shed to `normal`, publish to the `system:restart` Redis pub/sub channel — both backend and worker containers restart automatically via Docker `restart: unless-stopped`. **No queue job is lost** (paused queues retain in-flight state in Redis; resume restores normal claim semantics). **No storefront request is dropped** unless it hits a load-shed-protected route during the ~3–5 s downtime window. **If step (f) fails silently** (process exit racing the Redis Lua flush, or the resume-failure alert itself getting orphaned on the still-paused notifications queue), the new worker container self-heals on boot: `bootstrapWorkers()` re-checks every drainable queue and resumes any that stayed paused, emitting a `Detected queues paused at boot — likely incomplete drain from a prior restart. Auto-resumed.` warn log. Operators can also force a manual recovery without a rebuild via `docker exec <client-id>-workers node scripts/resume-paused-queues.js` (see `OPS_CONTROL_PLANE_GUIDE.md` §9.2). Prefer the Ops UI restart method in production to maintain audit trail and avoid direct server access. After restart, verify `/api/v1/health/ready` returns `status=ready` with empty `runtimeConfigMissingKeys`. **Saving a config does NOT auto-restart** — the save response sets `requiresRestart: true` and the operator must explicitly trigger one of the two methods above.

### 5.6 Ops control plane invite bootstrap on VPS (mandatory)

Run this once per environment after migrations and before go-live sign-off.

1. Ensure required env exists in backend `.env`:
   - `OPS_DB_ENCRYPTION_KEY`
2. Run invite bootstrap from a trusted shell session on the backend host:

```bash
cd /var/www/foodstore/backend
npm run ops:newuser -- --email=ops@foodstore.com --name="Primary Ops" --setup-base-url="https://foodstore.com" --yes
```

**Pre-requisite:** Ensure your domain is **"Verified"** in Resend Dashboard → Domains before running this. If still "Pending", the invite email will fail with: *"You can only send testing emails to your own email address..."* See `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md` §Step 1b for complete domain + email setup instructions.

`--setup-base-url` must be base origin only (for example, `https://foodstore.com`), not `https://foodstore.com/ops/setup`. Backend appends `/ops/setup?token=...`.

3. Complete invite setup from emailed link (`/ops/setup`) within 10 minutes.
4. Verify email OTP login completes and `GET /api/v1/ops/session` returns 200.
5. Verify Ops config UI/API visibility for contract-managed domains:
   - Core Runtime: bootstrap-only `DATABASE_URL`, initial `REDIS_URL`, `OPS_DB_ENCRYPTION_KEY` are read-only environment values; JWT secrets and `INVOICE_STORAGE_ROOT` are DB-overlay eligible
   - Payments, Shipping, Notifications provider keys
   - Ops Security: `REPLAY_APPROVAL_TOKEN`; `OPS_DB_ENCRYPTION_KEY` remains bootstrap-only
6. Confirm `/api/v1/ops/config/save` requires verified email OTP, rejects bootstrap-only keys with `BOOTSTRAP_KEY_NOT_DB_APPLICABLE`, and stores only encrypted/masked DB-overlay values.
7. Confirm expired unconsumed invites are cleaned and visible in ops audit timeline.
8. Remove shell output/history artifacts where policy requires.

Fail-closed identity rule: ops invite creation must return `409 CONFLICT` if invite email already exists in customer/admin (`User`) domain.

If credentials are compromised, deactivate the affected `OpsUser`, bootstrap a new one, and rotate stored secret references.

### 5.7 Merchant admin invite provisioning on VPS (mandatory)

Run this after Ops bootstrap is verified and before frontend go-live sign-off.

1. From an authenticated ops browser session, create the merchant admin invite:
   - Route: `POST /api/v1/ops/admin-invites`
   - Auth: `ops_session` cookie (email-OTP login) with OTP challenge for privileged write
   - Permission: `ops:write`
   - Body: `email`, `name`, `setupBaseUrl`, optional merchant-only `permissions`
   - `setupBaseUrl` must be base origin only (for example, `https://foodstore.com`), not `https://foodstore.com/admin/setup`; backend appends `/admin/setup?token=...`
2. Complete setup at `/admin/setup?token=...` within 10 minutes.
3. Confirm the backend created or reactivated `User(role=ADMIN)` and explicit merchant `AdminPermissionGrant` rows (re-invite after ops deactivation reuses the same `userId`).
4. Verify login via 2-step email OTP (`POST /api/v1/auth/admin/login/request-otp` → `POST /api/v1/auth/admin/login/verify-otp`) and confirm JWT `permissions` contains expected merchant scopes only.
5. Confirm no ops/developer scopes are present in the issued JWT.
6. Verify expired invite cleanup from ops context with `POST /api/v1/ops/admin-invites/cleanup-expired`.
7. Record invite creation, consumption time, permissions granted, and cleanup evidence in `CLIENT_VPS_DEPLOYMENT_LOG.md`.

Fail-closed identity rule: merchant admin invite must return `409 CONFLICT` if invite email exists in `OpsUser`, is an active merchant admin, or is a customer. Deactivated merchant admin emails are allowed and reactivated on setup consume.

Do not use local/legacy admin seed scripts as production go-live provisioning. Do not grant `ops:*`, `developer:*`, provider-secret, database, Redis, or ops-control permissions through merchant admin setup.

---

## PHASE 6 — Go-Live Validation

> **Full reference:** `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md`
> **Checklist set:** `docs/BACKEND_GO_LIVE_CHECKLIST.md` + `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`

### BRD acceptance criteria (all 15 must pass)

| AC | Test |
|----|------|
| AC-01 | Customer OTP login works end-to-end |
| AC-01a | Customer phone OTP signup works end-to-end (phone required, profile optional) |
| AC-02 | Guest cart merges on login |
| AC-03 | Pincode check returns correct serviceable/non-serviceable |
| AC-04 | Full prepaid checkout under 60 seconds |
| AC-05 | Duplicate webhooks don't create duplicate confirmations |
| AC-06 | Order stays PENDING_PAYMENT until webhook capture |
| AC-07 | Zero-stock order attempt returns INSUFFICIENT_STOCK |
| AC-08 | Admin ships → AWB created in shipping provider |
| AC-09 | Customer sees tracking timeline |
| AC-10 | Admin cancel → Razorpay refund → REFUNDED |
| AC-11 | Low stock alert triggers email + dashboard widget |
| AC-12 | GST invoice PDF has correct tax split |
| AC-13 | Dashboard KPIs match manual calculation |
| AC-14 | Client A data invisible from client B |
| AC-15 | Second client: clone to live HTTPS < 30 min |

### Post-launch monitoring (48 hours)

- Payment success rate (compare Razorpay dashboard)
- Webhook error rate (should be near zero)
- Queue dead-letter count (should not grow)
- Container health: `docker compose ps`
- Nginx errors: `tail -f /var/log/nginx/error.log`

### Integration operations evidence (required before final Go)

Archive all of the following with release evidence:

1. Completed client credential register (`docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`) with owner, vault path, created on, rotated on, expiry/next rotation, and last-tested.
2. Staging dry-run evidence for each provider class:
   - Razorpay payment + webhook validation
   - Delhivery/Shiprocket shipment + webhook validation
   - SMS provider OTP send/verify (MSG91 or Fast2SMS per `SMS_PROVIDER`)
   - Resend verified sender test
   - Invoice local storage write/read cycle
3. 90-day rotation calendar with primary + backup owners for payments, shipping, notifications, and assets.
4. One executed compromise drill (`revoke -> regenerate -> redeploy -> verify`) with measured recovery time and notes.

---

## Adding a second client (< 30 min)

Repeat Phases 2–6 with a new project folder, new database, new ports, new domain. The backend template stays untouched as your IP. Each client is fully independent.

---

## Related docs

| Need | Document |
|------|----------|
| Full API contract + admin endpoint matrix | `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` |
| Ops bootstrap + control plane usage | `docs/OPS_CONTROL_PLANE_GUIDE.md` |
| Provider account + API key setup/maintenance | `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` |
| Client credential register template | `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md` |
| VPS infrastructure commands | `docs/CLIENT_VPS_SETUP_GUIDE.md` |
| Go-live sign-off checklist | `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md` |
| Backend go-live checklist (reusable) | `docs/BACKEND_GO_LIVE_CHECKLIST.md` |
| Frontend AI go-live checklist (reusable) | `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` |
| Architecture decisions | `ECOM_MASTER.md` |
| API routes + technical spec | `TRD.md` |
| Business acceptance criteria | `BRD.md` |
| All environment variables | `.env.example` |

---

## APPENDIX A — JSON API Contracts (Request → Response)

> Error responses are always wrapped: `{ "success": false, "error": { "code", "message", "statusCode" } }`.
> Success responses are feature-flagged: raw route payload by default; when `FEATURE_RESPONSE_ENVELOPE_ENABLED=true`, they are wrapped as `{ "success": true, "data": <T>, "meta"?: {...} }`.
> All monetary values are **integer paise**. UUIDs are v4 strings. Dates are ISO-8601 strings.

### A.1 Auth — Customer

#### `POST /api/v1/auth/register`

```jsonc
// Request body
{
  "firstName": "string (max 100)",    // required
  "lastName": "string (max 100)",     // required
  "phone": "string (max 20)",         // required
  "email": "string (max 255)",        // required (normalized to lowercase)
  "password": "string (8–128 chars)", // required
  "turnstileToken": "string (max 4096)" // optional, CAPTCHA
}
// Response 200 → data
{
  "accessToken": "eyJhbG...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "phone": "+919876543210",
    "firstName": "John",
    "lastName": "Doe",
    "role": "CUSTOMER",
    "isVerified": false
  }
}
// Side effect: sets httpOnly refresh_token cookie
```

#### `POST /api/v1/auth/send-otp`

```jsonc
// Request body
{ "phone": "+919876543210", "turnstileToken": "optional" }
// Response 200 → data
{ "message": "OTP sent successfully" }
```

#### `POST /api/v1/auth/verify-otp`

```jsonc
// Request body
{ "phone": "+919876543210", "otp": "123456" }
// Response 200 → data
{
  "accessToken": "eyJhbG...",
  "user": { "id": "uuid", "email": "...", "phone": "...", "firstName": "...", "lastName": "...", "role": "CUSTOMER", "isVerified": true }
}
// Side effect: sets httpOnly refresh_token cookie
```

#### `POST /api/v1/auth/login`

```jsonc
// Request body
{ "email": "user@example.com", "password": "securepass", "turnstileToken": "optional" }
// Response 200 → data
{ "accessToken": "eyJhbG...", "user": { /* same shape as verify-otp */ } }
```

#### `POST /api/v1/auth/forgot-password`

```jsonc
// Request body
{ "email": "user@example.com", "turnstileToken": "optional" }
// Response 200 → data
{ "message": "If the account exists, a password reset email has been queued." }
```

#### `POST /api/v1/auth/refresh`

```jsonc
// No body — uses httpOnly refresh_token cookie
// Response 200 → data
{ "accessToken": "eyJhbG..." }
```

#### `POST /api/v1/auth/logout`

```jsonc
// No body — requires Bearer token
// Response 200 → data
{ "message": "Logged out successfully" }
// Side effect: clears refresh_token cookie
```

### A.2 Auth — Admin

Admin login uses a mandatory 2-step email OTP flow. There is no single-step login and no TOTP/authenticator-app MFA.

#### `POST /api/v1/auth/admin/login/request-otp` (step 1)

```jsonc
// Request body
{
  "email": "admin@store.com",   // required
  "password": "securepass"      // required (8–128)
}
// Response 200 → data (valid active admin only — OTP actually sent)
{ "message": "If a registered admin account exists...", "expiresAt": "2026-05-20T16:35:00.000Z" }
// Response 401 INVALID_CREDENTIALS — known admin, wrong password (no OTP)
// Response 401 UNAUTHORISED — admin deactivated (isBanned; no OTP)
// Response 200 generic — unknown email or non-admin (anti-enumeration; no OTP sent)
// Side effect on true success: 6-digit OTP to admin channel (TTL 300s, max 5 verify attempts)
```

#### `POST /api/v1/auth/admin/login/verify-otp` (step 2)

```jsonc
// Request body
{
  "email": "admin@store.com",   // required
  "otp": "123456"               // required (6 digits)
}
// Response 200 → data
{
  "accessToken": "eyJhbG...",
  "admin": { "id": "uuid", "email": "...", "role": "ADMIN", "permissions": [] }
}
// Side effect: sets HTTP-only refresh cookie
// JWT payload includes: permissions[] array (merchant scopes only)
```

### A.3 Products — Public

#### `GET /api/v1/products`

```jsonc
// Query params (all optional)
// ?category=shoes&search=nike&minPrice=100000&maxPrice=500000&tags=sport&sort=price_asc&inStock=true&page=1&limit=20
// sort options: price_asc | price_desc | newest | popularity

// Response 200 → data
{
  "items": [
    {
      "id": "uuid",
      "name": "Running Shoe Pro",
      "slug": "running-shoe-pro",
      "description": "Premium running shoe...",
      "tags": ["sport", "running"],
      "isFeatured": true,
      "category": { "id": "uuid", "name": "Shoes", "slug": "shoes" },
      "images": [
        { "id": "uuid", "url": "https://cdn.example.com/img.jpg", "altText": "Front view", "sortOrder": 0 }
      ],
      "variants": [
        { "id": "uuid", "name": "Size 10 - Black", "sku": "RSP-10-BLK", "price": 499500, "compareAtPrice": 699900, "isActive": true }
      ]
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 142, "totalPages": 8 }
}
```

#### `GET /api/v1/products/:slug`

```jsonc
// Response 200 → data (same as list item + reviews array)
{
  /* ...all product fields... */
  "reviews": [
    {
      "id": "uuid", "rating": 5, "body": "Great product!", "images": ["https://..."],
      "createdAt": "2026-01-15T10:30:00Z", "author": { "firstName": "Jane", "lastName": "D" }
    }
  ]
}
```

#### `GET /api/v1/products/categories`

```jsonc
// Response 200 → data (array)
[
  { "id": "uuid", "name": "Shoes", "slug": "shoes", "parentId": null },
  { "id": "uuid", "name": "Running", "slug": "running", "parentId": "uuid-of-shoes" }
]
```

### A.4 Cart

#### `GET /api/v1/cart`

```jsonc
// Response 200 → data
{
  "id": "uuid",
  "items": [
    {
      "id": "uuid",         // cart item ID (for PATCH/DELETE)
      "variantId": "uuid",
      "quantity": 2,
      "priceSnapshot": 499500,  // paise — price at time of add
      "lineTotal": 999000,      // paise — quantity × priceSnapshot
      "variant": { "id": "uuid", "name": "Size 10 - Black", "sku": "RSP-10-BLK", "price": 499500 }
    }
  ],
  "subtotal": 999000,       // paise
  "discountAmount": 100000, // paise (from coupon)
  "total": 899000,          // paise (subtotal - discount)
  "coupon": {               // null if no coupon applied
    "id": "uuid", "code": "SAVE10", "type": "PERCENTAGE_OFF", "value": 1000
    // type enum: PERCENTAGE_OFF | FLAT_AMOUNT_OFF | FREE_SHIPPING | BUY_X_GET_Y
  },
  "meta": {
    "isGuest": false,
    "reservationExpiresAt": "2026-01-15T11:00:00Z",  // or null
    "reservedItemCount": 2
  }
}
```

#### `POST /api/v1/cart/items`

```jsonc
// Request body
{ "variantId": "uuid", "quantity": 2 }
// Response 200 → data: full cart object (same shape as GET /cart)
```

#### `PATCH /api/v1/cart/items/:id`

```jsonc
// Request body
{ "quantity": 3 }
// Response 200 → data: full cart object
```

#### `DELETE /api/v1/cart/items/:id` — Response: full cart object

#### `DELETE /api/v1/cart` — Clears cart. Response: empty cart object

#### `POST /api/v1/cart/merge` — Merges guest cart into auth cart after login. Response: full cart

#### `POST /api/v1/cart/coupon`

```jsonc
// Request body
{ "code": "SAVE10" }
// Response 200 → data: full cart object (with coupon populated)
// Error codes: COUPON_EXPIRED, COUPON_USAGE_EXCEEDED, NOT_FOUND
```

#### `DELETE /api/v1/cart/coupon` — Removes coupon. Response: full cart

#### `POST /api/v1/cart/check-pincode`

```jsonc
// Request body
{ "pincode": "500001" }
// Response 200 → data
{ "pincode": "500001", "serviceable": true }
// Error code: PINCODE_NOT_SERVICEABLE (when serviceable=false in response)
```

#### `GET /api/v1/cart/delivery-rates?pincode=500001&paymentMode=PREPAID`

Query `paymentMode` optional: `PREPAID` (default) or `COD`. Quotes may differ by mode.

```jsonc
// Response 200 → data
{ "pincode": "500001", "shippingCharge": 4900, "estimatedDays": 3 }
```

#### `GET /api/v1/store/config`

Public runtime storefront config (no auth). Used by Next.js ISR and admin GST panels.

```jsonc
// Response 200 → data
{
  "isCodEnabled": true,
  "minOrderValuePaise": 0,
  "mobileOtpSignupEnabled": false,
  "couponsEnabled": true,
  "reviewsEnabled": true,
  "wishlistEnabled": false,
  "gstInvoicingEnabled": true
}
```

### A.5 Orders — Customer

#### `POST /api/v1/orders`

```jsonc
// Request body — one of addressId OR shippingAddress is required
{
  "addressId": "uuid",              // use saved address
  // OR
  "shippingAddress": {              // inline address
    "fullName": "John Doe",         // required
    "phone": "+919876543210",       // required
    "line1": "123 Main Road",       // required
    "line2": "Apt 4B",             // optional
    "city": "Hyderabad",           // required
    "state": "Telangana",          // required
    "pincode": "500001"            // required, exactly 6 digits
  },
  "notes": "Please deliver before 5 PM"  // optional (max 2000)
}
// Response 200 → data: customer order detail (see A.5.1 below)
// PREPAID orders start in PENDING_PAYMENT; COD orders return CONFIRMED immediately
```

##### A.5.1 Customer order detail shape (used by GET/POST)

```jsonc
{
  "id": "uuid",
  "orderNumber": "ORD-20260115-001",
  "status": "PENDING_PAYMENT",
  "shippingAddress": { "fullName": "...", "phone": "...", "line1": "...", "line2": null, "city": "...", "state": "...", "pincode": "500001" },
  "subtotal": 999000,
  "shippingCharge": 4900,
  "discountAmount": 100000,
  "total": 903900,
  "notes": "Please deliver before 5 PM",
  "createdAt": "2026-01-15T10:30:00Z",
  "updatedAt": "2026-01-15T10:30:00Z",
  "items": [
    { "id": "uuid", "variantId": "uuid", "productName": "Running Shoe Pro", "variantName": "Size 10 - Black", "sku": "RSP-10-BLK", "quantity": 2, "unitPrice": 499500, "totalPrice": 999000 }
  ],
  "statusHistory": [
    { "id": "uuid", "fromStatus": null, "toStatus": "PENDING_PAYMENT", "triggeredBy": "SYSTEM", "note": null, "createdAt": "2026-01-15T10:30:00Z" }
  ],
  "creditNotes": [],
  "payment": null,
  "customer": { "name": "John Doe", "email": "john@example.com", "phone": "+919876543210" },
  "invoice": null,
  "shipment": null
}
```

#### `GET /api/v1/orders/:id` — Response: customer order detail (above)

#### `POST /api/v1/orders/:id/cancel`

```jsonc
// Request body (all optional)
{ "reason": "Changed my mind", "refundAmountPaise": 903900 }
// Response 200 → data: updated customer order detail
```

### A.6 Payments

#### `POST /api/v1/payments/initiate`

```jsonc
// Request body
{ "orderId": "uuid" }
// Response 200 → data
{
  "orderId": "uuid",
  "provider": "razorpay",
  "providerOrderId": "order_Lx1234567890",  // pass to Razorpay checkout.js
  "amount": 903900,    // paise
  "currency": "INR"
}
```

#### `POST /api/v1/payments/verify`

```jsonc
// Request body
{
  "orderId": "uuid",
  "razorpayPaymentId": "pay_Lx1234567890",
  "razorpaySignature": "hmac_sha256_signature_string"
}
// Response 200 → data
{ "message": "Payment verification acknowledged" }
// NOTE: This is NOT proof of capture. Poll GET /orders/:id until webhook confirms.
```

### A.7 Shipping — Customer

#### `GET /api/v1/shipping/track/:awb`

```jsonc
// Response 200 → data (array)
[
  { "id": "uuid", "status": "In Transit", "location": "Mumbai Hub", "description": "Package arrived at hub", "occurredAt": "2026-01-16T08:00:00Z" },
  { "id": "uuid", "status": "Shipped", "location": "Warehouse", "description": "Package shipped", "occurredAt": "2026-01-15T14:00:00Z" }
]
```

### A.8 User Profile

#### `GET /api/v1/users/me` — Response: user object (same shape as auth response user)

#### `PATCH /api/v1/users/me`

```jsonc
// Request body (all optional)
{ "firstName": "John", "lastName": "Doe", "phone": "+919876543210" }
```

#### `GET /api/v1/users/me/addresses` — Response: `{ "items": [ ...address objects ], "meta": { "total": number } }`

#### `POST /api/v1/users/me/addresses`

```jsonc
// Request body
{
  "fullName": "John Doe", "phone": "+919876543210",
  "line1": "123 Main Road", "line2": "Apt 4B",
  "city": "Hyderabad", "state": "Telangana", "pincode": "500001",
  "isDefault": true
}
```

#### `PATCH /api/v1/users/me/addresses/:id` — same body shape, all optional

#### `DELETE /api/v1/users/me/addresses/:id` — 200 OK

### A.9 Wishlist (if `FEATURE_WISHLIST_ENABLED`)

```jsonc
// GET /api/v1/wishlist → array of product summaries
// POST /api/v1/wishlist/items → { "productId": "uuid" }
// DELETE /api/v1/wishlist/items/:productId → 200 OK
```

### A.10 Reviews (if `FEATURE_REVIEWS_ENABLED`)

```jsonc
// GET /api/v1/reviews/recent?limit=3 → latest approved reviews with body (homepage testimonials)
// GET /api/v1/reviews/product/:slug → paginated reviews
// GET /api/v1/reviews/me → my reviews
// POST /api/v1/reviews → { "productId": "uuid", "rating": 5, "body": "Great!", "images": ["url"] }
```

---

## APPENDIX B — Order State Machine & Error Codes

### B.1 Order status values (Prisma enum)

```
PENDING_PAYMENT → PAYMENT_FAILED → CONFIRMED → PROCESSING → SHIPPED → OUT_FOR_DELIVERY → DELIVERED → CANCELLED → REFUNDED
```

### B.2 Valid transitions (source code: `src/common/orders/order-state-machine.ts`)

```
PENDING_PAYMENT  → [PAYMENT_FAILED, CONFIRMED]
PAYMENT_FAILED   → [PENDING_PAYMENT, CANCELLED]
CONFIRMED        → [PROCESSING, CANCELLED, REFUNDED]
PROCESSING       → [SHIPPED, CANCELLED, REFUNDED]
SHIPPED          → [OUT_FOR_DELIVERY]
OUT_FOR_DELIVERY → [DELIVERED]
DELIVERED        → [REFUNDED]
CANCELLED        → [REFUNDED]
REFUNDED         → [] (terminal)
```

**Frontend rules:**
- Customer can cancel only from `CONFIRMED` or `PROCESSING` (not `PENDING_PAYMENT` / `PAYMENT_FAILED`)
- Admin can cancel from `CONFIRMED` or `PROCESSING` (with auto-refund if payment captured)
- Admin ships only from `CONFIRMED` or `PROCESSING`
- `SHIPPED` → `OUT_FOR_DELIVERY` → `DELIVERED` are shipping-webhook driven
- Invalid transitions return error code `INVALID_STATUS_TRANSITION`

### B.3 Error codes (source: `src/common/errors/error-codes.ts`)

| Code | HTTP | When | Frontend action |
|------|------|------|-----------------|
| `VALIDATION_ERROR` | 400 | Malformed request body/params | Show field-level errors |
| `INVALID_CREDENTIALS` | 401 | Wrong email/password | Show "Invalid credentials" |
| `TOKEN_EXPIRED` | 401 | JWT expired | Call `/auth/refresh`, retry once |
| `UNAUTHORISED` | 401 | No/invalid auth token | Redirect to login |
| `FORBIDDEN` | 403 | Insufficient permissions | Show "Access denied" or hide action |
| `NOT_FOUND` | 404 | Resource doesn't exist | Show 404 page or "Not found" |
| `CONFLICT` | 409 | Duplicate or concurrent operation | Show "Already exists" / retry |
| `INSUFFICIENT_STOCK` | 409 | Variant out of stock | Show "Out of stock" on product/cart |
| `PAYMENT_VERIFICATION_FAILED` | 401 | Razorpay webhook signature missing/invalid | Show "Payment verification failed" and avoid client-side replay |
| `INVALID_STATUS_TRANSITION` | 409 | Invalid order status change | Show "Action not available" |
| `COUPON_EXPIRED` | 400 | Coupon past expiry | Show "Coupon has expired" |
| `COUPON_USAGE_EXCEEDED` | 400 | Coupon usage limit reached | Show "Coupon limit reached" |
| `PINCODE_NOT_SERVICEABLE` | 422 | Delivery not available | Show "Not deliverable" |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Show "Try again shortly" + backoff |
| `INTERNAL_ERROR` | 500 | Server error | Show generic error, log for support |

Identity boundary reminder for frontend + provisioning tooling:

- Cross-domain email reuse returns `CONFLICT` (`409`):
  - ops invite email already exists in `User` domain
  - admin/customer email already exists in `OpsUser` domain

**Frontend error handling pattern:**

```typescript
// Always branch on error.code, never on error.message
if (!response.success) {
  switch (response.error.code) {
    case 'INSUFFICIENT_STOCK':
      showToast('Sorry, this item is out of stock');
      break;
    case 'TOKEN_EXPIRED':
      await refreshToken();
      retry();
      break;
    case 'RATE_LIMIT_EXCEEDED':
      showToast('Too many attempts, try again shortly');
      break;
    default:
      showToast(response.error.message);
  }
}
```

---

## APPENDIX C — Admin-Only API Contracts

> All admin endpoints require `Authorization: Bearer <adminJWT>`.
> Each endpoint also requires the permission listed in brackets (enforced by `adminPermissionsGuard`).

### C.1 Products — Admin CRUD

#### `POST /api/v1/admin/products` `[products:write]`

```jsonc
// Request body — JSON (not multipart). Images added after create via upload or URL endpoints below.
{
  "name": "Running Shoe Pro",           // required (max 500)
  "description": "Premium running...",   // required (max 10000)
  "categoryId": "uuid",                  // required
  "tags": ["sport", "running"],          // optional
  "isFeatured": true,                    // optional, default false
  "variants": [                          // at least one required
    {
      "name": "Size 10 - Black",         // required (max 500)
      "sku": "RSP-10-BLK",             // required (max 100, unique)
      "price": 499500,                   // required — PAISE
      "compareAtPrice": 699900,          // optional — PAISE (strikethrough)
      "stock": 50                        // required — integer
    }
  ]
}
// Response 201 → data: full product object (same shape as public GET)
```

#### `PATCH /api/v1/admin/products/:id` `[products:write]`

```jsonc
// Request body — all fields optional
{ "name": "Updated Name", "isFeatured": false, "categoryId": "uuid" }
// NOTE: to deactivate (soft delete) → PATCH with { "isActive": false }
// NEVER hard delete products — this corrupts order history
```

#### `GET /api/v1/admin/products` `[products:read]` — paginated, with `?isActive=false` filter

#### Product images `[products:write]`

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/v1/admin/products/:id/images/upload` | **Preferred.** `multipart/form-data`: one or more `file` parts (max **5 MiB** each, JPEG/PNG/WebP/GIF), optional `altText`. Sort order assigned server-side. **Automatically** uploads to Cloudflare R2 when `MEDIA_STORAGE_PROVIDER=r2`. |
| `POST` | `/api/v1/admin/products/:id/images` | JSON `{ url, altText, sortOrder }` — external `https://…` or existing hosted URL. |
| `PATCH` | `/api/v1/admin/products/:id/images/reorder` | `{ images: [{ id, sortOrder }] }` |
| `DELETE` | `/api/v1/admin/products/:id/images/:imageId` | Deletes DB row; removes R2 object (or legacy VPS file) when URL is hosted media. |

**Public serve (prod):** R2 bucket + `R2_PUBLIC_BASE_URL` (custom domain on bucket). **Local dev:** `GET /api/v1/media/products/:productId/:filename`.

**Env:** Ops UI → Product Media (`MEDIA_STORAGE_PROVIDER=r2`, `R2_*`). Preflight: `npm run verify:r2-media` (no R2 in `.env`). Storefront: `NEXT_PUBLIC_IMAGE_CDN_URL` must match `R2_PUBLIC_BASE_URL`.

### C.2 Categories — Admin

```jsonc
// POST /api/v1/admin/categories [categories:write]
// { "name": "Electronics", "slug": "electronics", "parentId": null }
// PATCH /api/v1/admin/categories/:id [categories:write]
// DELETE /api/v1/admin/categories/:id [categories:write]
// GET /api/v1/admin/categories [categories:read]
```

### C.3 Inventory — Admin

#### `GET /api/v1/admin/inventory` `[inventory:read]`

```jsonc
// Query: ?page=1&limit=20&lowStock=true&sku=RSP
// Response 200 → data
{
  "items": [
    {
      "variantId": "uuid", "sku": "RSP-10-BLK", "productName": "Running Shoe Pro",
      "variantName": "Size 10 - Black", "stock": 3, "reservedStock": 1,
      "availableStock": 2, "lowStockThreshold": 5, "isLowStock": true
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 45 }
}
```

#### `PATCH /api/v1/admin/inventory/:variantId` `[inventory:write]`

```jsonc
// Request body
{ "stock": 100, "lowStockThreshold": 10 }
```

### C.4 Orders — Admin

#### `GET /api/v1/admin/orders` `[orders:read]`

```jsonc
// Query: ?status=CONFIRMED&page=1&limit=20&dateFrom=2026-01-01&dateTo=2026-01-31&search=ORD-
// Response 200 → data: { items: [admin order detail], meta: { page, limit, total } }
```

#### `PATCH /api/v1/admin/orders/:id/status` `[orders:write]`

```jsonc
// Request body
{ "status": "PROCESSING", "note": "Packaging started" }
// Validates against state machine. Returns INVALID_STATUS_TRANSITION on failure.
```

#### `POST /api/v1/admin/orders/:id/ship` `[orders:write]`

```jsonc
// Request body
{ "provider": "delhivery", "awbNumber": "1234567890", "trackingUrl": "https://..." }
// Transitions order to SHIPPED status
```

#### `POST /api/v1/admin/orders/:id/refund` `[orders:refund]`

```jsonc
// Request body
{ "amountPaise": 903900, "reason": "Customer request" }
// Note: orders:refund is a HIGH RISK permission (Layer B, requiresApproval: true)
```

#### `GET /api/v1/admin/orders/export` `[orders:export]`

```jsonc
// Query: ?format=csv&dateFrom=2026-01-01&dateTo=2026-01-31&status=DELIVERED
// Response: CSV file download
```

### C.5 Coupons — Admin

```jsonc
// GET    /api/v1/admin/coupons         [coupons:read]
// POST   /api/v1/admin/coupons         [coupons:write]
{
  "code": "SAVE10",                      // required, unique, uppercase
  "type": "PERCENTAGE_OFF",             // PERCENTAGE_OFF | FLAT_AMOUNT_OFF | FREE_SHIPPING | BUY_X_GET_Y
  "value": 1000,                         // paise for FLAT, basis points for PERCENTAGE (1000 = 10%)
  "minOrderValue": 100000,              // paise — optional
  "maxDiscountAmount": 50000,           // paise — optional (caps % discount)
  "usageLimit": 100,                    // optional
  "perUserLimit": 1,                    // optional
  "startsAt": "2026-01-01T00:00:00Z",  // required
  "expiresAt": "2026-03-31T23:59:59Z"  // required
}
// PATCH  /api/v1/admin/coupons/:id     [coupons:write]
// DELETE /api/v1/admin/coupons/:id     [coupons:write] — soft delete
```

### C.6 Reviews — Admin

```jsonc
// GET    /api/v1/admin/reviews         [reviews:read]    — ?status=PENDING&page=1
// PATCH  /api/v1/admin/reviews/:id     [reviews:moderate] — { "status": "APPROVED" | "REJECTED" }
```

### C.7 Settings — Admin

```jsonc
// GET    /api/v1/admin/settings        [settings:read]
// PATCH  /api/v1/admin/settings        [settings:write]
// Settings include: store name, currency, tax rate, shipping defaults, feature flags
```

### C.8 Dashboard & Analytics — Admin

```jsonc
// GET /api/v1/admin/dashboard          [dashboard:read]
// Response: { totalOrders, totalRevenue, pendingOrders, lowStockCount, recentOrders[] }

// GET /api/v1/admin/analytics          [analytics:read]
// Query: ?period=7d|30d|90d|custom&from=&to=
// Response: { salesTimeSeries[], topProducts[], categoryBreakdown[], conversionRate }

// GET /api/v1/admin/analytics/export   [analytics:export]
// Query: ?format=csv&period=30d
```

### C.9 Users — Admin

```jsonc
// GET /api/v1/admin/users              [users:read]
// Query: ?search=john&role=CUSTOMER&page=1&limit=20
// Response: paginated user list (no passwords ever exposed)
```

### C.10 Queues — Ops plane only

```jsonc
// GET /api/v1/ops/queues             [ops:read]  — Bull Board UI
// GET /api/v1/ops/queues/dlq/summary [ops:read]  — DLQ summary card
```

---

## APPENDIX D — Admin Permissions & RBAC Matrix

### D.1 All permissions

| Permission | Layer | Owner role | Risk | Approval |
|------------|-------|-----------|------|----------|
| `products:read` | A | merchant | low | No |
| `products:write` | A | merchant | medium | No |
| `categories:read` | A | merchant | low | No |
| `categories:write` | A | merchant | medium | No |
| `inventory:read` | A | merchant | low | No |
| `inventory:write` | A | merchant | medium | No |
| `coupons:read` | A | merchant | low | No |
| `coupons:write` | A | merchant | medium | No |
| `settings:read` | A | merchant | low | No |
| `settings:write` | A | merchant | medium | No |
| `reviews:read` | A | merchant | low | No |
| `reviews:moderate` | A | merchant | medium | No |
| `dashboard:read` | A | merchant | low | No |
| `analytics:read` | A | merchant | low | No |
| `analytics:export` | A | merchant | low | No |
| `analytics:replay` | B | merchant | high | **Yes** |
| `orders:read` | A | merchant | low | No |
| `orders:write` | A | merchant | medium | No |
| `orders:export` | A | merchant | low | No |
| `orders:refund` | B | merchant | high | **Yes** |
| `orders:notify` | A | merchant | medium | No |
| `users:read` | A | merchant | medium | No |
| `ops:read` | C | developer | high | No |
| `ops:write` | C | developer | critical | **Yes** |

### D.2 Control layers

- **Layer A** — Standard merchant operations. Granted by default to merchant role.
- **Layer B** — Sensitive financial operations (refunds, analytics replay). Require explicit approval workflow.
- **Layer C** — Platform-level operations. Developer role only. Merchant role is blocked even if permission is granted.

### D.3 Default merchant permissions

When `ADMIN_DEFAULT_PERMISSIONS` env var is unset, new admins get:
`products:read/write, categories:read/write, inventory:read/write, coupons:read/write, settings:read/write, reviews:read/moderate, dashboard:read, analytics:read/export, orders:read/write/export/notify, users:read`

**Notably excluded from defaults:** `orders:refund`, `analytics:replay`, `ops:read`, `ops:write`

### D.4 Frontend RBAC integration

```typescript
// JWT payload contains permissions array
const decoded = jwtDecode<{ permissions: string[] }>(accessToken);

// Hide/show UI elements based on permissions
const canRefund = decoded.permissions.includes('orders:refund') || decoded.permissions.includes('*');
const isDeveloper = decoded.permissions.includes('ops:read') || decoded.permissions.includes('developer:*');

// Route guards — redirect to /unauthorized if permission missing
function requirePermission(permission: string) {
  return (req, res, next) => {
    if (!hasPermission(req.user.permissions, permission)) {
      redirect('/admin/unauthorized');
    }
    next();
  };
}
```

---

## APPENDIX E — Webhook Integration Reference

### E.1 Razorpay payment webhook

**Endpoint:** `POST /api/v1/payments/webhook` (registered in orders module)

**Processing order (hardcoded — do not rearrange):**

1. Read raw body as `Buffer` (custom `addContentTypeParser` in `src/main.ts` preserves raw bytes for webhook paths)
2. Compute HMAC-SHA256 of raw body with `RAZORPAY_WEBHOOK_SECRET`
3. Compare against `X-Razorpay-Signature` header → 401 if mismatch
4. Check Redis idempotency key `webhook:razorpay:<event_id>` → 200 if duplicate
5. Enqueue to BullMQ `order-processing` queue (job name `payment-webhook` for all events; handler then enqueues `process-order-update` for `payment.captured` events) → never process inline
6. Return `200 { received: true }` within 200ms

**Razorpay Dashboard configuration:**

```
Webhook URL: https://api.clientdomain.com/api/v1/payments/webhook
Events to subscribe:
  ✅ payment.captured    ← triggers order confirmation + inventory deduction
  ✅ payment.failed      ← marks order as PAYMENT_FAILED
  ✅ refund.processed    ← marks order as REFUNDED
  ☐ payment.authorized  ← received but no-op (status mapper returns null)
  ☐ refund.failed       ← not actively mapped; logged only
Active: Yes
Secret: (same as RAZORPAY_WEBHOOK_SECRET in .env)
```

**Production safety:** `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR` must be set to Razorpay's IP ranges. The system logs a **LOUD WARNING** at startup if this is empty in production.

### E.2 Shipping provider webhook

**Endpoint:** `POST /api/v1/shipping/webhook`

**Same processing order as Razorpay** (token verification → idempotency → BullMQ → 200).

**Provider Dashboard configuration:**

Delhivery:
```
Webhook URL: https://api.clientdomain.com/api/v1/shipping/webhook
Events: All shipment status updates
```

Shiprocket:
```
Webhook URL: https://api.clientdomain.com/api/v1/shipping/webhook
Events: All shipment status updates
Token: <SHIPROCKET_WEBHOOK_TOKEN>
```

**Production safety:** `SHIPPING_WEBHOOK_ALLOWLIST_CIDR` (or fallback `DELHIVERY_WEBHOOK_ALLOWLIST_CIDR`) is mandatory.

### E.3 BullMQ queue registry

| Queue name | Purpose | Retry | DLQ |
|------------|---------|-------|-----|
| `order-processing` | Payment/webhook lifecycle side effects (confirm, invoice, inventory, follow-up jobs) | 3 retries, exponential backoff | Yes |
| `notifications` | Transactional email/SMS/WhatsApp dispatch jobs | 3 retries, exponential backoff | Yes |
| `shipping` | Shipment booking and shipment status update jobs | 3 retries, exponential backoff | Yes |
| `inventory-alerts` | Low-stock scan + alert jobs | 3 retries, exponential backoff | Yes |
| `refunds` | Razorpay refund initiation and reconciliation jobs | 3 retries, exponential backoff | Yes |
| `analytics` | Analytics event recording/replay jobs | 3 retries, exponential backoff | Yes |
| `cart-cleanup` | Scheduled cleanup (guest carts, reservations, idempotency, published outbox, refresh tokens) | 3 retries, exponential backoff | Yes |
| `outbox-dispatch` | Outbox publish and dead-letter replay jobs | 3 retries, exponential backoff | Yes |
| `reconciliation` | Periodic order lifecycle anomaly scan/auto-heal jobs | 3 retries, exponential backoff | Yes |
| `dead-letter` | Holding queue for terminally failed jobs (manual inspection/retry via admin queue UI) | 1 attempt retained | N/A |

**Frontend impact:** Payment confirmation should poll `GET /orders/:id` every 2 seconds (max 30 seconds) after `payments/verify` returns, because the webhook may take 1-5 seconds to process.

---

## APPENDIX F — Environment Variables Reference

> **Canonical source:** `.env.example` in the backend root. This appendix mirrors it.
> All variables below use the `${VAR}` interpolation pattern in `docker-compose.yml` — see §2.2.1 for how that works.

### F.1 Core application

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `NODE_ENV` | Yes | `production` | Must be `production` on VPS. Controls strict-profile validation. |
| `PORT` | No | `3000` | Container-internal port. Default: `3000`. |
| `HOST` | No | `0.0.0.0` | Bind address. Default: `0.0.0.0`. |
| `CLIENT_ID` | Yes | `foodstore` | Used in container names, OTEL service names, and invoice storage references. |
| `BACKEND_PORT` | Yes | `3001` | Host-side port mapping in docker-compose `ports`. |
| `API_PREFIX` | No | `/api/v1` | Route prefix for all API endpoints. Default: `/api/v1`. |
| `LOG_LEVEL` | No | `info` | Pino log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`. |
| `CART_RESERVATION_TTL_MINUTES` | No | `20` | How long a hot-SKU reservation holds stock. Default: `20`. |
| `LOAD_SHED_MODE` | No | `normal` | Load-shed override: `normal`, `reduced`, `emergency`. Redis override takes precedence. Default: `normal`. |
| `ENABLE_VERBOSE_VALIDATION_ERRORS` | No | `false` | Verbose Ajv validation errors (dev only). **Must be `false` in production.** |

### F.2 Infrastructure

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | Yes | `postgresql://user:pass@host.docker.internal:5432/client_db` | Full Prisma connection string. Use `host.docker.internal` when PostgreSQL runs on the host. |
| `REDIS_URL` | Yes | `redis://:password@redis:6379` | Full Redis connection URL. Use `redis` (service name) inside Docker, `localhost` outside. |
| `REDIS_PASSWORD` | **Recommended** | `strong-random-password` | Must match the password segment of `REDIS_URL`. Used by Redis container `--requirepass`. Technically optional (blank disables auth), but blank causes `ECONNRESET` loops due to Redis `protected-mode` — see Appendix H.3. **Always set in all environments.** |
| `REDIS_KEY_PEPPER` | No | `hex-string` | Optional HMAC pepper for Redis key derivation (e.g. guest coupon keys). Defaults to `JWT_SECRET`. |
| `STOREFRONT_URL` | Yes | `https://foodstore.com` | Used for CORS, email links, cookie domain. **Boot fails in production-like profiles if missing** (prevents password-reset emails linking to localhost). |
| `ADMIN_URL` | Yes | `https://foodstore.com` | Used for CORS. Often same as `STOREFRONT_URL` for same-origin deployments. |
| `POSTGRES_USER` | No | `postgres` | PostgreSQL user for Docker Compose service. Default: `postgres`. |
| `POSTGRES_PASSWORD` | No | `postgres` | PostgreSQL password for Docker Compose service. Default: `postgres`. |
| `POSTGRES_DB` | No | `ecom_template` | PostgreSQL database name for Docker Compose service. |
| `POSTGRES_PORT` | No | `5432` | Host-side PostgreSQL port mapping in Docker Compose. Default: `5432`. |
| `REDIS_PORT` | No | `6379` | Host-side Redis port mapping in Docker Compose. Default: `6379`. |

### F.3 Authentication

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `JWT_SECRET` | Yes | `64-char-hex` | Access token signing. **Unique per client.** Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | Yes | `64-char-hex` | Refresh token signing. **Must differ from JWT_SECRET.** Fail-fast at runtime via `resolveRefreshSecret()` — server returns 500 if missing/empty. |
| `TURNSTILE_SECRET_KEY` | No | `0x4AAAAAA...` | Cloudflare Turnstile secret key for CAPTCHA verification. Leave empty to skip challenge verification. |

### F.4 Payment provider

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `PAYMENT_PROVIDER` | No | `razorpay` | Default: `razorpay`. Supported: `razorpay`, `cod`, `noop` (dev only). Unrecognised values are rejected at startup. Use `cod` only for COD-only stores; normally leave as `razorpay` and enable COD via admin settings (`isCodEnabled`). |
| `PAYMENT_PROVIDER_FAILOVER_ENABLED` | No | `false` | Enable failover to secondary provider. Default: `false`. |
| `PAYMENT_CB_FAILURE_THRESHOLD` | No | `5` | Circuit breaker: failures before opening. Default: `5`. |
| `PAYMENT_CB_COOLDOWN_MS` | No | `30000` | Circuit breaker: cooldown before retry. Default: `30000`. |
| `RAZORPAY_KEY_ID` | When `PAYMENT_PROVIDER=razorpay` | `rzp_live_XXXXX` | **Use `rzp_test_*` for dev, `rzp_live_*` for production.** Not required when `PAYMENT_PROVIDER=cod`. |
| `RAZORPAY_KEY_SECRET` | When `PAYMENT_PROVIDER=razorpay` | `secret` | From Razorpay dashboard → API Keys. |
| `RAZORPAY_WEBHOOK_SECRET` | When `PAYMENT_PROVIDER=razorpay` | `webhook-secret` | From Razorpay dashboard → Webhooks. Used for HMAC verification. |
| `RAZORPAY_WEBHOOK_SECRET_OLD` | No | `old-webhook-secret` | Overlap key during secret rotation. System tries both. Remove after rotation. |
| `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR` | **Prod** | `52.66.0.0/16` | Comma-separated CIDRs. **Mandatory in production-like profiles — startup hard-fails if empty.** |
| `RAZORPAY_WEBHOOK_MAX_SKEW_SECONDS` | No | `300` | Reject webhooks with timestamp older than this. Default: `300`. |

### F.5 Shipping provider

> **Dual-provider model:** `SHIPPING_PROVIDER` env var is **ignored** — do not set it. Provider detection is credential-based. If `DELHIVERY_API_KEY` is set, Delhivery is active. If `SHIPROCKET_EMAIL`+`SHIPROCKET_PASSWORD` are set, Shiprocket is active. Both can coexist — the system picks the cheapest rate at checkout. At least one provider must be configured in production.

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `SHIPPING_PROVIDER_FAILOVER_ENABLED` | No | `false` | Enable per-provider failover. Default: `false`. |
| `SHIPPING_CB_FAILURE_THRESHOLD` | No | `5` | Circuit breaker threshold (per provider). Default: `5`. |
| `SHIPPING_CB_COOLDOWN_MS` | No | `30000` | Circuit breaker cooldown (per provider). Default: `30000`. |
| `DELHIVERY_API_KEY` | To activate Delhivery | `api-token` | Presence activates Delhivery. From Delhivery developer portal. |
| `DELHIVERY_BASE_URL` | No | `https://track.delhivery.com` | API base URL. Has sensible default. |
| `DELHIVERY_PICKUP_PINCODE` | No | `522006` | Bootstrap default for shipping rate calc. Admin can override via settings API. |
| `DELHIVERY_WEBHOOK_TOKEN` | **Prod** (when Delhivery active) | `webhook-token` | Token for webhook verification. |
| `DELHIVERY_WEBHOOK_ALLOWLIST_CIDR` | No | `13.234.0.0/16` | Comma-separated CIDRs. |
| `DELHIVERY_WEBHOOK_MAX_SKEW_SECONDS` | No | `300` | Reject webhooks with stale timestamps. Default: `300`. |
| `SHIPROCKET_EMAIL` | To activate Shiprocket | `api-user@domain.com` | Presence (with PASSWORD) activates Shiprocket. Dedicated API user email. |
| `SHIPROCKET_PASSWORD` | To activate Shiprocket | `password` | Shiprocket API user password. |
| `SHIPROCKET_BASE_URL` | No | `https://apiv2.shiprocket.in/v1/external` | API base URL. Has sensible default. |
| `SHIPROCKET_PICKUP_PINCODE` | No | `522006` | Bootstrap default for shipping rate calc. Admin can override via settings API. |
| `SHIPROCKET_WEBHOOK_TOKEN` | **Prod** (when Shiprocket active) | `webhook-token` | Token for webhook verification. |
| `SHIPROCKET_WEBHOOK_ALLOWLIST_CIDR` | No | `—` | Comma-separated CIDRs. |
| `SHIPROCKET_WEBHOOK_MAX_SKEW_SECONDS` | No | `300` | Reject webhooks with stale timestamps. Default: `300`. |
| `SHIPPING_WEBHOOK_ALLOWLIST_CIDR` | No | `—` | Provider-agnostic alias for shipping webhook allowlist. Falls back to `DELHIVERY_WEBHOOK_ALLOWLIST_CIDR` for backward compatibility. |
| `TRUSTED_PROXY_ALLOWLIST_CIDR` | No | `10.0.0.0/8` | CIDRs trusted as reverse proxies (for `X-Forwarded-For`). |

### F.6 Notifications

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `NOTIFY_EMAIL_ENABLED` | No | `true` | Enable email notifications. Default: `true`. |
| `EMAIL_PROVIDER` | No | `resend` | Email provider adapter. Default: `resend`. |
| `RESEND_API_KEY` | **Yes** | `re_XXXXX` | Required at runtime because notification providers are initialized with fail-fast validation. |
| `RESEND_FROM` | Conditional | `Store <noreply@foodstore.com>` | Required when `NOTIFY_EMAIL_ENABLED=true`. RFC 5322 format. |
| `NOTIFY_SMS_ENABLED` | No | `false` | Enable SMS notifications. Default: `false` (opt-in). Set to `true` only after configuring provider credentials via Ops UI. |
| `SMS_PROVIDER` | No | `msg91` | SMS provider adapter. Default: `msg91`. Allowed: `msg91`, `fast2sms`, `noop`. |
| `MSG91_AUTH_KEY` | Conditional | `auth-key` | Required when `SMS_PROVIDER=msg91`. |
| `MSG91_SENDER_ID` | Conditional | `STOREX` | 6-char DLT-registered sender ID. Required when `SMS_PROVIDER=msg91`. |
| `MSG91_ROUTE` | Conditional | `4` | MSG91 route type. Default: `4` (transactional). Required when `SMS_PROVIDER=msg91`. |
| `FAST2SMS_API_KEY` | Conditional | `api-key` | Required when `SMS_PROVIDER=fast2sms`. Fast2SMS Quick SMS and OTP routes are used automatically based on template. |
| `NOTIFY_WHATSAPP_ENABLED` | No | `false` | Enable WhatsApp notifications. Default: `false`. |
| `ADMIN_ALERT_EMAIL` | No | `admin@foodstore.com` | Email for admin-facing alerts (low stock, failed jobs). |

### F.7 Invoice Storage

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `INVOICE_STORAGE_ROOT` | Yes | `/var/www/client/storage/invoices` | Absolute directory path writable by backend/workers. |

### F.7.1 Product image storage (Cloudflare R2 + CDN)

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `MEDIA_STORAGE_PROVIDER` | Yes (prod) | `r2` | `local` for dev; `r2` triggers automatic `PutObject` on each admin upload. |
| `R2_ACCOUNT_ID` | Yes (r2) | Cloudflare account id | From R2 dashboard. |
| `R2_ACCESS_KEY_ID` | Yes (r2) | API token access key | Object Read & Write on bucket. |
| `R2_SECRET_ACCESS_KEY` | Yes (r2) | API token secret | Store in vault only. |
| `R2_BUCKET_NAME` | Yes (r2) | `client-product-images` | Bucket for product media. |
| `R2_PUBLIC_BASE_URL` | Yes (r2) | `https://cdn.shop.example.com` | Custom domain on bucket (recommended). |
| `MEDIA_STORAGE_ROOT` | Local only | `/var/www/client/storage/media` | Used when `MEDIA_STORAGE_PROVIDER=local`. |
| `PUBLIC_STORE_URL` | No | `https://shop.example.com` | Fallback URL builder for local provider. |

**Limits:** 5 MiB per file; MIME validated by magic bytes (JPEG, PNG, WebP, GIF). Max 30 images per product.

**Cloudflare:** Create R2 bucket, bind public hostname, set cache rules on `R2_PUBLIC_BASE_URL`. Objects uploaded with `Cache-Control: public, max-age=31536000, immutable`.

### F.8 GST / Seller identity

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `STORE_LEGAL_NAME` | Conditional | `FoodStore Pvt Ltd` | Required when `FEATURE_GST_INVOICING_ENABLED=true`. |
| `STORE_SELLER_ADDRESS` | Conditional | `123 Main Road, Hyderabad` | Required when `FEATURE_GST_INVOICING_ENABLED=true`. |
| `STORE_SELLER_STATE` | Conditional | `Telangana` | Required when `FEATURE_GST_INVOICING_ENABLED=true`. |
| `STORE_SELLER_GSTIN` | Conditional | `36ABCDE1234F1Z5` | Required when `FEATURE_GST_INVOICING_ENABLED=true`. |
| `STORE_SELLER_FSSAI` | No | `12345678901234` | FSSAI license number (food businesses only). |
| `STORE_REQUIRES_FSSAI` | No | `false` | Set to `food` or `true` to require FSSAI license in invoice. Default: `false`. |
| `STORE_BUSINESS_TYPE` | No | `general` | Business type tag (used alongside `STORE_REQUIRES_FSSAI`). Default: `general`. |

### F.9 Feature flags

| Variable | Default | Purpose |
|----------|---------|---------|
| `FEATURE_COUPONS_ENABLED` | `false` | Enable coupon/discount code system |
| `FEATURE_REVIEWS_ENABLED` | `false` | Enable product review module |
| `FEATURE_WISHLIST_ENABLED` | `false` | Enable customer wishlist |
| `FEATURE_GST_INVOICING_ENABLED` | `true` | Enable GST invoice PDF generation. Requires F.8 seller vars. |
| `FEATURE_RESPONSE_ENVELOPE_ENABLED` | `false` | Wraps all 2xx JSON responses in `{ success, data, meta? }`. Enable when frontend expects envelope format. |

### F.10 Security / IAM

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `REPLAY_APPROVAL_TOKEN` | **Prod** | `random-token` | Required in production profile for secure replay approval flows. |
| `REPLAY_AUDIT_RETENTION_DAYS` | No | `90` | Replay audit trail retention in days. NDJSON entries older than this are pruned. Default: `90`. |
| `OPS_MFA_ENFORCE` | No | `true` | Require MFA for ops control plane access. Default: `true`. |
| `OPS_METRICS_ALLOWLIST` | No | `10.0.0.1,10.0.0.2` | IP allowlist for `/metrics` endpoint. |
| `OPS_METRICS_TOKEN` | **Prod** | `metrics-bearer-token` | Bearer token protecting metrics scrape endpoint. |
| `ADMIN_DEFAULT_PERMISSIONS` | No | *(empty)* | Override default admin permissions (comma-separated). See `src/common/auth/admin-permissions.ts`. When unset, new admins get the built-in default set. |
| `ADMIN_SCOPE_ENFORCEMENT` | No | `true` | Enable admin permission scope enforcement. Default: `true`. |
| `ALLOW_ADMIN_SCOPE_BYPASS` | No | `false` | Allow admin scope bypass (dev only). Set to `true` + `ADMIN_SCOPE_ENFORCEMENT=false` in dev to skip permission enforcement. Default: `false`. |
| `AUDIT_ANCHOR_SECRET` | No | `random-secret` | HMAC secret for tamper-evident audit log chain. |

### F.11 Checkout risk

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `RISK_VELOCITY_ENABLED` | No | `false` | Enable Redis-based velocity checks on payment initiation. Default: `false`. |
| `RISK_PAYMENT_INIT_MAX_PER_HOUR` | No | `30` | Max payment initiations per user per hour. Default: `30`. |

### F.12 Health / Observability

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `HEALTH_QUEUE_STALE_WAITING_SECONDS` | No | `300` | Flag queues as unhealthy if oldest waiting job exceeds this. Default: `300`. |
| `OTEL_TRACING_ENABLED` | No | `false` | Enable OpenTelemetry distributed tracing. Default: `false`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Conditional | `http://localhost:4318/v1/traces` | Required when `OTEL_TRACING_ENABLED=true`. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | No | | Optional override for traces-only endpoint. Takes precedence over base endpoint. |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | `Authorization=Basic <b64>` | Comma-separated key=value headers for authenticated collectors (Grafana Cloud, Honeycomb, Datadog, etc). |
| `OTEL_SERVICE_NAME` | No | `foodstore-backend` | Auto-derived from `CLIENT_ID` in docker-compose.yml. |

### F.13 Flash-sale / Hot-SKU admission control

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `HOT_SKU_VARIANT_IDS` | No | *(empty)* | Comma-separated variant UUIDs that trigger admission control. Leave empty to disable. |
| `HOT_SKU_ADMISSION_BUDGET_PER_MINUTE` | No | `120` | Per-minute admission budget per shard. Total budget = this × `HOT_SKU_SHARD_COUNT`. Default: `120`. |
| `HOT_SKU_USER_RESERVE_CAP` | No | `2` | Max units a single user can reserve across all hot SKUs. Default: `2`. |
| `HOT_SKU_COOLDOWN_SECONDS` | No | `15` | Cooldown seconds between successive hot-SKU reservations per user. Default: `15`. |
| `HOT_SKU_SHARD_COUNT` | No | `8` | Number of Redis shards for admission budget keys. Guideline: 4 for <500 concurrent users, 8 for 500–2k, 16 for 2k+. Default: `8`. |

### F.14 Idempotency

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `IDEMPOTENCY_SCOPE_SECRET` | No | *(empty)* | HMAC secret for idempotency scope derivation. Falls back to `JWT_SECRET` if unset. |

---

## Appendix G — Dependency Management, CI Security Scans & Dependabot

### G.0 CI security scan workflows

Two GitHub Actions workflows run on every push to `main`/`master` and on PRs:

| Workflow | File | Jobs |
|----------|------|------|
| **Reliability CI** | `.github/workflows/ci.yml` | Typecheck, unit tests (coverage), e2e, security tests, guardrails, build, Prisma validate/generate, edge drift, release policy/guard, parity scorecard |
| **Security Scans** | `.github/workflows/security.yml` | CodeQL, npm audit (`--omit=dev`, critical/high blocks), OSV Scanner (`osv-scanner.toml` config), Container Scan (Trivy) |

**Key design decisions:**

- **npm audit uses `--omit=dev`** — devDependencies are stripped from the production Docker image (`npm prune --omit=dev` in Dockerfile), so dev-only vulnerabilities don't block CI.
- **OSV Scanner respects `osv-scanner.toml`** — the config file at repo root ignores dev-group package vulnerabilities for the same reason. To suppress a specific known advisory, add an `[[IgnoredVulns]]` entry with the advisory ID and a reason.
- **npm audit JSON parsing** is compatible with npm v10+ (Node 22) — uses `jq` with `tonumber` and fallback for the changed JSON structure.
- **Trivy scans the built Docker image** for OS and library vulnerabilities at `CRITICAL,HIGH` severity.

### G.1 Version pinning strategy

This template pins **exact dependency versions** in `package.json`. When you clone and run `npm install` for a client, you get the exact versions the template was built and tested against. **Everything works out of the box.**

### G.2 Dependabot

GitHub Dependabot automatically monitors dependencies and opens Pull Requests when newer versions are released. After pushing this template (or a client fork) to GitHub, Dependabot PRs will appear. **This is normal and expected.**

### G.3 Why Dependabot PRs fail CI

Dependabot often proposes **major version bumps** (e.g., Prisma 5 → 7, TypeScript 5 → 6). Major versions contain **breaking API changes** that require code modifications. Your CI (Reliability CI + Security Scans) correctly rejects these PRs. **Red CI on Dependabot PRs does not mean the template is broken** — it means the upgrade is incompatible and your CI protected you.

### G.4 Handling Dependabot PRs

| PR Type | Example | Action |
|---------|---------|--------|
| **GitHub Actions bumps** | `actions/checkout 4 → 6` | ✅ Merge if CI passes — infrastructure only |
| **Minor/patch npm bumps** | `fastify 5.1.0 → 5.2.3` | ✅ Merge if CI passes — backward-compatible |
| **Major npm bumps** | `prisma 5 → 7`, `typescript 5 → 6` | ⚠️ Close — do manually on a feature branch |

### G.5 Suppressing noisy PRs

The `.github/dependabot.yml` includes `ignore` rules for major versions of core dependencies (Prisma, TypeScript, ESLint, Fastify, `@types/node`, dotenv). This prevents Dependabot from creating PRs that will always fail CI, and eliminates email notification spam.

To add more ignore rules:

```yaml
# .github/dependabot.yml — add under the npm ecosystem's ignore list
- dependency-name: "<package-name>"
  update-types: ["version-update:semver-major"]
```

### G.6 Manual major upgrades

When you decide to upgrade a core dependency:

1. Create a dedicated feature branch: `git checkout -b chore/upgrade-prisma-7 main`
2. Update `package.json` and run `npm install`
3. Follow the library's official migration guide
4. Fix all compilation and test failures
5. Run `npm run ci:reliability-gates` — all gates must pass
6. Merge to `main` via PR

**Never upgrade multiple major dependencies at once** — do them one at a time so failures are isolated.

---

## Appendix H: Common Setup Troubleshooting

### H.1 Prisma connects to `ecom_template` instead of client DB

**Symptom:** When running `npx prisma migrate dev`, the output says:
`Datasource "db": PostgreSQL database "ecom_template", schema "public" at "localhost:5432"`

**Cause:** You ran `docker compose up -d postgres redis` *before* configuring your `.env` file with the client's `POSTGRES_DB` name. Docker fell back to the default `ecom_template` and initialized the database volume with that name.

**Solution:**
1. Ensure `.env` has `POSTGRES_DB=your_client_name` and `DATABASE_URL` matches it.
2. Wipe the old database volume and recreate it:
   ```bash
   docker compose down -v
   docker compose up -d postgres redis
   ```

### H.2 `Cannot find module ... wasm-base64.js` after migration

**Symptom:** After a successful `npx prisma migrate dev`, you see an error:
`Cannot find module '...\@prisma\client\runtime\query_engine_bg.postgresql.wasm-base64.js'`

**Cause:** This is a known glitch on Windows environments or when Node versions switch, causing `node_modules/@prisma/client` to fall slightly out of sync. If the output above the error says "Your database is now in sync with your schema", the migration **succeeded**.

**Solution:**
Regenerate the Prisma client files:
```bash
npx prisma generate
```
If the error persists during runtime, wipe and reinstall modules:
```bash
rm -rf node_modules
npm install
```

### H.3 Infinite `ECONNRESET` loop on `npm run dev`

**Symptom:** When running `npm run dev`, the console is flooded with `Error: read ECONNRESET` originating from `TCP.onStreamRead`.

**Cause:** You set `REDIS_PASSWORD=` (blank) in your `.env` file. This starts the Redis Docker container without a password. However, Redis runs with `--protected-mode yes` by default. When you connect from the host (Node.js) into Docker, Redis sees an "external" IP connecting without a password, and instantly drops the connection for security. `ioredis` (via BullMQ) auto-reconnects, creating an infinite loop.

**Solution:**
Always run local Redis with a password to bypass protected mode:
1. In your `.env`, set:
   ```env
   REDIS_URL=redis://:localpassword@localhost:6379
   REDIS_PASSWORD=localpassword
   ```
2. Wipe the old password-less Redis container and recreate it:
   ```bash
   docker compose down -v
   docker compose up -d postgres redis
   ```

### H.4 Prisma P1000 Authentication Failed (PostgreSQL password mismatch)

**Symptom:** When running `npx prisma migrate status` or `npm run dev:e2e`, you see:
```
Error: P1000: Authentication failed against database server, the provided database credentials for `postgres` are not valid.
```

**Cause:** The Postgres container was initialized with a different password than what's currently in your `.env`. This commonly happens when:
1. You started the container once with default password `postgres`
2. Then changed `POSTGRES_PASSWORD` in `.env` to a custom value like `Umesh@05`
3. The existing volume `pg-data` retains the OLD password hash
4. Prisma tries to connect with the NEW password from `DATABASE_URL` and fails

**Solution (Non-destructive - Recommended):**
Update the database user password to match your current `.env`:

```bash
# Update postgres user password inside container to match your .env
docker exec ecom-postgres psql -U postgres -d ecom_template -c "ALTER USER postgres WITH PASSWORD 'YourNewPassword';"
```

Then verify:
```bash
npx prisma migrate status --schema prisma/schema.prisma
```

**Solution (Destructive - Nuclear option):**
If you don't have data to preserve, wipe and recreate:
```bash
docker compose down -v
docker compose up -d postgres redis
# Then re-run migrations
npx prisma migrate dev
```

**Prevention - The No-Confusion Workflow:**
1. **Before first container start**, decide your password and set it in `.env`:
   ```env
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=Umesh@05
   POSTGRES_DB=ecom_template
   POSTGRES_PORT=5432
   DATABASE_URL=postgresql://postgres:Umesh%4005@localhost:5432/ecom_template
   ```
   > Note: URL-encode special chars in password (`@` → `%40`)

2. **Check container env before connecting:**
   ```bash
   docker exec ecom-postgres printenv POSTGRES_USER
   docker exec ecom-postgres printenv POSTGRES_DB
   ```

3. **Verify from host:**
   ```bash
   npx prisma migrate status --schema prisma/schema.prisma
   ```

### H.5 DATABASE_URL Not Set (seed scripts fail)

**Symptom:** Running `node scripts/seed-flash-sale-fixtures.js` shows:
```
❌ DATABASE_URL is not set. Cannot seed fixtures.
```

**Cause:** The script runs in a subprocess that doesn't inherit your shell's exported env vars, or `.env` isn't loaded.

**Solution:**
The script now auto-loads from `.env` (updated in template), but if you need manual export:
```bash
# Windows CMD
set DATABASE_URL=postgresql://postgres:Umesh%%4005@localhost:5432/ecom_template

# Windows PowerShell
$env:DATABASE_URL="postgresql://postgres:Umesh%4005@localhost:5432/ecom_template"

# Linux/macOS
export DATABASE_URL="postgresql://postgres:Umesh%4005@localhost:5432/ecom_template"
```

**Verification:**
```bash
docker exec ecom-postgres psql -U postgres -d ecom_template -c "SELECT 1;"
# Should return: 1
```

---

*End of Master Deployment Playbook — this document is the single source of truth for building and deploying client e-commerce projects.*

---

### Phase 7 incident companion (May 2026)

For real-world failure signatures and copy/paste remediations observed during live VPS deploy (Prisma version drift, host-vs-container DB routing, compose postgres port collision, bootstrap vs runtime config readiness, restart-loop triage), see:

- `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md`

> **New to onboarding a client?** The sequenced, phase-by-phase execution order — intake → third-party accounts → VPS baseline → backend clone/configure → staging dry-runs → frontend build → VPS deploy → ops bootstrap → admin provisioning → frontend deploy → webhook registration → go-live validation → DNS cutover → post-handoff — is consolidated in **[`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](CLIENT_ONBOARDING_EXECUTION_ORDER.md)**. Use that runbook as the top-level execution checklist; it references this playbook and all other canonical docs for detail.

