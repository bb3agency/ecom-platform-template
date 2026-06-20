# Client Onboarding Execution Order

> **This is the master sequencing runbook.** It defines the exact ordered steps to take a new client from "nothing" to a live, production-validated e-commerce deployment on the shared VPS. Every step references the authoritative document that governs it. Read those references — do not guess.
>
> **Canonical source of truth:** `ECOM_MASTER.md`  
> **Business acceptance gates:** `BRD.md` §12 (AC-01–AC-15)  
> **Full deployment detail:** `docs/MASTER_DEPLOYMENT_PLAYBOOK.md`  
> **Conflict resolution:** `ECOM_MASTER.md` wins over all other documents.
>
> **Lifecycle:** This is a **Client-Main runbook**. For post-development usage precedence and related client-facing references, start from `docs/CLIENT_HANDOFF_INDEX.md`.

---

## Core delivery model

> **Dev-first. VPS only after everything passes locally.**

The non-negotiable sequence is:

1. **All local development and testing is done first** — backend configured, frontend fully built and integrated, all providers dry-run tested, full local E2E passes with no gaps or leaks.
2. **Only then** is the VPS touched for the first time for this client.
3. VPS deployment is a mechanical promotion of already-validated work, not a debugging environment.

This means: **do not provision VPS directories, do not run `docker compose up` on the VPS, do not configure Nginx, do not obtain TLS certs — until Phase 6.** Everything before Phase 6 happens entirely on your dev laptop against a local Docker environment.

---

## How to use this runbook

Work through each phase top-to-bottom. Each phase contains:

- **What you are doing** — purpose of the phase.
- **Prerequisites** — what must be true before you start.
- **Execution steps** — exact actions to take.
- **Evidence gate** — what proof confirms the phase is complete before you proceed.

Do **not** skip phases. Do **not** proceed past a phase without clearing its evidence gate. Skipping a phase and trying to fix problems in a later phase costs significantly more time than doing it in order.

### Development and deployment trackers (recommended)

Use these three tracker files when you need explicit phase-by-phase progress and handoff visibility.

| Log file | Template | Create at | Close at |
|---|---|---|---|
| `client-<id>/CLIENT_DEV_LOG.md` | `docs/CLIENT_DEV_LOG_TEMPLATE.md` | Phase 0 start | Phase 5 cleared |
| `client-<id>/frontend/docs/FRONTEND_DEV_LOG.md` | `docs/FRONTEND_DEV_LOG_TEMPLATE.md` | Phase 4 start | Phase 5 cleared |
| `client-<id>/CLIENT_VPS_DEPLOYMENT_LOG.md` | `docs/CLIENT_VPS_DEPLOYMENT_LOG_TEMPLATE.md` | Phase 6 start (only after Phase 5 cleared) | Phase 14 cleared |

- `CLIENT_DEV_LOG.md` tracks backend config, provider dry-runs, and frontend milestone progress for Phases 0–5.
- `FRONTEND_DEV_LOG.md` tracks slice-level progress for Phase 4.
- `CLIENT_VPS_DEPLOYMENT_LOG.md` tracks VPS execution progress for Phases 6–14.

---

## Phase 0 — Client intake and scoping

**What you are doing:** Define the client's exact requirements so every downstream decision is made correctly from the start.

**Prerequisites:** Nothing — this is the first step.

**Execution steps:**

1. Confirm the client's **domain name(s)**: storefront domain (e.g. `client1.com`) and whether admin is a sub-path or subdomain.
2. Confirm **payment provider**: Razorpay (default) or COD-only. If Razorpay, confirm whether live keys are ready or test keys only (staging vs production).
3. Confirm **shipping provider(s)**: Delhivery and/or Shiprocket — both can be active simultaneously (cheapest rate wins at checkout). Obtain credentials for each provider the client wants active. No env var selection needed; presence of credentials activates the provider.
4. Confirm **notification channels**: email (`RESEND_API_KEY`), SMS provider (`SMS_PROVIDER`: `msg91` or `fast2sms`), WhatsApp (`META_WHATSAPP_ACCESS_TOKEN`). If MSG91, confirm DLT registration status.
5. Confirm **VPS slot availability**: which backend port (`3000+N`) and storefront port (`3100+N`) will be assigned. See `docs/CLIENT_VPS_SETUP_GUIDE.md` §3 (Port assignment).
6. Confirm **`CLIENT_ID`** slug (e.g. `foodstore`, `fashionhub`) — must be unique across all clients on this VPS.
7. Confirm **feature flags**: which optional modules the client needs active at launch. Record each flag and its value:
   - `FEATURE_COUPONS_ENABLED` — enable only when the client plans to run promo/discount campaigns. When enabled, the full coupon admin (create/edit/pause/soft-delete/restore/audit) is available and counts against per-admin rate limits.
   - `FEATURE_REVIEWS_ENABLED` — enable when the storefront review module is active.
   - `FEATURE_WISHLIST_ENABLED` — enable for higher-intent repeat-browse categories.
   - `FEATURE_GST_INVOICING_ENABLED` — always `true` for Indian clients.
8. Record all of the above in a scoping note before touching any code or config.

7. **Create `CLIENT_DEV_LOG.md`** for this client:
   ```
   cp docs/CLIENT_DEV_LOG_TEMPLATE.md client-<client-id>/CLIENT_DEV_LOG.md
   ```
   Fill in the Project Identity section immediately with the values confirmed above.

**Evidence gate:** Scoping note exists with domain, providers, ports, and `CLIENT_ID` confirmed. `CLIENT_DEV_LOG.md` created and Project Identity section filled.

---

## Phase 1 — Third-party account setup

**What you are doing:** Create and configure all external provider accounts so credentials are ready before any backend config or frontend build begins. Credentials obtained late are the single most common cause of blocked vertical slices.

**Prerequisites:** Phase 0 complete.

**Full runbook:** `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`  
**Credential register template:** `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`

**Execution steps:**

1. **Razorpay** (if payment provider is `razorpay`):
   - Create a Razorpay business account or use the client's existing account.
   - Obtain `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (test keys for staging, live keys for production).
   - Create a webhook endpoint (URL: `https://<domain>/api/v1/payments/webhook`) and note `RAZORPAY_WEBHOOK_SECRET`.
   - Note the Razorpay egress IPs for `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR`.
   - Reference: `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` §2 (Razorpay).

2. **Shipping provider** (Delhivery or Shiprocket):
   - **Delhivery:** Obtain `DELHIVERY_API_KEY` from the Delhivery partner portal. Note `DELHIVERY_BASE_URL` (sandbox vs production). Create a webhook endpoint (`https://<domain>/api/v1/shipping/webhook`).
   - **Shiprocket:** Obtain `SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD`. Create a webhook endpoint. Note egress IPs for `SHIPROCKET_WEBHOOK_ALLOWLIST_CIDR`.
   - Reference: `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` §3 (Shipping).

3. **SMS provider** (MSG91 or Fast2SMS):
   - **If MSG91:** Obtain `MSG91_AUTH_KEY` from MSG91 dashboard. Register DLT-approved SMS templates; note template IDs.
   - **If Fast2SMS:** Obtain `FAST2SMS_API_KEY` from Fast2SMS dashboard.
   - Reference: `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` §4 (MSG91) or §2.5 (Fast2SMS).

4. **Resend** (transactional email):
   - Create a Resend account, add and verify the sending domain (`RESEND_FROM_EMAIL` domain).
   - Obtain `RESEND_API_KEY`.
   - Reference: `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` §5 (Resend).

