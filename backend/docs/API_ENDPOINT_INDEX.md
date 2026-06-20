# API Endpoint Index

Canonical low-noise index of backend HTTP endpoints. Route files and schemas remain the source of truth for request/response details.

**Primary code sources:** `src/modules/**/*.routes.ts`, `src/modules/**/*.schemas.ts`, `src/common/auth/admin-endpoint-policy-registry.ts`.

---

## How to use this doc

- **Frontend agents:** Use this to plan pages, navigation, permissions, and API client methods.
- **Backend agents:** Update this doc when adding/removing routes.
- **Deep route context (what every route does, all constraints, flows, boundaries):** `docs/ROUTE_SURFACE_COMPLETE_REFERENCE.md`
- **Detailed contracts:** Use `TRD.md` and colocated module schemas.
- **Admin permissions:** Use `src/common/auth/admin-permissions.ts` and `src/common/auth/admin-endpoint-policy-registry.ts`.
- **Error handling canon:** Use `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` section `2.1` (frontend matrix) and `docs/CLIENT_VPS_SETUP_GUIDE.md` section `19.1` (runtime triage matrix).

---

## Public and health endpoints

| Method | Endpoint | Purpose | Source |
|---|---|---|---|
| GET | `/api/v1/health` | Full health check | `health.routes.ts` |
| GET | `/api/v1/health/live` | Liveness check | `health.routes.ts` |
| GET | `/api/v1/health/ready` | Readiness — DB/Redis/workers + runtime config; `200` when ready; `503 CONFIG_NOT_READY` includes `data` payload + `runtimeConfigMissingKeys` when not ready | `health.routes.ts` |
| GET | `/api/v1/products` | Public product listing | `products.routes.ts` |
| GET | `/api/v1/products/categories` | Public category list | `products.routes.ts` |
| GET | `/api/v1/products/categories/:slug/products` | Products by category | `products.routes.ts` |
| GET | `/api/v1/products/:slug` | Product detail by slug | `products.routes.ts` |
| GET | `/api/v1/media/products/:productId/:filename` | Serve hosted product image when `MEDIA_STORAGE_PROVIDER=local` only; R2 URLs served from CDN | `media.routes.ts` |
| GET | `/api/v1/reviews/recent` | Latest merchant-approved reviews for storefront testimonials; query `limit` (default 3, max 10) | `reviews.routes.ts` |
| GET | `/api/v1/reviews/product/:slug` | Public product reviews | `reviews.routes.ts` |
| GET | `/api/v1/maintenance/status` | Maintenance snapshot for storefront banner — `{ mode, phase, pendingUntil, activatedAt, serverTime }`. Always reachable, even during `maintenance/active`. Polled every ~30 s normally, ~5 s during `pending` | `maintenance.routes.ts` |
| GET | `/api/v1/maintenance/gate` | Internal Nginx `auth_request` gate. Returns `200 { allowed: true }` when the request must pass through (normal/pending, or path in `ALWAYS_ALLOWED_PREFIXES`) or `401 { allowed: false }` when maintenance is `active` and the path is blocked. Nginx catches the 401 via `error_page 401 = @maintenance_block;` on the gated location → `return 503` → `maintenance.html`. The `X-Maintenance-Active: 0|1` response header is set on both shapes for backward compat but is no longer the deciding signal. Not for direct client use | `maintenance.routes.ts` |

---

## Auth endpoints

