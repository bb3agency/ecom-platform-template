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
| Phase 5 (local) | 2026-05-23 |
| Last updated | 2026-05-23 |

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
- [ ] Redis `ports:` commented out (multi-client — no host `6379` publish)
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

**Status:** `[~]` template ready

- [ ] `.env.production.local` from [frontend/.env.production.example](../../../frontend/.env.production.example)
- [ ] `pm2` process `raghava-organics-frontend`

---

## Phase 5 / 12 — Evidence

- [ ] [PHASE5_EVIDENCE_CHECKLIST.md](./PHASE5_EVIDENCE_CHECKLIST.md)
