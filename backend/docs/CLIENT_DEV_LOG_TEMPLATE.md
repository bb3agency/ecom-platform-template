# Client Site Development Log — [CLIENT_NAME]

> **Scope:** Phases 0–5 — local development and validation.
>
> **Usage:** Copy to `client-<client-id>/CLIENT_DEV_LOG.md` at Phase 0 and keep it updated through Phase 5.
>
> **Companion logs:**
> - `client-<client-id>/frontend/docs/FRONTEND_DEV_LOG.md` — frontend-specific slice tracker (Phases 4 tiers)
> - `client-<client-id>/CLIENT_VPS_DEPLOYMENT_LOG.md` — opened when Phase 5 clears and VPS work begins
>
> **Master runbook:** `../backend/docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`

---

## Project Identity

| Field | Value |
|---|---|
| Client name | [CLIENT_NAME] |
| `CLIENT_ID` slug | e.g. `fashionhub` |
| Domain | e.g. `fashionhub.com` |
| Admin path | e.g. `/admin` |
| Ops path | e.g. `/ops` |
| Backend port (assigned) | e.g. `3001` |
| Storefront port (assigned) | e.g. `3101` |
| Payment provider | `razorpay` / `cod` |
| Shipping provider | `delhivery` / `shiprocket` |
| Notification channels | email (`resend`) / SMS (`msg91` or `fast2sms`) / WhatsApp (`meta-whatsapp`) |
| VPS IP (for later) | — (fill when VPS provisioned in Phase 6) |
| Backend repo path | `client-<client-id>/backend` |
| Frontend repo path | `client-<client-id>/frontend` |
| Phase 0 start date | [DATE] |
| Last updated | [DATE] |

---

## Phase 0 — Client Intake and Scoping

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

- [ ] Domain name(s) confirmed
- [ ] Payment provider confirmed (Razorpay / COD-only)
- [ ] Shipping provider confirmed (Delhivery / Shiprocket)
- [ ] Notification channels confirmed (email / SMS / WhatsApp)
- [ ] VPS slot confirmed — backend port and storefront port assigned
- [ ] `CLIENT_ID` slug confirmed (unique on VPS)
- [ ] Scoping note written and filed

**Phase 0 cleared on:** —

**Notes:**

---

## Phase 1 — Third-Party Account Setup

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

### Credentials obtained

| Provider | Key variable | Test key in vault? | Live key in vault? | Webhook secret set? |
|---|---|---|---|---|
| Razorpay | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | [ ] | [ ] | [ ] |
| Delhivery | `DELHIVERY_API_KEY` | [ ] | [ ] | [ ] |
| Shiprocket | `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD` | [ ] | n/a | [ ] |
| MSG91 | `MSG91_AUTH_KEY` | [ ] | [ ] | n/a |
| Resend | `RESEND_API_KEY` | [ ] | [ ] | n/a |

- [ ] All credentials filed in `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`
- [ ] No credential stored only in chat/email — all in vault
- [ ] Sending domain added and verified in Resend dashboard

**Phase 1 cleared on:** —

**Notes:**

---

## Phase 2 — Backend Clone, Configure, Local Validation

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

### Setup checklist