5. **File all credentials** in the per-client credential register (`docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`):
   - Owner, vault path, creation date, rotation date, expiry date, last tested date.
   - Store secrets in a password manager or secrets vault — **never** in git.

6. **Ops config contract policy confirmation** (mandatory before frontend ops slice):
   - Confirm `OPS_DB_ENCRYPTION_KEY` is planned in runtime env.
   - Confirm developer ops UI/API scope is contract-driven by `src/modules/ops/ops-config-contract.ts`.
   - Confirm contract-listed infra/security keys are intentionally editable only through ops auth + OTP + encrypted persistence flow.

**Evidence gate:**
- All required provider accounts exist with test/live credentials in hand.
- Credential register is filled in for all active providers.
- No credential is only stored in chat, email, or a note file — all are in the vault.

### Invoice delivery contract (cross-phase requirement)

Before Phase 5 sign-off and again during Phase 12 go-live validation, verify:
- Customer invoice route: `GET /api/v1/orders/:id/invoice.pdf` (owner-only auth).
- Admin invoice route: `GET /api/v1/admin/orders/:id/invoice.pdf` (`orders:read`).
- Order payload behavior uses `invoice.hasPdf` only (no direct/public/signed invoice URLs).

---

## Phase 2 — Backend clone, configure, and local validation

**What you are doing:** Clone the backend template for this client, fill in all environment variables, and verify it builds and passes local checks. Everything here runs on your dev laptop — no VPS involvement yet.

**Prerequisites:** Phase 1 complete (credentials ready). Phase 0 complete (CLIENT_ID, ports, domain confirmed).

**Full runbook:** `docs/MASTER_DEPLOYMENT_PLAYBOOK.md` Phase 2 (Clone & configure backend).  
**Environment reference:** `.env.example` (bootstrap/infra + minimal wiring only). For the authoritative env vs DB configuration map (what belongs in `.env` vs Ops DB overlay), read `docs/ENV_VS_DB_CONFIG_REFERENCE.md`.

**Execution steps:**

1. **Clone the template** into the client project folder on your dev laptop:
   ```bash
   git clone https://github.com/your-org/ecom-backend-template client-<client-id>/backend
   cd client-<client-id>/backend
   ```

2. **Copy `.env.example` to `.env`** and fill **bootstrap/infra keys only**:
   ```bash
   cp .env.example .env
   ```

   > **Two-tier config model:** `.env` is for bootstrap/infra keys only. Provider credentials, webhook tokens, and ops-security parameters are **DB-overlay keys** — stored encrypted in `OpsConfigSecret` and set via the Ops UI after Phase 8 bootstrap. See `docs/ENV_VS_DB_CONFIG_REFERENCE.md` for the full classification.
   >
   > **First-deploy exception:** `RESEND_API_KEY` and `RESEND_FROM` must be set as live values for the first ops invite email (`ops-newuser.mjs`). After first ops login, manage via Ops UI. See `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`.

   **Bootstrap keys to set in `.env`** (non-exhaustive — read all comments in `.env.example`):
   - `CLIENT_ID=<client-id>`
   - `BACKEND_PORT=<assigned port>`
   - `NODE_ENV=production` (for production; `staging` for staging)
   - `DATABASE_URL=postgresql://<user>:<pass>@host.docker.internal:5432/<client-db>`
   - `REDIS_URL=redis://:<redis-password>@redis:6379`
   - `REDIS_PASSWORD=<generated secret>`
   - `JWT_SECRET=<generated secret>` — unique per client
   - `JWT_REFRESH_SECRET=<generated secret>` — unique per client, different from `JWT_SECRET`
   - `OPS_DB_ENCRYPTION_KEY=<32-char-hex>` — unique per client; never reused; bootstrap-only
   - `OPS_COOKIE_SECRET=<32-char-hex>` — signs ops session cookies; bootstrap-only
   - `STOREFRONT_URL=https://<domain>`
   - `ADMIN_URL=https://<domain>/admin` (or subdomain)
   - `ADMIN_ALERT_EMAIL=<ops email>` — fallback alert delivery
   - `TURNSTILE_SECRET_KEY`, `AUDIT_ANCHOR_SECRET`, `IDEMPOTENCY_SCOPE_SECRET`, `REDIS_KEY_PEPPER`
   - `RESEND_API_KEY`, `RESEND_FROM` — **Phase 1 only**, needed for `ops-newuser.mjs` invite email
   - Feature flags per Phase 0 scoping

   **DB-overlay keys — do NOT put these in `.env` for production.** Set them via Ops UI after Phase 8:
   - Provider credentials: `PAYMENT_PROVIDER`, `RAZORPAY_*`, `DELHIVERY_*`, `SHIPROCKET_*` (set whichever shipping provider credentials apply — both can coexist)
   - Notification credentials: `MSG91_AUTH_KEY`, `FAST2SMS_API_KEY`, `META_WHATSAPP_*`, `SMS_PROVIDER` (and `RESEND_*` after Phase 1 rotation)
   - Webhook tokens and allowlists: `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR`, `DELHIVERY_WEBHOOK_TOKEN`, `SHIPROCKET_WEBHOOK_TOKEN`
   - Ops security: `OPS_METRICS_TOKEN`, `REPLAY_APPROVAL_TOKEN`, `TRUSTED_PROXY_ALLOWLIST_CIDR`

   In **local dev** (`NODE_ENV=development`) you may temporarily set provider keys in `.env` to test before ops bootstrap. Remove them before VPS production deployment.

3. **CRITICAL: Set PostgreSQL password BEFORE first container start:**
   > The Postgres Docker volume persists the password hash from first initialization. If you change `POSTGRES_PASSWORD` later without updating the DB user, you'll get P1000 authentication errors.
   
   ```env
   # .env — set ONCE before docker compose up
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=YourStrongPassword
   POSTGRES_DB=ecom_template
   DATABASE_URL=postgresql://postgres:YourStrongPassword@localhost:5432/ecom_template
   ```
   > URL-encode special characters: `@` → `%40`, `#` → `%23`
   
   **Verification after `docker compose up -d postgres`:**
   ```bash
   # Check container env matches
   docker exec ecom-postgres printenv POSTGRES_USER
   docker exec ecom-postgres printenv POSTGRES_DB
   
   # Test Prisma connection
   npx prisma migrate status --schema prisma/schema.prisma
   ```
   
   **If P1000 error appears:** Password mismatch between `.env` and container volume. Fix without wiping:
   ```bash
   docker exec ecom-postgres psql -U postgres -d ecom_template -c "ALTER USER postgres WITH PASSWORD 'YourNewPassword';"
   ```
   
   See `docs/MASTER_DEPLOYMENT_PLAYBOOK.md` Appendix H.4 for full troubleshooting.

4. **Generate all random secrets** using a cryptographically secure method:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   Run once per secret. Never reuse across clients.

5. **Install dependencies and build:**
   ```bash
   npm ci
   npm run build
   ```

6. **Run local validation scripts:**
   ```bash
   npm run validate:env
   npm run validate:schema
   npm run lint
   npm run type-check
   ```

7. **Run the Postman E2E simulation** to verify the full order lifecycle locally:
   ```bash
   # Terminal 1 — server
   npm run dev:e2e
   # Terminal 2 — workers
   npm run dev:e2e:workers
   ```
   Then run the Postman collection (`docs/postman/E2E-Flow-Simulation.postman_collection.json`) with folders 0→1→2→3.  
   Reference: `README.md` §E2E Simulation.

   > This is **not optional**. The E2E simulation is the baseline proof that the backend wiring is correct before you build any frontend against it.

