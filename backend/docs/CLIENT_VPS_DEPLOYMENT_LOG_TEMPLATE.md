# Client VPS Deployment Log — [CLIENT_NAME]

> **Scope:** Phases 6–14 — VPS deployment and go-live execution.
>
> **Usage:** Copy to `client-<client-id>/CLIENT_VPS_DEPLOYMENT_LOG.md` once Phase 5 is cleared.
>
> **Master runbook:** `../backend/docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md` (Phases 6–14)

---

## Project Identity (copy from CLIENT_DEV_LOG.md)

| Field | Value |
|---|---|
| Client name | [CLIENT_NAME] |
| `CLIENT_ID` slug | |
| Domain | |
| Admin path | |
| Backend port | |
| Storefront port | |
| VPS IP | |
| Deploy user | |
| Backend repo path on VPS | `/var/www/<client-id>/backend` |
| Frontend repo path on VPS | `/var/www/<client-id>/frontend` |
| Phase 5 cleared on | [DATE from CLIENT_DEV_LOG.md] |
| Phase 6 start date | [DATE] |
| Last updated | [DATE] |

---

## Phase 6 — VPS Baseline Provisioning

> First time the VPS is touched for this client.

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

- [ ] Ubuntu 22.04 LTS confirmed
- [ ] Docker Engine + Compose plugin installed and version verified
- [ ] Nginx 1.24+ installed and version verified
- [ ] Certbot (nginx plugin) installed
- [ ] PostgreSQL 16 running on host (not only in Docker)
- [ ] Node.js 22 installed
- [ ] `jq` installed
- [ ] Non-root deploy user exists with sudo
- [ ] Firewall: ports 80 and 443 open inbound
- [ ] Firewall: backend/storefront ports (3001–3099, 3101–3199) NOT publicly exposed
- [ ] NTP / time sync active (`timedatectl status` shows synchronized)
- [ ] Per-client directories created:
  - `/var/www/<client-id>/backend`
  - `/var/www/<client-id>/frontend`
  - Ownership set to deploy user

**Phase 6 cleared on:** —

**Notes:**

---

## Phase 7 — VPS Backend Deployment

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

### 7.1 Database

- [ ] PostgreSQL user created: `<client-db-user>`
- [ ] PostgreSQL database created: `<client-db-name>`, owned by `<client-db-user>`

| Field | Value |
|---|---|
| DB user | |
| DB name | |
| DB password | (in vault — not here) |

### 7.2 Backend deployment

- [ ] Backend repo cloned / updated at `/var/www/<client-id>/backend`
- [ ] `.env` copied from secure source (not git) — no `replace_with` placeholders
- [ ] `.env` contains all startup-required **bootstrap** keys: `CLIENT_ID`, `DATABASE_URL`, `REDIS_URL`, `REDIS_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `OPS_DB_ENCRYPTION_KEY`, `OPS_COOKIE_SECRET`, `AUDIT_ANCHOR_SECRET`, `PORT=3000`, `BACKEND_PORT=<host-port>`
  - **Also set** `RESEND_API_KEY` and `RESEND_FROM` as live values — required for `node scripts/ops-newuser.mjs` (Phase 1 only; manage via Ops UI after first ops login). See `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`.
  - Runtime provider/security keys are DB-overlay managed and can be absent at first boot.
  - Missing runtime keys must be visible in `GET /api/v1/health/ready` via `runtimeConfigMissingKeys`.
- [ ] `node scripts/verify-client-bootstrap-env.mjs` passes before any container restart
- [ ] `npm ci --omit=dev` — passes
- [ ] `npm run prisma:migrate:deploy` — passes (all migrations applied)
- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml -p <client-id> up -d --build backend workers` — all containers start without launching compose postgres
- [ ] Redis **`ports:`** commented out in `docker-compose.yml` (no `0.0.0.0:6379` for this stack on multi-client VPS)
- [ ] `docker ps` shows all containers `Up`
- [ ] `curl -fsS http://127.0.0.1:<BACKEND_PORT>/api/v1/health` — DB + Redis connected
- [ ] `curl -sS http://127.0.0.1:<BACKEND_PORT>/api/v1/health/ready` — `runtimeConfigMissingKeys: []` only required **before go-live** (after Phase 8 Ops config)

