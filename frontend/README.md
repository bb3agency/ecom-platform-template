# Raghava Organics — Frontend (Next.js)

Storefront, merchant admin (`/admin`), ops console (`/ops`), and auth flows.

## Getting started

**Start the backend first**, then the frontend:

```bash
# Terminal 1 — backend
cd backend
npm run dev
# or: scripts\dev-up.cmd  (Docker + Prisma + server on Windows)

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
```

Dev server: **http://localhost:3101** (also shown as Network URL, e.g. `http://192.168.1.4:3101`).

`npm run dev` runs `scripts/ensure-backend-dev.mjs` automatically (`predev`). It probes `BACKEND_PROXY_URL` (default `http://127.0.0.1:3000`) and **exits with instructions** if the Fastify API is not reachable — avoiding broken `/api/v1/*` rewrites and `ECONNREFUSED` spam.

Copy `frontend/.env.example` → `.env.local`. Production template: `.env.production.example` — `https://raghavaorganics.com` API/storefront and `NEXT_PUBLIC_IMAGE_CDN_URL=https://cdn.raghavaorganics.com` (Cloudflare R2; must match Ops `R2_PUBLIC_BASE_URL`). Brand logo: `public/images/raghava-organics-logo.png` — use `BRAND_LOGO_SRC` from `lib/constants.ts`. Ops/R2 setup: `docs/clients/raghava-organics/CLOUDFLARE_R2_MEDIA.md`.

For **phone testing on the same Wi‑Fi**:

```env
ALLOWED_DEV_ORIGINS=192.168.1.4
```

Use the IP printed by `npm run dev` (optional — `next.config.ts` also auto-detects LAN IPv4). Sign in at `http://<that-ip>:3101/admin/login` (not `localhost` if you browse via LAN IP — refresh cookies are host-scoped).

## Typography

[`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) loads **[Inter](https://fonts.google.com/specimen/Inter)** site-wide via `lib/fonts.ts` and `app/globals.css`.

## Admin auth (quick reference)

| Route | Layout | Session behaviour |
| --- | --- | --- |
| `/admin/*` | `(admin)` → `AdminConsoleShell` | `AdminAuthProvider` restores from cookie before showing console |
| `/admin/login` | `(auth)` | Form shown immediately; background restore may redirect to `/admin` |

Details: `docs/FRONTEND_DEV_LOG.md` (§2026-06-03 — Admin session restore).

## Admin forms — validation UX

Merchant admin write forms use shared validation helpers:

| Module | Purpose |
| --- | --- |
| `lib/admin-form-validation.ts` | Parse API `VALIDATION_ERROR` fields, field labels, banner summary, scroll-to-error |
| `hooks/use-admin-form-validation.ts` | `validateRequired`, `handleSubmitError`, `fieldClassName` |
| `components/admin/AdminFormField.tsx` | Label + inline error wrapper |

Inputs use `data-admin-field="<key>"` and error rings with `!border-destructive` so highlight styles are not overridden by neutral border utilities.

**Product create** requires Category + URL Slug (API contract) — see `AdminProductEditor.tsx`.

## Admin product actions

| UI label | API | Notes |
| --- | --- | --- |
| **Deactivate** | `DELETE /admin/products/:id` | Soft delete — reversible |
| **Delete Permanently** | `DELETE /admin/products/:id/permanent` | Hard delete — `409` if orders/reviews exist |
| Row menu | `AdminRowActionsMenu.tsx` | Portal-based menu (no shadcn dropdown) |

## Admin settings

Merchant admin configures 4 settings panels:
1. **Store Profile** — Name, contact, compliance IDs (GSTIN, FSSAI)
2. **Shipping** — Pickup pincode, minimum order value for free shipping
3. **Inventory** — Default low-stock threshold (units)
4. **Cash on Delivery** — COD enablement, customer cancellation window

**Notification provider selection** is **ops-only** via `/ops/config` — not exposed in merchant admin. This consolidates infrastructure gates (email/SMS/WhatsApp provider availability) in one place and reduces redundancy.

All settings panels are **mobile-optimized** for 375px viewports with 44px+ touch targets and responsive spacing.

## Maintenance banner

`MaintenanceBanner` in root layout polls maintenance status on **storefront** routes only — skipped on `/admin/*` and `/ops/*`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next dev on port 3101 (runs backend health check first) |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit tests |

## Storefront reviews

When `FEATURE_REVIEWS_ENABLED=true` in backend `.env`:

| Surface | Source |
| --- | --- |
| Homepage testimonials | `GET /reviews/recent?limit=3` via `TestimonialsSection` |
| Product detail reviews | `GET /reviews/product/:slug` via `ProductReviewsSection` |

Reviews appear on the storefront only after admin approval. Shared helpers: `lib/reviews-api.ts`, `lib/storefront-reviews.ts`, `lib/review-display.ts`.

Integration docs: `backend/docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`.

## Third-party integrations & Content Security Policy

When adding external services (payment gateways, analytics, CAPTCHA, etc.), CSP headers in `next.config.ts` must be updated to allow them. **Silent CSP violations block integrations without error messages.**

- **Quick start:** `docs/CSP_QUICK_REFERENCE.md` — 5-step checklist
- **Full guide:** `docs/CSP_AND_THIRD_PARTY_INTEGRATION_GUIDE.md` — incident analysis, debugging, current services
- **CLAUDE.md §4.5:** Security rules and CSP enforcement

See incident report (June 14, 2026): entire site was broken due to CSP blocking React hydration scripts. Proper testing and documentation now prevent regressions.
