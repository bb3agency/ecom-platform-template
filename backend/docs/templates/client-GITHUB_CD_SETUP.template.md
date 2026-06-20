# GitHub CD — <Client Name>

> **Copy to:** `docs/clients/<client-id>/GITHUB_CD_SETUP.md`  
> **Full guide:** [backend/docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md](../../GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md)  
> **Template summary:** [backend/docs/CLIENT_VPS_SETUP_GUIDE.md](../../CLIENT_VPS_SETUP_GUIDE.md) §22

---

## Client identity

| Field | Value |
|-------|-------|
| GitHub repo | `https://github.com/<org>/<repo>` |
| `CLIENT_ID` | `<client-id>` |
| VPS IP | `<vps-ip>` |
| Deploy user | `<deploy-user>` |
| Runner name / label | `<client-id>-vps` |
| Runner install dir | `/home/<deploy-user>/actions-runner-<client-id>` |

---

## GitHub repository configuration

### Variables

| Name | Value |
|------|-------|
| `VPS_DEPLOY_ENABLED` | `true` |
| `VPS_RUNNER_LABEL` | `<client-id>-vps` |
| `FRONTEND_DEPLOY_ENABLED` | `true` |

### Secrets

| Name | Value |
|------|-------|
| `VPS_CLIENT_PATH` | `/var/www/<client-id>/backend` |
| `VPS_FRONTEND_PATH` | `/var/www/<client-id>/frontend` |

---

## VPS runner install (one-time)

Copy reusable scripts from backend templates into the client docs/scripts folder:

```bash
mkdir -p docs/clients/<client-id>/scripts
cp backend/docs/templates/scripts/install-github-runner.sh docs/clients/<client-id>/scripts/
cp backend/docs/templates/scripts/verify-cd-status.sh docs/clients/<client-id>/scripts/
cp backend/docs/templates/scripts/migrate-runner-directory.sh docs/clients/<client-id>/scripts/
cp backend/docs/templates/scripts/phase9-github-cd-setup.sh docs/clients/<client-id>/scripts/
```

Then install:

```bash
ssh <deploy-user>@<vps-ip>
cd /var/www/<client-id>
export CLIENT_ID=<client-id>
export GITHUB_REPO_URL=https://github.com/<org>/<repo>
export RUNNER_TOKEN=<TOKEN>
export RUNNER_DOWNLOAD_URL=<URL_FROM_GITHUB>
bash docs/clients/<client-id>/scripts/install-github-runner.sh
```

Preflight: `bash /var/www/<client-id>/docs/clients/<client-id>/scripts/phase9-github-cd-setup.sh`

---

## Monorepo clone (recommended)

```bash
git clone https://github.com/<org>/<repo>.git /var/www/<client-id>
```

Paths: `/var/www/<client-id>/backend`, `/var/www/<client-id>/frontend`

---

## Test deploy

```bash
git push origin main
```

Actions: **Reliability CI** → **Deploy to VPS** on runner `<client-id>-vps`.

---

## Cleared

| Field | Value |
|-------|-------|
| Runner Online date | |
| First green CD deploy SHA | |
| Verified by | |
