# Architectural Decisions

> **Format:** each entry is `[date] Title — Decision. Rationale. Alternatives considered. Affects.`

---

## [2026-06-10] STOREFRONT_URL fail-fast at boot in production-like profiles

**Context:** `auth.service.ts` uses `process.env.STOREFRONT_URL ?? 'http://localhost:3101'` when building password-reset links. A missing bootstrap value would silently send customers localhost URLs in production.

**Decision:** In `app.config.ts`, production-like profiles (`NODE_ENV` not `development` or `test`) throw at boot if `STOREFRONT_URL` is absent or still a placeholder. CORS plugin already fail-fast for missing origins; this closes the email-link gap.

**Alternatives considered:**
- *Remove localhost fallback in auth.service only.* Rejected — boot-time guard catches misconfiguration before any email is sent; service-layer fallback remains as dev convenience.

**Affected files:** `src/config/app.config.ts`, `src/modules/auth/auth.service.ts` (unchanged fallback for dev), `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`, `docs/ENV_VS_DB_CONFIG_REFERENCE.md`.

---

## [2026-06-10] Canonical brand logo in Next.js `public/` + `BRAND_LOGO_SRC`

**Context:** Logo file lived at repo root and in duplicate `frontend/public/logo.png` with hardcoded paths in header/admin components.

**Decision:**
1. Single asset: `frontend/public/images/raghava-organics-logo.png`.
2. Export `BRAND_LOGO_SRC = "/images/raghava-organics-logo.png"` from `frontend/lib/constants.ts`.
3. All storefront header, mobile nav, and admin shell components import the constant — never hardcode paths or store logos at repo root.

**Affected files:** `frontend/lib/constants.ts`, `frontend/components/layout/Header.tsx`, `MobileNav.tsx`, `AdminConsoleShell.tsx`, `ECOM_MASTER.md` §12.5.

---

## [2026-06-10] Runtime storefront config — `GET /api/v1/store/config` (supersedes build-time feature flags for customer UI)

**Context:** Storefront COD, min order, and module flags (`FEATURE_*`) were mirrored in Next.js build-time env vars. Changing backend flags or admin COD settings required a frontend redeploy to reach customers. Admin GST field visibility also used `NEXT_PUBLIC_FEATURE_GST_INVOICING_ENABLED`.

**Decision:**
1. Add public **`GET /api/v1/store/config`** returning `isCodEnabled`, `minOrderValuePaise`, `mobileOtpSignupEnabled`, `couponsEnabled`, `reviewsEnabled`, `wishlistEnabled`, `gstInvoicingEnabled` (DB fields + backend feature flags).
2. Storefront wraps routes in **`StoreConfigProvider`** (`lib/storefront-settings.ts`, ISR `revalidate: 60`). Fail-closed when fetch fails (`configAvailable: false` — block checkout).
3. Admin GST panels (`StoreSettingsPanel`, `AdminProductEditor`) fetch the same endpoint client-side for `gstInvoicingEnabled`.
4. **`NEXT_PUBLIC_FEATURE_*`** env vars are legacy/fallback only — do not rely on them for storefront or admin GST visibility in new work.

**Alternatives considered:**
- *Keep build-time flags only.* Rejected — ops cannot toggle COD/modules without redeploying Next.js.

**Affected files:** `settings.service.ts`, `settings.routes.ts`, `frontend/lib/storefront-settings.ts`, `StoreConfigProvider.tsx`, `CheckoutForm.tsx`, admin GST panels, `NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`, `ENV_VS_DB_CONFIG_REFERENCE.md`.

---

## [2026-06-10] Coupon checkout reservation includes `PAYMENT_FAILED`

**Context:** `COUPON_RESERVED_ORDER_STATUSES` counted only `PENDING_PAYMENT`. A failed prepaid checkout released cart reservations but the order still held the coupon slot in usage-limit math, allowing another customer to exceed `maxUsesTotal` / per-user caps while the first customer could retry.

**Decision:** Reserve coupon capacity for both `PENDING_PAYMENT` and `PAYMENT_FAILED` until finalize (`usesCount` + `CouponUsage` row) or explicit release (`releaseCouponUsageForOrder`, stale cancel, reconciliation). Centralize in `src/common/coupons/coupon-usage.ts`.

**Affected files:** `coupon-usage.ts`, `cart.service.ts`, `orders.service.ts`, `order-processing.worker.ts`, `reconciliation.worker.ts`, `BRD.md` BR-CPN rules.

---

## [2026-06-10] Reconciliation auto-heal defaults — three safe types; shipment mismatch manual

**Context:** Default auto-heal included `ORDER_SHIPPED_WITHOUT_SHIPMENT`, which could auto-transition orders without operator review. Refund mismatch heal did not restore inventory or clear coupon links. Stale abandoned `PAYMENT_FAILED` orders were detected but not consistently cleaned up.

**Decision:**
1. Default `RECONCILIATION_AUTO_HEAL_ISSUES` (unset) = `PAYMENT_CAPTURED_ORDER_NOT_CONFIRMED`, `REFUNDED_STATUS_MISMATCH`, `STALE_PENDING_PAYMENT`.
2. `ORDER_SHIPPED_WITHOUT_SHIPMENT` remains detected; heal policy = manual review. Open issues auto-resolve when a shipment row exists.
3. `REFUNDED_STATUS_MISMATCH` heal restores inventory (when applicable), releases coupon usage, clears unfinalized coupon links.
4. Stale `PAYMENT_FAILED` cleanup runs under the `STALE_PENDING_PAYMENT` heal key; issue logged as `STALE_PAYMENT_FAILED`.

**Affected files:** `reconciliation.worker.ts`, `ENV_VS_DB_CONFIG_REFERENCE.md`, `BACKEND_GO_LIVE_CHECKLIST.md`.

---

## [2026-06-10] COD inventory restore guard — `COD_ORDER_CREATED` history

**Context:** COD orders return `CONFIRMED` synchronously but inventory deducts asynchronously in the worker (`triggeredBy: COD_ORDER_CREATED`). Cancel before worker completion incorrectly restored stock that was never decremented, inflating inventory.

**Decision:** `restore-inventory-on-cancel.ts` skips COD inventory restore until `COD_ORDER_CREATED` appears in order status history (or is present on the loaded snapshot).

**Affected files:** `restore-inventory-on-cancel.ts`, cancel paths in `orders.service.ts`, `reconciliation.worker.ts`.

---

## [2026-06-10] Frontend GST invoicing UI — runtime `/store/config` (supersedes build-time-only decision)

**Supersedes:** earlier same-day entry that documented `NEXT_PUBLIC_FEATURE_GST_INVOICING_ENABLED` as the admin GST visibility source.

**Decision:** Admin GSTIN/FSSAI and product GST fields use **`gstInvoicingEnabled` from `GET /store/config`**. Env var remains in templates for backward compatibility but is not authoritative. Customer invoice download uses **`invoice.hasPdf`** on order payloads, not the GST flag.

