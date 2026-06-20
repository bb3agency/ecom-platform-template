# Client VPS Deployment Log — Raghava Organics

> **Scope:** Phases 6–14. Master runbook: [CLIENT_ONBOARDING_EXECUTION_ORDER.md](../../../backend/docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md)

---

## Project Identity

| Field | Value |
|---|---|
| Client name | Raghava Organics |
| `CLIENT_ID` | `raghava-organics` |
| Domain | `raghavaorganics.com` (details in gitignored [VPS_INPUTS.md](./VPS_INPUTS.md)) |
| Admin path | `/admin` |
| Backend port | `3001` |
| Storefront port | `3101` |
| VPS IP | `178.104.46.202` |
| Deploy user | `d_user` |
| Git repo | `https://github.com/bb3agency/raghava-organics-site` |
| Backend path | `/var/www/raghava-organics/backend` |
| Frontend path | `/var/www/raghava-organics/frontend` |
| Image CDN | `https://cdn.raghavaorganics.com` (Cloudflare R2) |
| DNS | Cloudflare (nameservers updated at Namecheap) |
| Phase 5 (local) | 2026-05-23 |
| Last updated | 2026-06-20 |

---

## 2026-06-20 — Progress log

- **Product image upload reliability fix landed** (commit `c0bea7d`): admin image upload had three compounding bugs — a DTO-serialization 500 *after* the image was already saved to R2 + DB, false-positive "declared MIME mismatch" 400s on legitimate images (renamed files, `image/jpg` vs `image/jpeg`, phone exports), and the nginx maintenance `auth_request` gate buffering/breaking larger multipart uploads. All three fixed; see `backend/CHANGELOG.md` / `frontend/CHANGELOG.md` `[Unreleased]` for full propagation notes. **Action:** confirm the updated `nginx/client.conf.template` admin-upload location block has been re-rendered/applied on the live VPS config (`nginx -t && systemctl reload nginx`) — template changes don't auto-apply to an already-deployed `/etc/nginx/sites-available/<domain>` file.
- Manual `npm run build` should never be run directly on the VPS while PM2 is serving the live process — it races with the live `.next` directory and causes "Failed to load chunk" errors in browsers. Use the CD pipeline (`phase10-frontend-deploy.sh` / GitHub Actions) instead.

---

## Phase 6 — VPS Baseline

**Status:** `[~]` scripts ready — execute on VPS

- [ ] Run `bash docs/clients/raghava-organics/scripts/phase6-host-baseline.sh` (from repo root on VPS after clone)
- [ ] Full checklist: [CLIENT_VPS_DEPLOYMENT_LOG_TEMPLATE.md](../../../backend/docs/CLIENT_VPS_DEPLOYMENT_LOG_TEMPLATE.md)

---

## Phase 7 — Backend deploy

**Status:** `[x]` backend health OK on loopback (2026-05-24)

- [x] `production.backend.env` on VPS at `backend/.env`
- [x] Run `phase7-backend-deploy.sh`
- [x] `curl http://127.0.0.1:3001/api/v1/health` OK
- [ ] Redis not published on host `6379` in production (`docker-compose.prod.yml` `redis.ports: !reset []`; multi-client VPS)
- [ ] `phase7.5-nginx-tls-preflight.sh` then Nginx + Certbot per [VPS_DEPLOYMENT_PACK.md](./VPS_DEPLOYMENT_PACK.md) § multi-client

---

## Phase 8 — Ops bootstrap

**Status:** `[ ]` blocked until live Resend

- [ ] Run `phase8-ops-bootstrap.sh` or manual `ops:newuser`
- [ ] Ops UI config save + container restart

---

## Phase 7.6 — GitHub CD (self-hosted runner)

**Status:** `[ ]` configure after Phase 7 (+ PM2 for frontend CD)

> Guide: [backend/docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md](../../../backend/docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md)

- [ ] Monorepo at `/var/www/raghava-organics` (single clone)
- [ ] Runner installed: `raghava-organics-vps` label
- [ ] GitHub Variables + Secrets per [GITHUB_CD_SETUP.md](./GITHUB_CD_SETUP.md)
- [ ] Root workflows on `main`: `.github/workflows/reliability-ci.yml`, `deploy.yml`
- [ ] Test push to `main` → CI green → Deploy jobs on VPS runner

---

## Phase 10 — Frontend

**Status:** `[~]` production-ready locally — deploy on VPS

- [x] [frontend/.env.production.example](../../../frontend/.env.production.example) — `raghavaorganics.com` + `cdn.raghavaorganics.com` CDN
- [ ] Copy to `.env.production.local` on VPS and run [phase10-frontend-deploy.sh](./scripts/phase10-frontend-deploy.sh)
- [ ] `pm2` process `raghava-organics-frontend`

## Razorpay — Payments

**Status:** `[~]` live keys in vault; dashboard webhook + Ops save + frontend env pending

- [x] `RAZORPAY_WEBHOOK_SECRET` generated → [VPS_INPUTS.md](./VPS_INPUTS.md) (gitignored vault)
- [x] Razorpay **live** `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` recorded in [VPS_INPUTS.md](./VPS_INPUTS.md) (2026-05-23)
- [x] Public runbook [RAZORPAY_PAYMENTS_SETUP.md](./RAZORPAY_PAYMENTS_SETUP.md)
- [ ] Razorpay Dashboard → webhook URL + secret + 3 events (`payment.captured`, `payment.failed`, `refund.processed`)
- [ ] Ops UI → Payments → `PAYMENT_PROVIDER`, keys, webhook secret → restart API/workers
- [ ] `NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_Szr9LAUchr3Sk3` in `frontend/.env.production.local` on VPS + frontend deploy

## Cloudflare R2 — Product media

**Status:** `[~]` bucket + CDN hostname live; Ops save pending on VPS

- [x] R2 bucket `raghava-organics-product-images`
- [x] Custom domain `cdn.raghavaorganics.com`
- [x] Credentials documented in [VPS_INPUTS.md](./VPS_INPUTS.md) + [CLOUDFLARE_R2_MEDIA.md](./CLOUDFLARE_R2_MEDIA.md)
- [ ] Ops UI → Product Media → save + restart API/workers on VPS
- [ ] Admin upload smoke → image URL on `cdn.raghavaorganics.com`

---

## Phase 5 / 12 — Evidence

- [ ] [PHASE5_EVIDENCE_CHECKLIST.md](./PHASE5_EVIDENCE_CHECKLIST.md)
