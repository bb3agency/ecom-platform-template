# Raghava Organics — Deployment Readiness Signoff

**Assessment date:** 2026-06-10 (pass 2: order/payment/coupon/storefront integration + runtime store config; pass 1: boot guards, assets, notification tracking, CI)

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
| List-response / catalog fixes | OK | [frontend/docs/FRONTEND_DEV_LOG.md](../../../../frontend/docs/FRONTEND_DEV_LOG.md) |

## Production (operator-run on VPS)

| Phase | Artifact | Status |
|-------|----------|--------|
| 6 | [scripts/phase6-host-baseline.sh](./scripts/phase6-host-baseline.sh) | Run on VPS |
| 7 | [scripts/phase7-backend-deploy.sh](./scripts/phase7-backend-deploy.sh) | Run on VPS |
| 8 | [scripts/phase8-ops-bootstrap.sh](./scripts/phase8-ops-bootstrap.sh) | Run on VPS |
| 10 | [frontend/.env.production.example](../../../../frontend/.env.production.example) | Copy on VPS — `NEXT_PUBLIC_IMAGE_CDN_URL`, same-origin API; storefront flags from `GET /store/config` |
| 5 | [PHASE5_EVIDENCE_CHECKLIST.md](./PHASE5_EVIDENCE_CHECKLIST.md) | After prod live |

**Human sign-off:** _pending production health + go-live checklists_

### Pre-deploy env checklist (2026-06-10)

**Backend Phase 1 (required before boot):** `NODE_ENV=production`, `STOREFRONT_URL`, `ADMIN_URL`, `DATABASE_URL`, `REDIS_URL`, secrets per `backend/.env.example`. Missing `STOREFRONT_URL` prevents boot in production-like profiles.

**Frontend production:** `NEXT_PUBLIC_API_BASE_URL`, `INTERNAL_API_BASE_URL`, `NEXT_PUBLIC_STOREFRONT_URL`, `NEXT_PUBLIC_IMAGE_CDN_URL` (match Ops `R2_PUBLIC_BASE_URL`). Storefront COD and module flags come from **`GET /api/v1/store/config`** — no redeploy needed when admin toggles COD or backend `FEATURE_*` changes.

**Docker Compose on VPS:** Always use prod overlay: `docker compose -f docker-compose.yml -f docker-compose.prod.yml` so Redis is not host-exposed.

### Post-deploy smoke checklist

See canonical copy: [docs/clients/raghava-organics/DEPLOYMENT_READY_SIGNOFF.md](../../../../docs/clients/raghava-organics/DEPLOYMENT_READY_SIGNOFF.md) (items 1–16 + product media notes).

**Reference docs:** `backend/docs/HARDENING_HISTORY.md` (June 10 pass 2 + pass 1 entries), `backend/docs/DECISIONS.md`, `backend/docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`.
