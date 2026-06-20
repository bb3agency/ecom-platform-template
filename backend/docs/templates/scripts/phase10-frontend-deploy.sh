#!/usr/bin/env bash
# Phase 10 — Frontend PM2 deploy template (copy to docs/clients/<client-id>/scripts/ and customize)
# Run on VPS after backend + Nginx + TLS are active.
set -euo pipefail

FRONTEND_PATH="${FRONTEND_PATH:-/var/www/<client-id>/frontend}"
CLIENT_ID="${CLIENT_ID:-<client-id>}"

if [ ! -d "$FRONTEND_PATH" ]; then
  echo "Missing $FRONTEND_PATH"
  exit 1
fi

if [ ! -f "$FRONTEND_PATH/.env.production.local" ]; then
  echo "Copy frontend/.env.production.example to .env.production.local and set PRODUCTION_DOMAIN"
  exit 1
fi

require_env_key() {
  local key="$1"
  if ! grep -qE "^${key}=.+" "$FRONTEND_PATH/.env.production.local"; then
    echo "Missing or empty ${key} in .env.production.local (required for /ops/* Basic Auth on VPS)"
    exit 1
  fi
}

require_env_key "OPS_UI_BASIC_AUTH_USERNAME"
require_env_key "OPS_UI_BASIC_AUTH_PASSWORD"
require_env_key "NEXT_PUBLIC_API_BASE_URL"
require_env_key "NEXT_PUBLIC_STOREFRONT_URL"

read_env_value() {
  grep -E "^$1=" "$FRONTEND_PATH/.env.production.local" | cut -d= -f2- | tr -d '\r"' | sed 's/[[:space:]]*$//'
}

cd "$FRONTEND_PATH"
npm ci
npm run build

STOREFRONT_PORT=$(grep -E '^STOREFRONT_PORT=' .env.production.local | cut -d= -f2 | tr -d '[:space:]')
STOREFRONT_PORT="${STOREFRONT_PORT:-3101}"

if pm2 describe "${CLIENT_ID}-frontend" >/dev/null 2>&1; then
  pm2 reload "${CLIENT_ID}-frontend" --update-env
else
  pm2 start npm --name "${CLIENT_ID}-frontend" -- start
fi
pm2 save

HEALTH_URL="http://127.0.0.1:${STOREFRONT_PORT}/"
MAX_RETRIES=20
RETRY_DELAY=2
for i in $(seq 1 "$MAX_RETRIES"); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" =~ ^(200|301|302|307|308)$ ]]; then
    echo "[phase10] Frontend reachable on $HEALTH_URL (HTTP $HTTP_CODE after ${i} attempt(s))"
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "[phase10] Frontend did not respond on $HEALTH_URL (last HTTP $HTTP_CODE) — inspect: pm2 logs ${CLIENT_ID}-frontend"
    exit 1
  fi
  sleep "$RETRY_DELAY"
done

OPS_USER="$(read_env_value OPS_UI_BASIC_AUTH_USERNAME)"
OPS_PASS="$(read_env_value OPS_UI_BASIC_AUTH_PASSWORD)"
OPS_SETUP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -u "${OPS_USER}:${OPS_PASS}" "http://127.0.0.1:${STOREFRONT_PORT}/ops/setup" 2>/dev/null || echo "000")
if [[ ! "$OPS_SETUP_CODE" =~ ^(200|307|308)$ ]]; then
  echo "[phase10] ERROR: /ops/setup returned HTTP $OPS_SETUP_CODE with Basic Auth from .env.production.local"
  echo "  Pull latest frontend (proxy.ts uses connection() for runtime env), rebuild, and reload PM2."
  echo "  Inspect: pm2 logs ${CLIENT_ID}-frontend"
  exit 1
fi
echo "[phase10] /ops/setup Basic Auth OK (HTTP $OPS_SETUP_CODE)"
echo "Frontend listening on port $STOREFRONT_PORT - verify via Nginx and https://<domain>/"