- [ ] Backend template cloned into `client-<client-id>/backend`
- [ ] `.env.example` copied to `.env`
- [ ] **Bootstrap keys** filled in `.env` (no `replace_with` placeholders): `CLIENT_ID`, `DATABASE_URL`, `REDIS_URL`, `REDIS_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `OPS_DB_ENCRYPTION_KEY`, `OPS_COOKIE_SECRET`, `PAYMENT_PROVIDER`, feature flags, OTEL vars
  - **Also set** `RESEND_API_KEY` and `RESEND_FROM` — required for `node scripts/ops-newuser.mjs` invite email (Phase 1). After first ops login, manage via Ops UI. See `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`.
  > **Note:** All other provider credentials (`RAZORPAY_*`, `DELHIVERY_*`, `MSG91_*`, etc.) and ops-security params (`OPS_METRICS_TOKEN`, `REPLAY_APPROVAL_TOKEN`, etc.) are **DB-overlay keys** — they are NOT set in `.env` in production. They are provisioned via Ops UI after Phase 8. For local dev (Phase 2–5), you may temporarily set them in `.env` for dry-runs. See `docs/ENV_VS_DB_CONFIG_REFERENCE.md`.
  > **Shipping:** `SHIPPING_PROVIDER` is not a valid config key. Shipping provider detection is credential-based — set `DELHIVERY_API_KEY` (Delhivery) and/or `SHIPROCKET_EMAIL`+`SHIPROCKET_PASSWORD` (Shiprocket) via Ops UI. Both providers can coexist.
- [ ] `PAYMENT_PROVIDER` set (not `noop` unless explicitly staging-only)
- [ ] Shipping credentials configured via Ops UI — `DELHIVERY_API_KEY` (Delhivery) and/or `SHIPROCKET_EMAIL`+`SHIPROCKET_PASSWORD` (Shiprocket). At least one required for production.
- [ ] `npm ci` — passes
- [ ] `npm run build` — passes
- [ ] `npm run validate:env` — passes
- [ ] `npm run validate:schema` — passes
- [ ] `npm run lint` — passes
- [ ] `npm run type-check` — passes

### Postman E2E baseline

- [ ] Backend started: `npm run dev:e2e` (Terminal 1)
- [ ] Workers started: `npm run dev:e2e:workers` (Terminal 2)
- [ ] Postman collection folder 0 — passes
- [ ] Postman collection folder 1 — passes
- [ ] Postman collection folder 2 — passes
- [ ] Postman collection folder 3 — passes

**Phase 2 cleared on:** —

**Notes:**

---

## Phase 3 — Third-Party Staging Dry-Runs (runs simultaneously with Phase 4)

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

> Each dry-run is performed during the relevant frontend slice in Phase 4, not batched at the end.

| Provider | Dry-run type | Status | Date | Tester | Notes |
|---|---|---|---|---|---|
| Razorpay | Full test payment cycle (initiate → webhook → `CONFIRMED`) | [ ] | — | — | |
| Delhivery / Shiprocket | Ship order → AWB created → tracking webhook received | [ ] | — | — | |
| Resend | Order confirmation email received at test inbox | [ ] | — | — | |
| MSG91 SMS | Notification delivered to test number | [ ] | — | — | |
| Meta WhatsApp | Notification delivered to test number | [ ] | — | — | |

- [ ] All dry-run results logged in `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md` with timestamps

**Phase 3 cleared evidence oncrd

**Notes:**

---

## Phase 4 — Frontend Build Progress

> Detailed slice-level tracking lives in `client-<client-id>/frontend/docs/FRONTEND_DEV_LOG.md`.
> This section captures milestone status only.

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

| Milestone | Status | Date |
|---|---|---|
| Frontend repo created, `frontend-agent-rules.md` copied to `.agents/rules/dev-rules.md`, diff clean | [ ] | — |
| `.env.local` generated pointing at local backend | [ ] | — |
| `FRONTEND_DEV_LOG.md` created from template | [ ] | — |
| Tier 1 (Foundation) complete | [ ] | — |
| Tier 2 (Ops control plane) complete — includes `/ops/setup` invite consumption with email OTP | [ ] | — |
| Tier 3 (Admin read slices) complete | [ ] | — |
| Tier 4 (Admin mutation slices) complete — provider dry-runs done simultaneously | [ ] | — |
| Tier 5 (Reliability surfaces) complete | [ ] | — |
| Tier 6 (Storefront customer journey) complete — Resend dry-run done | [ ] | — |
| Tier 2 ops config contract surfaces complete — overview/validate/stored/save with OTP and masked persistence | [ ] | — |
| `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` fully ticked | [ ] | — |

**Phase 4 cleared on:** —

---

## Phase 5 — Full Local Integration Testing Gate

> **This phase must be fully cleared before Phase 6 (VPS) begins. No exceptions.**

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done

### Backend validation scripts

- [ ] `npm run validate:env` — passes
- [ ] `npm run validate:schema` — passes
- [ ] `npm run lint` — passes
- [ ] `npm run type-check` — passes
- [ ] `npm run test` — passes

### Postman E2E full run (real provider credentials, not noop)

- [ ] Folder 0 — passes
- [ ] Folder 1 — passes
- [ ] Folder 2 — passes
- [ ] Folder 3 — passes

### Manual browser walk

- [ ] Guest: catalog → product detail → cart → PREPAID checkout (Razorpay test payment) → order confirmation → email received
- [ ] Guest: COD checkout → order immediately `CONFIRMED` (if COD enabled)
- [ ] Registered user: login → order history → order detail
- [ ] Admin: login → order list → order detail → ship action → AWB returned → shipping webhook → status updated → mark delivered
- [ ] Admin: initiate refund → confirm pending state → worker processes → final `REFUNDED`
- [ ] Ops: ops endpoint 200 from allowed IP, 403 from non-allowed IP
- [ ] Auth guard: unauthenticated requests to protected routes return 401
- [ ] Admin permission guard: user without permission cannot access admin routes
- [ ] No CORS errors in browser DevTools
- [ ] No 500s or schema mismatches in any flow
- [ ] No hardcoded data visible (all content from backend)

### Checklist parity

- [ ] `docs/BACKEND_GO_LIVE_CHECKLIST.md` — fully ticked (local environment)
- [ ] `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` — fully ticked
- [ ] `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md` reviewed before Phase 6 handoff (strict env + networking gates captured)
- [ ] No `replace_with` placeholders in `.env` (confirmed via `findstr /i "replace_with" .env`)
- [ ] No `noop` payment or shipping provider active
- [ ] Race-condition hardening verified: CAS-hardened service tests pass (`ops.service.test.ts`, `auth.service.mfa-refresh.test.ts`, `admin-invites.service.test.ts`, `reconciliation.worker.test.ts`, `idempotency.test.ts`)

### Provider evidence

- [ ] All provider dry-run results logged in `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`

**Phase 5 gate cleared on:*evidence * crd
**Signed off by:** —

> **VPS work (Phase 6) must not begin until this row is filled.**

---

## Notes

### [DATE]

-

---

<!-- Add new session entries above this line -->
