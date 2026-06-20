# Frontend AI Go-Live Checklist

Use this checklist before shipping any AI-generated storefront/admin frontend against this backend.

Pair this with `docs/BACKEND_GO_LIVE_CHECKLIST.md` for final go-live sign-off. The backend checklist includes audit-hardened gates covering Nginx security headers, JSON schema `additionalProperties: false` enforcement, SLO alert test coverage, JWT fail-fast validation, script credential env var usage, and admin route rate-limit/load-shed guards.

## 1) Environment & Profile Safety

- [ ] Frontend uses only `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_STOREFRONT_URL`.
- [ ] `NEXT_PUBLIC_API_BASE_URL` includes `/api/v1`.
- [ ] `NEXT_PUBLIC_STOREFRONT_URL` and `NEXT_PUBLIC_IMAGE_CDN_URL` are set in production (CDN must match Ops `R2_PUBLIC_BASE_URL`; SSR never embeds implicit `localhost` — see `lib/media-url.ts`).
- [ ] Storefront uses **`GET /api/v1/store/config`** (via `StoreConfigProvider` / `lib/storefront-settings.ts`) for COD, min order, and module flags — not build-time `NEXT_PUBLIC_FEATURE_*` env vars.
- [ ] Admin GST panels fetch `gstInvoicingEnabled` from `/store/config` (legacy `NEXT_PUBLIC_FEATURE_GST_INVOICING_ENABLED` is not authoritative).
- [ ] Brand logo served from `frontend/public/images/raghava-organics-logo.png` via `BRAND_LOGO_SRC` in `lib/constants.ts` — no repo-root or duplicate `public/logo.png` paths.
- [ ] No hardcoded API URLs in code.
- [ ] No alternate env names (for example `NEXT_PUBLIC_API_URL`).
- [ ] **Cookie auth / same-site:** Local dev uses `NEXT_PUBLIC_API_BASE_URL` on the **storefront origin** (e.g. `http://localhost:3101/api/v1`) with `BACKEND_PROXY_URL` + Next rewrite; `INTERNAL_API_BASE_URL` points at Fastify for SSR/tests. Production uses one public origin for UI + `/api/v1` (Nginx). After admin login, `refresh_token` cookie is on the UI origin (`Path=/api/v1`); hard refresh on `/admin` stays signed in (`AdminGuard` + `restore-auth-session.ts`). VPS: `TRUSTED_PROXY_ALLOWLIST_CIDR` set for stable client IP on refresh. See `NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §1.0.1–§1.0.2.
- [ ] Production-like backend profile is understood:
  - `NODE_ENV=development` or `test` => development-like
  - Any other value (`production`, `staging`, `qa`, `uat`, custom, or unset) => production-like
- [ ] `PAYMENT_PROVIDER=noop` is treated as local simulation only — never production. For shipping, `SHIPPING_PROVIDER` env var is ignored; at least one provider's credentials must be set for production (Delhivery and/or Shiprocket).
- [ ] Frontend repo has latest AI rules synced from backend: `frontend-agent-rules.md` -> `.agents/rules/dev-rules.md`.

### 1.1) CSP & Security Headers Verification

**Backend enforces strict CSP (no 'unsafe-inline'):**
- [ ] `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:`
- [ ] No inline `<script>` tags (use external JS files)
- [ ] No inline `style=` attributes (use CSS classes)
- [ ] No `eval()` or `new Function()` usage
- [ ] No `innerHTML` with user-generated content

**Additional Security Headers (enforced by backend):**
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY`
- [ ] `Strict-Transport-Security: max-age=31536000`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`

**Frontend `next.config.ts` Security Headers (added 2026-06-14):**
- [ ] `async headers()` export in `next.config.ts` emits full CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS (production only), COOP, CORP on every route.
- [ ] CSP `frame-src` includes `https://checkout.razorpay.com` (required for Razorpay iframe).
- [ ] CSP `script-src` includes `https://checkout.razorpay.com` (required for Razorpay checkout.js).
- [ ] CSP `connect-src` includes `NEXT_PUBLIC_API_BASE_URL` origin + Razorpay API domains.
- [ ] `Cross-Origin-Opener-Policy: same-origin-allow-popups` (required for Razorpay popup flow).
- [ ] Static assets have `Cache-Control: public, max-age=31536000, immutable` header on `/_next/static/`.
- [ ] `lib/config-validation.ts::validateProductionEnv()` is called in `next.config.ts` — throws if required prod env vars missing.
- [ ] Run `securityheaders.com` scan on production URL post-deploy and confirm A+ rating.

