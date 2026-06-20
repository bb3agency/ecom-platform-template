# Frontend Setup Readiness

Checkpoint completed during Phase 4 kickoff (session setup only).

## Completed

- Next.js 16 app at `frontend/` with App Router, TypeScript strict, Tailwind 4, shadcn/ui
- Dependencies: Zod, React Hook Form, Zustand, Framer Motion, Lucide
- Folder structure per `dev-rules`: `app/(storefront)`, `app/(auth)`, `components/`, `lib/`, `stores/`, `types/`, `actions/`
- `lib/api.ts` + `lib/api-base.ts` — centralized client, same-site cookie auth, Next rewrite to Fastify
- Environment files: `.env.example`, `.env.production.example`, `.env.local` (gitignored)
- Production env template documents `NEXT_PUBLIC_IMAGE_CDN_URL`, same-origin API pattern; storefront/COD/module flags via **`GET /store/config`** (`StoreConfigProvider`, `lib/storefront-settings.ts`)
- AI rules: `.agents/rules/dev-rules.md`, `.cursor/rules/dev-rules.mdc`
- Dev log: `docs/FRONTEND_DEV_LOG.md`
- Typography: **Inter** sitewide (`lib/fonts.ts`, `app/globals.css`)

## Cloudflare Turnstile

Turnstile protects **abuse-prone public actions** (login, signup, password reset, OTP send, admin/ops login step 1). OTP verify steps do not use Turnstile — the one-time code is the second factor.

### Where it appears (storefront + admin + ops)

| Surface | When widget shows |
|--------|-------------------|
| Customer email login | Before sign in |
| Customer email register | Before create account |
| Customer phone login | Before **Send OTP** |
| Customer phone signup | Before **Send OTP** |
| Forgot password | Before send reset link |
| Admin login | Before **Send login code** (credentials step) |
| Ops login | Before **Send verification code** |

Reset-password (token in URL) and OTP verify steps do **not** use Turnstile.

### Development (default — Turnstile off)

Leave keys empty on both API and Next.js. No widget, no token required.

```bash
# backend/.env
TURNSTILE_SECRET_KEY=
# TURNSTILE_ENFORCE_IN_DEV=false  (default)

# frontend/.env.local
# NEXT_PUBLIC_TURNSTILE_SITE_KEY=
# NEXT_PUBLIC_TURNSTILE_ENFORCE_IN_DEV=false  (default)
```

Use `AUTH_DEV_BYPASS=true` for fixed OTP `000000` during local admin login (separate from Turnstile).

### Optional: test Turnstile locally