**Evidence gate:**
- `npm run build` passes with no errors.
- All local validation scripts pass.
- No placeholder secrets remain in `.env`.
- Postman E2E simulation completes folders 0→1→2→3 with all steps passing.

---

## Phase 3 — Third-party staging dry-runs

**What you are doing:** Validate every provider credential against its sandbox/test environment before deploying to production. This is mandatory — a misconfigured provider will silently fail in production and is very hard to debug under live traffic pressure. All dry-runs happen **locally on your dev laptop**, not on the VPS.

**Prerequisites:** Phase 2 complete (backend running locally). Phase 1 complete (credentials in `.env`).

**Full runbook:** `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` §0.1 (Integration timing) and per-provider sections.

**Execution steps:**

Perform each dry-run as part of the vertical slice that builds the relevant frontend feature (Phase 4). Do not batch all dry-runs at the end — each one is part of that slice's integration evidence.

1. **Razorpay test payment cycle:**
   - Start local backend with `PAYMENT_PROVIDER=razorpay` and Razorpay **test** keys.
   - Place a test order from the local storefront, initiate payment, complete with Razorpay test card.
   - Verify `PAYMENT_CAPTURED` event hits `/api/v1/payments/webhook` locally.
   - Confirm order transitions to `CONFIRMED`.
   - Record evidence in credential register.

2. **Shipping provider dry-run (per active provider):**
   - Start local backend with the target shipping provider credentials set. The system auto-detects which providers are active based on credentials.
   - Trigger `POST /api/v1/admin/orders/:id/ship` for a confirmed test order. The backend will use whichever provider's credentials are configured (cheapest rate if dual active).
   - Confirm AWB is created and tracking state is correct.
   - Send a test shipping webhook to the local backend and verify order state transitions.
   - Record evidence in credential register.

3. **Email (Resend) dry-run:**
   - Trigger an order confirmation for a test order locally.
   - Confirm confirmation email arrives at a test inbox.
   - Record evidence in credential register.

4. **SMS dry-run:**
   - Trigger a notification locally with the active SMS provider (`SMS_PROVIDER`).
   - Confirm delivery to a test phone number.
   - Record evidence in credential register.

**Evidence gate:**
 - Every enabled provider has one successful local dry-run with evidence recorded.

---

## Phase 4 — Frontend build (contract-first vertical slices)

**What you are doing:** Build the complete frontend against the local backend using contract-first slices.

**Prerequisites:** Phase 2 and Phase 3 complete.

**Canonical implementation details:**
- `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`
- `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`
- `CO_DEVELOPMENT_SYNC_GUIDE.md` (for template-worthy backend upstreams) + `docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md` (versioned core + changelog propagation + design isolation across client sites)

**Execution steps (condensed):**
1. Create frontend repo and sync rules (`frontend-agent-rules.md` -> `.agents/rules/dev-rules.md`).
2. Configure `.env.local` with local backend base URL (`NEXT_PUBLIC_API_BASE_URL` including `/api/v1`).
3. Build slices in strict order: Foundation -> Ops -> Admin read -> Admin mutation -> Reliability -> Storefront.
4. For each slice: lock contract -> typed client -> UI states -> real backend integration -> provider dry-run -> checklist ticks.
5. Upstream reusable backend fixes via `CO_DEVELOPMENT_SYNC_GUIDE.md`; keep client-specific backend changes local.

**Evidence gate:**
- All contracted frontend pages and admin views are built and integrated against the **local** backend (not mocked, not deferred).
- `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` is fully ticked.
- All API calls use `NEXT_PUBLIC_API_BASE_URL` — no hardcoded URLs.
- No `noop` provider behavior relied upon for any production-bound feature.

---

## Phase 5 — Full local integration testing (mandatory gate before any VPS work)

**What you are doing:** Run a complete end-to-end test of the entire client site — backend + frontend + all providers — on your local dev environment. This phase is the **mandatory quality gate**. Nothing goes to the VPS until this phase is fully passed. This is where you find gaps, leaks, edge cases, and integration failures — not on the VPS under time pressure.

**Prerequisites:** Phase 2 complete (backend built and E2E baseline passes). Phase 3 complete (all provider dry-runs pass). Phase 4 complete (all frontend slices built and integrated locally).

**Full runbook:** `docs/BACKEND_GO_LIVE_CHECKLIST.md`, `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`, `README.md` §E2E Simulation.

**Execution steps:**

1. **Start the full local stack** with real provider credentials (not noop):
   ```bash
   # Terminal 1 — server
   npm run dev:e2e
   # Terminal 2 — workers
   npm run dev:e2e:workers
   ```

2. **Run the Postman E2E collection end-to-end** (`docs/postman/E2E-Flow-Simulation.postman_collection.json`) folders 0→1→2→3. All steps must pass — no warnings treated as acceptable for go-live.

3. **Manually walk every user-facing flow in the browser** against `http://localhost:<STOREFRONT_PORT>`:
   - Guest: catalog browse → product detail → add to cart → checkout (prepaid Razorpay test payment) → order confirmation page → confirmation email received.
   - Guest: same flow with COD if enabled for this client.
   - Registered user: login → order history → order detail.
   - Admin: login → order list → view order → ship action → AWB returned → shipping webhook received → order status updated → mark delivered.
   - Admin: initiate refund → confirm refund is queued → refund worker processes → order status reflects refund.
   - Ops: ops API responds 200 from local test, ops audit log entries are chained correctly.

4. **Check for no gaps or leaks:**
   - No API call returns unexpected 404, 500, or schema mismatch.
   - No browser console errors that indicate broken API integration.
   - No hardcoded data visible in the UI (all content comes from backend).
   - No `PAYMENT_PROVIDER=noop` active. For shipping: at least one provider's credentials set (Delhivery or Shiprocket).
   - Auth guard works: unauthenticated requests to protected routes return 401, not 200 with empty data.
   - Admin permission guard works: user without permission cannot access admin routes.
   - CORS is correct: no CORS errors in browser dev tools.

5. **Run all backend validation scripts one final time:**
   ```bash
   npm run validate:env
   npm run validate:schema
   npm run lint
   npm run type-check
   npm run test
   ```
   
6. **Verify race-condition hardening:**
   - Confirm CAS-hardened services pass targeted tests:
     ```bash
     npx vitest run ops.service.test.ts auth.service.mfa-refresh.test.ts admin-invites.service.test.ts reconciliation.worker.test.ts idempotency.test.ts idempotency.security.test.ts
     ```
   - All tests pass confirming atomic operations and TOCTOU prevention are active.

7. **Verify `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`** is fully ticked from Phase 4. Any unticked item must be resolved before proceeding.

8. **Confirm no placeholder secrets** remain in `.env`:
   ```bash
   # Windows
   findstr /i "replace_with" .env
   # Must return no results
   ```

**Evidence gate — all of the following must be true before Phase 6 begins:**
- Postman E2E all folders pass with no errors.
- Every user-facing flow manually verified in browser with no broken integrations.
- No 500s, schema mismatches, or console errors.
- All backend validation scripts pass clean.
- `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` fully ticked.
- No placeholder secrets in `.env`.
- All provider dry-run evidence is logged in credential register.

> **If anything fails this gate, fix it locally and re-run. Do not proceed to VPS.**

---

## Phase 6 — VPS baseline provisioning

