# GitHub Actions — monorepo (`raghava-organics-site`)

GitHub only executes workflows from **this directory** (repository root).

| Workflow | Runs on | Purpose |
|----------|---------|---------|
| `reliability-ci.yml` | `ubuntu-latest` | CI gates on every PR/push |
| `deploy.yml` | Self-hosted runner on client VPS | Auto-deploy after CI passes on `main` |
| `release-train.yml` | `ubuntu-latest` | **Template repo. Opt-in, inert by default.** On a `backend-core-v*` / `frontend-core-v*` tag push, dispatches each client's `core-sync`. Enable with repo Variable `RELEASE_TRAIN_ENABLED=true` + `CLIENT_REPOS` + secret `CROSS_REPO_PAT`. See `backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md` §9. |
| `core-sync.yml` | `ubuntu-latest` | **Client repo.** Triggered by the template's release-train (or manually). Runs `sync-core.mjs` for the tag and opens a review PR. Needs repo Variable `TEMPLATE_REPO` + secrets `TEMPLATE_READ_PAT`, `CORE_SYNC_PAT`. See guide §9, §13.1. |

## Per-client runner model (canonical)

Documented in `backend/docs/CLIENT_VPS_SETUP_GUIDE.md` §22:

1. Install **one** self-hosted runner on the client's VPS.
2. Register it to **that client's GitHub repo** with a **unique label** (`<client-id>-vps`).
3. Set `VPS_RUNNER_LABEL` in repo Variables so jobs route only to that runner.
4. On `git push` to `main`: CI runs in the cloud → deploy jobs run **on the VPS** via outbound HTTPS polling (no inbound SSH).

Backend-only template repos use `backend/.github/workflows/` instead (same job names and scripts).