**Frontend Requirements:**
- [ ] All styles in external CSS files (no inline styles)
- [ ] All scripts in external JS files (no inline scripts)
- [ ] User-generated content properly escaped (XSS prevention)

### 1.2) Idempotency Key Quality

- [ ] `createIdempotencyKey()` (`lib/idempotency.ts`) uses `crypto.randomUUID()` with RFC 4122 v4 UUID fallback (not a simple timestamp-random string). Verify the fallback branch generates a valid `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` format.
- [ ] Mutations that use idempotency keys send a **new** key per user action, **reuse** the same key on retry of the same action.
- [ ] Backend idempotency keys are opaque strings accepted up to 255 chars — UUID4 is the correct format.

## 2) Response Contract Compliance

- [ ] API client supports both success shapes:
  - enveloped: `{ success, data, meta? }`
  - raw payload: route-specific JSON body
- [ ] Error handling branches on `error.code`, not free-form `error.message`.
- [ ] UI fallbacks exist for network failure, non-JSON failure, and timeout.

## 3) Auth & Session Handling

- [ ] Refresh token is never stored in `localStorage` or `sessionStorage`.
- [ ] Refresh token remains backend-controlled (HTTP-only cookie flow).
- [ ] Access token handling is ephemeral (memory/state), not long-term browser storage.
- [ ] 401 flow is implemented: refresh -> retry original request -> logout if refresh fails.

### 3.0a) Storefront Session Bootstrap (Critical — 2026-06-14)

`useSessionBootstrap()` is mounted in the `<Header>` (storefront layout). It must be hardened:

- [ ] **Expired token detection:** `runStorefrontSessionBootstrap()` checks `isAccessTokenUsable(token)` (from `lib/jwt-utils.ts`), NOT `!!token`. A non-null but expired access token must trigger a refresh, not be accepted as authenticated.
- [ ] **`useEffect` mirrors the same check:** `if (accessToken && isAccessTokenUsable(accessToken))` before calling `bootstrapStorefrontSessionOnce()`.
- [ ] **`storefrontSessionStatus` is threaded through auth store:** values are `"checking" | "authenticated" | "guest"`. Starts as `"checking"`.
- [ ] **New-tab restore works without visible "Please sign in" flash:** When the user opens a second tab (Session 2), Zustand starts empty, bootstrap runs asynchronously, and the checkout form shows a loading skeleton — not a "Please sign in" prompt that could redirect them to `/login`.

**Protected UI components (e.g. `CheckoutForm`) must:**
- [ ] Subscribe to `storefrontSessionStatus` from auth store.
- [ ] Render a skeleton/loading state when `storefrontSessionStatus === "checking"` (before showing any "Please sign in" copy or redirecting to login).
- [ ] Only show "Please sign in" when `!accessToken && storefrontSessionStatus !== "checking"`.

**Authenticated fetches in client components must use `useAuthenticatedApi()`:**
- [ ] `CheckoutForm` (and any other client component) fetches addresses, profile, orders via `useAuthenticatedApi()` — NOT via `getMyAddresses(accessToken)` or bare `apiClient`. The bare client has no 401→refresh→retry; `createAuthenticatedApiClient` does.
- [ ] Address fetch effect skips when `storefrontSessionStatus === "checking"` to avoid firing before session is resolved.

