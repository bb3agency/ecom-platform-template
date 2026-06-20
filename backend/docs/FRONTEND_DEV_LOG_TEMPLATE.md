# Frontend Development Log — [CLIENT_NAME]

> **Purpose:** Frontend phase tracker for Phase 4 delivery and Phase 5 readiness evidence.
>
> **Usage:** Copy this file to `docs/FRONTEND_DEV_LOG.md` in the frontend repo at project start.
>
> Cross-reference: `../backend/docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md` Phase 4 and Phase 5.

---

## Project Identity

| Field | Value |
|---|---|
| Client name | [CLIENT_NAME] |
| Backend API (local) | `http://localhost:[PORT]/api/v1` |
| Storefront URL (local) | `http://localhost:[STOREFRONT_PORT]` |
| Razorpay test key ID | `rzp_test_xxx` |
| Feature flags active | `FEATURE_COUPONS_ENABLED=[true/false]`, `FEATURE_REVIEWS_ENABLED=[true/false]`, `FEATURE_WISHLIST_ENABLED=[true/false]`, `FEATURE_GST_INVOICING_ENABLED=[true/false]`, `FEATURE_RESPONSE_ENVELOPE_ENABLED=[true/false]` |
| Backend repo path | `../backend` (or absolute path) |
| Frontend repo path | `.` |
| Phase 4 start date | [DATE] |
| Last updated | [DATE] |

---

## Backend Provider Confirmation (confirm before Tier 3 mutations)

| Provider | Backend `.env` key set? | Dry-run status | Dry-run date |
|---|---|---|---|
| Razorpay | [ ] | [ ] not done / [ ] passed | — |
| COD | n/a (no key needed) | [ ] confirmed in settings | — |
| Delhivery / Shiprocket | [ ] | [ ] not done / [ ] passed | — |
| Resend (email) | [ ] | [ ] not done / [ ] passed | — |
| MSG91 (SMS) | [ ] | [ ] not done / [ ] passed | — |
| Fast2SMS (SMS) | [ ] | [ ] not done / [ ] passed | — |
| Meta WhatsApp | [ ] | [ ] not done / [ ] passed | — |

> Resend, MSG91, and Fast2SMS keys are backend-only — they never appear in frontend `.env.local`. Confirm they are set in backend `.env` before building checkout and notification slices. Only one SMS provider is active at a time (`SMS_PROVIDER`).

---

## Environment Setup

- [ ] `.env.local` generated with all required values
- [ ] `frontend-agent-rules.md` copied to `.agents/rules/dev-rules.md` and diff is clean
- [ ] Backend is running locally (`npm run dev:e2e` + workers) and health check passes
- [ ] Postman E2E baseline passes (Phase 2 gate already cleared before this log was created)

`.env.local` values logged (non-secret only):

```
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_STORE_NAME=
NEXT_PUBLIC_STOREFRONT_URL=
NEXT_PUBLIC_IMAGE_CDN_URL=
NEXT_PUBLIC_FEATURE_GST_INVOICING_ENABLED=
NEXT_PUBLIC_RAZORPAY_KEY_ID=
```

---

## Slice Tracker

> Status: `[ ]` not started · `[~]` in progress · `[x]` done (all gate checks passed)

### Tier 1 — Foundation

| Slice | Status | Notes |
|---|---|---|
| Project scaffold (Next.js 15, Tailwind, shadcn/ui, Zustand, RHF+Zod) | [ ] | |
| Shared API client (dual-envelope parser, error.code mapper, auth injection) | [ ] | |
| Auth Zustand store (accessToken in memory, refresh-on-401, force-login) | [ ] | |
| `useSessionBootstrap` (storefront) with expired-token detection | [ ] | Must check `isAccessTokenUsable(token)` not just `!!token`. See §10.2 of integration guide. |
| Cart Zustand store (guest-safe, merge-on-login aware) | [ ] | |
| Permission-aware nav scaffold | [ ] | |
| Global error code → UI copy mapping | [ ] | |

**Tier 1 done when:** All slices `[x]`. Auth OTP flow produces session. 401 refresh loop works. Both envelope shapes parse. Permission-gated nav renders correctly. New-tab session restore succeeds without "Please sign in" flash.

---

### Tier 2 — Ops Control Plane

| Slice | Status | Routes covered | Notes |
|---|---|---|---|
| Session bootstrap | [ ] | `GET /ops/session` | |
| Ops config overview/validate/stored/save | [ ] | `GET /ops/config/overview`, `POST /ops/config/validate`, `GET /ops/config/stored`, `POST /ops/config/save` | |
| Load-shed change (direct) | [ ] | `POST /ops/load-shed` | |
| Audit timeline | [ ] | `GET /ops/audit/logs` | |

**Tier 2 done when:** All slices `[x]`. Load-shed change is applied directly with OTP confirmation. Ops credentials never visible in browser DevTools.

---

### Tier 3 — Admin Read Slices

| Slice | Status | Routes covered | Notes |
|---|---|---|---|
| Dashboard KPIs + charts | [ ] | `GET /admin/dashboard/kpis`, `/sales-chart`, `/top-products` | |
| Orders list + detail | [ ] | `GET /admin/orders`, `GET /admin/orders/:id` | |
| Inventory list + low-stock | [ ] | `GET /admin/inventory`, `/inventory/low-stock` | |
| Product list + categories | [ ] | `GET /admin/products`, `/admin/categories` | |
| Customer index + CRM view | [ ] | `GET /admin/users`, `/admin/users/:id` | |

**Tier 3 done when:** All slices `[x]`. Real data visible from local backend. No mocked responses.

---

### Tier 4 — Admin Mutation Slices (run provider dry-runs simultaneously)

