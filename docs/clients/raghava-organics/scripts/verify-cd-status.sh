#!/usr/bin/env bash
# Verify GitHub CD + PM2 + Docker on the Raghava VPS (run as deploy user: d_user)
# Does NOT fix issues — prints PASS/FAIL and next steps.
set -uo pipefail

slugify_client_id() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g'
}

CLIENT_ID_INPUT="${CLIENT_ID:-raghava-organics}"
CLIENT_ID="$(slugify_client_id "$CLIENT_ID_INPUT")"
WWW_ROOT="${WWW_ROOT:-/var/www/${CLIENT_ID}}"
BACKEND_PATH="${BACKEND_PATH:-${WWW_ROOT}/backend}"
FRONTEND_PATH="${FRONTEND_PATH:-${WWW_ROOT}/frontend}"
GITHUB_REPO="${GITHUB_REPO:-bb3agency/raghava-organics-site}"
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
echo " Raghava Organics — CD / PM2 / Docker verify"
echo " $(date -u '+%Y-%m-%dT%H:%M:%SZ') UTC"
echo "=============================================="
if [ "$CLIENT_ID" != "$CLIENT_ID_INPUT" ]; then
  echo " [INFO] CLIENT_ID normalized: '$CLIENT_ID_INPUT' -> '$CLIENT_ID'"
fi
echo ""

# --- Git monorepo ---
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
  git -C "$GIT_ROOT" fetch --quiet origin main 2>/dev/null || warn "git fetch failed (network or auth)"
  LOCAL=$(git -C "$GIT_ROOT" rev-parse HEAD 2>/dev/null || echo "?")
  REMOTE_SHA=$(git -C "$GIT_ROOT" rev-parse origin/main 2>/dev/null || echo "?")
  info "local HEAD:  ${LOCAL:0:12}"
  info "origin/main: ${REMOTE_SHA:0:12}"
  if [ "$LOCAL" = "$REMOTE_SHA" ]; then
    pass "VPS is up to date with origin/main"
  else
    fail "VPS is BEHIND origin/main — CD did not pull, or runner never ran deploy"
    info "Fix: push to main (if CD on) OR run: cd $GIT_ROOT && git pull origin main"
  fi
fi
echo ""

# --- GitHub Actions runner ---
echo "2) Self-hosted runner (required for auto-deploy on push)"
ACTIVE_RUNNER_DIR=""
if [ -d "$RUNNER_DIR" ] && [ -f "$RUNNER_DIR/.runner" ]; then
  ACTIVE_RUNNER_DIR="$RUNNER_DIR"
elif [ -d "$LEGACY_RUNNER_DIR" ] && [ -f "$LEGACY_RUNNER_DIR/.runner" ]; then
  ACTIVE_RUNNER_DIR="$LEGACY_RUNNER_DIR"
  warn "Using legacy $LEGACY_RUNNER_DIR — migrate: bash docs/clients/${CLIENT_ID}/scripts/migrate-runner-directory.sh"
fi

if [ -n "$ACTIVE_RUNNER_DIR" ]; then
  pass "Runner directory exists: $ACTIVE_RUNNER_DIR"
  if [ -f "$ACTIVE_RUNNER_DIR/svc.sh" ]; then
    if (cd "$ACTIVE_RUNNER_DIR" && sudo ./svc.sh status 2>/dev/null | grep -qi running); then
      pass "Runner service is running"
    else
      fail "Runner service not running — sudo $ACTIVE_RUNNER_DIR/svc.sh start"
    fi
  else
    fail "svc.sh missing — re-register runner (see GITHUB_CD_SETUP.md)"
  fi
else
  fail "No runner at $RUNNER_DIR (or legacy $LEGACY_RUNNER_DIR) — install per GITHUB_CD_SETUP.md"
fi
info "Runner must be Online in GitHub → $GITHUB_REPO → Settings → Actions → Runners"
info "Label must match repo Variable VPS_RUNNER_LABEL (expected: $RUNNER_LABEL)"
echo ""

# --- GitHub repo config (manual check) ---
echo "3) GitHub repo settings (check in browser)"
info "Variables (Settings → Secrets and variables → Actions → Variables):"
info "  VPS_DEPLOY_ENABLED = true"
info "  FRONTEND_DEPLOY_ENABLED = true"
info "  VPS_RUNNER_LABEL = $RUNNER_LABEL"
info "Secrets:"
info "  VPS_CLIENT_PATH = $BACKEND_PATH"
info "  VPS_FRONTEND_PATH = $FRONTEND_PATH"
info "Workflows on main: .github/workflows/reliability-ci.yml + deploy.yml"
info "Push flow: Reliability CI (ubuntu) must pass → then Deploy to VPS on runner"
echo ""

