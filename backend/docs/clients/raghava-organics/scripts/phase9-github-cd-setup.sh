#!/usr/bin/env bash
# Phase 9 — GitHub self-hosted runner + CD prerequisites (run on VPS as deploy user)
# After: Phase 7 backend healthy, Phase 10 PM2 started once manually.
# Docs: docs/clients/raghava-organics/GITHUB_CD_SETUP.md
set -euo pipefail

slugify_client_id() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g'
}

CLIENT_ID_INPUT="${CLIENT_ID:-raghava-organics}"
CLIENT_ID="$(slugify_client_id "$CLIENT_ID_INPUT")"
DEPLOY_USER="${DEPLOY_USER:-$(whoami)}"
WWW_ROOT="/var/www/${CLIENT_ID}"
BACKEND_PATH="${BACKEND_PATH:-${WWW_ROOT}/backend}"
FRONTEND_PATH="${FRONTEND_PATH:-${WWW_ROOT}/frontend}"
GITHUB_REPO="${GITHUB_REPO:-https://github.com/bb3agency/raghava-organics-site}"
RUNNER_NAME="${RUNNER_NAME:-${CLIENT_ID}-vps}"
RUNNER_LABEL="${RUNNER_LABEL:-${CLIENT_ID}-vps}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner-${CLIENT_ID}}"
LEGACY_RUNNER_DIR="$HOME/actions-runner"

log() { echo "[phase9] $*"; }
fail() { log "ERROR: $*"; exit 1; }

log "Checking monorepo layout at ${WWW_ROOT}..."
[ -d "$BACKEND_PATH" ] || fail "Missing $BACKEND_PATH — clone repo first (see GITHUB_CD_SETUP.md)"
[ -d "$FRONTEND_PATH" ] || fail "Missing $FRONTEND_PATH"
[ -f "$BACKEND_PATH/scripts/vps-deploy.sh" ] || fail "Missing vps-deploy.sh — wrong clone layout?"
[ -f "$BACKEND_PATH/.env" ] || fail "Missing $BACKEND_PATH/.env"
[ -f "$FRONTEND_PATH/.env.production.local" ] || fail "Missing $FRONTEND_PATH/.env.production.local"

log "Checking backend health..."
BACKEND_PORT=$(grep -E '^BACKEND_PORT=' "$BACKEND_PATH/.env" | cut -d= -f2 | tr -d '[:space:]')
BACKEND_PORT="${BACKEND_PORT:-3001}"
curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/v1/health" >/dev/null || fail "Backend health failed on port ${BACKEND_PORT}"

log "Checking PM2 frontend process ${CLIENT_ID}-frontend..."
if ! pm2 describe "${CLIENT_ID}-frontend" >/dev/null 2>&1; then
  fail "PM2 process ${CLIENT_ID}-frontend not found — run phase10-frontend-deploy.sh once first"
fi

log "Checking docker access for deploy user..."
docker ps >/dev/null || fail "Deploy user cannot run docker — add to docker group: sudo usermod -aG docker ${DEPLOY_USER}"

log "Checking git remotes..."
git -C "$BACKEND_PATH" remote get-url origin | grep -q 'raghava-organics-site' || \
  log "WARNING: origin URL may not match ${GITHUB_REPO}"

if [ ! -d "$RUNNER_DIR" ] && [ ! -d "$LEGACY_RUNNER_DIR" ]; then
  log "Runner not installed yet."
  log "Next steps (manual — token expires in 1 hour):"
  log "  1. GitHub → bb3agency/raghava-organics-site → Settings → Actions → Runners → New self-hosted runner"
  log "  2. Follow the download + ./config.sh commands on this VPS"
  log "  3. Use labels: self-hosted,${RUNNER_LABEL}"
  log "  4. sudo ./svc.sh install && sudo ./svc.sh start"
  exit 0
fi

log "Runner directory exists — checking service..."
ACTIVE_RUNNER_DIR="$RUNNER_DIR"
if [ ! -f "$ACTIVE_RUNNER_DIR/svc.sh" ] && [ -f "$LEGACY_RUNNER_DIR/svc.sh" ]; then
  ACTIVE_RUNNER_DIR="$LEGACY_RUNNER_DIR"
  log "WARNING: using legacy runner dir $LEGACY_RUNNER_DIR (migrate recommended)"
fi

if [ -f "$ACTIVE_RUNNER_DIR/svc.sh" ]; then
  (cd "$ACTIVE_RUNNER_DIR" && sudo ./svc.sh status) || fail "Runner service not healthy"
else
  fail "Runner directory present but svc.sh missing — re-install runner"
fi

log "Phase 9 VPS checks passed."
log "Configure GitHub repo Variables/Secrets per GITHUB_CD_SETUP.md, then push to main to test CD."