**What you are doing:** Ensure the VPS host is correctly set up to receive the client deployment. This is the **first time you touch the VPS** for this client.

> **Before starting Phase 6:** Confirm `CLIENT_DEV_LOG.md` Phase 5 gate row shows a cleared date and sign-off. Create `CLIENT_VPS_DEPLOYMENT_LOG.md` now:
> ```
> cp docs/CLIENT_VPS_DEPLOYMENT_LOG_TEMPLATE.md client-<client-id>/CLIENT_VPS_DEPLOYMENT_LOG.md
> ```
> Copy Project Identity values from `CLIENT_DEV_LOG.md` into the new log. This is done once per VPS (not once per client) — if the VPS already hosts other clients, verify the baseline still meets requirements but skip steps already done.

**Prerequisites:** Phase 5 complete — **full local integration testing passed**. SSH access to VPS.

**Full runbook:** `docs/CLIENT_VPS_SETUP_GUIDE.md` §2 (VPS baseline) and §4 (Directory layout).

**Execution steps:**

1. **OS and packages:** Confirm Ubuntu 22.04 LTS. Install (if not present): Docker Engine + Compose plugin, Nginx 1.24+, Certbot (nginx plugin), PostgreSQL 16, Node.js 22, `jq`.
   ```bash
   docker --version && docker compose version
   nginx -v
   certbot --version
   psql --version
   node --version
   ```

2. **Non-root deploy user:** Confirm a non-root user with sudo exists for deployments.

3. **PostgreSQL 16 host service:** Confirm it is running on the host (not only in Docker). Containers reach it via `host.docker.internal`.

4. **Firewall:** Ports 80 and 443 open inbound. Backend/storefront ports (3001–3099, 3101–3199) NOT exposed publicly — proxied only by Nginx.

5. **NTP / time sync:** Confirm `systemd-timesyncd` or equivalent is active.
   ```bash
   timedatectl status
   ```

6. **Host hardening checks (once per VPS):**
   - `PermitRootLogin no` and `PasswordAuthentication no` in `/etc/ssh/sshd_config`
   - `ufw` allows only `22`, `80`, `443`
   - `fail2ban` running
   - `unattended-upgrades` enabled

   > **Port 22 after CD setup:** Once the self-hosted GitHub Actions runner is registered for this client (Phase 7 — see `CLIENT_VPS_SETUP_GUIDE.md` §22), restrict port 22 to your office CIDR only. Automated deploys use HTTPS outbound from the runner and do not require inbound SSH.

7. **Capacity signals (record before onboarding each new client):**
   - RAM sustained usage target: <75%
   - CPU sustained usage target: <70%
   - Disk usage target: <70%
   - If above thresholds, stabilize/resize before adding another client

8. **Create per-client directories:**
   ```bash
   sudo mkdir -p /var/www/<client-id>/backend
   sudo mkdir -p /var/www/<client-id>/frontend
   sudo chown -R <deploy-user>:<deploy-user> /var/www/<client-id>
   ```

**Evidence gate:**
- All required packages installed and version checks pass.
- Non-root deploy user exists.
- PostgreSQL 16 running on host.
- Firewall blocks raw backend ports from public access.
- NTP active.
- Host hardening checks pass (SSH, UFW, fail2ban, unattended upgrades).
- Capacity signals recorded and within target or explicitly mitigated.
- Client directory structure created.

---

## Phase 7 — VPS backend deployment

**What you are doing:** Deploy the locally validated backend to the VPS. Configure database, Nginx, TLS, and bring up the Docker Compose stack.

**Prerequisites:** Phase 5 complete (full local testing passed). Phase 6 complete (VPS baseline ready).

**Full runbook:** `docs/CLIENT_VPS_SETUP_GUIDE.md` §5–§12  
**Master playbook:** `docs/MASTER_DEPLOYMENT_PLAYBOOK.md`  
**Client phase scripts (template):** Copy and customize from `docs/templates/scripts/` into `docs/clients/<client-id>/scripts/` before first VPS deploy.

### 7.1 — Database setup

```bash
# On VPS, as postgres superuser or admin
psql -U postgres
CREATE USER <client-db-user> WITH PASSWORD '<generated>';
CREATE DATABASE <client-db-name> OWNER <client-db-user>;
\q
```

Reference: `docs/CLIENT_VPS_SETUP_GUIDE.md` §5.

### 7.2 — Backend deployment

> **First-time bootstrap only.** Run these steps once to set up the client stack on the VPS. After this, complete `CLIENT_VPS_SETUP_GUIDE.md` §22 (self-hosted runner setup + GitHub repo Variables). Once the runner is Online, all future deploys are fully automated on every `git push` to `main` — no SSH or manual `docker compose` required.

```bash
# On VPS, as deploy user
cd /var/www/<client-id>/backend
git clone https://github.com/your-org/ecom-backend-template .

# Copy .env from secure source (never git)
# scp from local, or pull from secrets vault

# Strict preflight before any restart loop triage
npm ci
node scripts/verify-client-bootstrap-env.mjs

# Host-side migrate: NEVER bare `npx prisma migrate deploy` on VPS — .env uses host.docker.internal
# for containers only; bare migrate → P1001 on host even when Postgres is fine on 127.0.0.1.
MIGRATE_DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/host\.docker\.internal/127.0.0.1/')"
DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma

# VPS production: use compose overlay to avoid starting compose postgres
docker compose -f docker-compose.yml -f docker-compose.prod.yml -p <client-id> up -d --build backend workers

# Install daily automated cleanup script (one-time per client)
sudo ./scripts/install-vps-cleanup.sh "<client-id>" "/var/www/<client-id>" "<client-id>-frontend"
```

Reference: `docs/CLIENT_VPS_SETUP_GUIDE.md` §6–§7 (first deploy), §12 (automated cleanup), §22 (automated CD setup), and `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md`.

### 7.3 — Nginx configuration

1. Copy `nginx/client.conf.template` from the backend repo to `/etc/nginx/sites-available/<client-id>.conf`.
2. Replace all template variables: `<domain>`, `<BACKEND_PORT>`, `<STOREFRONT_PORT>`, `<client-id>`.
3. Verify the six mandatory security headers are present in the HTTPS server block:
   - `Strict-Transport-Security` (2-year max-age, `includeSubDomains`, `preload`)
   - `X-Frame-Options: DENY`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `X-XSS-Protection: 1; mode=block`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
4. Verify TLS hardening: `ssl_ciphers` ECDHE-only AEAD suite, `ssl_session_cache`, `ssl_session_tickets off`, `ssl_stapling on`, `ssl_stapling_verify on`.
5. Verify `limit_req_zone` directives are in `http {}` (top-level `nginx.conf`), not inside `server {}`.
6. Enable the site: `sudo ln -s /etc/nginx/sites-available/<client-id>.conf /etc/nginx/sites-enabled/`
7. Test and reload: `sudo nginx -t && sudo systemctl reload nginx`

Reference: `docs/BACKEND_GO_LIVE_CHECKLIST.md` §2.1 (Nginx checklist items).

### 7.4 — TLS certificate

```bash
# Obtain certificate (first time)
sudo certbot --nginx -d <domain> -d www.<domain>

# Verify auto-renewal is scheduled
sudo systemctl status certbot.timer
# OR
sudo certbot renew --dry-run
```

Certbot will auto-patch the Nginx config. Verify HTTPS redirect from HTTP is active after cert issuance.

### 7.5 — Smoke test post-deploy