### 7.3 Multi-client preflight (shared VPS only)

- [ ] `bash docs/clients/<client-id>/scripts/phase7.5-nginx-tls-preflight.sh` passes (or template from `backend/docs/templates/scripts/`)
- [ ] `ls /etc/nginx/sites-enabled/` reviewed — other clients' configs left intact
- [ ] `ss -tlnp` confirms `<BACKEND_PORT>` and `<STOREFRONT_PORT>` not used by another client
- [ ] Did **not** remove `sites-enabled/default` unless verified unused

### 7.4 Nginx configuration

- [ ] Nginx config file created at `/etc/nginx/sites-available/<domain.com>` (domain-based; not `<client-id>.conf` unless they match)
- [ ] All template variables replaced: `<domain>`, `<BACKEND_PORT>`, `<STOREFRONT_PORT>`, `<client-id>`
- [ ] Security headers present in HTTPS server block:
  - [ ] `Strict-Transport-Security` (2-year max-age, `includeSubDomains`, `preload`)
  - [ ] `X-Frame-Options: DENY`
  - [ ] `X-Content-Type-Options: nosniff`
  - [ ] `Referrer-Policy: strict-origin-when-cross-origin`
  - [ ] `X-XSS-Protection: 1; mode=block`
  - [ ] `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
- [ ] TLS hardening: ECDHE-only ciphers, `ssl_session_tickets off`, `ssl_stapling on`
- [ ] `limit_req_zone` directives in top-level `nginx.conf` `http {}` block (not in `server {}`)
- [ ] Site symlinked: `/etc/nginx/sites-enabled/<domain.com>` (additive symlink only)
- [ ] `sudo nginx -t` — passes
- [ ] `sudo systemctl reload nginx` — succeeds

### 7.5 TLS certificate

- [ ] Certificate obtained via Certbot for `<domain>` and `www.<domain>`
- [ ] `certbot.timer` active (auto-renewal confirmed)
- [ ] HTTPS loads in browser without warnings
- [ ] HTTP → HTTPS redirect confirmed

### 7.6 Post-deploy smoke test

- [ ] `curl https://<domain>/api/v1/health` — returns 200
- [ ] `curl -H "Authorization: Bearer <OPS_METRICS_TOKEN>" https://<domain>/api/v1/ops/metrics` — returns 200 with Prometheus text
- [ ] Authenticated invoice download routes validated:
  - `GET /api/v1/orders/:id/invoice.pdf` (owner-only)
  - `GET /api/v1/admin/orders/:id/invoice.pdf` (admin `orders:read`)
- [ ] No errors in backend container logs (`docker compose -p <client-id> logs backend --tail=50`)
- [ ] No errors in workers container logs (`docker compose -p <client-id> logs workers --tail=50`)

**Phase 7 cleared on:** —

**Notes:**

---

## Phase 7.6 — GitHub Push-to-Deploy (Self-Hosted Runner)

> **Full guide:** `docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md`  
> **Client checklist:** `docs/clients/<client-id>/GITHUB_CD_SETUP.md`

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

- [ ] Monorepo at `/var/www/<client-id>/` (single clone) or backend-only layout documented
- [ ] Workflow files on client repo `main` (root for monorepo)
- [ ] Runner installed on VPS for this client's GitHub repo; label `<client-id>-vps`
- [ ] GitHub Variables + Secrets configured
- [ ] Test push: CI green → Deploy to VPS green on correct runner

| Field | Value |
|---|---|
| GitHub repo | |
| Runner Online date | |
| First green CD SHA | |

**Phase 7.6 cleared on:** —

**Notes:**

---

## Phase 8 — Ops Control Plane Invite Bootstrap

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

**Prerequisite:** Client frontend `/ops/setup` page must be deployed and functional (invite expires in 10 minutes).

