# Raghava Organics — Client deployment docs

Client-specific deployment and evidence live here (not under `backend/docs/`).

| Document | Purpose |
|----------|---------|
| [VPS_DEPLOYMENT_PACK.md](./VPS_DEPLOYMENT_PACK.md) | Production env template, ports, CD, Nginx |
| [VPS_INPUTS.md](./VPS_INPUTS.md) | Private inputs + secrets (gitignored); template: [VPS_INPUTS.template.md](./VPS_INPUTS.template.md) |
| [CLIENT_VPS_DEPLOYMENT_LOG.md](./CLIENT_VPS_DEPLOYMENT_LOG.md) | Phase 6–14 checklist |
| [LOCAL_SETUP_EVIDENCE.md](./LOCAL_SETUP_EVIDENCE.md) | Local backend bootstrap evidence |
| [DEPLOYMENT_READY_SIGNOFF.md](./DEPLOYMENT_READY_SIGNOFF.md) | Local vs production readiness |
| [GITHUB_CD_SETUP.md](./GITHUB_CD_SETUP.md) | Raghava CD values (full guide: [GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md](../../../backend/docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md)) |
| [PHASE5_EVIDENCE_CHECKLIST.md](./PHASE5_EVIDENCE_CHECKLIST.md) | Postman, dry-runs, go-live sign-off |
| [scripts/](./scripts/) | Bash scripts to run on the VPS (incl. `phase7.5-nginx-tls-preflight.sh` for multi-client Nginx) |

Backend template SOPs: [backend/docs/CLIENT_VPS_SETUP_GUIDE.md](../../../backend/docs/CLIENT_VPS_SETUP_GUIDE.md)

**Local preflight (from dev machine):**

```bash
cd backend && npm run verify:vps-preflight && npm run verify:bootstrap-env
```

**VPS execution order:**

1. Confirm [VPS_INPUTS.md](./VPS_INPUTS.md) is complete (not committed — contains secrets)
2. `bash docs/clients/raghava-organics/scripts/phase6-host-baseline.sh`
3. Create host Postgres + copy `production.backend.env.example` → `backend/.env` on VPS
4. `bash docs/clients/raghava-organics/scripts/phase7-backend-deploy.sh`
5. `bash docs/clients/raghava-organics/scripts/phase7.5-nginx-tls-preflight.sh` then Nginx + Certbot ([VPS_DEPLOYMENT_PACK.md](./VPS_DEPLOYMENT_PACK.md) — multi-client VPS)
6. `bash docs/clients/raghava-organics/scripts/phase10-frontend-deploy.sh` (before Ops browser UI)
7. `OPS_EMAIL=... SETUP_BASE_URL=... bash .../phase8-ops-bootstrap.sh`
8. Phase 7.6 GitHub CD — [GITHUB_CD_SETUP.md](./GITHUB_CD_SETUP.md)
9. [PHASE5_EVIDENCE_CHECKLIST.md](./PHASE5_EVIDENCE_CHECKLIST.md)
