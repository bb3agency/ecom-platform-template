#!/usr/bin/env bash
# Phase 10 - Frontend PM2 deploy (run on VPS after backend + Nginx)
set -euo pipefail

FRONTEND_PATH="${FRONTEND_PATH:-/var/www/raghava-organics/frontend}"
CLIENT_ID="${CLIENT_ID:-raghava-organics}"

if [ ! -d "$FRONTEND_PATH" ]; then
  echo "Missing $FRONTEND_PATH"
  exit 1
fi

if [ ! -f "$FRONTEND_PATH/.env.production.local" ]; then
  echo "Copy frontend/.env.production.example to .env.production.local and set PRODUCTION_DOMAIN"
  exit 1
fi

cd "$FRONTEND_PATH"
npm ci
npm run build

STOREFRONT_PORT=$(grep -E '^STOREFRONT_PORT=' .env.production.local | cut -d= -f2 | tr -d '[:space:]')
STOREFRONT_PORT="${STOREFRONT_PORT:-3101}"

if pm2 describe "${CLIENT_ID}-frontend" >/dev/null 2>&1; then
  pm2 reload "${CLIENT_ID}-frontend" --update-env
else
  pm2 start npm --name "${CLIENT_ID}-frontend" -- start -- -p "$STOREFRONT_PORT"
fi
pm2 save

HEALTH_URL="http://127.0.0.1:${STOREFRONT_PORT}"
if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  echo "Frontend is reachable on $HEALTH_URL"
else
  echo "Frontend did not respond on $HEALTH_URL - inspect: pm2 logs ${CLIENT_ID}-frontend"
  exit 1
fi

echo "Frontend listening on port $STOREFRONT_PORT - verify via Nginx and https://<domain>/"
