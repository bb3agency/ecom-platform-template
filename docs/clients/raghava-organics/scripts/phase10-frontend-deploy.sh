#!/usr/bin/env bash
# Phase 10 — Frontend deploy (Raghava Organics)
#
# Wraps the canonical CD script: git sync + npm ci + npm run build + pm2 reload.
# Do not rely on git pull alone — browsers serve the compiled .next bundle.
#
# Usage (on VPS):
#   bash docs/clients/raghava-organics/scripts/phase10-frontend-deploy.sh
#
# Env overrides:
#   FRONTEND_PATH  default /var/www/raghava-organics/frontend
#   BACKEND_PATH   default /var/www/raghava-organics/backend
#   COMMIT_SHA     default HEAD after optional git pull (set when called from CI)

set -euo pipefail

FRONTEND_PATH="${FRONTEND_PATH:-/var/www/raghava-organics/frontend}"
BACKEND_PATH="${BACKEND_PATH:-/var/www/raghava-organics/backend}"
DEPLOY_SCRIPT="$BACKEND_PATH/scripts/vps-frontend-deploy.sh"

if [ ! -d "$FRONTEND_PATH" ]; then
  echo "Missing $FRONTEND_PATH"
  exit 1
fi

if [ ! -f "$FRONTEND_PATH/.env.production.local" ]; then
  echo "Copy frontend/.env.production.example to .env.production.local (raghavaorganics.com + cdn.raghavaorganics.com)"
  exit 1
fi

if [ ! -f "$DEPLOY_SCRIPT" ]; then
  echo "Missing canonical deploy script: $DEPLOY_SCRIPT"
  exit 1
fi

GIT_ROOT=$(git -C "$FRONTEND_PATH" rev-parse --show-toplevel 2>/dev/null || echo "$(dirname "$FRONTEND_PATH")")

if [ -z "${COMMIT_SHA:-}" ]; then
  echo "Syncing git at $GIT_ROOT …"
  git -C "$GIT_ROOT" fetch origin main
  git -C "$GIT_ROOT" checkout main 2>/dev/null || git -C "$GIT_ROOT" checkout -B main origin/main
  git -C "$GIT_ROOT" pull origin main --ff-only
  COMMIT_SHA=$(git -C "$GIT_ROOT" rev-parse HEAD)
fi

echo "Deploying frontend at $FRONTEND_PATH (commit $COMMIT_SHA)…"
bash "$DEPLOY_SCRIPT" "$FRONTEND_PATH" "$COMMIT_SHA"

echo "Done. Verify https://<domain>/admin shows Admin Console (sidebar), not legacy Admin Read Surfaces."
