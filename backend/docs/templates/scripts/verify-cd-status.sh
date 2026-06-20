#!/usr/bin/env bash
# Verify GitHub CD + PM2 + Docker readiness on VPS (template).
# Run as deploy user on the target VPS.
set -uo pipefail

slugify_client_id() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g'
}

CLIENT_ID_INPUT="${CLIENT_ID:-<client-id>}"
CLIENT_ID="$(slugify_client_id "$CLIENT_ID_INPUT")"
[ "$CLIENT_ID" != "<client-id>" ] || { echo "Set CLIENT_ID first."; exit 1; }

WWW_ROOT="${WWW_ROOT:-/var/www/${CLIENT_ID}}"
BACKEND_PATH="${BACKEND_PATH:-${WWW_ROOT}/backend}"
FRONTEND_PATH="${FRONTEND_PATH:-${WWW_ROOT}/frontend}"
GITHUB_REPO="${GITHUB_REPO:-<org>/<client-repo>}"
RUNNER_LABEL="${RUNNER_LABEL:-${CLIENT_ID}-vps}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner-${CLIENT_ID}}"
LEGACY_RUNNER_DIR="$HOME/actions-runner"
PM2_NAME="${CLIENT_ID}-frontend"

pass() { echo "  [PASS] $*"; }
fail() { echo "  [FAIL] $*"; FAILURES=$((FAILURES + 1)); }
warn() { echo "  [WARN] $*"; }
info() { echo "  [INFO] $*"; }

FAILURES=0

echo "=============================================="
echo " ${CLIENT_ID} - CD / PM2 / Docker verify"
echo " $(date -u '+%Y-%m-%dT%H:%M:%SZ') UTC"
echo "=============================================="
echo ""

echo "1) Git repository"
if [ -d "$WWW_ROOT/.git" ]; then
  pass "Monorepo .git at $WWW_ROOT"
  GIT_ROOT="$WWW_ROOT"
elif git -C "$BACKEND_PATH" rev-parse --show-toplevel >/dev/null 2>&1; then
  GIT_ROOT=$(git -C "$BACKEND_PATH" rev-parse --show-toplevel)
  pass "Git root: $GIT_ROOT"
else
  fail "No git repo found at $WWW_ROOT or $BACKEND_PATH"
  GIT_ROOT=""
fi

if [ -n "$GIT_ROOT" ]; then
  REMOTE=$(git -C "$GIT_ROOT" remote get-url origin 2>/dev/null || echo "missing")
  info "origin: $REMOTE"
  git -C "$GIT_ROOT" fetch --quiet origin main 2>/dev/null || warn "git fetch failed"
  LOCAL=$(git -C "$GIT_ROOT" rev-parse HEAD 2>/dev/null || echo "?")
  REMOTE_SHA=$(git -C "$GIT_ROOT" rev-parse origin/main 2>/dev/null || echo "?")
  info "local HEAD:  ${LOCAL:0:12}"
  info "origin/main: ${REMOTE_SHA:0:12}"
fi
echo ""

echo "2) Self-hosted runner"
ACTIVE_RUNNER_DIR=""
if [ -d "$RUNNER_DIR" ] && [ -f "$RUNNER_DIR/.runner" ]; then
  ACTIVE_RUNNER_DIR="$RUNNER_DIR"
elif [ -d "$LEGACY_RUNNER_DIR" ] && [ -f "$LEGACY_RUNNER_DIR/.runner" ]; then
  ACTIVE_RUNNER_DIR="$LEGACY_RUNNER_DIR"
  warn "Using legacy $LEGACY_RUNNER_DIR; migrate to per-client runner dir."
fi

if [ -n "$ACTIVE_RUNNER_DIR" ]; then
  pass "Runner directory exists: $ACTIVE_RUNNER_DIR"
  if [ -f "$ACTIVE_RUNNER_DIR/svc.sh" ]; then
    (cd "$ACTIVE_RUNNER_DIR" && sudo ./svc.sh status 2>/dev/null | grep -qi running) \
      && pass "Runner service is running" \
      || fail "Runner service not running"
  else
    fail "svc.sh missing in runner directory"
  fi
else
  fail "No runner at $RUNNER_DIR (or legacy $LEGACY_RUNNER_DIR)"
fi
info "Runner label expected: $RUNNER_LABEL"
echo ""

echo "3) Backend"
if [ -f "$BACKEND_PATH/.env" ]; then
  pass "backend/.env exists"
  BACKEND_PORT=$(grep -E '^BACKEND_PORT=' "$BACKEND_PATH/.env" | head -1 | cut -d= -f2 | tr -d '[:space:]')
  BACKEND_PORT="${BACKEND_PORT:-3001}"
  curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/v1/health" >/dev/null 2>&1 \
    && pass "GET /api/v1/health OK on :$BACKEND_PORT" \
    || fail "Backend health failed on :$BACKEND_PORT"
else
  fail "Missing $BACKEND_PATH/.env"
fi
echo ""

echo "4) Frontend"
if [ -f "$FRONTEND_PATH/.env.production.local" ]; then
  pass "frontend/.env.production.local exists"
fi
if command -v pm2 >/dev/null 2>&1; then
  pm2 describe "$PM2_NAME" >/dev/null 2>&1 && pass "PM2 process $PM2_NAME exists" || warn "PM2 process missing"
fi

echo "=============================================="
if [ "$FAILURES" -eq 0 ]; then
  echo " Overall: OK"
else
  echo " Overall: $FAILURES issue(s)"
fi
echo " GitHub Actions: https://github.com/$GITHUB_REPO/actions"
echo "=============================================="

exit "$([ "$FAILURES" -eq 0 ] && echo 0 || echo 1)"
