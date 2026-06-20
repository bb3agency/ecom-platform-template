# Doc Update Plan — Admin Routes + Alert System Fixes

## Scope

Two sets of changes need to propagate into docs:

1. **Admin login flow change** — TOTP/single-step `POST /auth/admin/login` was removed. Replaced with a 2-step email OTP flow:
   - Step 1: `POST /api/v1/auth/admin/login/request-otp` — verify email+password, send OTP to admin email address
   - Step 2: `POST /api/v1/auth/admin/login/verify-otp` — verify OTP, issue JWT access+refresh tokens

2. **Notifications worker terminal failure handler** — `notifications.worker.ts` was missing a `worker.on('failed', ...)` terminal handler that sends a `sendTechnicalFailureAlert` on job exhaustion. This was the last worker without coverage. Added and test fixed.

---

## Docs Requiring Changes

### HIGH PRIORITY

#### 1. `docs/ROUTE_SURFACE_COMPLETE_REFERENCE.md` — Section 3 (Admin auth routes)

**Current (stale):**
```
### `POST /api/v1/auth/admin/login`
Admin login with email + password. Optionally requires TOTP...

### `POST /api/v1/auth/admin/mfa/setup/start`
### `POST /api/v1/auth/admin/mfa/setup/confirm`
### `POST /api/v1/auth/admin/mfa/disable`
```

**Replace with:**
```
### `POST /api/v1/auth/admin/login/request-otp`
Step 1 of admin login. Verifies email + password. If valid, sends a time-limited OTP
to the admin's registered email address. Returns `{ expiresAt }`. Does NOT issue a JWT.
Rate-limited (auth-sensitive profile). OTP TTL: 300s. Max 5 attempts before lockout.

### `POST /api/v1/auth/admin/login/verify-otp`
Step 2 of admin login. Accepts `{ email, otp }`. Verifies OTP against the pending
challenge. On success: issues JWT access token + refresh token (sets httpOnly cookie).
Returns `{ accessToken, admin }`. Anti-enumeration: generic error message on failure.
```

Remove all three TOTP MFA setup/disable routes (`mfa/setup/start`, `mfa/setup/confirm`, `mfa/disable`) — they no longer exist.

Also update Section 25 (Admin setup flow) to remove "Optional: POST /auth/admin/mfa/setup/start → confirm → MFA enabled" line.

---

#### 2. `TRD.md` — Section 7.2 Auth Routes table

**Current (stale):**
```
| POST | `/admin/login` | Public | `{ email, password }` | `{ accessToken, admin }` + cookie |
```

**Replace with:**
```
| POST | `/admin/login/request-otp` | Public | `{ email, password }` | `{ expiresAt }` — sends OTP to email |
| POST | `/admin/login/verify-otp` | Public | `{ email, otp }` | `{ accessToken, admin }` + cookie |
```

Also update Section 11.3 Rate Limits table — the auth login row currently reads:
```
| Auth login (`/auth/login`, `/auth/admin/login`) | ...
```
Replace with:
```
| Auth login (`/auth/login`, `/auth/admin/login/request-otp`, `/auth/admin/login/verify-otp`) | ...
```

Also update Section 12.2 Admin Dashboard:
```
- Auth provider: `POST /api/v1/auth/admin/login`, auto refresh token handling
```
Replace with:
```
- Auth provider: 2-step email OTP (`POST /api/v1/auth/admin/login/request-otp` → `POST /api/v1/auth/admin/login/verify-otp`), auto refresh token handling
```

---

#### 3. `ECOM_MASTER.md` — Section 8.2 Auth routes table + Section 9 Auth Module

**Section 8.2 table current (stale):**
```
| POST | `/api/v1/auth/admin/login` | Public | Admin login (stricter rate limit) |
```
**Replace with:**
```
| POST | `/api/v1/auth/admin/login/request-otp` | Public | Admin login step 1 — verify credentials, send email OTP |
| POST | `/api/v1/auth/admin/login/verify-otp` | Public | Admin login step 2 — verify OTP, issue JWT pair |
```

