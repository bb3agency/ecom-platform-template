#!/usr/bin/env bash
# Phase 8 - Ops bootstrap (run on VPS after Phase 7 health passes)
set -euo pipefail

CLIENT_ID="${CLIENT_ID:-raghava-organics}"
BACKEND_PATH="${BACKEND_PATH:-/var/www/raghava-organics/backend}"
OPS_EMAIL="${OPS_EMAIL:?Set OPS_EMAIL}"
SETUP_BASE_URL="${SETUP_BASE_URL:?Set SETUP_BASE_URL e.g. https://your-domain}"
COMPOSE_ARGS="-p ${CLIENT_ID} -f docker-compose.yml -f docker-compose.prod.yml"

cd "$BACKEND_PATH"

if grep -q 'replace_with_resend' .env 2>/dev/null; then
  echo "RESEND_API_KEY still placeholder in .env - fix before ops:newuser"
  exit 1
fi

npm run ops:newuser -- \
  --email="$OPS_EMAIL" \
  --name="Primary Ops" \
  --setup-base-url="$SETUP_BASE_URL" \
  --yes

echo "Complete /ops/setup in browser, then save provider keys via Ops UI and restart:"
echo "  docker compose ${COMPOSE_ARGS} up -d backend workers"
echo "Then verify readiness is fully green:"
echo "  curl -fsS http://127.0.0.1:\${BACKEND_PORT:-3001}/api/v1/health/ready"
echo "Expected: status=ready and runtimeConfigMissingKeys=[]"