> Reference: `NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §10.2 — "Storefront session bootstrap critical invariants"

---

### 3.0) Admin Session Lifecycle (Critical)

**Admin login (2-step OTP — step 1 credentials):**
- [ ] `POST /auth/admin/login/request-otp` advances to OTP UI **only on HTTP 200** after valid active admin credentials.
- [ ] `401 INVALID_CREDENTIALS` keeps user on email/password step with **"Incorrect password."** (no OTP sent).
- [ ] `401 UNAUTHORISED` keeps user on credentials with deactivated-admin copy (ops-deactivated / `isBanned`).
- [ ] Unknown email may still receive generic `200` without OTP (anti-enumeration) — UI must not treat that as proof an OTP was delivered.

**Session restoration on page refresh:**
- [ ] `AdminAuthProvider` (`AdminConsoleShell`) attempts deduped `POST /api/v1/auth/refresh` when `accessToken` is null (page reload); audience `admin`.
- [ ] On refresh success: parse JWT claims to reconstruct `User` (`sub`, `role`, `permissions`), call `setSession()`, render admin console.
- [ ] On refresh failure: `clearSession()` (memory only), `runtime.blocked` set, `redirectToAdminLoginIfNeeded()` (not when already on `/admin/login`).
- [ ] Loading gate (`AdminSessionRestoreGate` / `AdminLoadingBlock`) during restore; 8s watchdog redirects to sign-in if stuck.
- [ ] `/admin/login`: `AdminGuestOnly` shows form immediately (`useAdminGuestSessionRestore`, `admin-guest` audience, `redirectOnFailure: false`); no reload loop on failed restore.
- [ ] Browser API calls use page origin (`lib/api-base.ts` → `/api/v1` on same host as UI); LAN/mobile dev uses `ALLOWED_DEV_ORIGINS`.
- [ ] Logout uses `logoutLocalSession()`, not `clearSession()` alone.
- [ ] Non-admin tokens (e.g. CUSTOMER role refresh succeeds but role check fails) redirect to `/dashboard`, not `/admin/login`.

**Session expiry warning (`AdminSessionWarning`):**
- [ ] Warning banner renders when `accessToken` is within 2 minutes of expiry.
- [ ] "Extend session" button calls `refreshAccessToken()` and updates store via `setAccessToken()` — no page reload.
- [ ] Button shows `Loader2` spinner during the network call.
- [ ] Error state shown if refresh fails ("Session is no longer valid for admin access.").
- [ ] "Sign in again" button calls `logoutLocalSession()` + redirects to `/admin/login`.

**Idle timeout (`AdminIdleTimeoutModal` inside `AdminConsoleShell`):**
- [ ] Warning modal fires after 25 minutes of inactivity (no mouse, keyboard, touch, scroll, or click events).
- [ ] Modal shows countdown timer from 5:00 to 0:00, decrementing every second.
- [ ] "Stay signed in" calls `refreshAccessToken()` and dismisses the modal.
- [ ] "Sign out now" calls `logoutLocalSession()` + redirects to `/admin/login`.
- [ ] Auto-logout triggers when countdown reaches 0.
- [ ] User activity while modal is open (any tracked event) dismisses it without logging out.
- [ ] Idle tracking is disabled when `accessToken` is null (no timers running on the login page).

### 3.0b) Ops merchant admin re-invite (Critical)

- [ ] `/ops/invites` uses **merchant admin invite** form (not top ops-operator form) to restore deactivated merchant admins.
- [ ] `POST /ops/admin-invites` succeeds for deactivated admin email; setup at `/admin/setup` completes without `409 User already exists`.
- [ ] Ops operator invite form surfaces backend message when email belongs to deactivated merchant admin (directs to merchant admin invite).
- [ ] `OpsAdminUsersPanel` links operators to merchant admin invite flow after deactivation.

### 3.1) Ops Control Plane Security (Critical)

**Browser-Session-Only Authentication:**
- [ ] Ops login uses 2-step OTP flow (request-otp → verify-otp → httpOnly cookie)
- [ ] Ops session is httpOnly cookie (no localStorage, no API keys)
- [ ] No `x-ops-key-id` or `x-ops-api-key` headers in any ops requests
- [ ] Logout clears session via `POST /ops/auth/logout`

**Critical Ops Operations Require OTP (6 Endpoints):**
- [ ] `POST /ops/config/save` implements OTP modal flow (action: `config-save`)
- [ ] `POST /ops/load-shed` implements OTP modal flow (action: `load-shed-change`)
- [ ] `POST /ops/system/restart` implements OTP modal flow (action: `system-restart`)
- [ ] `POST /ops/users/:id/deactivate` implements OTP modal flow (action: `user-deactivate`)
- [ ] `POST /ops/admin-users/:id/deactivate` implements OTP modal flow (action: `admin-user-deactivate`)
- [ ] `POST /ops/invites/:id/revoke` implements OTP modal flow (action: `invite-revoke`)

**OTP Challenge Implementation:**
- [ ] Step 1: Call `POST /ops/otp/request` with `{ action }` (not `actionType`) → get `challengeId`
- [ ] Step 2: Show OTP input modal with 10-minute countdown timer
- [ ] Step 3: Submit mutation with `challengeId` + `otpCode`
- [ ] Handle 401 (invalid OTP) showing remaining attempts (max 3)
- [ ] `POST /ops/config/save`: validate first; `domain` optional; `null` value removes overlay key; partial batches are accepted (save 1–N keys at a time)
- [ ] After successful save, UI shows a **manual restart hint** (link to `/ops/system` and a note about VPS `docker compose up -d backend workers`) — no automatic restart prompt
- [ ] `GET /health/ready`: parse envelope `data` on HTTP 503 (`CONFIG_NOT_READY`) for `runtimeConfigMissingKeys`
- [ ] Handle 429 (rate limit) with backoff
- [ ] Handle 503 `ops_audit_chain_lock_timeout` with 1-2s retry
- [ ] After 5 failed attempts, challenge locked — must request new OTP

**Ops Permission Model:**
- [ ] `ops:read` — grants read access to all ops endpoints
- [ ] `ops:write` — grants write access (requires OTP for critical mutations)
- [ ] `OPS_APPROVE` permission does not exist (removed June 2026)

## 4) Idempotency on Critical Mutations

- [ ] `idempotency-key` is sent on:
  - `POST /api/v1/orders`
  - `POST /api/v1/orders/:id/cancel`
  - `POST /api/v1/payments/initiate`
  - `POST /api/v1/payments/verify`
  - destructive admin writes (create/update/delete affecting inventory/orders/payments)
- [ ] Each user action generates a new unique idempotency key.
- [ ] Retries reuse the same key for the same intent.
- [ ] Frontend handles `409 CONFLICT` on state-changing actions by refreshing state and retrying appropriately (backend uses atomic CAS patterns — concurrent mutations receive 409 with descriptive error code).

## 5) Checkout Flow Split (Mandatory)

- [ ] **`GET /api/v1/store/config`** loaded before checkout (fail-closed when `configAvailable === false`).
- [ ] COD option gated on `isCodEnabled` from store config (not admin API or build-time env).
- [ ] **`GET /api/v1/cart/delivery-rates?pincode=&paymentMode=`** called with the selected payment mode; shipping errors show unavailable (no false “Free”).
- [ ] Customer cancel button only for `CONFIRMED` / `PROCESSING` — not `PENDING_PAYMENT` / `PAYMENT_FAILED`.
- [ ] **`POST /payments/retry`** invoked from payment page only (single call); order detail navigates without duplicating retry.
- [ ] PREPAID flow implemented exactly:
  1. `POST /api/v1/orders`
  2. `POST /api/v1/payments/initiate`
  3. Razorpay modal
  4. `POST /api/v1/payments/verify`
- [ ] COD flow implemented exactly:
  1. `POST /api/v1/orders` with `{ "paymentMode": "COD" }`
  2. Skip Razorpay modal
  3. Skip `/payments/initiate`
  4. Treat COD payment status semantics as `CREATED` -> `CAPTURED` (do not invent `PENDING`/`PAID` enums in frontend logic)
  5. Shipment remains manual-only via admin `POST /api/v1/admin/orders/:id/ship`
- [ ] Prepaid retry path uses `POST /api/v1/payments/retry`.
- [ ] Shipping is treated as manual-only in admin UX: payment confirmation does not trigger shipment booking automatically.
- [ ] Admin order UI respects backend ship-state fields (`canShipNow`, `shipBlockReason`, `shippingMode`) before enabling ship action.
- [ ] Admin refund UX reflects deferred state semantics: requesting `REFUNDED` can return a successful response while order status remains pre-refund until asynchronous refund worker/provider confirmation completes.

## 6) Webhook Boundary Enforcement

- [ ] Browser/frontend never calls webhook endpoints:
  - `/api/v1/payments/webhook`
  - `/api/v1/shipping/webhook`
- [ ] No frontend route, action, or utility invokes any backend `*webhook*` endpoint.

## 7) Money & Data Integrity

- [ ] Business logic uses paise integers from backend.
- [ ] UI formatting converts paise to currency display only.
- [ ] No calculations are performed on already formatted display strings.

## 8) AI Agent Output Review (Code Review Gate)

- [ ] Generated API layer is centralized and typed.
- [ ] No direct fetch duplication across components for critical flows.
- [ ] No secrets in client bundles (`NEXT_PUBLIC_*` checked).
- [ ] No unsafe assumptions about envelope-only or raw-only responses.
- [ ] No webhook invocations from browser code.

## 8.1) Simultaneous Build + Integration Gate (Mandatory)

- [ ] Frontend work is organized as **vertical slices** (contract -> API client -> UI -> integration -> tests), not page-only batches.
- [ ] For each slice, routes and request/response schemas are frozen before UI implementation begins.
- [ ] For each slice, API calls are integrated with real backend routes (no permanent mock-only slice closure).
- [ ] Admin and ops surfaces are delivered in this order unless intentionally overridden with documented rationale:
  1. Foundation (auth, refresh, API client, error mapper, permission-aware nav)
  2. Ops control plane surfaces
  3. Admin read surfaces
  4. Admin mutation surfaces
  5. Reliability/replay surfaces
  6. Storefront customer journey surfaces
- [ ] Slice closure criteria are enforced:
  - happy path + negative path complete,
  - permission-aware UX + backend 401/403 handling complete,
  - idempotency behavior complete for critical writes,
  - one integration test and one UI interaction test passing.
- [ ] Milestone cadence is enforced every 4-6 merged slices:
  - rerun backend guardrail/release subset,
  - verify BRD AC mapping coverage,
  - execute one full end-to-end high-risk scenario.
- [ ] Coupon admin UI covers the full lifecycle: create, edit, pause/resume, soft-delete, and restore. The list view shows deleted coupons in a separate "deleted" state (not permanently hidden) with a restore action.
- [ ] Deleting a coupon calls `DELETE /api/v1/admin/coupons/:id` (soft-delete) **without a JSON body**. The UI never calls a hard-delete endpoint because none exists.
- [ ] Restoring a coupon calls `POST /api/v1/admin/coupons/:id/restore` **without a request body** and refreshes the coupon state to active.
- [ ] Coupon list **Usage** column shows `used / limit` (e.g. `0 / ∞` when unlimited) — not a bare `/ ∞`.
- [ ] Audit log view per coupon (`GET /api/v1/admin/coupons/:id/audit`) is accessible from the coupon detail screen, showing actor, timestamp, action, and before/after diff.
- [ ] UI handles `RATE_LIMIT_EXCEEDED` (429) on coupon write actions with a user-friendly message (e.g. "Too many operations — please wait a moment") rather than a generic error.
- [ ] `BUY_X_GET_Y` coupon type is disabled/hidden in create/edit forms until v2.2 (backend rejects it with `VALIDATION_ERROR`).
- [ ] Coupon UI is fully gated on `FEATURE_COUPONS_ENABLED` — if the flag is off the coupon nav item and routes do not render.
- [ ] Merchant actions are never routed through ops endpoints to simplify UI logic.
- [ ] Ops load-shed change applies immediately via `POST /ops/load-shed` (single-step, OTP-confirmed) — no separate approval step or confirm/reject UX.
- [ ] Ops control plane surfaces handle `503 ops_audit_chain_lock_timeout` as retryable after 1–2 second backoff (audit chain lock contention under concurrent ops activity — not a failure).
- [ ] Ops console navigation is hidden on `/ops/login` and `/ops/setup`; protected `/ops/*` routes redirect to login when `GET /ops/session` returns `401`.
- [ ] Ops config UI surfaces (`/ops/config/overview`, `/ops/config/stored`, `/ops/config/save`) follow contract metadata (`mutableViaOps`, `requiresRestart`, `runtimeSource`).
- [ ] Ops config editor consumes `GET /api/v1/ops/config/stored` per-row `{ maskedValue, plaintextValue }` correctly: **every** input (including real secrets like `RAZORPAY_KEY_SECRET`, `SHIPROCKET_PASSWORD`, `RESEND_API_KEY`, `MSG91_AUTH_KEY`, `META_WHATSAPP_ACCESS_TOKEN`) is prefilled with `plaintextValue` so operators can see and edit the saved value in place. This is the deliberate Ops console policy (see backend `getStoredConfigSecrets` JSDoc, `docs/HARDENING_HISTORY.md`, and `docs/DECISIONS.md`) — workspace rule "never show plaintext secrets in admin UI" is explicitly overridden for this surface only because it is platform-operator-only behind ops login + OTP + audit chain.
- [ ] Secret-classified inputs (`isOpsConfigSecretKey()` mirror predicate in `frontend/lib/ops-config-fields.ts`) render as `<input type="password">` with an eye toggle so the rendered DOM stays bullet-masked until the operator opts to peek. The value is still in browser memory regardless — the toggle is shoulder-surfing prevention, not crypto isolation.
- [ ] **Merchant admin and customer surfaces** continue to obey the workspace rule "never show plaintext secrets in admin UI" — verify no provider secret is exposed through `/admin/*` or storefront routes. The plaintext policy is scoped to `/ops/config/stored` only.
- [ ] Ops config editor displays a clear "Restart required" hint after a successful save (response `requiresRestart: true`) and links operators to `/ops/system` to trigger `POST /api/v1/ops/system/restart`. **The save action itself does not auto-trigger a restart** — the UI must surface this expectation.
- [ ] Bootstrap-only Ops config keys (`DATABASE_URL`, initial `REDIS_URL`, `OPS_DB_ENCRYPTION_KEY`) render as read-only with operator copy that changes must happen in deployment env/secret manager, not via DB-backed save.
- [ ] DB-overlay eligible Ops config keys show restart-required semantics clearly: saved values are encrypted at rest, override env only for contract-allowed non-bootstrap keys, and apply only after API/worker restart.
- [ ] `/admin/setup` consumes merchant admin invite tokens only through `POST /api/v1/admin/invites/consume`; tokens are never stored in localStorage/sessionStorage/logs, and expired/consumed/invalid tokens produce a safe terminal state requesting a fresh ops-issued invite.
- [ ] Merchant admin setup UI never displays or requests `ops:*`, `developer:*`, provider-secret, database, Redis, or ops-control permissions.
- [ ] Frontend invoice behavior follows backend contract: CTA gated by `invoice.hasPdf`; customer/admin downloads use authenticated routes (`/orders/:id/invoice.pdf`, `/admin/orders/:id/invoice.pdf`).
- [ ] Customer detail page loads paginated order history via `GET /api/v1/admin/users/:id/orders` (not by re-fetching the full detail). Requires `users:read`.
- [ ] Customer ban/unban flow is fully implemented: `PATCH /api/v1/admin/users/:id/ban` (requires `users:write`, mandatory `reason` field) and `DELETE /api/v1/admin/users/:id/ban` (unban). UI reflects `isBanned`, `bannedAt`, `bannedReason` from the customer detail response. Banning a non-customer account (admin) is blocked — UI guards the action on the `role` field.
- [ ] Admin notes (`GET`/`POST`/`DELETE /api/v1/admin/users/:id/notes`) are gated on `users:read`/`users:write`. Notes are never shown to the customer. Delete confirmation should display the note content before removal.
- [ ] Inventory bulk-update (`POST /api/v1/admin/inventory/bulk-update`) sends an array of `{ variantId, adjustment, note }` objects (max 100). UI provides clear feedback on the per-variant rollback behaviour when any item fails.
- [ ] Inventory adjustment history (`GET /api/v1/admin/inventory/history/:variantId`) is accessible from the variant detail/stock view, paginated. Requires `inventory:read`.
- [ ] Product variant delete (`DELETE /api/v1/admin/products/:id/variants/:variantId`) is guarded in UI — action is disabled if the product has only one variant. Backend returns `400` in this case; frontend surfaces it as "Cannot delete the last variant of a product."
- [ ] Product **deactivate** (`DELETE /api/v1/admin/products/:id`) is labeled **Deactivate** in UI (soft delete — reversible). Product **permanent delete** (`DELETE /api/v1/admin/products/:id/permanent`) is a separate destructive action in `AdminRowActionsMenu` with confirmation; surfaces backend **409** when order history or reviews block deletion.
- [ ] Product create/edit form maps `VALIDATION_ERROR.details.fields` to highlighted inputs (`data-admin-field`), inline errors, and scroll-to-first-error. Create flow includes required **Category** and **URL Slug** fields. Generic "check highlighted fields" banner also lists field-specific messages.
- [ ] Global shipment list (`GET /api/v1/admin/shipments`) and global payment list (`GET /api/v1/admin/payments`) are loaded via their dedicated endpoints, not by aggregating per-order requests. Requires `shipments:read` and `payments:read` respectively.
- [ ] Return request detail (`GET /api/v1/admin/return-requests/:id`) is accessible from the return request queue. Requires `orders:read`.
- [ ] Return requests for a specific order are shown in the order detail view via `AdminOrderReturnRequestsPanel` — calls `GET /api/v1/admin/return-requests?orderId=<id>`. Requires `orders:read`. The global returns list also supports `?orderId=` filter (added 2026-06-14).
- [ ] **Admin permission guard coverage** (added 2026-06-14 audit): all admin mutation buttons in `AdminOrderFulfillmentPanel` are gated — Ship (`orders:write`), Cancel (`orders:write`), Schedule Pickup (`orders:write`), Retrigger Email (`orders:notify`), Refund (`orders:refund`). Verify `hasAdminPermission(user, ADMIN_PERMISSIONS.xxx)` guard wraps every destructive or write action in the fulfillment panel.
- [ ] `AdminPaymentsList` detail drawer shows both `refundedAmountPaise` and `refundPendingAmountPaise` (conditional on > 0) so operators can see in-progress refunds.
- [ ] Review hard-delete (`DELETE /api/v1/admin/reviews/:id`) requires `reviews:moderate`. UI shows a destructive confirmation modal — this is permanent, not a soft-delete.
- [ ] Storefront homepage testimonials (`TestimonialsSection`) load from `GET /api/v1/reviews/recent?limit=3` when **`FEATURE_REVIEWS_ENABLED=true`**. Section is hidden when the API returns no approved reviews with written body. PDP reviews use `GET /api/v1/reviews/product/:slug` via `ProductReviewsSection`. Admin moderation (`PATCH /api/v1/admin/reviews/:id/moderate`) is the gate for both surfaces.

## 9) Release Validation Commands (Backend Cross-Check)

Run from backend root before sign-off:

> These commands are the backend release gate subset. Also execute and archive `docs/BACKEND_GO_LIVE_CHECKLIST.md`, which validates full environment-to-implementation parity (not only provider configuration).

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
cmd /c npm run parity:scorecard
```

Sign-off expectation:
- [ ] All commands exit `0`.
- [ ] `release:guard` reports pass.
- [ ] Guardrails pass for admin/docs/config parity.

## 10) Final Go-Live Sign-Off

- [ ] Real payment provider credentials configured for production-like profile.
- [ ] At least one shipping provider's credentials configured for production (Delhivery and/or Shiprocket). Both can be active simultaneously — cheapest rate wins at checkout. `Shipment.provider` DB field records which provider fulfilled each order.
- [ ] Frontend env values match deployed domains exactly.
- [ ] UAT completed for guest checkout, auth checkout, COD, prepaid, retry, cancellation.
- [ ] Team confirms no `noop` usage in production-like deploy.
- [ ] Provider onboarding and secret lifecycle controls follow `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` (public-vs-secret env boundaries, rotation, incident response).
- [ ] Admin UI and support runbooks acknowledge permission snapshot behavior: grant/revoke changes on admins are token-issuance scoped and may require logout/re-auth for immediate UI/API effect.

---

## Security Verification Summary (June 2026)

### Verified Security Invariants

**Authentication & Session:**
- ✅ No tokens in localStorage/sessionStorage (memory-only access tokens)
- ✅ httpOnly, secure, sameSite=strict cookies for refresh tokens
- ✅ 2-step OTP login for admin and ops
- ✅ Secondary OTP required for 5 critical ops operations
- ✅ SHA256 hashing for all tokens and OTPs
- ✅ No API keys in ops (browser-session-only)

**Authorization:**
- ✅ 2 ops permissions: `ops:read`, `ops:write` (no `OPS_APPROVE`)
- ✅ 25 admin permissions across 3 layers
- ✅ Fail-closed permission model
- ✅ Live `isActive` checks on every request

**Data Protection:**
- ✅ bcrypt 12 rounds for passwords
- ✅ AES-256-GCM for config secrets
- ✅ Sensitive data redaction in logs
- ✅ No stack traces in production errors

**Network Security:**
- ✅ Strict CSP (no 'unsafe-inline')
- ✅ Helmet security headers
- ✅ CORS origin validation
- ✅ Tiered rate limiting

**Audit & Compliance:**
- ✅ Tamper-evident audit chain
- ✅ Cryptographic chain hashing
- ✅ Structured audit logging

### Recent Security Hardening (Verified)

| Change | Date | Status |
|--------|------|--------|
| OTP enforcement on 5 critical ops endpoints | June 2026 | ✅ Verified |
| Dual approval system removal | June 2026 | ✅ Verified |
| CSP hardening (no 'unsafe-inline') | June 2026 | ✅ Verified |
| Browser-session-only ops auth | June 2026 | ✅ Verified |
| OTP test hash fixes (SHA256) | June 2026 | ✅ Verified |

### Security Score: 10/10

**Status: PRODUCTION-READY**

All security gates passing:
- `npm run typecheck` → exit 0
- `npm run test:unit` → 487/487 pass
- `npm run ci:reliability-gates` → exit 0
- Security tests → all pass
- E2E tests → all pass
- Backend VPS Phase 7 stabilization evidence references `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md` (strict env/startup + DB routing gates)

---

## Quick Reuse Note (Per Client)

For each new client project:
1. Duplicate this checklist in the client deployment workspace.
2. Fill pass/fail notes beside each item.
3. Archive the completed checklist with release evidence (build logs, test logs, environment snapshot).

---

> **This checklist is used twice in the client onboarding process:** first as part of **Phase 5** (full local integration testing gate — run against the local dev environment before any VPS work) and again as part of **Phase 12** (go-live validation against the live VPS deployment). The complete ordered sequence — client intake → third-party accounts → backend config → provider dry-runs → frontend build → **full local testing gate (Phase 5, this checklist)** → VPS baseline → VPS deploy → ops bootstrap → admin provisioning → frontend deploy → webhook registration → **VPS go-live validation (Phase 12, this checklist again)** → DNS cutover → post-handoff — see **[`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](CLIENT_ONBOARDING_EXECUTION_ORDER.md)**.
