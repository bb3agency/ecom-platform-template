#!/usr/bin/env bash
# Phase 7.6 — GitHub CD preflight (copy to docs/clients/<client-id>/scripts/)
# Run on VPS before enabling push-to-deploy.
# Docs: docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md
set -euo pipefail

CLIENT_ID="${CLIENT_ID:-<client-id>}"
DEPLOY_USER="${DEPLOY_USER:-$(whoami)}"
WWW_ROOT="/var/www/${CLIENT_ID}"
BACKEND_PATH="${BACKEND_PATH:-${WWW_ROOT}/backend}"
FRONTEND_PATH="${FRONTEND_PATH:-${WWW_ROOT}/frontend}"
GITHUB_REPO="${GITHUB_REPO:-https://github.com/<org>/<client-repo>}"
RUNNER_LABEL="${RUNNER_LABEL:-${CLIENT_ID}-vps}"

log() { echo "[phase7.6-cd] $*"; }
fail() { log "ERROR: $*"; exit 1; }

log "Checking layout at ${WWW_ROOT}..."
[ -d "$BACKEND_PATH" ] || fail "Missing $BACKEND_PATH"
[ -f "$BACKEND_PATH/scripts/vps-deploy.sh" ] || fail "Missing vps-deploy.sh"
[ -f "$BACKEND_PATH/.env" ] || fail "Missing backend .env"

BACKEND_PORT=$(grep -E '^BACKEND_PORT=' "$BACKEND_PATH/.env" | cut -d= -f2 | tr -d '[:space:]')
BACKEND_PORT="${BACKEND_PORT:-3001}"
curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/v1/health" >/dev/null || fail "Backend health failed"

if [ "${FRONTEND_DEPLOY_ENABLED:-true}" = "true" ]; then
  [ -d "$FRONTEND_PATH" ] || fail "Missing $FRONTEND_PATH"
  [ -f "$FRONTEND_PATH/.env.production.local" ] || fail "Missing frontend .env.production.local"
  pm2 describe "${CLIENT_ID}-frontend" >/dev/null 2>&1 || \
    fail "PM2 ${CLIENT_ID}-frontend missing — bootstrap frontend once (Phase 10)"
fi

docker ps >/dev/null || fail "docker not available for $DEPLOY_USER"

if [ ! -d "$HOME/actions-runner" ]; then
  log "Runner not installed. Follow docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md Step A."
  exit 0
fi

(cd "$HOME/actions-runner" && sudo ./svc.sh status) || fail "Runner service not healthy"

log "VPS preflight OK. Set GitHub Variables/Secrets, then push to main."