| Method | Endpoint | Purpose | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/register` | Customer registration | Sets refresh cookie. Idempotency guarded |
| POST | `/api/v1/auth/send-otp` | Send OTP | Auth-sensitive rate limit |
| POST | `/api/v1/auth/verify-otp` | Verify OTP and issue auth | Sets refresh cookie |
| POST | `/api/v1/auth/signup-phone` | Phone signup flow | Idempotency guarded |
| POST | `/api/v1/auth/forgot-password` | Forgot password flow | Idempotency guarded |
| POST | `/api/v1/auth/login` | Customer login | Sets refresh cookie |
| POST | `/api/v1/auth/refresh` | Refresh access token | Uses HTTP-only refresh cookie |
| POST | `/api/v1/auth/logout` | Logout | Clears refresh cookie |
| GET | `/api/v1/auth/otp-channel` | Customer OTP channel config — `{ channel, availableChannels[] }` | Public, pre-auth |
| GET | `/api/v1/auth/admin/otp-channel` | Admin OTP channel config — `{ channel, availableChannels[] }` | Public, pre-auth |
| POST | `/api/v1/auth/admin/login/request-otp` | Admin login step 1 — on valid active admin credentials returns `200 { message, expiresAt }` and sends OTP; unknown email / non-admin returns `200` generic message (anti-enumeration, no OTP); known admin wrong password → `401 INVALID_CREDENTIALS`; deactivated admin → `401 UNAUTHORISED` | Public, auth-sensitive rate limit |
| POST | `/api/v1/auth/admin/login/verify-otp` | Admin login step 2 — verify OTP, issue JWT access+refresh tokens | Sets refresh cookie |

Identity boundary contract (critical):

- Email identities are exclusive across customer/admin (`User`) and ops (`OpsUser`) accounts.
- Customer registration and phone-signup with email reject emails already used by ops accounts.
- Admin/ops invite setup flows reject emails already used by the other account domain.

---

## Customer cart, checkout, orders, and account endpoints

| Method | Endpoint | Purpose | Notes |
|---|---|---|---|
| GET | `/api/v1/store/config` | Public storefront runtime config | COD, min order, mobile OTP signup, `FEATURE_*` mirrors — no auth; ISR-friendly |
| GET | `/api/v1/cart` | Get current cart | Guest/customer session aware |
| POST | `/api/v1/cart/items` | Add cart item | Idempotency guarded |
| PATCH | `/api/v1/cart/items/:id` | Update cart item quantity | Cart mutation |
| DELETE | `/api/v1/cart/items/:id` | Remove cart item | Cart mutation |
| DELETE | `/api/v1/cart` | Clear cart | Cart mutation |
| POST | `/api/v1/cart/merge` | Merge guest cart after login | Cart/session flow |
| POST | `/api/v1/cart/coupon` | Apply coupon | Idempotency guarded |
| DELETE | `/api/v1/cart/coupon` | Remove coupon | Cart mutation |
| POST | `/api/v1/cart/check-pincode` | Check delivery serviceability | Shipping estimate flow |
| GET | `/api/v1/cart/delivery-rates` | Estimate delivery rates | Query: `pincode`, optional `paymentMode=PREPAID\|COD` (default PREPAID) |
| POST | `/api/v1/orders` | Create COD order only | Customer auth + idempotency |
| POST | `/api/v1/payments/prepare-checkout` | Prepare PREPAID checkout (new flow) | Customer auth + idempotency; returns `{ checkoutSessionId, razorpayOrderId, amount, currency }` |
| POST | `/api/v1/payments/confirm-prepaid` | Confirm PREPAID payment (new flow) | Customer auth + idempotency; creates order in CONFIRMED state |
| GET | `/api/v1/orders/:id` | Customer order detail | Owner-only; filters out PENDING_PAYMENT/PAYMENT_FAILED on customer pages |
| GET | `/api/v1/orders/:id/invoice.pdf` | Customer invoice PDF | Owner-only PDF |
| POST | `/api/v1/orders/:id/cancel` | Customer order cancel | Idempotency guarded; CONFIRMED+ only |
| POST | `/api/v1/payments/retry` | Retry failed payment (old flow) | Customer flow; for PAYMENT_FAILED orders only |
| GET | `/api/v1/shipping/track/:awb` | Track shipment | Customer auth |
| POST | `/api/v1/orders/:id/return-requests` | Create return request | Customer flow |
| GET | `/api/v1/users/me` | Current customer profile | Customer auth |
| PATCH | `/api/v1/users/me` | Update profile | Customer auth |
| GET | `/api/v1/users/me/addresses` | List addresses | Customer auth |
| POST | `/api/v1/users/me/addresses` | Create address | Customer auth |
| PATCH | `/api/v1/users/me/addresses/:id` | Update address | Customer auth |
| DELETE | `/api/v1/users/me/addresses/:id` | Delete address (bodyless DELETE) | Customer auth |
| GET | `/api/v1/users/me/orders` | Customer order history | Customer auth |
| GET | `/api/v1/reviews/me` | Customer review history | Customer auth |
| POST | `/api/v1/reviews` | Create product review | Customer auth |
| GET | `/api/v1/wishlist` | Wishlist listing | Customer auth |
| POST | `/api/v1/wishlist/items` | Add wishlist item | Customer auth |
| DELETE | `/api/v1/wishlist/items/:productId` | Remove wishlist item | Customer auth |

---

## Webhook endpoints

Browser apps must never call these endpoints.

| Method | Endpoint | Purpose | Source |
|---|---|---|---|
| POST | `/api/v1/payments/webhook` | Razorpay payment webhook | `orders.routes.ts` |
| POST | `/api/v1/shipping/webhook` | Shipping provider webhook | `orders.routes.ts` |
| GET | `/api/v1/notifications/webhook/meta-whatsapp` | Meta WhatsApp verification | `notifications-webhook.routes.ts` |
| POST | `/api/v1/notifications/webhook/meta-whatsapp` | Meta WhatsApp events | `notifications-webhook.routes.ts` |

---

## Merchant admin UI endpoint groups

Admin UI should be served under `/admin/*` in the frontend and call `/api/v1/admin/*` backend routes. Navigation must be permission-aware.

### Admin dashboard

| Method | Endpoint | UI use |
|---|---|---|
| GET | `/api/v1/admin/dashboard/kpis` | KPI cards |
| GET | `/api/v1/admin/dashboard/sales-chart` | Sales chart |
| GET | `/api/v1/admin/dashboard/top-products` | Top products table |

### Products and categories

| Method | Endpoint | UI use |
|---|---|---|
| GET | `/api/v1/admin/products` | Product table; query: `search` (name, description, **variant SKU**), `category`, `tags`, `inStock` (true=in stock, **false=out of stock**), **`isActive`**, `page`, `limit` |
| GET | `/api/v1/admin/products/:id` | Product detail/editor (`isActive`, `metaDescription`, `isFeatured`) |
| POST | `/api/v1/admin/products/import-csv` | CSV import |
| POST | `/api/v1/admin/products` | Create product — body requires `name`, `slug`, `description`, `categoryId`, `variants[]` (min 1). Admin UI: `AdminProductEditor` create flow includes **Category** + **URL Slug** fields (2026-06-06). |
| PATCH | `/api/v1/admin/products/:id` | Update product |
| DELETE | `/api/v1/admin/products/:id` | Deactivate product (soft delete — sets `isActive: false`). UI label: **Deactivate**; reversible via restore/`PATCH isActive`. |
| DELETE | `/api/v1/admin/products/:id/permanent` | Permanently delete product (hard delete — irreversible). UI: **Delete Permanently** in row actions menu (`AdminRowActionsMenu`). Requires `products:write`. Fails with **409** if order history or reviews exist. Clears hosted media and cart line items first. |
| POST | `/api/v1/admin/products/:id/variants` | Create variant |
| PATCH | `/api/v1/admin/products/:id/variants/:variantId` | Update variant |
| DELETE | `/api/v1/admin/products/:id/variants/:variantId` | Delete variant |
| POST | `/api/v1/admin/products/:id/images` | Add product image by external HTTPS URL |
| POST | `/api/v1/admin/products/:id/images/upload` | Batch multipart upload (max 5 MiB each; optional `altText`; sort order server-assigned). Returns one image or `{ items: [...] }`. Auto R2 when `MEDIA_STORAGE_PROVIDER=r2`. |
| PATCH | `/api/v1/admin/products/:id/images/reorder` | Reorder images |
| DELETE | `/api/v1/admin/products/:id/images/:imageId` | Delete image (removes R2 object or legacy VPS file when hosted) |
| GET | `/api/v1/admin/categories` | Category table; query: `search`, `isActive`, `page`, `limit` |
| GET | `/api/v1/admin/categories/:id` | Category detail/editor |
| POST | `/api/v1/admin/categories` | Create category |
| PATCH | `/api/v1/admin/categories/:id` | Update category (`parentId`/`imageUrl` nullable to clear) |
| DELETE | `/api/v1/admin/categories/:id` | Soft-delete (deactivate) category |
| DELETE | `/api/v1/admin/categories/:id/permanent` | Permanent hard-delete category (409 if any products reference it). Policy registry: `categories:write`, Layer A. Bodyless DELETE. |

### Orders, shipping, returns, invoices

| Method | Endpoint | UI use |
|---|---|---|
| GET | `/api/v1/admin/orders` | Orders table; query: `status`, `search`, `paymentMode` (PREPAID\|COD), `sort` (newest\|oldest), `from`, `to`, `page`, `limit` |
| GET | `/api/v1/admin/orders/board` | Pipeline/kanban board |
| GET | `/api/v1/admin/orders/export` | CSV export; query: `from`, `to`, `status`, `search`, **`paymentMode`** |
| GET | `/api/v1/admin/orders/:id` | Order detail |
| GET | `/api/v1/admin/orders/:id/invoice.pdf` | Invoice download |
| PATCH | `/api/v1/admin/orders/:id/status` | Status update — base guard: `orders:write`; setting status to `REFUNDED` additionally requires `orders:refund` (enforced in handler) |
| PATCH | `/api/v1/admin/orders/:id/items` | Update order line items (quantities / adjustments) — `orders:write` |
| POST | `/api/v1/admin/orders/:id/ship` | Manual shipment booking |
| POST | `/api/v1/admin/orders/:id/schedule-pickup` | Schedule pickup |
| POST | `/api/v1/admin/orders/:id/print-label` | Print shipping label — requires `orders:read` permission; uses `adminWrite` rate limit + `idempotencyPreHandler` because it mutates `Shipment.labelUrl` and calls an external courier provider |
| POST | `/api/v1/admin/orders/:id/cancel` | Cancel/refund-sensitive action |
| POST | `/api/v1/admin/orders/:id/notifications/retrigger` | Retrigger order notification |
| GET | `/api/v1/admin/orders/:id/timeline` | Order status transition timeline |
| GET | `/api/v1/admin/return-requests` | Return request queue |
| GET | `/api/v1/admin/return-requests/:id` | Single return request detail |
| PATCH | `/api/v1/admin/return-requests/:id` | Update return request |

### Inventory

| Method | Endpoint | UI use |
|---|---|---|
| GET | `/api/v1/admin/inventory` | Inventory table |
| GET | `/api/v1/admin/inventory/low-stock` | Low-stock queue |
| PATCH | `/api/v1/admin/inventory/:variantId` | Stock adjustment |
| POST | `/api/v1/admin/inventory/bulk-update` | Bulk stock adjustment (max 100) |
| GET | `/api/v1/admin/inventory/history/:variantId` | Adjustment history for a variant |

### Coupons and promotions

| Method | Endpoint | UI use |
|---|---|---|
| GET | `/api/v1/admin/coupons/analytics` | Coupon analytics |
| GET | `/api/v1/admin/coupons` | Coupon table; query: `code`, `status`, `type` (PERCENTAGE_OFF\|FLAT_AMOUNT_OFF\|FREE_SHIPPING\|BUY_X_GET_Y), `from`, `to`, `page`, `limit` |
| GET | `/api/v1/admin/coupons/:id` | Single coupon detail |
| POST | `/api/v1/admin/coupons` | Create coupon |
| PATCH | `/api/v1/admin/coupons/:id` | Update coupon |
| PATCH | `/api/v1/admin/coupons/:id/status` | Pause/resume/status change |
| DELETE | `/api/v1/admin/coupons/:id` | Soft-delete coupon (bodyless DELETE — no JSON body) |
| POST | `/api/v1/admin/coupons/:id/restore` | Restore coupon (no request body) |
| POST | `/api/v1/admin/coupons/:id/clone` | Clone coupon |
| GET | `/api/v1/admin/coupons/:id/audit` | Coupon audit trail |

### Reviews and customers

| Method | Endpoint | UI use |
|---|---|---|
| GET | `/api/v1/admin/reviews/summary` | Approved-review KPIs: `averageRating`, star `distribution`, `totalApproved`; query `from`/`to` |
| GET | `/api/v1/admin/reviews` | Review queue; query: `approved`, `ratingGte`, `ratingLte`, **`search`** (body, author name, **product name**), `from`, `to`, `page`, `limit` |
| PATCH | `/api/v1/admin/reviews/:id/moderate` | Moderate review |
| DELETE | `/api/v1/admin/reviews/:id` | Hard-delete review (`reviews:moderate`) |
| GET | `/api/v1/admin/users` | Customer table |
| GET | `/api/v1/admin/users/:id` | Customer detail |
| GET | `/api/v1/admin/users/:id/orders` | Customer order history (paginated) |
| PATCH | `/api/v1/admin/users/:id/ban` | Ban customer account (`users:write`) |
| DELETE | `/api/v1/admin/users/:id/ban` | Remove ban from customer (`users:write`) |
| GET | `/api/v1/admin/users/:id/notes` | List admin notes for customer |
| POST | `/api/v1/admin/users/:id/notes` | Create admin note (`users:write`) |
| DELETE | `/api/v1/admin/users/:id/notes/:noteId` | Delete admin note (`users:write`) |
| GET | `/api/v1/admin/shipments` | Shipment list; query: `status`, `search` (AWB or order number), `awbNumber`, `orderId`, `from`, `to`; items include `customerName` |
| GET | `/api/v1/admin/shipments/:id` | Single shipment detail |
| GET | `/api/v1/admin/payments` | Payment list; query: `status`, `method`, `orderId`, **`search`** (order number, provider payment ID, customer name/email), `from`, `to` |
| GET | `/api/v1/admin/payments/:id` | Single payment detail |

### Analytics and reliability

| Method | Endpoint | UI use |
|---|---|---|
| GET | `/api/v1/admin/analytics/revenue` | Revenue chart |
| GET | `/api/v1/admin/analytics/revenue/export` | Revenue CSV export |
| GET | `/api/v1/admin/analytics/funnel` | Funnel chart |
| GET | `/api/v1/admin/analytics/inventory-alerts` | Inventory alert analytics |
| GET | `/api/v1/admin/analytics/notifications` | Notification analytics |
| GET | `/api/v1/admin/analytics/reconciliation-issues` | Reconciliation issue list |
| GET | `/api/v1/admin/analytics/category-breakdown` | Category analytics |
| GET | `/api/v1/admin/analytics/shipping-providers` | Shipping provider breakdown (shipment count, revenue, delivery rate, share % per provider) |
| GET | `/api/v1/admin/analytics/outbox-dead-letter` | Outbox DLQ table |
| POST | `/api/v1/admin/analytics/outbox-dead-letter/:id/replay-preview` | Preview outbox replay |
| POST | `/api/v1/admin/analytics/outbox-dead-letter/:id/replay` | Execute outbox replay |
| GET | `/api/v1/admin/analytics/inbox-failures` | Inbox failure table |
| POST | `/api/v1/admin/analytics/inbox-failures/:id/replay-preview` | Preview inbox replay |
| POST | `/api/v1/admin/analytics/inbox-failures/:id/replay` | Execute inbox replay |

### Settings

| Method | Endpoint | UI use |
|---|---|---|
| GET | `/api/v1/admin/settings/shipping` | Shipping settings (merchant admin) |
| PATCH | `/api/v1/admin/settings/shipping` | Update shipping settings (merchant admin) |
| GET | `/api/v1/admin/settings/store` | Store profile settings (merchant admin) |
| PATCH | `/api/v1/admin/settings/store` | Update store profile (merchant admin) |
| GET | `/api/v1/admin/settings/notifications` | Notification settings (deprecated in frontend; ops config used instead) |
| PATCH | `/api/v1/admin/settings/notifications` | Update notification settings (deprecated in frontend; ops config used instead) |
| GET | `/api/v1/admin/settings/inventory` | Inventory defaults (merchant admin) |
| PATCH | `/api/v1/admin/settings/inventory` | Update inventory defaults (merchant admin) |
| GET | `/api/v1/admin/settings/cod` | COD settings (merchant admin) |
| PATCH | `/api/v1/admin/settings/cod` | Update COD settings (merchant admin) |

### Merchant admin invite (ops-authenticated + public setup)

| Method | Endpoint | UI use |
|---|---|---|
| GET | `/api/v1/ops/admin-invites` | List merchant admin invites (ops:read) |
| POST | `/api/v1/ops/admin-invites` | Create invite (ops:write). Allows deactivated merchant admin email; reactivates same `userId` on consume |
| POST | `/api/v1/ops/admin-invites/:inviteId/revoke` | Revoke active invite (ops:write, OTP-gated) |
| POST | `/api/v1/ops/admin-invites/cleanup-expired` | Cleanup expired invites (ops:write) |
| POST | `/api/v1/admin/invites/setup/send-otp` | Public — send setup OTP from `/admin/setup` |
| POST | `/api/v1/admin/invites/consume` | Public — complete setup; creates new admin or reactivates deactivated admin |

Setup URL contract:

- `setupBaseUrl` must be the frontend base origin (for example, `https://example.com`).
- Backend composes setup links as `${setupBaseUrl}/admin/setup?token=...`.

---

## Ops control plane endpoint groups

Ops endpoints are platform/developer controls. Do not expose write controls in normal merchant admin UI.

| Method | Endpoint | UI use |
|---|---|---|
| POST | `/api/v1/ops/auth/login/request-otp` | Browser login — request email OTP (public) |
| POST | `/api/v1/ops/auth/login/verify-otp` | Browser login — verify OTP, sets `ops_session` cookie |
| POST | `/api/v1/ops/auth/logout` | Browser logout — clears `ops_session` cookie |
| GET | `/api/v1/ops/session` | Bootstrap ops user/session |
| GET | `/api/v1/ops/config/overview` | Runtime config overview |
| POST | `/api/v1/ops/config/validate` | Validate config draft (ops:read) |
| GET | `/api/v1/ops/config/stored` | DB-backed config rows. Per item: `{ domain, key, maskedValue, plaintextValue, keyVersion, requiresRestart, updatedAt }`. `plaintextValue` is **required** and returned for every active row, INCLUDING real cryptographic secrets — deliberate operator-UX policy for the Ops console (see `HARDENING_HISTORY.md` and `DECISIONS.md`). `isOpsConfigSecretKey()` predicate still drives `<input type="password">` rendering on the frontend but no longer gates plaintext disclosure. (ops:read) |
| POST | `/api/v1/ops/config/save` | Save encrypted DB config (OTP `config-save`; `domain?` optional; `null` deactivates key) |
| POST | `/api/v1/ops/otp/request` | Request privileged-write OTP — body `{ action }` ∈ `config-save`, `load-shed-change`, `user-deactivate`, `admin-user-deactivate`, `system-restart`, `invite-revoke` |
| POST | `/api/v1/ops/otp/verify` | Verify privileged-write OTP |
| GET | `/api/v1/ops/otp/pending` | List caller's pending OTP challenges |
| GET | `/api/v1/ops/invites` | List all invites (filterable by status) |
| POST | `/api/v1/ops/invites` | Issue ops invite |
| POST | `/api/v1/ops/invites/:inviteId/revoke` | Revoke a pending/sent invite — requires OTP (`challengeId`, `otpCode`) |
| POST | `/api/v1/ops/invites/setup/send-otp` | Send ops setup OTP |
| POST | `/api/v1/ops/invites/consume` | Consume ops setup token |
| POST | `/api/v1/ops/invites/cleanup-expired` | Cleanup expired ops invites |
| GET | `/api/v1/ops/users` | List ops users (filterable by isActive) |
| GET | `/api/v1/ops/users/:opsUserId` | Get single ops user profile |
| POST | `/api/v1/ops/users/:opsUserId/deactivate` | Deactivate ops user account — requires OTP (`challengeId`, `otpCode`) |
| GET | `/api/v1/ops/admin-users` | List merchant admin accounts (`User.role = ADMIN`) |
| POST | `/api/v1/ops/admin-users/:adminUserId/deactivate` | Deactivate merchant admin — requires OTP action `admin-user-deactivate` |
| GET | `/api/v1/ops/load-shed` | Current load-shed snapshot: `{ mode, phase, pendingUntil, activatedAt, reason }`. Mode ∈ `normal | reduced | emergency | maintenance`; `phase` ∈ `null | pending | active` (only non-null in `maintenance`) |
| POST | `/api/v1/ops/load-shed` | Apply load-shed mode change immediately — requires OTP (`challengeId`, `otpCode`). `mode: 'maintenance'` writes durable `MaintenanceState` row, starts 2-min `pending` window, enqueues `maintenance-activation` job that pauses outbox+producer queues, drains active counts, drains `PENDING_PAYMENT`, flips `active`, then resumes queues (background work continues; Nginx serves the maintenance page at the edge). Exit by setting any other mode — durable row's phase/pendingUntil/activatedAt are cleared; no separate deactivation job needed |
| GET | `/api/v1/ops/audit/logs` | Ops audit timeline (filterable by opsUserId) |
| POST | `/api/v1/ops/system/restart` | Schedule process restart — requires OTP (`challengeId`, `otpCode`); `delayMinutes:0` = now, `>0` = deferred (survives logout). Worker runs 6-step drain: pause outboxDispatch → grace (`RESTART_QUEUE_PAUSE_GRACE_MS`) → pause all producer queues → poll `getActiveCount()` until 0 or `RESTART_QUEUE_DRAIN_TIMEOUT_MS` → drain PENDING_PAYMENT orders (`RESTART_PAYMENT_DRAIN_TIMEOUT_MS`) → resume queues → publish restart signal → `process.exit(0)`. Feature-flagged via `RESTART_PAUSE_AND_DRAIN_QUEUES_ENABLED` (default `true`). No queue job lost. |
| GET | `/api/v1/ops/queues` | BullMQ Bull Board UI — queue dashboard (ops:read) |
| GET | `/api/v1/ops/queues/dlq/summary` | DLQ summary card — totals and per-source-queue counts (ops:read) |

Setup URL contract:

- `setupBaseUrl` must be the frontend base origin (for example, `https://example.com`).
- Backend composes setup links as `${setupBaseUrl}/ops/setup?token=...`.

---

## SaaS admin UI blueprint

Recommended frontend route groups:

```text
/admin
/admin/orders
/admin/orders/board
/admin/orders/:id
/admin/products
/admin/products/new
/admin/products/:id
/admin/inventory
/admin/customers
/admin/customers/:id
/admin/coupons
/admin/reviews
/admin/analytics
/admin/settings/store
/admin/settings/shipping
/admin/settings/notifications
/admin/settings/inventory
/admin/settings/cod
/admin/reliability
/admin/setup
/admin/login
/ops
/ops/config
/ops/audit
```

SaaS-grade UI expectations:
- Permission-aware sidebar and command menu.
- KPI cards, charts, filterable tables, detail drawers, and audit timelines.
- Sensitive actions require explicit confirmation and show permission/risk labels.
- Async workflows (refunds, shipping, replay) show pending/progress states.
- Webhook endpoints are never called from browser code.

---

## Security Model Summary

### Authentication Methods by Endpoint Type

| Endpoint Category | Auth Method | Token Storage |
|-------------------|-------------|---------------|
| **Public** | None | N/A |
| **Customer** | JWT access token + refresh cookie | Access: memory, Refresh: httpOnly cookie |
| **Admin** | JWT access token + refresh cookie | Access: memory, Refresh: httpOnly cookie |
| **Ops** | httpOnly session cookie only | Redis-backed, SHA256 hashed |

### Critical Ops Operations Requiring OTP

All 6 critical mutation endpoints require secondary OTP verification:

1. `POST /api/v1/ops/config/save` — Config changes
2. `POST /api/v1/ops/load-shed` — Load-shed mode changes
3. `POST /api/v1/ops/system/restart` — Process restart scheduling
4. `POST /api/v1/ops/users/:opsUserId/deactivate` — Ops operator deactivation
5. `POST /api/v1/ops/admin-users/:adminUserId/deactivate` — Merchant admin deactivation
6. `POST /api/v1/ops/invites/:inviteId/revoke` — Invite revocation

**OTP Challenge Pattern:**
1. Call `POST /api/v1/ops/otp/request` with `{ action }` (not `actionType`) → receive `challengeId`
2. User receives 6-digit OTP via email (600s TTL, 3 max attempts per challenge)
3. Submit mutation with `challengeId` and `otpCode` in body — backend verifies `challenge.action` matches the operation (`403` on mismatch)

### Permission Model

**Ops Permissions (2):**
- `ops:read` — Read access to all ops endpoints
- `ops:write` — Write access (implies read), requires OTP for critical operations

**Admin Permissions (25 across 3 layers):**
- Layer A: orders, products, inventory, customers (basic operations)
- Layer B: coupons, users, refunds, settings (sensitive operations)
- Layer C: analytics replay, queue inspection (developer operations)

### Security Headers

All responses include:
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security: max-age=31536000`
- `Referrer-Policy: strict-origin-when-cross-origin`

### Production Readiness Status

**✅ Verified Security Invariants:**
- No tokens in localStorage/sessionStorage
- No API keys in browser bundles
- No 'unsafe-inline' in CSP
- bcrypt 12 rounds for passwords
- SHA256 hashing for OTPs and session tokens
- AES-256-GCM for config secrets
- Rate limiting on all auth endpoints
- Idempotency keys required for mutations
- Sensitive data redaction in logs

**Status: PRODUCTION-READY (June 2026)**

---

### Deployment incident note (May 2026)

No route contract or endpoint shape changed due to the Phase 7 VPS incident. The failures were deploy/runtime configuration issues (env completeness, compose strategy, and host-Postgres routing). Operational remediation is documented in:

- `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md`