| Slice | Status | Provider dry-run | Notes |
|---|---|---|---|
| Razorpay PREPAID checkout | [ ] | Razorpay test payment | |
| COD checkout | [ ] | n/a | |
| Ship action | [ ] | Shipping provider (Delhivery/Shiprocket) | |
| Cancel + refund (async) | [ ] | — | UI must show pending-refund state |
| COD collection | [ ] | — | Payment `CREATED` → `CAPTURED` verified |
| Return request approve/reject | [ ] | — | |
| Stock adjustment | [ ] | — | Set to 0, confirm low-stock alert fires |
| Product CRUD (create/edit/soft-delete) | [ ] | — | |
| Category CRUD | [ ] | — | |
| Settings: shipping/store/notifications/inventory/cod | [ ] | — | |
| Coupon lifecycle (create/edit/disable/apply/expire) | [ ] | — | |
| Bulk product import CSV | [ ] | — | |
| Return requests list | [ ] | — | |
| Admin notification retrigger | [ ] | — | |

**Tier 4 done when:** All slices `[x]`. Razorpay dry-run logged in credential register. Shipping dry-run logged. Refund shows pending state correctly. COD immediately confirms. Idempotency keys handled correctly — backend uses atomic CAS patterns, safe to retry with same key on 503/504.

---

### Tier 5 — Reliability Surfaces

| Slice | Status | Notes |
|---|---|---|
| Reconciliation issues list | [ ] | |
| Outbox dead-letter list + replay-preview + replay | [ ] | Preview before execute verified |
| Inbox failures list + replay-preview + replay | [ ] | |
| Analytics: revenue chart + export | [ ] | |
| Analytics: funnel | [ ] | |
| Analytics: category breakdown | [ ] | |
| Analytics: inventory alerts history | [ ] | |
| Analytics: notification delivery rates | [ ] | |
| Bull Board queue visibility | [ ] | Embed or iframe with admin JWT |

---

### Tier 6 — Storefront Customer Journey (run Resend dry-run during checkout slice)

| Slice | Status | Notes |
|---|---|---|
| Catalogue: product list, categories, search | [ ] | ISR patterns (`revalidate`) applied |
| Product detail page | [ ] | |
| Cart: guest session + item CRUD + coupon + pincode | [ ] | |
| Cart merge on login (`POST /cart/merge`) | [ ] | |
| PREPAID checkout (full Razorpay flow) | [ ] | Resend email dry-run here; address load via `useAuthenticatedApi()` |
| COD checkout | [ ] | `CheckoutForm`: `storefrontSessionStatus` skeleton gate before "Please sign in" |
| Order history + detail | [ ] | |
| Return request creation | [ ] | |
| Shipment tracking | [ ] | `GET /shipping/track/:awb` |
| Customer auth: OTP flow | [ ] | |
| Customer auth: email login + forgot-password | [ ] | |
| Customer auth: refresh loop + logout | [ ] | |
| User profile + addresses CRUD | [ ] | |
| Wishlist | [ ] | Only if `FEATURE_WISHLIST_ENABLED=true` |
| Reviews | [ ] | Only if `FEATURE_REVIEWS_ENABLED=true` |
| Coupon UI (storefront) | [ ] | Only if `FEATURE_COUPONS_ENABLED=true` |
| GST invoice download | [ ] | Only if `FEATURE_GST_INVOICING_ENABLED=true` |

**Tier 6 done when:** All active slices `[x]`. Resend email dry-run logged. Guest cart survives and merges correctly. Payment retry CTA absent for COD orders.

Tier 6 contract-specific checks:
- [ ] Invoice CTA logic uses `invoice.hasPdf` and download routes (`/orders/:id/invoice.pdf`, `/admin/orders/:id/invoice.pdf`) are verified by role context.

---

## Milestone Test Records

> Record after every 4–6 slices and at Tier boundaries.

| Date | Milestone | `BACKEND_GO_LIVE_CHECKLIST.md` run? | BRD AC rows covered | Notes |
|---|---|---|---|---|
| — | Tier 1 complete | [ ] | — | |
| — | Tier 2 complete | [ ] | AC-14 | |
| — | Tier 3 complete | [ ] | AC-13, AC-14 | |
| — | Tier 4 complete | [ ] | AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11 | |
| — | Tier 5 complete | [ ] | AC-13 | |
| — | Tier 6 complete | [ ] | AC-01, AC-02, AC-03, AC-04, AC-06, AC-07, AC-09, AC-12, AC-15 | |

---

## Phase 5 Local Gate Readiness (fill before touching VPS)

> All rows must be `[x]` before Phase 6 (VPS baseline provisioning) begins.

- [ ] `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` — every row ticked
- [ ] `docs/BACKEND_GO_LIVE_CHECKLIST.md` — every row ticked (full parity, not provider-only)
- [ ] Postman E2E collection: all folders pass, 0 errors
- [ ] Manual browser walk: every user-facing flow verified, no console errors, no 500s
- [ ] No `noop` providers in `.env` (Razorpay, Delhivery/Shiprocket must be real test credentials)
- [ ] No placeholder secrets — all provider keys confirmed real
- [ ] All provider dry-run evidence logged in `CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md`
- [ ] Backend Phase 7 readiness confirms `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md` gates are green before frontend VPS deploy begins
- [ ] `frontend-agent-rules.md` diff vs `.agents/rules/dev-rules.md` is clean

**Phase 5 gate cleared on:** [DATE] — signed off by: [NAME]

---

## Notes

### [DATE]

-

**Blockers / decisions made:**
-

**What to do first in the next session (read this at session start):**
-

---

<!-- Add new session entries above this line -->