```bash
# Health check
curl -s https://<domain>/api/v1/health | jq .

# Readiness (Phase 7: informational; go-live requires empty runtimeConfigMissingKeys)
curl -s https://<domain>/api/v1/health/ready | jq .

# Metrics endpoint (requires OPS_METRICS_TOKEN)
curl -s -H "Authorization: Bearer <OPS_METRICS_TOKEN>" https://<domain>/api/v1/ops/metrics | head -30

# Container health
docker ps --filter "name=<client-id>"
docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml logs backend --tail=50
docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml logs workers --tail=50
```

**Evidence gate:**
- All containers running (`docker ps` shows `Up`).
- `/api/v1/health` returns 200 with `db` and `redis` connected.
- `/api/v1/health/ready` returns 200 (Phase 7 bootstrap may list missing runtime keys until Phase 8 completes).
- `/api/v1/ops/metrics` returns 200 with Prometheus text format (after Phase 8 config save).
- Nginx HTTPS active; HTTP redirects to HTTPS.
- TLS certificate valid (check with browser or `openssl s_client -connect <domain>:443`).
- No errors in backend or workers container logs at startup.

---

## Phase 7.6 — Enable GitHub push-to-deploy (self-hosted runner)

**What you are doing:** Register a GitHub Actions self-hosted runner on the client VPS for **this client's GitHub repo only**, configure repository Variables/Secrets, and verify that a push to `main` triggers automatic deploy after CI passes.

**Prerequisites:**

- Phase 7 complete (`/api/v1/health` OK on VPS).
- Monorepo cloned once at `/var/www/<client-id>/` (see guide — not two separate clones).
- Workflow files present on `main` (monorepo: repo root `.github/workflows/`; backend-only repo: `backend/.github/workflows/`).

**Full guide:** [`docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md`](GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md)

**Execution steps (summary):**

1. **VPS — install runner** (token from client repo → Settings → Actions → Runners → New):
   ```bash
   mkdir -p ~/actions-runner && cd ~/actions-runner
   # curl + tar from GitHub UI
   ./config.sh \
     --url https://github.com/<org>/<client-repo> \
     --token <REGISTRATION_TOKEN> \
     --name "<client-id>-vps" \
     --labels "self-hosted,<client-id>-vps" \
     --unattended
   sudo ./svc.sh install && sudo ./svc.sh start
   ```
2. **GitHub — Variables:** `VPS_DEPLOY_ENABLED=true`, `VPS_RUNNER_LABEL=<client-id>-vps`, `FRONTEND_DEPLOY_ENABLED=true` (if storefront on VPS).
3. **GitHub — Secrets:** `VPS_CLIENT_PATH=/var/www/<client-id>/backend`, `VPS_FRONTEND_PATH=/var/www/<client-id>/frontend`.
4. **Test:** `git push origin main` → Actions: **Reliability CI** (green) → **Deploy to VPS** (jobs on `<client-id>-vps` runner).
5. **Copy client checklist:** `cp docs/templates/client-GITHUB_CD_SETUP.template.md docs/clients/<client-id>/GITHUB_CD_SETUP.md` and fill values.

> **Backend auto-deploy readiness:** `vps-deploy.sh` requires `/api/v1/health/ready` with empty `runtimeConfigMissingKeys`. First green **backend** CD deploy typically requires **Phase 8** complete. You may install the runner after Phase 7; frontend CD (PM2) can succeed earlier if PM2 was bootstrapped in Phase 10.

**Daily workflow after Phase 7.6:**

```bash
git commit -m "feat: ..."
git push origin main
```

**Evidence gate:**

- Runner shows **Idle** (green) on the correct client repo with label `<client-id>-vps`.
- All Variables and Secrets configured (Variables are not Secrets).
- Test deploy workflow completed successfully on the self-hosted runner.
- `client-<id>/GITHUB_CD_SETUP.md` filled and linked from `CLIENT_VPS_DEPLOYMENT_LOG.md`.

---

## Phase 8 — Ops control plane invite bootstrap

**What you are doing:** Create the first ops invite, complete setup from email, and confirm the ops control plane is accessible from the designated IP.

**Prerequisites:** Phase 7 complete (VPS backend running with HTTPS).

**Mandatory frontend dependency before starting Phase 8:**
- Client frontend already includes working `/ops/setup` page that consumes invite token and completes setup against backend invite API.
- If `/ops/setup` is not deployed, do not run `ops:newuser` yet (invites expire in 10 minutes).
- Verify `/ops/setup` with the actual `OPS_UI_BASIC_AUTH_USERNAME` / `OPS_UI_BASIC_AUTH_PASSWORD` from `frontend/.env.production.local` before issuing an invite:
  ```bash
  curl -sS -o /dev/null -w "%{http_code}\n" \
    -u "<OPS_UI_BASIC_AUTH_USERNAME>:<OPS_UI_BASIC_AUTH_PASSWORD>" \
    "http://127.0.0.1:<STOREFRONT_PORT>/ops/setup"
  ```
  Expected: `200` (or redirect). `401` means bad/mismatched basic-auth credentials or stale frontend build; fix Phase 10 first.

**Full runbook:** `docs/OPS_CONTROL_PLANE_GUIDE.md`

**Execution steps:**

1. **Create ops invite** via trusted host CLI (not a public open bootstrap endpoint):
   ```bash
   cd /var/www/<client-id>/backend
   npm run ops:newuser -- \
     --email ops@<client-id>.internal \
     --name "Primary Ops" \
     --setup-base-url "https://<client-domain>" \
     --yes
   ```
   `ops-newuser` auto-normalizes `DATABASE_URL` from `host.docker.internal` to `127.0.0.1` when executed on the VPS host shell (outside containers), so invite bootstrap can run safely with production `.env`.
   Reference: `docs/OPS_CONTROL_PLANE_GUIDE.md` §4 (Invite bootstrap).

2. **Complete setup from invite email** at `https://<client-domain>/ops/setup?...` within 10 minutes (public page — no console navigation).

3. **Log in via email-OTP** at `/ops/login` — enter email, receive OTP, enter OTP. Session cookie (`ops_session`) is set. Console routes (`/ops`, `/ops/config`, etc.) show navigation only after this step.

4. **Test ops access:**
   ```bash
   curl -s -X GET https://<domain>/api/v1/ops/session \
     --cookie "ops_session=<session_token>"
   ```
   Expected: 200 with ops session payload. (Privileged write actions require an email OTP challenge in the request body.)

5. **Record ops user** in the credential register with email, permissions, and creation date.
6. **Verify cleanup policy:** expired unconsumed invites are removed and lifecycle events are visible in ops audit logs.

