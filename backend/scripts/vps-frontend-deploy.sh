#!/usr/bin/env bash
# =============================================================================
# vps-frontend-deploy.sh - VPS-side deploy script for Next.js frontend
#
# Executed locally by the self-hosted GitHub Actions runner installed on this VPS.
# The runner pulls the job from GitHub via outbound HTTPS and runs this script
# directly - no inbound SSH connection is opened.
#
# Every deploy (default):
#   1. git fetch + reset to origin/main at monorepo root
#   2. npm ci + npm run build in FRONTEND_PATH
#   3. pm2 reload <client-id>-frontend (zero-downtime)
#   4. HTTP health check
#
# git pull alone does NOT update what browsers see — this script (or phase10
# wrapping it) must run after code changes.
#
# Optional: SKIP_FRONTEND_BUILD=true — PM2 reload + health check only (backend-only
# pushes). Never use after frontend code changed; .last-frontend-build-sha is not updated.
#
# Usage:
#   bash scripts/vps-frontend-deploy.sh <FRONTEND_PATH> <COMMIT_SHA>
#
# Arguments:
#   FRONTEND_PATH  Absolute path to the client frontend directory on VPS
#   COMMIT_SHA     The git commit SHA that CI validated (for verification)
# =============================================================================

set -euo pipefail

resolve_storefront_port() {
  local base_path="$1"
  local env_file=""
  local port=""
  for env_file in .env.local .env.production.local .env.production; do
    if [ -f "$base_path/$env_file" ]; then
      port=$(grep -E '^STOREFRONT_PORT=' "$base_path/$env_file" | head -1 | cut -d= -f2- | tr -d '"' | xargs || true)
      if [ -n "$port" ]; then
        echo "$port"
        return 0
      fi
    fi
  done
  echo "3101"
}

FRONTEND_PATH="${1:-}"
COMMIT_SHA="${2:-}"

if [ -z "$FRONTEND_PATH" ] || [ -z "$COMMIT_SHA" ]; then
  echo "::error::Usage: vps-frontend-deploy.sh <FRONTEND_PATH> <COMMIT_SHA>"
  exit 1
fi

if [ ! -d "$FRONTEND_PATH" ]; then
  echo "::error::FRONTEND_PATH does not exist: $FRONTEND_PATH"
  exit 1
fi

if [ ! -f "$FRONTEND_PATH/package.json" ]; then
  echo "::error::No package.json found at $FRONTEND_PATH - is this a Next.js project?"
  exit 1
fi

DEPLOY_SHA_RECORD="$FRONTEND_PATH/.last-frontend-deploy-sha"
BUILD_SHA_RECORD="$FRONTEND_PATH/.last-frontend-build-sha"
SKIP_BUILD="${SKIP_FRONTEND_BUILD:-false}"

GIT_ROOT=$(git -C "$FRONTEND_PATH" rev-parse --show-toplevel 2>/dev/null || echo "$FRONTEND_PATH")

echo "===== Frontend deploy started ====="
echo "Path:   $FRONTEND_PATH"
echo "Git:    $GIT_ROOT"
echo "SHA:    $COMMIT_SHA"
echo "Time:   $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ---------------------------------------------------------------------------
# 1. Sync git at monorepo root (git pull is not enough without build + pm2)
# ---------------------------------------------------------------------------
echo ""
echo "----- Step 1: git sync -----"
cd "$GIT_ROOT"
git fetch --quiet origin main
git checkout main 2>/dev/null || git checkout -B main origin/main
git reset --hard "origin/main"

ACTUAL_SHA=$(git rev-parse HEAD)
if [ "$ACTUAL_SHA" != "$COMMIT_SHA" ]; then
  echo "::error::SHA mismatch - expected $COMMIT_SHA, got $ACTUAL_SHA"
  echo "Another push may have landed mid-deploy. Failing safely."
  exit 1
fi
echo "SHA verified: $ACTUAL_SHA"

# ---------------------------------------------------------------------------
# 2. Install dependencies and production build (default: always)
# ---------------------------------------------------------------------------
echo ""
echo "----- Step 2: frontend build -----"
if [ "$SKIP_BUILD" = "true" ]; then
  echo "::warning::SKIP_FRONTEND_BUILD=true — skipping npm ci / npm run build."
  echo "Use only for backend-only deploys. Browsers will keep the previous .next bundle."
  if [ -f "$BUILD_SHA_RECORD" ]; then
    echo "Last built SHA: $(cat "$BUILD_SHA_RECORD")"
  else
    echo "::warning::No $BUILD_SHA_RECORD — frontend may never have been built on this host."
  fi