- [ ] Invite created via `npm run ops:newuser` with `--email`, `--name`, `--setup-base-url`
- [ ] Invite email received and setup link clicked within 10 minutes
- [ ] Setup completed at `https://<domain>/ops/setup` — ops user account created
- [ ] Email OTP login verified — `GET /api/v1/ops/session` returns 200
- [ ] **DB-overlay keys provisioned via Ops UI** (`POST /api/v1/ops/config/save` — requires ops auth + email OTP): all provider credentials (`RAZORPAY_*`, `DELHIVERY_*` or `SHIPROCKET_*`, `RESEND_API_KEY`, `MSG91_AUTH_KEY` / `FAST2SMS_API_KEY`, `META_WHATSAPP_*` if enabled) and ops-security params (`OPS_METRICS_TOKEN`, `REPLAY_APPROVAL_TOKEN`, etc.) saved and encrypted in `OpsConfigSecret`
- [ ] Containers restarted to apply DB-overlay: `docker compose -p <client-id> -f docker-compose.yml -f docker-compose.prod.yml up -d backend workers`
- [ ] Ops status endpoint tested: `GET /api/v1/ops/session` returns 200 with email-OTP verification
- [ ] Ops config save hardening validated: `POST /api/v1/ops/config/save` requires OTP and returns masked/encrypted persistence metadata
- [ ] Expired invite cleanup verified: `POST /api/v1/ops/invites/cleanup-expired` accessible to ops users
- [ ] Ops user recorded in `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`

| Field | Value |
|---|---|
| Ops user email | |
| Invite consumed at | |
| First OTP login verified at | |

**Phase 8 cleared on:** —

**Notes:**

---

## Phase 9 — Admin Provisioning

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

- [ ] Merchant admin invite created from ops-authenticated context: `POST /api/v1/admin/invites`
- [ ] Invite list verified from ops context: `GET /api/v1/admin/invites` returns the invite with correct `status`
- [ ] `/admin/setup?token=...` completed before 10-minute expiry using `POST /api/v1/admin/invites/consume`
- [ ] Admin permissions explicitly granted by invite consumption (`AdminPermissionGrant`; fail-closed — zero implicit permissions)
- [ ] Admin login tested via 2-step email OTP: `POST /api/v1/auth/admin/login/request-otp` → `POST /api/v1/auth/admin/login/verify-otp` returns token with expected `permissions` claim
- [ ] No TOTP/authenticator-app enrollment required (email OTP is the sole second factor)
- [ ] Invite revocation flow verified from ops context: `POST /api/v1/admin/invites/:inviteId/revoke` (OTP-gated) correctly cancels an active invite
- [ ] Expired invite cleanup route verified from ops context: `POST /api/v1/admin/invites/cleanup-expired`

| Field | Value |
|---|---|
| Admin email | |
| Invite created by ops user | |
| Invite consumed at | |
| Password stored in vault | |
| Permissions granted | |
| Cleanup verification | |

**Phase 9 cleared on:** —

**Notes:**

---

## Phase 10 — Frontend Deployment and Domain Wiring

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

- [ ] Frontend `.env.local` updated to production values:
  - [ ] `NEXT_PUBLIC_API_BASE_URL=https://<domain>/api/v1` (not localhost)
  - [ ] `NEXT_PUBLIC_STOREFRONT_URL=https://<domain>`
  - [ ] `NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxx` (live key, not test key)
- [ ] `npm run build` passes with production env values
- [ ] Frontend deployed to VPS (or Vercel/Netlify)
- [ ] Nginx updated to proxy storefront port — `sudo nginx -t && reload` passes
- [ ] `https://<domain>/` loads storefront
- [ ] `https://<domain>/api/v1/health` returns 200
- [ ] `https://<domain>/admin` loads admin UI
- [ ] No `localhost` references visible in page source or network tab

**Phase 10 cleared on:** —

**Notes:**

---

## Phase 11 — Provider Webhook Endpoint Registration

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

