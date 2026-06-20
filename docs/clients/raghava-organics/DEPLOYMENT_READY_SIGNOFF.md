# Raghava Organics — Deployment Readiness Signoff

**Assessment date:** 2026-06-11 (Cloudflare DNS + R2 media wired; frontend production template finalized)

## Local readiness (Phase 5 partial)

| Item | Status | Evidence |
|------|--------|----------|
| Client `.env` bootstrap keys | OK | `backend/.env` (gitignored) |
| `CLIENT_ID` / `POSTGRES_DB` alignment | OK | `raghava-organics` / `raghava_organics` |
| Health + migrations | OK | [LOCAL_SETUP_EVIDENCE.md](./LOCAL_SETUP_EVIDENCE.md) |
| VPS deploy scripts + pack | OK | [scripts/](./scripts/), [VPS_DEPLOYMENT_PACK.md](./VPS_DEPLOYMENT_PACK.md) |
| Frontend unit tests + build | OK | 2026-06-10 pass 2: Vitest **114/114**, `npm run lint` clean, `npm run build` clean |
| Backend unit tests | OK | 2026-06-10 pass 2: `npx vitest run` **1012/1012**, e2e **16/16**, `tsc --noEmit` clean |
| Production boot guards | OK | `STOREFRONT_URL` fail-fast in production-like profiles; CORS fail-fast for missing origins |
| Brand assets | OK | `frontend/public/images/raghava-organics-logo.png` + `BRAND_LOGO_SRC` |
| List-response / catalog fixes | OK | [frontend/docs/FRONTEND_DEV_LOG.md](../../../frontend/docs/FRONTEND_DEV_LOG.md) |
| Cloudflare DNS (Namecheap → CF) | OK | Authoritative DNS on Cloudflare; `raghavaorganics.com` |
| R2 product media + CDN hostname | OK | [CLOUDFLARE_R2_MEDIA.md](./CLOUDFLARE_R2_MEDIA.md) — `cdn.raghavaorganics.com` |
| Frontend production env template | OK | `NEXT_PUBLIC_IMAGE_CDN_URL=https://cdn.raghavaorganics.com` in `.env.production.example` |

## Production (operator-run on VPS)

| Phase | Artifact | Status |
|-------|----------|--------|
| 6 | [scripts/phase6-host-baseline.sh](./scripts/phase6-host-baseline.sh) | Run on VPS |
| 7 | [scripts/phase7-backend-deploy.sh](./scripts/phase7-backend-deploy.sh) | Run on VPS |
| 8 | [scripts/phase8-ops-bootstrap.sh](./scripts/phase8-ops-bootstrap.sh) | Run on VPS |
| 10 | [frontend/.env.production.example](../../../frontend/.env.production.example) | Copy on VPS — `NEXT_PUBLIC_IMAGE_CDN_URL`, same-origin API; storefront flags from `GET /store/config` |
| 5 | [PHASE5_EVIDENCE_CHECKLIST.md](./PHASE5_EVIDENCE_CHECKLIST.md) | After prod live |

**Human sign-off:** _pending production health + go-live checklists_

### Pre-deploy env checklist (2026-06-10)

**Backend Phase 1 (required before boot):** `NODE_ENV=production`, `STOREFRONT_URL`, `ADMIN_URL`, `DATABASE_URL`, `REDIS_URL`, secrets per `backend/.env.example`. Missing `STOREFRONT_URL` prevents boot in production-like profiles.

**Frontend production:** `NEXT_PUBLIC_API_BASE_URL=https://raghavaorganics.com/api/v1`, `INTERNAL_API_BASE_URL=http://127.0.0.1:3001/api/v1`, `NEXT_PUBLIC_STOREFRONT_URL=https://raghavaorganics.com`, `NEXT_PUBLIC_IMAGE_CDN_URL=https://cdn.raghavaorganics.com` (must match Ops `R2_PUBLIC_BASE_URL`). Storefront COD and module flags from **`GET /api/v1/store/config`** (no frontend redeploy when toggled).

**Ops Product Media (after Phase 8):** `MEDIA_STORAGE_PROVIDER=r2`, bucket `raghava-organics-product-images`, `R2_PUBLIC_BASE_URL=https://cdn.raghavaorganics.com` — credentials in [VPS_INPUTS.md](./VPS_INPUTS.md); restart API/workers after save.

**Docker Compose on VPS:** Always use prod overlay: `docker compose -f docker-compose.yml -f docker-compose.prod.yml` so Redis is not host-exposed.

### Post-deploy smoke checklist (2026-06-03, updated 2026-06-10)

After CD deploy to VPS:

1. **Storefront:** `/products` loads without console errors; search via `/products?search=…` returns results.
2. **Account — addresses:** Settings → add address → appears in list; Checkout → saved address chip selects → place COD or test PREPAID order with `addressId` path.
3. **Checkout:** Guest cart → login with `?redirect=/checkout` → returns to checkout; PREPAID success → `/checkout/success`; abandoned Razorpay → message + retry from `/orders`.
4. **Email:** After COD or confirmed PREPAID (workers up), `NotificationLog` shows `OrderConfirmed` template **SENT** for customer email.
5. **Account:** Order history shows payment mode + loading state (no flash “No orders yet”).
6. **Admin — Dashboard:** `/admin` loads with KPI cards, Sales Overview chart, Top Products, Recent Orders, Category breakdown, Low Stock alerts, and Quick Actions panels.
7. **Admin — Orders:** `/admin/orders` loads with KPI cards, filter bar, and redesigned table with customer avatars, status badges, and action icons.
8. **Admin — Payments:** `/admin/payments` loads with KPI cards, filter bar, and redesigned table with transaction IDs, payment method badges, and status pills.
9. **Admin — Coupons:** `/admin/coupons` loads with KPI cards, filter bar, redesigned table with usage progress bars, and "Create Coupon" CTA.
10. **Admin — Reviews:** `/admin/reviews` loads with KPI cards, right sidebar Rating Overview, filter bar, and redesigned table with star ratings and moderation action icons.
11. **Admin — Products:** `/admin/products` list loads; create product with **Initial stock qty > 0** → visible on storefront.
12. **Admin images:** Edit product → upload image (≤ 5 MB) → file appears on PDP; `GET /api/v1/media/products/:id/:file` returns 200; Cloudflare (if used) serves cached asset.
13. **Admin auth:** Login OTP → resend with Turnstile on OTP step.
14. **Ops:** `/ops` audit/users lists load (no empty crash from malformed `items`).
15. **Password reset:** Trigger forgot-password → email link uses production `STOREFRONT_URL`, not `localhost`.
16. **Brand logo:** Header and admin shell show logo from `/images/raghava-organics-logo.png`.

**Product media:** R2 bucket and `cdn.raghavaorganics.com` are provisioned in Cloudflare. On VPS: save keys in **Ops UI** (Product Media), restart API, verify `/health/ready`, copy `frontend/.env.production.example` → `.env.production.local`, run `npm run verify:r2-media` (no R2 keys in `backend/.env`). See [CLOUDFLARE_R2_MEDIA.md](./CLOUDFLARE_R2_MEDIA.md).

**Note:** COD visibility at checkout still follows `NEXT_PUBLIC_COD_ENABLED` **and** DB `storeSettings.isCodEnabled` — align both before go-live.

**Reference docs:** `backend/docs/HARDENING_HISTORY.md` (June 10 entry), `backend/docs/DECISIONS.md`, `backend/docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`.