8. **Provision DB-overlay config via Ops UI** — after invite bootstrap and first login, use the Ops UI (or API directly) to set all DB-overlay keys:

   a. Request OTP: `POST /api/v1/ops/otp/request` with `{ action: 'config-save' }` (optional standalone verify: `POST /api/v1/ops/otp/verify`)
   b. Validate draft: `POST /api/v1/ops/config/validate` with `{ values: { ... } }`
   c. Save config: `POST /api/v1/ops/config/save` with `{ challengeId, otpCode, values: { ... } }` — `domain` is optional (omit to save keys across multiple domains in one request); `null` deactivates a stored overlay key

   Provider credentials, webhook tokens, and ops-security parameters are all DB-overlay keys. They are stored encrypted in `OpsConfigSecret` — see `docs/ENV_VS_DB_CONFIG_REFERENCE.md` §3 for the full list.

   For each domain in order:
   - **Payments:** `PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR`, `PAYMENT_CB_FAILURE_THRESHOLD`, `PAYMENT_CB_COOLDOWN_MS`
   - **Shipping:** `DELHIVERY_API_KEY` and/or `SHIPROCKET_EMAIL` + `SHIPROCKET_PASSWORD` (both can coexist), webhook token + allowlist, circuit breaker params. `SHIPPING_PROVIDER` is not a configurable key.
   - **Notifications:** `RESEND_API_KEY`, `RESEND_FROM`, `SMS_PROVIDER`, `MSG91_AUTH_KEY` / `FAST2SMS_API_KEY`, `META_WHATSAPP_*` keys
   - **Ops security:** `OPS_MFA_ENFORCE`, `OPS_METRICS_TOKEN`, `REPLAY_APPROVAL_TOKEN`, `TRUSTED_PROXY_ALLOWLIST_CIDR`
   - **Risk/replay:** `WEBHOOK_TIMESTAMP_SKEW_SECONDS`, `REPLAY_AUDIT_RETENTION_DAYS`

   > Bootstrap-only keys (`DATABASE_URL`, `OPS_DB_ENCRYPTION_KEY`, etc.) are rejected with `BOOTSTRAP_KEY_NOT_DB_APPLICABLE` if submitted — set them in `.env` only.

9. **Restart containers after config save** so `applyOpsConfigRuntimeOverlay()` applies the new DB-stored values before provider initialization:
   ```bash
   docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d backend workers
   docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml logs backend --tail=50
   # Verify: no startup errors, provider init logs show correct provider
   ```

10. **Verify DB-overlay config is applied:**
    ```bash
    # Check ops config overview (masked metadata, no plaintext)
    curl -s -X GET https://<domain>/api/v1/ops/config/overview \
      --cookie "ops_session=<session_token>"
    # All expected keys should show status: present, noPlaceholdersInStrict: true
    ```
11. **Readiness gate before Phase 9/10 handoff:**
    ```bash
    curl -fsS https://<domain>/api/v1/health/ready
    # On 503, jq '.data.runtimeConfigMissingKeys' — payload is in envelope `data` with error.code CONFIG_NOT_READY
    # Expected: status=ready and runtimeConfigMissingKeys=[]
    ```

**Evidence gate:**
- Ops invite is completed before expiry.
- Email OTP login flow is functional (session cookie issued).
- Email OTP challenge verification is functional for privileged write actions.
- Ops session endpoint returns 200 from authenticated browser session.
- All DB-overlay keys are saved via Ops UI and `/ops/config/overview` confirms all keys present with no placeholders.
- `/api/v1/health/ready` is `ready` and `runtimeConfigMissingKeys` is empty after restart.
- Backend and worker containers restarted after config save; no startup errors.
- `run config:parity-check` passes locally confirming `.env.example` layout is correct.

---

## Phase 9 — Admin provisioning

**What you are doing:** Create the first merchant admin through the invite-only `/admin/setup` flow and verify ecommerce admin access.

**Prerequisites:** Phase 7 complete (VPS backend running).

**Execution steps:**

1. **Create merchant admin invite** from an authenticated ops context:
   - Backend route: `POST /api/v1/ops/admin-invites`
   - Required ops auth: `ops_session` cookie (email-OTP login) with OTP challenge for privileged write.
   - Required permission: `ops:write`.
   - Endpoint policy: Layer C developer/ops control surface, not merchant admin self-service.
   - After creation, verify the invite status via `GET /api/v1/ops/admin-invites` (`ops:read`) — confirm it appears with status `EMAIL_SENT`.
   - If the invite must be cancelled before setup, use `POST /api/v1/ops/admin-invites/:inviteId/revoke` (`ops:write`, OTP-gated) to set its status to `CANCELLED`.
   - Body: `email`, `name`, `setupBaseUrl`, required merchant-only `permissions`.
   - **Deactivated merchant admin emails are allowed** (re-invite after ops deactivation).
   - The generated setup link targets `/admin/setup?token=...` and expires in 10 minutes.

2. **Complete merchant setup** at `/admin/setup`:
   - Frontend calls `POST /api/v1/admin/invites/setup/send-otp` then `POST /api/v1/admin/invites/consume` with token + OTP.
   - Backend creates `User(role=ADMIN)` **or reactivates** a deactivated admin (same `userId`, ban cleared), marks the invite consumed, and inserts merchant `AdminPermissionGrant` rows.
   - Default grants cover dashboard, products, categories, inventory, coupons, settings, reviews, analytics, orders, exports, notifications, and users read.
   - Developer/ops permissions (`ops:*`, `developer:*`) are not granted by this flow.
   - Invite token is accepted once; expired or consumed invites require a fresh ops-created invite.

3. **Verify admin login** via 2-step email OTP: `POST /api/v1/auth/admin/login/request-otp` (sends OTP to admin email) → `POST /api/v1/auth/admin/login/verify-otp` (issues JWT). Confirm JWT `permissions` contains expected merchant scopes only.

4. **Confirm no TOTP/MFA enrollment step is required** — email OTP is the only second factor; no authenticator-app provisioning needed.

5. **Confirm admin permission snapshot caveat** is in your ops SOP: permission grant/revoke changes are token-issuance scoped. Mid-session changes require session revocation or logout/re-auth for immediate effect.

6. **Clean expired admin invites** when needed from an authenticated ops context:
   - Backend route: `POST /api/v1/ops/admin-invites/cleanup-expired`
   - Required permission: `ops:write`.
   - Use this for operational cleanup evidence; it must not be exposed as a merchant admin UI action.

**Evidence gate:**
- Merchant admin invite was consumed before 10-minute expiry.
- Admin user exists and can log in.
- Admin permissions are explicitly granted through `AdminPermissionGrant` rows created by invite consumption.
- MFA enrolled if enforced.
- Admin JWT checked for expected `permissions` claim.
- Expired invite cleanup route is verified from ops context or scheduled SOP.

---

## Phase 10 — Frontend deployment and domain wiring

**What you are doing:** Deploy the locally validated Next.js frontend to the VPS and wire it to the live domain and production API base URL. You are promoting the already-tested local build — not building or debugging anything new here.

**Prerequisites:** Phase 5 complete (full local integration testing passed). Phase 7.3–7.4 complete (Nginx + TLS active for domain).