# --- Backend ---
echo "4) Backend (Docker)"
if [ -f "$BACKEND_PATH/.env" ]; then
  pass "backend/.env exists"
  BACKEND_PORT=$(grep -E '^BACKEND_PORT=' "$BACKEND_PATH/.env" | cut -d= -f2 | tr -d '[:space:]')
  BACKEND_PORT="${BACKEND_PORT:-3001}"
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/v1/health" >/dev/null 2>&1; then
    pass "GET /api/v1/health OK on :$BACKEND_PORT"
  else
    fail "Backend health failed on :$BACKEND_PORT"
  fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "${CLIENT_ID}-backend"; then
    pass "Container ${CLIENT_ID}-backend running"
  else
    fail "Container ${CLIENT_ID}-backend not running"
  fi
else
  fail "Missing $BACKEND_PATH/.env"
fi
echo ""

# --- Frontend PM2 ---
echo "5) Frontend (PM2)"
if [ -f "$FRONTEND_PATH/.env.production.local" ]; then
  pass "frontend/.env.production.local exists"
else
  fail "Missing $FRONTEND_PATH/.env.production.local"
fi

if command -v pm2 >/dev/null 2>&1; then
  pass "pm2 installed"
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    pass "PM2 process $PM2_NAME exists"
    pm2 jlist 2>/dev/null | head -c 200 >/dev/null || true
    info "$(pm2 describe "$PM2_NAME" 2>/dev/null | grep -E 'status|restarts|uptime' | head -5 | tr '\n' ' ')"
  else
    fail "PM2 process $PM2_NAME missing — run phase10-frontend-deploy.sh once"
  fi
  if systemctl is-enabled "pm2-$(whoami)" >/dev/null 2>&1 || systemctl is-enabled pm2-$(whoami).service >/dev/null 2>&1; then
    pass "PM2 systemd startup enabled (survives reboot)"
  else
    warn "PM2 startup may not survive reboot — run: pm2 startup && pm2 save"
  fi
else
  fail "pm2 not in PATH"
fi

STOREFRONT_PORT=3101
if [ -f "$FRONTEND_PATH/.env.production.local" ]; then
  STOREFRONT_PORT=$(grep -E '^STOREFRONT_PORT=' "$FRONTEND_PATH/.env.production.local" | cut -d= -f2 | tr -d '[:space:]' || echo 3101)
fi
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:${STOREFRONT_PORT}/" 2>/dev/null || echo "000")
if [[ "$HTTP" =~ ^(200|301|302|307|308)$ ]]; then
  pass "Storefront responds on :$STOREFRONT_PORT (HTTP $HTTP)"
else
  fail "Storefront not responding on :$STOREFRONT_PORT (HTTP $HTTP)"
fi

if [ -f "$FRONTEND_PATH/.last-frontend-deploy-sha" ]; then
  info "Last CD frontend deploy SHA: $(cat "$FRONTEND_PATH/.last-frontend-deploy-sha")"
else
  warn "No .last-frontend-deploy-sha — CD frontend deploy may never have succeeded"
fi
if [ -f "$FRONTEND_PATH/.last-frontend-build-sha" ]; then
  info "Last frontend build SHA: $(cat "$FRONTEND_PATH/.last-frontend-build-sha")"
  HEAD_SHA=$(git -C "$GIT_ROOT" rev-parse HEAD 2>/dev/null || echo "")
  if [ -n "$HEAD_SHA" ] && [ "$(cat "$FRONTEND_PATH/.last-frontend-build-sha")" != "$HEAD_SHA" ]; then
    warn "HEAD ($HEAD_SHA) != last build SHA — run phase10-frontend-deploy.sh (git pull alone is not enough)"
  fi
else
  warn "No .last-frontend-build-sha — npm run build may never have run on this host"
fi
echo ""

# --- Summary ---
echo "=============================================="
if [ "$FAILURES" -eq 0 ]; then
  echo " Overall: OK — if push still does not deploy, check GitHub Actions:"
  echo "   https://github.com/$GITHUB_REPO/actions"
  echo "   - Reliability CI green on your commit?"
  echo "   - Deploy to VPS ran on runner $RUNNER_LABEL?"
else
  echo " Overall: $FAILURES issue(s) — fix FAIL items above before expecting auto-deploy."
fi
echo ""
echo " Manual deploy (bypass waiting for CI):"
echo "   GitHub → Actions → Deploy to VPS → Run workflow"
echo ""
echo " Manual frontend only on VPS:"
echo "   bash $BACKEND_PATH/scripts/vps-frontend-deploy.sh $FRONTEND_PATH \$(git -C $GIT_ROOT rev-parse HEAD)"
echo "=============================================="

exit "$([ "$FAILURES" -eq 0 ] && echo 0 || echo 1)"