**Affected files:** `StoreSettingsPanel.tsx`, `AdminProductEditor.tsx`, `orders-api.ts`, `frontend/.env.example`.

---

## [2026-06-10] SSR product image URLs — no implicit localhost fallback

**Context:** `resolveProductImageUrl()` could prefix relative `/api/v1/media/...` paths with `http://localhost:3101` during SSR when `NEXT_PUBLIC_IMAGE_CDN_URL` was unset, baking localhost into production HTML if env vars were missing at build time.

**Decision:** SSR absolute-URL prefix applies only when `NEXT_PUBLIC_STOREFRONT_URL` is explicitly set. Otherwise return the relative path (browser resolves against page origin). Production must set `NEXT_PUBLIC_IMAGE_CDN_URL` to match Ops `R2_PUBLIC_BASE_URL`.

**Affected files:** `frontend/lib/media-url.ts`, `frontend/.env.production.example`, `NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §7.2.

---

## [2026-06-10] Notification worker provider failure counters — wire success/failure hooks

**Context:** `onProviderSuccess` and `onProviderFailure` in `notifications.worker.ts` were implemented but never invoked — TypeScript reported them as unused; systematic provider outage alerting did not run.

**Decision:** Call `onProviderSuccess` after each successful email/SMS/WhatsApp send (direct and primary-channel paths); call `onProviderFailure` in catch blocks before rethrowing. Preserves existing `notificationLog` writes and `sendNotificationFailureAlert` behaviour.

**Affected files:** `queues/workers/notifications.worker.ts`, `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`.

---

## [2026-06-03] Product media on Cloudflare R2 — Ops DB overlay, not bootstrap `.env`

**Context:** Admin product images needed automatic upload to R2 in production, batch multipart, and CDN URLs in `ProductImage.url`, without storing R2 secrets in VPS `backend/.env`.

**Decision:**
1. New `media` module: `product-media-provider`, `r2-product-media.storage`, `local-product-media.storage`, `media.routes.ts`.
2. `MEDIA_STORAGE_PROVIDER`, `R2_*`, `R2_PUBLIC_BASE_URL` live in **Ops UI** (Product Media domain) and apply via ops config overlay at boot; `resetProductMediaStorageCache()` after save.
3. `POST /api/v1/admin/products/:id/images/upload` — batch `file` parts, server-assigned `sortOrder`, compensating R2 delete on partial failure.
4. `GET /api/v1/media/products/*` only when provider is `local`.
5. Preflight: `npm run verify:r2-media` fails if R2 keys remain in `.env`.

**Affected files:** `src/modules/media/*`, `src/modules/products/products.service.ts`, `src/modules/ops/ops-config-contract.ts`, `scripts/verify-r2-media-config.mjs`, frontend `lib/media-url.ts`, `lib/admin-product-media.ts`.

---

## [2026-06-03] Backend scripts cleanup — index + remove ad-hoc probes

**Context:** `backend/scripts/` accumulated one-off debug and superseded bootstrap/smoke scripts.

**Decision:** Delete `debug-cwd.js`, `debug-startup.mjs`, `check-email-provider.js`, `check-email-provider2.js`, `check-infra.js`, `admin-live-smoke.mjs`, `ops-bootstrap.mjs`. Add `scripts/README.md` as the canonical index; `ops:newuser` replaces `ops-bootstrap.mjs`.

**Affected files:** `backend/scripts/README.md`, `backend/README.md`, `package.json` (`verify:r2-media`).

---

## [2026-06-03] Admin per-page date ranges & dynamic KPI trends

**Context:** A global date range in `AdminConsoleShell` duplicated state and produced misleading fixed "vs last 7 days" labels when operators changed the window on one page only.

**Decision:**
1. Remove shell-level date state; keep `admin-shell-context` for **export handler pub/sub** only.
2. Add `AdminDateRangePicker.tsx` (presets + custom range) with `prevRange`, `rangeToISO`, `trendPeriodLabel`.
3. Each analytics-heavy page owns local `DateRange`: Dashboard, Orders, Payments, Coupons, Reviews.
4. KPI footers use `trendPeriodLabel(from, to)`; comparison queries use `prevRange()` for an equal-length prior window.

**Affected files:** `frontend/components/admin/AdminDateRangePicker.tsx`, `frontend/app/(admin)/admin/page.tsx`, `orders/page.tsx`, `payments/page.tsx`, `coupons/page.tsx`, `reviews/page.tsx`, `AdminDashboardPanels.tsx`, `AdminAnalyticsPanels.tsx`.

---

## [2026-06-03] Admin product editor — `isActive`, `metaDescription`, featured; strip cosmetic fields

**Context:** Publish Status, Short Description, and Featured were partially cosmetic; `costPrice`, `visibility`, and `publishDate` had no Prisma fields.

**Decision:**
1. Map Status → `isActive`; Short Description → `metaDescription` (500 chars); Featured → `isFeatured` on create/PATCH.
2. Include `lowStockThreshold` on variant create payload; variant table shows compare-at price column.
3. Remove unsupported UI fields; Summary/Preview use live form-derived values.
4. Extend `productListItemSchema` + serialization with `isActive` and `metaDescription` for admin list/detail.

**Affected files:** `AdminProductEditor.tsx`, `products.schemas.ts`, `products.service.ts`, `frontend/lib/admin-product-types.ts` (if present).

---

## [2026-06-03] Admin list enrichment — payments customer, reviews product

**Context:** Payments table showed synthetic `User {uuid}` labels; reviews showed `Product {uuid}`; admin OpenAPI schemas omitted joined fields.

**Decision:**
1. `adminListPayments`: join `order.user`; expose `customerName`, `customerEmail` on list items.
2. Admin reviews: join `product`; expose `productName`, `productSlug` on `reviewAdminItemSchema`.
3. `ReviewWithUser`: `product` optional on type for storefront/owner paths without product include.

**Affected files:** `orders.service.ts`, `orders.schemas.ts`, `reviews.service.ts`, `reviews.schemas.ts`, `AdminPaymentsList.tsx`, `AdminReviewsList.tsx`.

---

## [2026-06-03] Admin Console Frontend Integration — live data (completed pass)

**Context:** Admin dashboard and resource tables previously mixed reference-design placeholders with partial API wiring.

**Decision:**
1. **Dashboard / Orders / Payments / Coupons / Reviews:** FreshMart layout + live `/api/v1/admin/*` data; per-page `AdminDateRangePicker`; no mock customer/product labels on payments/reviews tables.
2. **Shipments:** KPI and status donut computed from API result set (no hardcoded NYC/mock rows).
3. **Customers:** Real ban/unban; status filter sends `?banned=true` for banned-only list; removed decorative VIP/Wholesale badges.
4. **Coupons:** Real usage labels; inline clone code row to avoid clone race.
5. **API safety:** Envelope coercion + idempotency keys on mutations unchanged.

**Rationale:** Operators need trustworthy admin data matching Postgres; schema extensions prevent frontend guessing from IDs alone.

**Affected files:** `frontend/components/admin/*`, `frontend/app/(admin)/admin/**/page.tsx`, `backend/src/modules/orders/*`, `backend/src/modules/reviews/*`, `backend/src/modules/products/products.schemas.ts`.

---

## [2026-06-02] Prisma migration strategy — `db push` for development, `migrate deploy` for production

**Context:** The `0_init` migration contained enum values (`PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `OPS_APPROVE`) and a table (`OpsDualApprovalRequest`) that were later removed from `schema.prisma` as part of the dual-approval system cleanup. This caused `prisma migrate deploy` to fail with `P3009` (failed migrations in target database) because subsequent migrations tried to alter enums that had data referencing the old values. `prisma db push` also failed because it could not drop `OpsActionStatus_old` due to the `OpsDualApprovalRequest` column dependency.

**Decision:**
1. **Development (`scripts/dev-up.cmd`, `scripts/dev-up-workers.cmd`):** Use `prisma db push --accept-data-loss` via `scripts/dev-ensure-prisma-ready.js` when `NODE_ENV !== 'production'`. This bypasses the broken migration chain and syncs the schema directly.
2. **Production (VPS deploy):** Continue using `prisma migrate deploy` — the `0_init` migration was corrected to match the current `schema.prisma` (old enums removed, `OpsDualApprovalRequest` table removed), so a fresh database will apply migrations cleanly.
3. **Fixed `0_init` migration:** Removed `OpsDualApprovalRequest` table creation, indexes, and foreign keys. Updated `OpsPermission` enum to only `OPS_READ`, `OPS_WRITE`. Updated `OpsActionStatus` enum to only `EXECUTED`, `FAILED`.

**Rationale:**
1. **Development velocity:** `db push` is the standard Prisma workflow for rapid schema iteration in local development. It avoids migration history management overhead when the schema is still evolving.
2. **Production safety:** `migrate deploy` remains the only safe mechanism for production — it applies migrations transactionally and preserves data integrity. The corrected `0_init` ensures a fresh production database starts from the correct schema state.
3. **Separation of concerns:** Dev scripts should not be blocked by historical migration artifacts that are irrelevant to the current codebase.

**Alternatives considered:**
- *Squash all migrations into a single new `init`.* Rejected — would break existing databases that already applied `0_init` and subsequent migrations.
- *Add old enum values back to `schema.prisma` permanently.* Rejected — the dual-approval system was intentionally removed; keeping dead values in the schema is technical debt.
- *Manual SQL data migration to remove old enum references before altering enums.* Rejected — overly complex for a local dev fix; the `0_init` correction is the cleaner upstream fix.

**Affected files:** `prisma/migrations/0_init/migration.sql`, `scripts/dev-ensure-prisma-ready.js`, `scripts/dev-up.cmd`, `scripts/dev-up-workers.cmd`, `prisma/schema.prisma`.

---

## [2026-06-02] End-to-end password reset flow — hash-stored tokens, time-bound expiry, email URL delivery

**Context:** The auth system had a `POST /api/v1/auth/forgot-password` endpoint that sent a raw `resetToken` in the email body. This was a security risk (token exposure in email clients, no URL for direct navigation) and the `PasswordResetToken` model did not exist in the Prisma schema.

**Decision:**
1. **Backend model:** Added `PasswordResetToken` to `prisma/schema.prisma` with `id`, `userId`, `tokenHash`, `expiresAt`, `createdAt`. Tokens are SHA-256 hashed before storage (same pattern as refresh tokens).
2. **Backend service (`auth.service.ts`):**
   - `requestPasswordReset`: creates `PasswordResetToken` row with 1-hour expiry, hashes the raw token, stores hash in DB, sends `resetUrl` (not raw token) via email. Returns generic success regardless of whether the email exists (anti-enumeration).
   - `resetPassword`: validates token via `timingSafeEqual` against stored hash, checks expiry, verifies `password === confirmPassword`, updates user password with bcrypt inside a Prisma transaction, then deletes **all** tokens for that user (ensuring single-use and cleanup of stale tokens).
3. **Backend routes:**
   - `POST /api/v1/auth/forgot-password` with `forgotPasswordSchema` (email + optional `turnstileToken`). Protected by `idempotencyPreHandler` and auth-sensitive rate limit.
   - `POST /api/v1/auth/reset-password` with `resetPasswordSchema` (token + password + confirmPassword, 8–128 chars). Protected by `idempotencyPreHandler` and auth-sensitive rate limit.
4. **Email template:** `PasswordResetEmail` component accepts `resetUrl` and renders a styled clickable CTA button (plus plaintext fallback) linking to `/reset-password?token=RAW_TOKEN`.
5. **Frontend page:** `/reset-password` reads `token` from query params, renders `ResetPasswordForm` if present, shows error if missing.
6. **Frontend form:** `ResetPasswordForm` uses React Hook Form + Zod (`resetPasswordInputSchema`), password + confirmPassword inputs with match validation, submit spinner, success banner, and auto-redirect to `/login?reset=success` after 2 seconds.
7. **Frontend API:** `requestPasswordReset()` and `resetPassword()` client functions call their respective endpoints with auto-generated `idempotency-key` headers.

**Rationale:**
1. **Security:** Raw tokens are never persisted — only SHA-256 hashes. `timingSafeEqual` prevents timing attacks. 1-hour expiry limits the attack window.
2. **UX:** A clickable URL in the email is standard industry practice (GitHub, Stripe, Vercel). Users don't need to manually copy-paste tokens.
3. **Idempotency:** Both endpoints accept an idempotency key. The token is single-use because it is deleted immediately after successful password update.

**Alternatives considered:**
- *Send raw token in email body with instructions to visit a page and paste it.* Rejected — worse UX, higher exposure risk.
- *Use JWT for reset tokens.* Rejected — JWTs are stateless and cannot be revoked individually; a database-backed token enables precise invalidation.
- *Magic link (single-click login + immediate password change).* Rejected — more complex flow; the token-based reset is simpler and maps cleanly to the existing auth system.

**Affected files:** `prisma/schema.prisma`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/notifications/templates/email-templates.ts`, `src/modules/notifications/templates/email-template-components.ts`, `src/modules/auth/auth.service.password-reset.test.ts`, `frontend/app/(auth)/reset-password/page.tsx`, `frontend/components/auth/ResetPasswordForm.tsx`, `frontend/lib/auth-api.ts`, `frontend/lib/validators.ts`.

---

## [2026-06-02] Register endpoint auto-login + email normalization

**Context:** `POST /api/v1/auth/register` previously returned only `{ user }`, requiring a separate login call immediately after registration. This added friction and an extra round-trip. Additionally, email lookup in `register`, `login`, and `requestPasswordReset` was case-sensitive and accepted leading/trailing whitespace, causing duplicate accounts and failed logins.

**Decision:**
1. **Backend (`auth.service.ts`):**
   - `register` now returns `AuthResult` (same shape as login: `{ accessToken, user }`) via `issueTokensForUser`, and the route handler sets the HTTP-only `refresh_token` cookie.
   - `email` is normalized with `trim().toLowerCase()` before any DB lookup in `register`, `login`, and `requestPasswordReset`.
   - `resetPassword` password validation (match + length) moved to the top of the function for fail-fast behaviour before the DB lookup.
2. **Backend (`auth.routes.ts`):** Register route handler now calls `setRefreshTokenCookie(reply, auth.refreshToken)` and returns `{ accessToken, user }`.
3. **Backend (`auth.schemas.ts`):** Register response schema now requires `accessToken` (string, max 2048) alongside `user`.
4. **Frontend (`auth-api.ts`):** `registerWithEmail` now returns `AuthSessionResponse` and sends `credentials: "include"` so the refresh cookie is stored.
5. **Dev environment:** Replaced direct `process.env.NODE_ENV !== 'production'` checks with `isDevelopmentLikeNodeEnv()` for consistent development-like profile detection.

**Rationale:**
1. **UX:** Auto-login after registration is standard practice (Stripe, Vercel, GitHub). Eliminates the "register → login" friction.
2. **Consistency:** All auth endpoints that create/verify identity now return the same `AuthResult` shape and set the same refresh cookie.
3. **Data integrity:** Lowercase normalization prevents `John@Example.com` and `john@example.com` from being treated as different users.
4. **Security:** Fail-fast validation in `resetPassword` avoids unnecessary DB reads on invalid input.

**Alternatives considered:**
- *Keep register returning `{ user }` and force a separate login call.* Rejected — worse UX, extra latency, more error surface.
- *Normalize email only in the frontend.* Rejected — backend must be the source of truth for data integrity; frontend normalization is a convenience layer, not a guarantee.

**Affected files:** `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `frontend/lib/auth-api.ts`, `frontend/components/auth/EmailRegisterForm.tsx` (implicit, uses `registerWithEmail`).

---

## [2026-06-09] Shared Redis error listeners and bodyless DELETE route schemas

**Context:** BullMQ and ioredis pub/sub duplicate connections emitted unhandled `error` events on transient network blips. Several DELETE routes incorrectly required an empty JSON body, causing `VALIDATION_ERROR` for standard bodyless DELETE clients (admin coupon delete, coupon restore POST, customer address delete).

**Decision:**
1. Centralize Redis client options and error handling in `src/common/redis/redis-connection.ts` (`attachRedisErrorListener`, `guardRedisDuplicate`, `installGuardedIORedisDuplicate`, `waitForRedisReady`).
2. Publish Redis port `6379` only in base `docker-compose.yml` for local host dev; strip it in `docker-compose.prod.yml`.
3. Omit `body` from route schemas when the HTTP method has no payload — never use `emptyBodySchema` on DELETE.
4. Register `DELETE /api/v1/admin/categories/:id/permanent` in the admin endpoint policy registry.
5. Supplement `parseGuardedRoutesFromWorkspace()` with static records for routes added after last `dist/` build (COD settings, category permanent delete) so registry integrity tests pass against stale compiled output until next production build.

**Affected files:** `src/common/redis/redis-connection.ts`, `docker-compose.yml`, `docker-compose.prod.yml`, `coupons.schemas.ts`, `users.schemas.ts`, `admin-endpoint-policy-registry.ts`, `admin-policy-registry.validation.ts`, worker/API Redis boot paths.

---

## [2026-06-02] Integration readiness verification script — runtime config + health gate for Razorpay/Shiprocket

**Context:** Before deploying to production, there was no automated way to verify that Razorpay and Shiprocket credentials were correctly stored in the Ops DB config overlay and that the backend was ready to process payments and shipping webhooks.

**Decision:**
1. Created `scripts/verify-integration-readiness.mjs` that:
   - Checks `POST /api/v1/health/ready` for `db: connected` and `redis: connected`.
   - Checks `runtimeConfigMissingKeys` for missing `PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and at least one shipping provider's credentials (`DELHIVERY_API_KEY` or `SHIPROCKET_EMAIL`/`SHIPROCKET_PASSWORD`). Note: `SHIPPING_PROVIDER` is not a required key — provider detection is credential-based since 2026-06.
   - Verifies webhook routes `POST /api/v1/payments/webhook` and `POST /api/v1/shipping/webhook` return `404` (route exists, no raw body → Fastify validation rejects) rather than `404 Not Found` (route missing).
   - Prints a color-coded readiness report.
2. Added `npm run verify:integration` alias to `package.json`.

**Rationale:**
1. **Pre-flight safety:** Catches missing provider credentials before deploy rather than after first failed payment.
2. **Self-service:** Platform operators can run one command to verify readiness without needing backend codebase knowledge.
3. **Contract validation:** The 404-from-validation vs 404-not-found distinction proves the webhook routes are registered and have raw body guards.

**Alternatives considered:**
- *Manual checklist in a document.* Rejected — prone to human error, not repeatable in CI.
- *E2E test suite covering payment flow.* Rejected — requires live Razorpay test keys and actual transactions; the readiness script verifies config presence without external dependencies.

**Affected files:** `scripts/verify-integration-readiness.mjs`, `package.json`.

---

## [2026-06-02] tsx v4+ watch command syntax — positional `watch` before flags

**Context:** After a package update, `npm run dev` (which executed `tsx --env-file .env watch src/main.ts`) failed with `ERR_MODULE_NOT_FOUND: Cannot find module '.../watch'` because tsx v4+ interprets `watch` as a file path rather than a subcommand when flags precede it.

**Decision:** Reordered to `tsx watch --env-file .env src/main.ts` (and same for workers). This places the `watch` subcommand in the first positional slot, which tsx v4+ correctly recognizes.

**Rationale:** tsx v4 changed CLI parsing to match Node.js behavior — flags before the subcommand are treated as Node.js flags, and the first non-flag positional is the entry point. `watch` must be the first positional.

**Affected files:** `package.json` (`"dev"` and `"dev:workers"` scripts).

---

## Historical Archive (condensed)

> Older decisions are preserved below in compact form. Full prose lives in git history.

**[2026-05-30] VPS automated cleanup** — Template-based per-client cron cleanup (`scripts/vps-cleanup-template.sh`, `install-vps-cleanup.sh`). Daily at 06:25; Docker dangling + PM2 logs + Next.js cache + runner cache. *Alt: global script (rejected — no client attribution); aggressive prune (rejected — unsafe).* **Affects:** `scripts/vps-cleanup*`, `docs/CLIENT_VPS_SETUP_GUIDE.md`.

**[2026-05-28] Admin session lifecycle** — `AdminGuard` silent refresh-on-load via refresh-token cookie; `useIdleTimeout` 25-min warning + 5-min countdown; password/OTP UX hardening. **Affects:** `AdminGuard`, `AdminSessionWarning`, `useIdleTimeout`, `AdminIdleTimeoutModal`, `AdminLoginForm`, `AdminSetupForm`.

**[2026-05-28] Single-flight refresh (Strict Mode)** — Deduplicated `POST /auth/refresh` via shared in-flight promise to prevent double-mount token rotation race. Generalised to `restoreAuthSessionFromCookie()`. Same-site cookie fix for cross-port dev. **Affects:** `restore-*-session.ts`, `use-*-session-restore.ts`, `stores/auth.ts`.

**[2026-05-28] Merchant admin ops deactivation** — `GET/POST /ops/admin-users` + OTP-gated deactivate. Re-onboard via merchant admin invite reactivates existing `User` id. **Affects:** `ops.service.ts`, `ops.routes.ts`, `OpsAdminUsersPanel`.

**[2026-05-27] Strict typing in tests** — Eliminated `as any` casts in test mocks; explicit `Mock` types; `featureFlags` mutated directly in `beforeEach`/`afterEach` for deterministic flag isolation. **Affects:** `inventory.routes.test.ts`, `cart-cleanup.worker.test.ts`, `notifications.worker.test.ts`, `order-processing.worker.test.ts`.

**[2026-05-26] Worker boot queue self-heal** — Auto-resume paused queues on worker boot (incomplete drain protocol recovery); manual recovery script `scripts/resume-paused-queues.js` with `--dry-run` and `--queues`. **Affects:** `queues/workers/index.ts`, `scripts/resume-paused-queues.js`, `Dockerfile`, `HARDENING_HISTORY.md`.

**[2026-05-26] Maintenance gate 401 fix** — Replaced broken `200 + X-Maintenance-Active + if` Nginx gate (REWRITE phase evaluated before ACCESS) with `401 + error_page 401 = @maintenance_block`. **Affects:** `maintenance.routes.ts`, `nginx/client.conf.template`, `HARDENING_HISTORY.md`.

**[2026-05-25] Maintenance load-shed mode** — Durable Postgres-backed `MaintenanceState` with `pending → active` lifecycle, Nginx `auth_request` gate, payment drain, ops-only exit. Gate mechanism superseded by 2026-05-26 401 fix; state model still current. **Affects:** `prisma/schema.prisma`, `maintenance.routes.ts`, `cart-cleanup.worker.ts`, `ops.service.ts`, nginx template, frontend `MaintenanceBanner`.

**[2026-05-25] Ops config plaintext** — `GET /ops/config/stored` returns `plaintextValue` for all keys (including secrets) scoped to ops console only. Merchant/customer surfaces unchanged. **Affects:** `ops.service.ts`, `ops.routes.ts`, `OpsConfigEditor`.

**[2026-05-25] System restart queue drain** — `scheduled-process-restart` drains BullMQ queues (pause → active-count poll → resume) before PENDING_PAYMENT drain. Feature-flagged. **Affects:** `cart-cleanup.worker.ts`, `cart-cleanup.worker.test.ts`.

**[2026-05-25] Idempotent OTP retry** — `verifyEmailOtp` allows retry on `VERIFIED` challenges (same OTP, within TTL). `scheduleRestart` returns structured failure envelopes with load-shed rollback. **Affects:** `ops.service.ts`, `ops.service.test.ts`.

**[2026-05-25] `COMPOSE_FILE` + `COMPOSE_PROJECT_NAME`** — VPS `.env` sets compose defaults so bare `docker compose` picks up prod overlay automatically. **Affects:** `.env.example`, `vps-deploy.sh`, docs.

**[2026-05-25] Explicit `git pull` in workflow** — Promoted monorepo-root pull to visible workflow step before deploy scripts. `--ff-only` protection. **Affects:** `.github/workflows/deploy.yml`.

**[2026-05-25] Incremental ops config save** — `validateConfigDraft` batch-scoped (no unrelated key failures). Boot tolerant of incomplete provider chains. CD readiness gate warning-only during Phase 8. **Affects:** `ops.service.ts`, `app.config.ts`, `vps-deploy.sh`, `OpsConfigEditor`.

**[2026-05-24] Ops OTP action binding** — OTP challenges bound to single critical action (`config-save`, `load-shed-change`, `user-deactivate`, `system-restart`, `invite-revoke`). `/health/ready` returns diagnostic payload on 503. **Affects:** `ops.routes.ts`, `ops.service.ts`, `health.routes.ts`.

**[2026-05-21] Admin permissions required at invite** — `permissions` now mandatory at admin invite creation (removed `MERCHANT_DEFAULT_PERMISSIONS` silent fallback). Queue inspection moved to ops plane (`queues:inspect` removed from admin). **Affects:** `admin-invites.service.ts`, `ops.routes.ts`, `admin-permissions.ts`.

**[2026-05-21] Route-guard audit** — `print-label` classified as write-rate-limit + idempotency; analytics replay-preview as `adminWrite`; permission-set completeness. **Affects:** `orders.routes.ts`, `analytics.routes.ts`, `admin-invites.service.ts`, scripts.

**[2026-05-20] Mock-detection elimination** — Removed all `if (delegate.updateMany)` / `preferUpdateForMock` shims. `updateMany` used unconditionally. OTP pattern `^[0-9]{6}$` enforced on all 7 input fields. **Affects:** `ops.service.ts`, `auth.service.ts`, `auth.schemas.ts`, `admin-invites.service.test.ts`.

**[2026-05-20] Ops CAS hardening (GAP-3/4)** — `EXPIRED_CLEANED` soft-delete instead of hard-delete for audit trail. `deactivateOpsUser` CAS `updateMany` prevents silent double-deactivation races. **Affects:** `ops.service.ts`, `ops.service.test.ts`.

**[2026-05-20] Admin/ops hardening gaps A–L** — Invite `CANCELLED` status; `actionType` in audit response; IP allowlist at service layer; failed OTP audit logging; explicit `select` on ops user queries; `opsUserId` audit filter; `ENV_READ` not `ENV_UPDATE` for dry-run. **Affects:** `ops.service.ts`, `ops.routes.ts`, `auth.routes.ts`, `inventory.service.ts`, `main.ts`, docs.

**[2026-05-18] Admin login → 2-step email OTP** — Replaced password-only + TOTP with mandatory email OTP (`request-otp` → `verify-otp`). TOTP fields retained in schema for migration safety but unused. **Affects:** `auth.routes.ts`, `auth.service.ts`, `auth.schemas.ts`, docs.

**[2026-05-18] Ops browser login** — Email OTP + `httpOnly` cookie session (`ops_session`). Redis-backed session with live `isActive` DB check. **Affects:** `ops.routes.ts`, `ops.service.ts`, `cookie.plugin.ts`, `prisma/schema.prisma`.

**[2026-05-18] Ops control plane expansion** — Invite revoke, ops user list/deactivate, OTP pending visibility, audit `opsUserId` filter, `ops/config/validate` permission corrected to `ops:read`. **Affects:** `ops.routes.ts`, `ops.service.ts`, `prisma/schema.prisma`.

**[2026-05-17] Per-template notification channels** — DB-backed `StoreSettings.primaryNotificationChannels` JSON; each of 13 templates configurable `EMAIL|SMSF|WHATSAPP`. No fallback. **Affects:** `prisma/schema.prisma`, `settings.service.ts`, `notifications.worker.ts`.

**[2026-06-07] Admin notifications UI removed** — Merchant admin `/admin/settings/notifications` panel removed to eliminate admin–ops redundancy. Notification provider availability (`NOTIFY_EMAIL_ENABLED`, `SMS_PROVIDER`, etc.) is ops-only via `/ops/config`. Per-template channel routing (`primaryNotificationChannels`) remains DB-backed and configurable via direct `PATCH /api/v1/admin/settings/notifications` API. **Rationale:** Provider infrastructure gates belong in ops; merchants set these once at go-live. Consolidating prevents merchants from accidentally disabling a channel the ops team configured. **Affects:** `frontend/components/admin/NotificationsChannelPanel.tsx` (deleted), `frontend/app/(admin)/admin/settings/notifications/page.tsx` (deleted), settings layout nav (Bell link removed).

**[2026-05-17] System-wide technical failure alerting** — Centralised email pipeline with 10-stage failure taxonomy (`critical`/`high`/`suppressed`), dedup (15-min TTL), cache hygiene, worker `onStall`/`onDlqFailure`, process boundary coverage. **Affects:** `notification-failure-alert.ts`, workers, `main.ts`.

**[2026-05-15] SQL injection prevention** — Eliminated all `$executeRawUnsafe` / `$queryRawUnsafe`; parameterized tagged templates only. Added `scripts/sql-injection-guard.js` CI gate. **Affects:** `scripts/sql-injection-guard.js`, `package.json`.

**[2026-05-15] Final CAS hardening** — Inventory `updateMany` CAS; inventory-alerts atomic claim; outbox-dispatch atomic claim; coupon `usesCount` CAS with rollback; admin contract check env-var credentials; MFA test coverage. **Affects:** `inventory.service.ts`, workers, `scripts/admin-contract-check.js`.

**[2026-05-14] Race-condition audit** — Atomic CAS via `updateMany` across idempotency, admin invites, auth refresh tokens, ops state transitions (Redis distributed lock), reconciliation, webhook inbox, analytics replay. **Affects:** `idempotency.ts`, `admin-invites.service.ts`, `auth.service.ts`, `ops.service.ts`, workers, `analytics.service.ts`.

**[2026-05-14] Coupon audit hash chain** — `CouponAuditLog` tamper-evident `chainHash` per coupon (mirrors `OpsAuditLog`). **Affects:** `prisma/schema.prisma`, `coupons.service.ts`.

**[2026-05-14] Per-admin coupon rate limiting** — `AdminRateLimitStore` sliding-window per admin ID. **Affects:** `admin-rate-limit.store.ts`, `coupons.routes.ts`.

**[2026-05-12] Phase-2 ops** — Invite-based onboarding, email OTP MFA, contract-driven encrypted DB config (`OpsConfigSecret` AES-256-GCM), tamper-evident audit chain. **Affects:** `ops.routes/service.ts`, `ops-config-contract.ts`, `ops-config-crypto.ts`, `prisma/schema.prisma`.

**[2026-05-10] Build + integration mandatory** — Contract-first vertical slices for all frontend delivery. Security boundary: merchant `/admin/*`, platform `/ops/*`. **Affects:** `starter-prompt.md`, `frontend-agent-rules.md`.

**[2026-05-10] Documentation sync** — Cross-cutting synchronization of crash observability, MFA key isolation, admin auth semantics, circuit-breaker locality, Prisma drift, deferred refund lifecycle. **Affects:** `README.md`, `BRD.md`, `TRD.md`, `ECOM_MASTER.md`.

**[2026-05-10] Worker bug fixes** — Refunds TOCTOU split; reconciliation auto-heal state-machine bypass; static auto-heal env-driven; module-level Prisma scoped to factory; credit note `jobId`; shipment create split out of DB tx. **Affects:** `refunds`, `reconciliation`, `order-processing`, `shipping` workers.

**[2026-05-10] `process-order-update` canonical job** — Single job replaces scattered confirm/deduct/webhook handlers. Deterministic `jobId` for BullMQ dedup. **Affects:** `order-processing.worker.ts`, `reconciliation.worker.ts`.

**[2026-05-10] Final hardening closeout** — `security.yml` re-blocked; worker Redis lifecycle; nginx split into `rate-zones.conf.template` + `client.conf.template`; queue load-shed dedup removed; reconciliation `PARTIALLY_REFUNDED` ignore; outbox DLQ metric; observability plugin Redis lock. **Affects:** `security.yml`, workers, nginx templates.

**[2026-05-10] CI security scan fixes** — npm audit JSON parsing for npm v10+; `osv-scanner.toml` dev-group ignore; test env stubs. **Affects:** `security.yml`, `osv-scanner.toml`, tests.

**[2026-05-09] Audits 1–13** — 13th: FK `onDelete: Restrict` + nginx `proxy_http_version 1.1`. 12th: 5 missing `@@index` + 14 env vars. 11th: 2 more indexes. 10th: Turnstile `AbortSignal.timeout(10s)` + `Category` self-relation `SetNull`. 9th: 9 `as any` casts eliminated. 8th: Workers `node bootstrap-workers.js` + `AbortSignal.timeout` on adapters. 7th: `prisma` to devDeps. 6th: SMS fall-through fix + `npm prune` + `$executeRaw`. 5th: `.dockerignore` exclude + `$executeRawUnsafe` removal. 4th: nginx rate-limit zones in `http{}` + TLS hardening. 3rd: `upsert-admin.js` env vars + 5 nginx security headers. 2nd: JWT fail-fast + cart `!` guards. 1st: `JWT_REFRESH_SECRET` fail-fast + structural casts. **Affects:** schema, nginx, `auth.service.ts`, `cart.service.ts`, `products.service.ts`, `orders.service.ts`, scripts.

**[2026-05-09] Config / startup hardening** — Unknown provider values rejected at boot; canonical types in `fastify.d.ts`; `database.config.ts` + `redis.config.ts` fail-fast; Prisma global cache dev/test only; webhook IP allowlists throw in prod; DLQ alert recording rule; flash-sale invariant gating. **Affects:** `app.config.ts`, `fastify.d.ts`, `database.config.ts`, `redis.config.ts`.

**[2026-05-09] Shipment dispatch manual-only** — Removed `AUTO_SHIP_ON_CONFIRM`; explicit `POST /admin/orders/:id/ship` required. **Affects:** `orders.service.ts`, `orders.routes.ts`, `order-processing.worker.ts`.

**[2026-05-07] Ops bootstrap CLI** — `scripts/ops-bootstrap.mjs` (removed 2026-06; use `npm run ops:newuser` / `ops-newuser.mjs`). **Affects:** `ops-auth.guard.ts`.

**[2026-05-07] Webhook raw body as Buffer** — `addContentTypeParser` forwards Buffer to prevent UTF-8 roundtrip breaking Razorpay HMAC. **Affects:** `src/main.ts`.

**[2026-05-07] Production startup guard** — Rejects `noop`/placeholder providers in non-dev profiles. **Affects:** `app.config.ts`.

**[2026-05-07] Periodic housekeeping** — IdempotencyRecord purge (daily 3AM), OutboxMessage purge (weekly), RefreshToken purge (daily 3AM). **Affects:** `cart-cleanup.worker.ts`, `bullmq.plugin.ts`.

**[2026-05-07] JWT HS256 + Redis timeout** — Pinned `HS256` for sign/verify; Redis bootstrap rejects after 20s. **Affects:** `jwt.plugin.ts`, `auth.service.ts`, `redis.plugin.ts`.

**[2026-06-14] Dual shipping provider + provider analytics** — Provider selection is now credential-based, not env-var-based. `SHIPPING_PROVIDER` env var is dead/ignored. `resolveDualShippingRuntime()` activates Delhivery if `DELHIVERY_API_KEY` is present, Shiprocket if `SHIPROCKET_EMAIL`+`SHIPROCKET_PASSWORD` are present — both can be active simultaneously. At checkout, all active providers are queried in parallel; the cheapest rate wins and `selectedShippingProvider` is stored on the order. At ship time, the stored provider is used. `Shipment.provider` DB field (DELHIVERY|SHIPROCKET|SELF) records which provider fulfilled each order. New analytics endpoint: `GET /api/v1/admin/analytics/shipping-providers`. `CartService` constructor no longer calls `createShippingProvider()` — shipping detection happens at method call time via `resolveDualShippingRuntime()`. **Affects:** `cart.service.ts`, `orders.service.ts`, `shipping-provider.ts`, `shipping.worker.ts`, analytics module, admin + storefront frontend.

**[2026-05-07] Dev orchestrator scripts** — `dev-up.cmd` / `dev-up-workers.cmd`: container start, Redis/Postgres polling, stale node kill, Prisma bootstrap, noop env, `tsx watch`. **Affects:** `scripts/dev-up.cmd`, `scripts/dev-up-workers.cmd`, `scripts/dev-ensure-prisma-ready.js`.

**[2026-05-06] Shipping webhook noop bypass** — Accepts any non-empty `Authorization` when no shipping credentials are configured (noop mode). Postman idempotency keys use `Date.now()`. **Affects:** `orders.service.ts`, Postman collection.

**[2026-05-05] Noop providers functional** — `NoopShippingAdapter` serviceable/rate mock; `NoopPaymentAdapter` mock order + signature pass. Cart falls back to pincode `500001` in noop mode. **Affects:** noop adapters, `cart.service.ts`, `orders.service.ts`.

**[2026-05-05] India D2C features** — COD (`CodPaymentAdapter`), `cancellationWindowHours`, `ReturnRequest` + `CreditNote`, HSN/GST on `ProductVariant`, GSTIN on `Address`. **Affects:** `prisma/schema.prisma`, payment adapters, `orders.service.ts`, `settings.service.ts`.

**[2026-05-05] Test mocking strategy** — `vi.spyOn(ServiceClass.prototype)` + DI replaces `vi.mock` (incompatible with `vmForks`). **Affects:** all `*.service.*.test.ts`, all workers + worker tests.

**[2026-05-03] `searchVector` removed from schema** — `Unsupported("tsvector")` cannot represent `GENERATED ALWAYS AS`; column managed by raw SQL migration only. **Affects:** `prisma/schema.prisma`.

**[2026-05-03] Docker Compose `env_file`** — Replaced 80+ inline env passthrough with `env_file: .env`; added `postgres` service + health conditions. **Affects:** `docker-compose.yml`.

**[2026-05-02] AST migration for guardrails** — All governance scripts use `parseFastifyRouteConfigsFromAst`. **Affects:** `admin-layer-drift-check.js`.

**[2026-05-02] Parity scorecard evidence linkage** — Tracks `evidenceArtifacts` + `lastEvidenceTimestamp` per axis. **Affects:** `parity-scorecard.js`.

**[2026-05-19] Admin route surface expansion** — New permissions (`users:write`, `shipments:read`, `payments:read`); customer ban/unban; admin notes CRUD; customer order history; bulk inventory update; inventory adjustment history; variant delete; global shipment/payment lists; return request detail; review hard-delete. **Affects:** `admin-permissions.ts`, `users.service.ts`, `products.service.ts`, `inventory.service.ts`, `orders.service.ts`, `reviews.routes.ts`.

**[2026-05-01] `/admin` vs `/ops` split** — Endpoint policy registry + layer-aware guard. Merchant on `/admin/*`; platform on `/ops/*`. **Affects:** `admin-permissions.ts`, `admin-endpoint-policy-registry.ts`, `admin-permissions.guard.ts`.

**[2026-04-29] Compliance guardrails** — Static `route:discipline-check` + `serializer:exposure-check` with CI wiring. **Affects:** `scripts/route-discipline-check.js`, `scripts/serializer-exposure-check.js`, CI.

**[2026-04-29] DB-scoped admin permissions** — `AdminPermissionGrant` resolves from DB first, env fallback. Refund flows require `orders:refund`. Mutations append-audited. **Affects:** `prisma/schema.prisma`, `admin-permissions.ts`, `auth.service.ts`.

**[2026-04-29] CheckoutRiskAssessmentPort** — Pluggable fraud provider port replacing `CheckoutRiskService`. **Affects:** `checkout-risk.service.ts`, `orders.service.ts`, `orders.routes.ts`.

**[2026-04-29] Enterprise maturity controls** — HMAC guest coupon keys; static queue enqueue regression test; webhook IPv4 allowlists; Razorpay skew checks; pluggable checkout risk. **Affects:** `cart.service.ts`, `orders.service.ts`, `webhook-allowlist.ts`.

**[2026-05-XX] Migration squash to `0_init`** — 26 incremental migrations replaced with single baseline. Fresh deploys run `migrate deploy` against baseline. **Affects:** `prisma/migrations/`.

**[2026-05-XX] Fastify FSTDEP022 fix** — `ignoreTrailingSlash` moved to `routerOptions`. **Affects:** `src/main.ts`.

**[2026-05-XX] DB-backed runtime config overlay** — Provider secrets resolved at call time via `resolveRuntimeConfig()` from encrypted `OpsConfigSecret` DB overlay; zero-downtime rotation without redeploy. **Affects:** `orders.service.ts`, `notifications-webhook.service.ts`, `cart.service.ts`.

**[2026-05-XX] Fast2SMS SMS provider** — Selectable alongside MSG91 and noop. **Affects:** `fast2sms.adapter.ts`, `notification-provider.ts`, `prisma/schema.prisma`.

**[2026-05-XX] Merchant SMS templates in StoreSettings** — `smsTemplates` JSON overrides defaults at runtime. **Affects:** `prisma/schema.prisma`, notifications worker, `settings.service.ts`.

**[2026-04-29] Delhivery webhook skew** — `occurredAt` parse/skip/skew enforcement. **Affects:** `orders.service.ts`.

**[2026-05-18] Env→DB enforcement** — All mutable runtime config DB-backed via `OpsConfigSecret`; merchant settings via `StoreSettings`. `.env.example` pruned to bootstrap/infra only. **Affects:** `.env.example`, `ENV_VS_DB_CONFIG_REFERENCE.md`, workers, services.

**[2026-05-18] dbOverlay parity-check** — `.env.example` two-tier layout: live values for bootstrap keys, commented stubs for DB-overlay keys. Enforced by `config-runtime-parity-check.js`. **Affects:** `env-runtime-contract.js`, `config-runtime-parity-check.js`, `.env.example`.

**[2026-04-29] Reliability parity v4–v7** — CI gates: coverage/test-topology, outbox replay, auth abuse, hot-SKU, DR scripts, parity scorecard, flash-sale stress, DR drills, error-budget policy, queue failure taxonomy, DLQ metrics, inbox re-drive. **Affects:** CI, `scripts/*`, `observability/*`, workers.

**[2026-04-28] Reliability foundations** — Observability metrics, load-shed, idempotency-by-header, outbox/inbox persistence, reconciliation worker, cart reservation TTL. **Affects:** `observability/*`, `idempotency/*`, `bullmq.plugin.ts`, `orders/*`, `cart/*`, `prisma/schema.prisma`.

**[2026-04-28] Tiered rate limiting** — Endpoint-criticality tiers + progressive auth lockout with `Retry-After`. **Affects:** `rate-limit.plugin.ts`, `rate-limit-policies.ts`, `auth.service.ts`.

**[2026-04-27] Inventory restock restriction** — Restock only on `CANCELLED` for captured payments. **Affects:** `orders.service.ts`.

**[2026-06-03] Admin client session restore (mobile/LAN)** — Protected `/admin/*` blocks on `AdminAuthProvider` until deduped cookie refresh completes (RSC may 200 first). Separate restore runtimes: `admin` vs `admin-guest` (`/admin/login`). `clearSession()` does not reset `blocked`; `logoutLocalSession()` does. Browser API base = page origin; `allowedDevOrigins` for LAN `next dev`. **Affects:** `frontend/hooks/use-auth-session-restore.ts`, `contexts/admin-auth-context.tsx`, `components/auth/AdminGuestOnly.tsx`, `lib/api-base.ts`, `next.config.ts`.

**[2026-06-06] Admin product hard delete** — `DELETE /api/v1/admin/products/:id/permanent` (`products:write`) removes product row when no orders/reviews (`409` otherwise). Soft delete remains `DELETE .../:id` (deactivate). Service clears cart line items + hosted media. **Affects:** `products.service.ts`, `products.routes.ts`, `admin-endpoint-policy-registry.ts`.

**[2026-06-06] Admin form validation UX** — Shared client helpers map `VALIDATION_ERROR.details.fields` to `data-admin-field` keys, apply `!border-destructive` rings, scroll/focus first error, and append field summaries to banner copy. Product create UI exposes Category + Slug (required by API). **Affects:** `frontend/lib/admin-form-validation.ts`, `hooks/use-admin-form-validation.ts`, `AdminFormField.tsx`, `AdminProductEditor.tsx`.

**[2026-06-06] Frontend predev backend probe** — `npm run dev` runs `scripts/ensure-backend-dev.mjs` before Next starts; fails fast when Fastify is unreachable. **Affects:** `frontend/package.json`, `frontend/scripts/ensure-backend-dev.mjs`.

**[2026-06-06] MaintenanceBanner admin skip** — Poll `/maintenance/status` only on storefront routes; skip `/admin/*` and `/ops/*`. **Affects:** `frontend/components/maintenance/MaintenanceBanner.tsx`.

**[2026-05-23] Self-hosted GitHub Actions runner** — Per-client runner (`<client-id>-vps`) on VPS; monorepo workflows at repo root. **Affects:** `.github/workflows/`, `scripts/vps-deploy.sh`, `scripts/vps-frontend-deploy.sh`.

**[2026-05-23] Phase 7 fail-fast preflight** — `npm ci` before Prisma; strict env verify; host DB `127.0.0.1`; compose overlay; troubleshooting playbook. **Affects:** `scripts/vps-deploy.sh`, `PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md`.

**[2026-04-27] Payment verify + webhook dedup** — Redis/JobId dedup; atomic `PENDING_PAYMENT → CONFIRMED`. **Affects:** `orders.service.ts`, `order-processing.worker.ts`.

**[2026-04-27] Coupon `maxUsesPerUser` nullable** — `null` = unlimited. Notification toggles from `StoreSettings`. Category route precedence fix. `FEATURE_GUEST_CHECKOUT_ENABLED` removed. Reviews disabled → 200 + empty. Webhook raw payload required. **Affects:** `prisma/schema.prisma`, `coupons/*`, `settings.service.ts`, `products.routes.ts`, `feature-flags.ts`, `reviews.service.ts`, `orders.routes.ts`, workers.

**[2026-06-07] Storefront testimonials from approved reviews** — `GET /api/v1/reviews/recent` (public, `limit` default 3) returns latest merchant-approved reviews with non-empty body on active products (`updatedAt` desc). Service scans paginated batches until `limit` displayable rows are found (whitespace-only bodies skipped post-query). Homepage `TestimonialsSection` and PDP `ProductReviewsSection` share `lib/reviews-api.ts` normalization + `lib/review-display.ts`. When `FEATURE_REVIEWS_ENABLED=false`, endpoint returns empty list and homepage section hides. **Affects:** `reviews.service.ts`, `reviews.routes.ts`, `reviews.schemas.ts`, `frontend/lib/storefront-reviews.ts`, `TestimonialsSection.tsx`, `ProductReviewsSection.tsx`.

**[2026-06-19] Platform versioning & multi-client sync model** — Shared code is versioned as `backend-core` / `frontend-core` (semver; `backend/package.json` + `frontend/package.json` `version` are the source of truth, already surfaced at `/health` + tracing). Each core change carries a `CHANGELOG.md` entry with a **Propagation** block (severity · layers · migration · flag · design impact · breaking · rollback) — the entry is the apply-everywhere recipe. Per-client divergence is forced out of core code into three buckets: **design** (token layer, `.gitattributes merge=ours`), **feature flags** (`FEATURE_*`, ship OFF), **one-offs** (`src/modules/client/**`, `app/(client)/**`). CI gates: `check-core-drift.sh` (manifest-driven, forbids silent core forks) + `check-token-contract.sh` (guarantees per-client theming). **Rationale:** configuration-over-customization — keeps one meaningful version per client while preserving each site's design/feature set; avoids fork drift. **Alternatives considered:** shared npm package (`@org/core`) — heavier refactor, deferred; per-client branches — rejected (drift). **Affects:** `PLATFORM_VERSION`, `core-manifest.json`, `.gitattributes`, `frontend/design-tokens.contract.json`, `backend/CHANGELOG.md`, `frontend/CHANGELOG.md`, `backend/scripts/check-core-drift.sh`, `backend/scripts/check-token-contract.sh`, `.github/workflows/release-train.yml`, `backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md`, `CLAUDE.md`, `CO_DEVELOPMENT_SYNC_GUIDE.md`.