**Full guide:** `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §1 (Base URLs and environment variables).

**Execution steps:**

1. **Build the frontend for production** with live env variables (swap from local values used in Phase 4):
   ```bash
   cd client-<client-id>/frontend
   NEXT_PUBLIC_API_BASE_URL=https://<domain>/api/v1 \
   NEXT_PUBLIC_STOREFRONT_URL=https://<domain> \
   NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxx \
   npm run build
   ```

2. **First-time VPS setup** (run once — all subsequent deploys are automated via the CD pipeline):
   ```bash
   # SSH into VPS and navigate to the frontend directory
   # (git clone should already be done as part of Phase 7 backend setup)
   cd /var/www/<client-id>/frontend

   # Create runtime env from tracked template
   cp .env.production.example .env.production.local
   # Required keys: CLIENT_ID, STOREFRONT_PORT, NEXT_PUBLIC_API_BASE_URL,
   #                NEXT_PUBLIC_STOREFRONT_URL, NEXT_PUBLIC_RAZORPAY_KEY_ID
   # Required on shared/staging/production VPS: OPS_UI_BASIC_AUTH_USERNAME / OPS_UI_BASIC_AUTH_PASSWORD
   nano .env.production.local

   # Canonical one-time bootstrap script (env checks + build + PM2 + /ops/setup basic-auth check)
   bash /var/www/<client-id>/docs/clients/<client-id>/scripts/phase10-frontend-deploy.sh

   # Optional (first time only): persist across reboots
   pm2 startup       # install boot hook — run the printed sudo command
   pm2 save
   ```

   > **After this, all future deploys are fully automated.** Every `git push` to `main` triggers:
   > CI gates → self-hosted runner → `vps-frontend-deploy.sh` → `npm run build` → `pm2 reload` (zero downtime). No SSH required.

   **GitHub repo setup (one-time):** Add to the client repo at Settings → Secrets and variables → Actions:
   | Type | Name | Value |
   |------|------|-------|
   | Variable | `FRONTEND_DEPLOY_ENABLED` | `true` |
   | Secret | `VPS_FRONTEND_PATH` | `/var/www/<client-id>/frontend` |

   > See [`docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md`](GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md) and `docs/CLIENT_VPS_SETUP_GUIDE.md` §22.

3. **Update Nginx** to proxy storefront traffic to `http://127.0.0.1:<STOREFRONT_PORT>`. Reload Nginx.

4. **Verify domain routing:**
   - `https://<domain>/` → storefront
   - `https://<domain>/api/v1/health` → backend (200)
   - `https://<domain>/admin` → admin UI

**Evidence gate:**
- Storefront homepage loads over HTTPS.
- Admin UI loads at `/admin` (or subdomain).
- `/ops/setup` responds from both localhost and HTTPS with the configured basic-auth credentials (`200`/redirect; not `401`/`502`).
- `NEXT_PUBLIC_RAZORPAY_KEY_ID` is the **live** key (not test key).
- No `NEXT_PUBLIC_API_BASE_URL` pointing to `localhost`.

---

## Phase 11 — Provider webhook endpoint registration

**What you are doing:** Register the live VPS webhook URLs with all payment and shipping providers. This must happen after the live HTTPS domain exists (Phase 7). During local development (Phases 3–5), webhooks were tested locally — now you register the live URL.

**Prerequisites:** Phase 7 complete (HTTPS domain active). Phase 10 complete (frontend deployed).

**Execution steps:**

1. **Razorpay webhook:**
   - Go to Razorpay Dashboard → Settings → Webhooks.
   - Update (or create) the webhook URL to: `https://<domain>/api/v1/payments/webhook`.
   - Confirm active events: `payment.captured`, `payment.failed`, `refund.created`, `refund.failed`.
   - Confirm `RAZORPAY_WEBHOOK_SECRET` in backend `.env` matches the webhook secret in dashboard.

2. **Delhivery webhook:**
   - Go to Delhivery partner portal → Webhooks.
   - Register: `https://<domain>/api/v1/shipping/webhook`.
   - Confirm `DELHIVERY_WEBHOOK_ALLOWLIST_CIDR` in backend `.env` includes Delhivery egress IPs.

3. **Shiprocket webhook** (if used):
   - **CRITICAL:** Ensure an API User is active in Shiprocket (Settings → Additional Settings → API Users) before attempting to access the Webhooks page, otherwise the page will render blank.
   - Go to Shiprocket settings → Webhooks.
   - Register: `https://<domain>/api/v1/shipping/webhook`.
   - Confirm `SHIPROCKET_WEBHOOK_ALLOWLIST_CIDR` in backend `.env` includes Shiprocket egress IPs.

4. **Verify webhook receipt:** After registration, use each provider's "send test webhook" feature or trigger a test event and confirm it arrives and is processed in backend logs.

**Evidence gate:**
- All active provider webhooks point to live HTTPS URL (not staging URL, not localhost).
- Webhook secret in backend `.env` matches provider dashboard for each provider.
- At least one test webhook received and logged (no 400/500 from backend).

---

## Phase 12 — Go-live validation

**What you are doing:** Execute the full backend and frontend go-live checklists against the live VPS deployment. Most of this was already validated locally in Phase 5 — this phase confirms everything behaves identically on the VPS under real TLS, real domain, and live provider credentials.

**Prerequisites:** All phases 1–11 complete.

**Backend checklist:** `docs/BACKEND_GO_LIVE_CHECKLIST.md` — execute all sections.  
**Frontend checklist:** `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` — execute all sections.  
**Final sign-off guide:** `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md`

**Execution steps:**

1. **Fill in the release record** in `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md` §1:
   - Client name, environment, backend git SHA, storefront git SHA, deploy timestamp, on-call owner.

2. **Execute `docs/BACKEND_GO_LIVE_CHECKLIST.md`** in full:
   - Section 1: Runtime Profile & Global Environment Safety.
   - Section 2: Environment-to-Implementation Parity (all subsections: core routing, data layer, auth, payment, shipping, webhooks, risk/fraud, features, notifications, ops, observability).
   - No item may be skipped. Unticked items are blockers.

3. **Execute `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`** in full:
   - Section 1: Environment & Profile Safety.
   - Section 2: Response Contract Compliance.
   - Section 3: Auth & Session Handling.
   - Section 4: Idempotency.
   - Section 5: Checkout Flow.
   - Section 6: Webhook Boundaries.
   - Section 7: Admin Flow.
   - Section 8: Release Validation Commands.
   - No item may be skipped. Unticked items are blockers.

4. **Attach provider lifecycle evidence** from `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`:
   - Owner, vault path, created/rotated/expiry/last-tested for every active provider.

5. **Run release validation commands** from `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` §8 against the live VPS domain.

6. **Run contract smoke tests** — verify the critical API flows end-to-end on the live deployment:
   - Storefront: catalog browse → add to cart → checkout (Razorpay test payment if on staging; live payment on production) → order confirmation email received.
   - Admin: order appears in admin panel, ship action creates AWB, shipping webhook updates order status.
   - Ops: ops endpoint responds 200 from allowlisted IP, 403 from non-allowlisted.

7. **Confirm observability is active:**
   - Prometheus scraping `/api/v1/ops/metrics` with auth token.
   - At least one alert rule configured and tested.
   - `process_crash_total` series visible in metrics.

**Evidence gate:**
- `docs/BACKEND_GO_LIVE_CHECKLIST.md` fully ticked — no open items.
- `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` fully ticked — no open items.
- Release record filled in `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md`.
- Provider credential register attached with all fields complete.
- All contract smoke tests pass on live domain.
- Observability confirmed active.

---

## Phase 13 — DNS cutover

**What you are doing:** Switch production DNS records to point to the VPS. This is the final irreversible step that exposes the client to real traffic.

**Prerequisites:** Phase 12 complete with all evidence gates passed. No open blockers.

**Execution steps:**

1. **Update DNS records** at the domain registrar:
   - `A` record for `<domain>` → VPS IP.
   - `A` record for `www.<domain>` → VPS IP (or CNAME to `<domain>`).
   - If admin is on subdomain: `A` record for `admin.<domain>` → VPS IP.

2. **Wait for DNS propagation** (typically 5–60 minutes, up to 24–48 hours for global propagation). Use `dig <domain>` or `https://dnschecker.org` to monitor.

3. **Verify after propagation:**
   - `https://<domain>/` loads storefront (HTTPS, not HTTP).
   - `https://<domain>/api/v1/health` returns 200.
   - TLS certificate is valid for the domain (no browser warnings).
   - HTTP → HTTPS redirect works.