| Provider | Live webhook URL registered | Webhook secret saved via Ops UI (`OpsConfigSecret`)? | Test webhook received? |
|---|---|---|---|
| Razorpay | `https://<domain>/api/v1/payments/webhook` [ ] | [ ] | [ ] |
| Delhivery | `https://<domain>/api/v1/shipping/webhook` [ ] | [ ] | [ ] |
| Shiprocket | `https://<domain>/api/v1/shipping/webhook` [ ] | [ ] | [ ] |

- [ ] No webhook URL still pointing to `localhost` or staging URL

**Phase 11 cleared on:** —

**Notes:**

---

## Phase 12 — Go-Live Validation

> Both checklists run again against the **live VPS** (they were also run in Phase 5 against localhost).

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

### Release record

| Field | Value |
|---|---|
| Client name | |
| Environment | production / staging |
| Backend git SHA | |
| Storefront git SHA | |
| Deploy timestamp | |
| On-call owner | |

### Checklist execution

- [ ] `docs/BACKEND_GO_LIVE_CHECKLIST.md` — fully ticked (VPS environment, live domain)
- [ ] `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` — fully ticked (VPS environment, live domain)
- [ ] Release record filled in `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md`
- [ ] Provider credential register attached — all fields complete
- [ ] Race-condition hardening verified on VPS: CAS-hardened service tests pass (`ops.service.test.ts`, `auth.service.mfa-refresh.test.ts`, `admin-invites.service.test.ts`, `reconciliation.worker.test.ts`, `idempotency.test.ts`)

### Contract smoke tests on live domain

- [ ] Storefront: catalog → cart → PREPAID checkout (Razorpay test payment on staging / live on production) → confirmation page → confirmation email received
- [ ] Storefront: COD checkout → order immediately `CONFIRMED` (if enabled)
- [ ] Admin: order appears in admin panel → ship action → AWB returned → webhook → status updated
- [ ] Ops: 200 from allowed IP, 403 from non-allowed IP

### Observability

- [ ] Prometheus scraping `/api/v1/ops/metrics` with auth token
- [ ] At least one alert rule configured and tested
- [ ] `process_crash_total` series visible in metrics

**Phase 12 cleared on:** —  
**Signed off by:** —

---

## Phase 13 — DNS Cutover

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

- [ ] DNS `A` record for `<domain>` → VPS IP updated
- [ ] DNS `A` record for `www.<domain>` → VPS IP (or CNAME) updated
- [ ] Admin subdomain DNS updated (if applicable)
- [ ] DNS propagation confirmed globally (dnschecker.org)
- [ ] `https://<domain>/` loads storefront via HTTPS
- [ ] `https://<domain>/api/v1/health` returns 200 on live domain
- [ ] TLS certificate valid — no browser warnings
- [ ] HTTP → HTTPS redirect confirmed
- [ ] Client notified that site is live
- [ ] Logs monitored for first 24 hours — no critical errors

**Phase 13 cleared on:** —

**Notes:**

---

## Phase 14 — Post-Go-Live Handoff and Maintenance Setup

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

### Artifacts filed

- [ ] `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md` — completed and filed
- [ ] `docs/BACKEND_GO_LIVE_CHECKLIST.md` — completed copy archived
- [ ] `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` — completed copy archived
- [ ] `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md` — completed and filed
- [ ] Nginx config backed up
- [ ] DB connection info (name, user, host) in vault

### Maintenance setup

- [ ] 90-day credential rotation calendar set (all providers, primary + backup owners assigned)
- [ ] Quarterly compromise drill scheduled
- [ ] Prometheus alerting configured — alert delivery channel confirmed (email/Slack/PagerDuty)
- [ ] Client slot documented in agency ops register: `CLIENT_ID`, ports, DB name, ops user email, on-call

### Client briefing

- [ ] Admin panel URL and login process explained
- [ ] MFA requirement explained
- [ ] Manual ship action workflow explained
- [ ] Async refund behaviour explained
- [ ] Incident contact protocol established

**Phase 14 cleared on:** —  
**Project go-live confirmed:** —

---

## Notes

### [DATE]

-

---

<!-- Add new session entries above this line -->