1. Create a Turnstile widget in [Cloudflare Dashboard](https://dash.cloudflare.com/) → Turnstile.
2. Add hostname `localhost` (and `127.0.0.1` if needed).
3. Set **both** enforce flags and **both** keys, then restart API + `npm run dev`:

```bash
# backend/.env
TURNSTILE_SECRET_KEY=<secret-key>
TURNSTILE_ENFORCE_IN_DEV=true

# frontend/.env.local
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site-key>
NEXT_PUBLIC_TURNSTILE_ENFORCE_IN_DEV=true
```

### Production (required for public sites)

```bash
# backend/.env (or VPS env)
NODE_ENV=production
TURNSTILE_SECRET_KEY=<secret-key>
# Do NOT set TURNSTILE_ENFORCE_IN_DEV in production

# frontend build env (CI / hosting)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site-key>
# Do NOT set NEXT_PUBLIC_TURNSTILE_ENFORCE_IN_DEV in production builds
```

- **Site key** → baked into the Next.js client bundle (`NEXT_PUBLIC_*`).
- **Secret key** → API only; never commit or expose in the browser.
- Widget hostnames in Cloudflare must include your production domain (e.g. `shop.example.com`).
- If the secret is set on the API in production, requests without a valid `turnstileToken` are rejected on protected routes.

**Local `next dev`:** Turnstile is **off** unless `NEXT_PUBLIC_TURNSTILE_ENFORCE_IN_DEV=true` **and** the site key is set. The API skips verification in development unless `TURNSTILE_ENFORCE_IN_DEV=true` **and** `TURNSTILE_SECRET_KEY` is set.

## Local admin login (development bypass)

When email/SMS workers are not running, enable fixed OTP (development **only**):

**Backend** `backend/.env` (local only):

```bash
NODE_ENV=development
AUTH_DEV_BYPASS=true
AUTH_DEV_OTP=000000
```

**Frontend** `frontend/.env.local` (optional — only for UI hint when backend returns `devOtp`):

```bash
NEXT_PUBLIC_AUTH_DEV_BYPASS=true
NEXT_PUBLIC_AUTH_DEV_OTP=000000
```

**Both** backend and frontend flags are required for fixed OTP `000000`. If only the frontend flag is set, step 1 still sends a **real** email OTP — do not use `000000` unless you see the amber “Development mode” banner after **Send login code**.

Restart backend + `npm run dev`. After step 1, use OTP `000000` only when that banner appears.

If you skip dev bypass, ensure `RESEND_API_KEY` + `NOTIFY_EMAIL_ENABLED=true` in `backend/.env`, or rely on the dev email-channel fallback (OTP stored in Redis under `auth:admin:login-otp:ci-plaintext:*` when `NODE_ENV` is not production).

**Production safety:** With `NODE_ENV=production`, dev bypass is **always off** (even if `AUTH_DEV_BYPASS=true` is set). The API never returns `devOtp`, notifications still enqueue, and the server **refuses to start** if bypass is enabled in a production-like profile. Production builds must not set `NEXT_PUBLIC_AUTH_DEV_BYPASS`.

## Before first feature slice

1. Start backend per `../backend/README.md` §Local Development Quickstart (**required before frontend** — `npm run dev` in `frontend/` runs `ensure-backend-dev.mjs` and exits if the API is down)
2. Verify health (direct): `curl http://127.0.0.1:3000/api/v1/health`
3. Configure `frontend/.env.local` per `.env.example` (browser API on **storefront port**, not `:3000`)
4. Start storefront: `cd frontend && npm run dev` (uses **webpack** dev on Windows — stable; see troubleshooting below)
5. Verify rewrite: `curl http://localhost:3101/api/v1/health`
6. Run `npm run typecheck`, `npm test`, and `npx vitest run -c vitest.integration.config.ts`

## Local URLs

| Service | URL | Notes |
|---|---|---|
| Backend API (direct) | http://127.0.0.1:3000/api/v1 | `INTERNAL_API_BASE_URL`, health, Postman |
| Browser API | http://localhost:3101/api/v1 | `NEXT_PUBLIC_API_BASE_URL` — **required for cookies** |
| Storefront / Admin UI | http://localhost:3101 | Next.js dev server |

## Dev server troubleshooting (Windows / Turbopack)

**Symptoms:** `failed to write to .next/dev/server/middleware.js` (os error 1224), Turbopack panic, very high RAM, dev server hang.

**Causes we fixed in-repo:**

1. **Orphan repo-root `package-lock.json`** — made Turbopack treat the monorepo root as workspace and watch `backend/` + `frontend/` (removed; do not add a root lockfile without a root `package.json`).
2. **`turbopack.root`** — set in `next.config.ts` to the `frontend/` directory.
3. **Default `npm run dev`** — uses `next dev --webpack` (avoids Turbopack HMR file-lock loops on Windows). Optional: `npm run dev:turbo` if you want Turbopack.

**If dev still fails:**

```powershell
cd frontend
npm run dev:clean
npm run dev
```

Stop other `node.exe` dev servers, and exclude `frontend\.next` from real-time antivirus scan if error 1224 persists.

## Admin session refresh

After admin OTP login, `refresh_token` must appear under **localhost:3101** in DevTools → Application → Cookies. Page reload on `/admin` calls `POST /auth/refresh` via the same origin (see `lib/restore-auth-session.ts`, `components/auth/AdminGuard.tsx`). Details: `../backend/docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §1.0.1.

## Product images (Cloudflare R2 + CDN)

| Item | Local dev | Production |
|------|-----------|------------|
| Upload | Admin → Products → edit product → **Images** → choose one or more files (JPEG/PNG/WebP/GIF, **max 5 MB** each) | Same; backend auto-uploads to **Cloudflare R2** (`MEDIA_STORAGE_PROVIDER=r2`) |
| API | `POST /admin/products/:id/images/upload` (multipart) | Requires admin JWT + `products:write` |
| Public serve | `GET /api/v1/media/products/:productId/:filename` when `local` | Images served from `R2_PUBLIC_BASE_URL` |
| CDN URL | `MEDIA_STORAGE_PROVIDER=local`; optional `NEXT_PUBLIC_IMAGE_CDN_URL=http://localhost:3101` | `R2_PUBLIC_BASE_URL` + matching `NEXT_PUBLIC_IMAGE_CDN_URL` |

**Backend:** configure in **Ops UI** → Product Media (not `backend/.env`). Local dev: `MEDIA_STORAGE_PROVIDER=local`. Production: `r2` + R2 keys in Ops panel; restart API after save. Preflight: `cd backend && npm run verify:r2-media`.

**Frontend** (`frontend/.env.local`):

```bash
# Must match R2_PUBLIC_BASE_URL in production
# NEXT_PUBLIC_IMAGE_CDN_URL=http://localhost:3101
```

Catalog images are resolved in `lib/media-url.ts` (`resolveProductImageUrl`) via `lib/product-adapters.ts`. In production, set `NEXT_PUBLIC_IMAGE_CDN_URL` to match Ops `R2_PUBLIC_BASE_URL`. SSR does **not** fall back to implicit `localhost` — only uses `NEXT_PUBLIC_STOREFRONT_URL` when CDN is unset.

## Brand logo

| Item | Path / constant |
|------|-----------------|
| Asset | `frontend/public/images/raghava-organics-logo.png` |
| Constant | `BRAND_LOGO_SRC` in `lib/constants.ts` |
| Used in | `Header.tsx`, `MobileNav.tsx`, `AdminConsoleShell.tsx` |

Do not store logos at repo root or use duplicate `public/logo.png`.

## Admin console integrity (2026-06-03)

- **Product editor:** `AdminProductEditor` — `isActive`, `metaDescription`, `isFeatured`, variant `lowStockThreshold` on create; see `FRONTEND_DEV_LOG.md` §Admin data integrity.
- **Date ranges:** `AdminDateRangePicker` on Dashboard, Orders, Payments, Coupons, Reviews (not in shell header).
- **Live tables:** Payments show customer name/email; reviews show product name; shipments KPIs from API data.
- **Tests:** Backend **1012/1012** unit + **16/16** e2e (2026-06-10 pass 2); frontend Vitest **114/114**, `npm run build` + `npm run lint` clean.

## Storefront customer journey (2026-06-03)

Integrated paths documented in `FRONTEND_DEV_LOG.md` and `../backend/docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`:

- Checkout: saved `addressId`, `/checkout/success`, guest → `/login?redirect=/checkout`
- Auth: Turnstile, OTP resend, cookie restore + profile hydrate, cart merge after login
- Account: `{ items, meta }` for addresses/orders; banned users blocked at `GET /users/me`