4. **Notify client** that the site is live.

5. **Monitor logs and metrics** for the first 24–48 hours:
   ```bash
   docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml logs backend -f
   docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml logs workers -f
   ```

**Evidence gate:**
- DNS propagated globally (confirmed via DNS checker).
- HTTPS loads cleanly without cert warnings.
- `/api/v1/health` returns 200 on live domain.
- No critical errors in first-hour logs.

---

## Phase 14 — Post-go-live handoff and maintenance setup

**What you are doing:** Complete the onboarding by documenting the deployment, setting up ongoing maintenance procedures, and handing off to the client (if applicable).

**Prerequisites:** Phase 13 complete.

**Execution steps:**

1. **File all deployment artifacts:**
   - Completed `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md` (with release record and all ticks).
   - Completed `docs/BACKEND_GO_LIVE_CHECKLIST.md`.
   - Completed `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`.
   - Completed `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`.
   - Nginx config backup.
   - Database name, user, and connection info in vault.

2. **Set up 90-day credential rotation calendar** per `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` §6 (Rotation schedule):
   - Assign primary and backup owners for each credential.
   - Set calendar reminders 30 days before each rotation date.

3. **Schedule quarterly compromise drill** per `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` §7 (Compromise runbook):
   - Revoke → regenerate → redeploy → verify all credentials exercise at least annually.

4. **Configure Prometheus alerting** (if not done in Phase 11) and verify alert delivery channel (email/Slack/PagerDuty).

5. **Document the client's slot** on the VPS:
   - `CLIENT_ID`, backend port, storefront port, database name, ops user email, on-call contact.
   - Store in the agency's internal ops register.

6. **Brief the client** on:
   - Admin panel URL and login process.
   - MFA requirement for admin.
   - Manual ship action workflow (shipment booking is intentionally manual — not auto-triggered).
   - Refund is asynchronous — customers may see a brief delay before refund status is final.
   - Contact protocol for production incidents.

**Evidence gate:**
- All deployment artifacts filed and accessible to the team.
- 90-day rotation calendar set.
- Quarterly drill scheduled.
- Observability and alerting confirmed active.
- Client briefed and accepted handoff.

---

## Quick-reference execution summary

> **The hard boundary: Phases 0–5 are entirely on your dev laptop. The VPS is not touched until Phase 6.**

| Phase | Where | What | Key doc |
|-------|-------|------|---------|
| 0 | Dev laptop | Client intake and scoping | — |
| 1 | Browser | Third-party account setup | `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` |
| 2 | Dev laptop | Backend clone, configure, local E2E baseline | `docs/MASTER_DEPLOYMENT_PLAYBOOK.md`, `.env.example` |
| 3 | Dev laptop | Third-party staging dry-runs (per slice) | `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` §0.1 |
| 4 | Dev laptop | Frontend build — simultaneous with Phase 3 | `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`, `starter-prompt.md` |
| **5** | **Dev laptop** | **Full local integration testing — mandatory gate** | `docs/BACKEND_GO_LIVE_CHECKLIST.md`, `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` |
| 6 | **VPS** | VPS baseline provisioning (first VPS step) | `docs/CLIENT_VPS_SETUP_GUIDE.md` §2–§4 |
| 7 | **VPS** | VPS backend deployment (DB, Docker, Nginx, TLS) | `docs/CLIENT_VPS_SETUP_GUIDE.md` §5–§12 |
| 8 | **VPS** | Ops control plane bootstrap | `docs/OPS_CONTROL_PLANE_GUIDE.md` |
| 9 | **VPS** | Admin provisioning | `ECOM_MASTER.md` §12, `TRD.md` §6 |
| 10 | **VPS** | Frontend deployment and domain wiring | `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §1 |
| 11 | **VPS** | Provider webhook endpoint registration | `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` |
| 12 | **VPS** | Go-live validation against live domain | `docs/BACKEND_GO_LIVE_CHECKLIST.md`, `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`, `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md` |
| 13 | DNS registrar | DNS cutover | — |
| 14 | — | Post-go-live handoff and maintenance setup | `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` §6–§7 |

---

## Critical isolation rules (must never be violated)

These rules come from `ECOM_MASTER.md` §5 and `TRD.md` §2.3. They are not suggestions — violating them collapses the security and billing isolation model of the multi-client VPS:

- **Never share a database** between clients. Each client gets its own PostgreSQL database and user.
- **Never share Redis** between clients. Each client gets its own Redis container with its own password.
- **Never share JWT secrets** (`JWT_SECRET`, `JWT_REFRESH_SECRET`) between clients.
- **Never share payment/shipping credentials** between clients. Even if two clients use the same Razorpay account owner, create separate API keys.
- Each client has its own Nginx `server {}` block(s) and its own TLS certificate.
- Each client's `.env` must **never** be committed to git.

---

## Related documents

| Document | Role in this runbook |
|----------|---------------------|
| `ECOM_MASTER.md` | Canonical architecture source of truth — all isolation rules, VPS model, and hardening notes |
| `TRD.md` | API contract, infrastructure requirements, auth model, webhook specs |
| `BRD.md` | Business acceptance criteria (AC-01–AC-15) that this process must satisfy |
| `README.md` | Quick-start orientation, documentation index, E2E simulation guide |
| `docs/MASTER_DEPLOYMENT_PLAYBOOK.md` | Detailed deployment steps with copy-paste commands |
| `docs/CLIENT_VPS_SETUP_GUIDE.md` | VPS provisioning and per-client Nginx/Docker isolation detail |
| `docs/BACKEND_GO_LIVE_CHECKLIST.md` | Local testing gate (Phase 5) + VPS go-live gate (Phase 12) |
| `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` | Local testing gate (Phase 5) + VPS go-live gate (Phase 12) |
| `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md` | Final sign-off record and release evidence (Phase 12) |
| `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` | Frontend integration contract, vertical slice model (Phase 4) |
| `docs/OPS_CONTROL_PLANE_GUIDE.md` | Ops user bootstrap and API usage (Phase 8) |
| `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` | Provider setup, credential lifecycle, rotation (Phases 1, 3, 11, 14) |
| `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md` | Per-client credential ownership record (filled across Phases 1, 3, 11) |
| `starter-prompt.md` | AI prompting playbook for frontend agent (Phase 4) |
| `frontend-agent-rules.md` | Antigravity rules to copy into frontend repo (Phase 4) |
| `.env.example` | Complete environment variable reference used in Phase 2 |
| `docs/CLIENT_DEV_LOG_TEMPLATE.md` | **Copy to `client-<id>/CLIENT_DEV_LOG.md` at Phase 0** — persistent dev context for Phases 0–5 (backend config, provider dry-runs, frontend milestones, Phase 5 gate) |
| `docs/FRONTEND_DEV_LOG_TEMPLATE.md` | **Copy to `frontend/docs/FRONTEND_DEV_LOG.md` at Phase 4 start** — frontend slice-level tracker |
| `docs/CLIENT_VPS_DEPLOYMENT_LOG_TEMPLATE.md` | **Copy to `client-<id>/CLIENT_VPS_DEPLOYMENT_LOG.md` at Phase 6 start** — VPS deployment progress log for Phases 6–14 |
| `docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md` | **Phase 7.6** — push-to-deploy via per-repo self-hosted runner (full setup) |
| `docs/templates/client-GITHUB_CD_SETUP.template.md` | **Copy to `client-<id>/GITHUB_CD_SETUP.md`** — per-client CD values checklist |