**Section 9 Auth Module bullet current (stale):**
```
- Admin login via `/auth/admin/login` — separate endpoint with stricter controls (8 req/min...)
```
**Replace with:**
```
- Admin login is a 2-step email OTP flow: `POST /auth/admin/login/request-otp` (verify credentials, send OTP to admin email) then `POST /auth/admin/login/verify-otp` (verify OTP, issue JWT pair). OTP TTL: 300s, max 5 attempts. Stricter rate limit than customer login. No TOTP/authenticator-app MFA — admin MFA is email-OTP-only.
```

Also update Section 9 permissions list — it currently says `users:read` gates "own MFA setup". Remove that annotation since TOTP MFA setup no longer exists.

---

### MEDIUM PRIORITY

#### 4. `docs/HARDENING_HISTORY.md` — Add entry for notifications worker terminal failure fix

Add a new dated entry at the top of the "Recent hardening changes" section:

```markdown
**Notifications worker terminal failure handler — [current date]:**
- `queues/workers/notifications.worker.ts` was the only BullMQ worker missing a `worker.on('failed', ...)` terminal handler. All other workers had one. Added the handler: guards on `job.attemptsMade < attempts` to skip non-terminal failures, then calls `sendTechnicalFailureAlert({ failureStage: 'WORKER_TERMINAL', terminalFailure: true, ... })` on job exhaustion. Matches the pattern used in all 9 other workers.
- `queues/workers/notifications.worker.test.ts` `MockWorker` updated from a plain function to a class with a no-op `.on()` method to allow the event handler attachment in factory function without TypeError.
- All 10 BullMQ workers now have full terminal failure alert coverage.
```

---

#### 5. `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` — Admin auth slice description

The guide does not currently spell out the admin login flow in the ops/admin slices section, but Section 1.2.2 step 2 references "Session bootstrap (`GET /ops/session`)" for ops. No stale admin login route reference was found. No change needed here unless we want to add a note about the 2-step flow to the admin read slices block. **LOW IMPACT — skip unless user wants it explicitly called out.**

---

### DOCS CONFIRMED UP TO DATE (no change needed)

After full review, the following docs are already correct or don't reference the stale routes:

- `docs/API_ENDPOINT_INDEX.md` — already shows `request-otp` + `verify-otp` (confirmed at lines 47–48)
- `docs/BACKEND_GO_LIVE_CHECKLIST.md` — no auth route specifics
- `docs/CLIENT_DEV_LOG_TEMPLATE.md` — no route specifics
- `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md` — no route specifics
- `docs/CLIENT_HANDOFF_INDEX.md` — no route specifics
- `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md` — no route specifics
- `docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md` — no route specifics
- `docs/CLIENT_VPS_DEPLOYMENT_LOG_TEMPLATE.md` — no route specifics
- `docs/CLIENT_VPS_SETUP_GUIDE.md` — no route specifics
- `docs/DECISIONS.md` — no route specifics
- `docs/DOC_CONTEXT_MAP.md` — no route specifics
- `docs/ENV_VS_DB_CONFIG_REFERENCE.md` — no route specifics
- `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` — no route specifics
- `docs/FRONTEND_DEV_LOG_TEMPLATE.md` — no route specifics
- `docs/MASTER_DEPLOYMENT_PLAYBOOK.md` — no route specifics
- `docs/OPS_CONTROL_PLANE_GUIDE.md` — ops routes only
- `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` — no admin login routes
- `BRD.md` — no route specifics
- `frontend-agent-rules.md` — no admin login reference
- `README.md` — no admin login reference
- `starter-prompt.md` — no admin login reference

---

## Summary of Changes

| File | Change |
|---|---|
| `docs/ROUTE_SURFACE_COMPLETE_REFERENCE.md` | Replace §3 admin auth (TOTP→2-step email OTP); remove MFA routes; update §25 admin setup flow |
| `TRD.md` | §7.2 auth table rows; §11.3 rate limit row; §12.2 admin auth provider description |
| `ECOM_MASTER.md` | §8.2 auth table row; §9 Auth Module admin login description + remove `users:read` MFA gate note |
| `docs/HARDENING_HISTORY.md` | Add entry for notifications worker terminal failure handler |
| `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` | No change required |