else
  cd "$FRONTEND_PATH"

  # Verify no stale config files exist (should only have next.config.ts from git)
  echo "Verifying config integrity…"
  if [ -f "next.config.js" ]; then
    echo "::warning::Found stale next.config.js (not tracked in git). Removing…"
    rm -f next.config.js
  fi

  # Clean install (npm ci is safe — it doesn't break concurrent builds)
  # Do NOT aggressively delete .next or node_modules — let npm/next handle it
  # Aggressive deletion causes race conditions with Turbopack/build process
  echo "Running npm ci (clean install)…"
  if ! npm ci --prefer-offline --no-audit 2>&1; then
    echo "::error::npm ci failed."
    exit 1
  fi

  # Build with error capture
  echo "Running npm run build…"
  BUILD_LOG=$(mktemp)
  if ! npm run build > "$BUILD_LOG" 2>&1; then
    echo "::error::npm run build failed. Build output:"
    cat "$BUILD_LOG"
    rm -f "$BUILD_LOG"

    # Rollback: restore previous build
    if [ -d "$FRONTEND_PATH/.next.old" ]; then
      rm -rf "$FRONTEND_PATH/.next" 2>/dev/null || true
      mv "$FRONTEND_PATH/.next.old" "$FRONTEND_PATH/.next"
      echo "::warning::Rolled back to previous .next build due to build failure."
    fi
    exit 1
  fi
  rm -f "$BUILD_LOG"

  # Verify build artifacts exist and are complete
  if [ ! -d "$FRONTEND_PATH/.next" ]; then
    echo "::error::Build finished but .next/ directory is missing."
    if [ -d "$FRONTEND_PATH/.next.old" ]; then
      mv "$FRONTEND_PATH/.next.old" "$FRONTEND_PATH/.next"
      echo "::warning::Rolled back to previous .next build."
    fi
    exit 1
  fi

  if [ ! -f "$FRONTEND_PATH/.next/BUILD_ID" ]; then
    echo "::error::Build verification failed: .next/BUILD_ID is missing (corrupt build)."
    rm -rf "$FRONTEND_PATH/.next"
    if [ -d "$FRONTEND_PATH/.next.old" ]; then
      mv "$FRONTEND_PATH/.next.old" "$FRONTEND_PATH/.next"
      echo "::warning::Rolled back to previous .next build due to corrupt new build."
    fi
    exit 1
  fi

  # Clean up old build backup
  rm -rf "$FRONTEND_PATH/.next.old" 2>/dev/null || true

  echo "$COMMIT_SHA" > "$BUILD_SHA_RECORD"
  echo "Build complete and verified. Recorded build SHA: $COMMIT_SHA"
fi

cd "$FRONTEND_PATH"

# ---------------------------------------------------------------------------
# 3. PM2 reload
# ---------------------------------------------------------------------------
echo ""
echo "----- Step 3: PM2 reload -----"

CLIENT_ID=""
for env_file in .env.local .env.production.local .env.production; do
  if [ -f "$FRONTEND_PATH/$env_file" ]; then
    CLIENT_ID=$(grep -E '^CLIENT_ID=' "$FRONTEND_PATH/$env_file" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true)
    if [ -n "$CLIENT_ID" ]; then
      break
    fi
  fi
done

if [ -z "$CLIENT_ID" ]; then
  CLIENT_ID=$(basename "$(dirname "$FRONTEND_PATH")")
  echo "::warning::CLIENT_ID not found in env files. Using directory-derived name: $CLIENT_ID"
fi

PM2_NAME="${CLIENT_ID}-frontend"
echo "PM2 process name: $PM2_NAME"

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 reload "$PM2_NAME" --update-env
  echo "PM2 reload issued for $PM2_NAME"
else
  echo "::warning::PM2 process '$PM2_NAME' not found."
  echo "Run the one-time setup first:"
  echo "  pm2 start npm --name '$PM2_NAME' -- start -- -p <STOREFRONT_PORT>"
  echo "  pm2 save && pm2 startup"
  echo "Attempting cold start (port from STOREFONT_PORT env or 3101)…"
  STOREFRONT_PORT=$(resolve_storefront_port "$FRONTEND_PATH")
  pm2 start npm --name "$PM2_NAME" -- start -- -p "$STOREFRONT_PORT"
  pm2 save
fi

# ---------------------------------------------------------------------------
# 4. Health check
# ---------------------------------------------------------------------------
echo ""
echo "----- Step 4: health check -----"

STOREFRONT_PORT=$(resolve_storefront_port "$FRONTEND_PATH")
HEALTH_URL="http://127.0.0.1:${STOREFRONT_PORT}/"
MAX_RETRIES=20
RETRY_DELAY=3

for i in $(seq 1 $MAX_RETRIES); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" =~ ^(200|301|302|307|308)$ ]]; then
    echo "Health check passed (HTTP $HTTP_CODE) after $i attempt(s)."
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "::error::Frontend health check failed after $MAX_RETRIES attempts (last HTTP $HTTP_CODE)."
    echo "PM2 logs:"
    pm2 logs "$PM2_NAME" --lines 30 --nostream 2>/dev/null || true
    exit 1
  fi
  echo "  Attempt $i/$MAX_RETRIES - HTTP $HTTP_CODE. Retrying in ${RETRY_DELAY}s..."
  sleep "$RETRY_DELAY"
done

# ---------------------------------------------------------------------------
# 5. Record deploy SHA (git sync + pm2; build SHA recorded separately)
# ---------------------------------------------------------------------------
echo "$COMMIT_SHA" > "$DEPLOY_SHA_RECORD"
echo "Deploy SHA recorded: $COMMIT_SHA"

echo ""
echo "===== Frontend deploy complete ====="
echo "Process:    $PM2_NAME"
echo "Deploy SHA: $COMMIT_SHA"
if [ -f "$BUILD_SHA_RECORD" ]; then
  echo "Build SHA:  $(cat "$BUILD_SHA_RECORD")"
fi
echo "Time:       $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
