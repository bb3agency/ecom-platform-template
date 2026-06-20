#!/usr/bin/env bash
# Phase 7 — Backend deploy template (copy to docs/clients/<client-id>/scripts/ and customize)
# Run on VPS after Phase 6 host baseline is complete.
set -euo pipefail

CLIENT_ID="${CLIENT_ID:-<client-id>}"
BACKEND_PATH="${BACKEND_PATH:-/var/www/<client-id>/backend}"
COMPOSE_PROJECT="${CLIENT_ID}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)

log() { echo "[phase7] $*"; }

[ -d "$BACKEND_PATH" ] || { log "Missing $BACKEND_PATH — clone repo first"; exit 1; }
[ -f "$BACKEND_PATH/.env" ] || { log "Missing $BACKEND_PATH/.env — copy from vault"; exit 1; }

cd "$BACKEND_PATH"

log "Checking Redis is not published on host :6379 (required on multi-client VPS)..."
if grep -A14 '^  redis:' docker-compose.yml | grep -qE '^[[:space:]]+ports:' \
  && ! grep -A14 '^  redis:' docker-compose.yml | grep -qE '^[[:space:]]+#.*ports:'; then
  log "ERROR: Comment out the redis service 'ports:' block in docker-compose.yml before continuing"
  exit 1
fi
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "${CLIENT_ID}-redis"; then
  if docker port "${CLIENT_ID}-redis" 6379/tcp 2>/dev/null | grep -q .; then
    log "ERROR: ${CLIENT_ID}-redis publishes 6379 on the host — recreate after commenting ports:"
    log "  docker compose -p ${CLIENT_ID} ${COMPOSE_FILES[*]} up -d --force-recreate redis"
    exit 1
  fi
fi

log "Installing backend deps (required — bare 'npx prisma' pulls Prisma 7 and breaks migrate)..."
npm ci

log "Running bootstrap env preflight..."
node scripts/verify-client-bootstrap-env.mjs

log "Starting Redis (prod overlay — host Postgres on :5432, no Compose Postgres)..."
docker compose -p "$COMPOSE_PROJECT" "${COMPOSE_FILES[@]}" up -d redis

log "Prisma generate + migrate..."
npx prisma generate --schema prisma/schema.prisma

MIGRATE_DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/host\.docker\.internal/127.0.0.1/')"
log "Prisma migrate via host Postgres (127.0.0.1)..."
DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma

log "Building and starting backend + workers..."
docker compose -p "$COMPOSE_PROJECT" "${COMPOSE_FILES[@]}" up -d --build backend workers

BACKEND_PORT=$(grep -E '^BACKEND_PORT=' .env | cut -d= -f2 | tr -d '[:space:]')
BACKEND_PORT="${BACKEND_PORT:-3001}"
HEALTH_URL="http://127.0.0.1:${BACKEND_PORT}/api/v1/health"
READY_URL="http://127.0.0.1:${BACKEND_PORT}/api/v1/health/ready"

log "Health check: $HEALTH_URL"
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" | grep -q '"database":"connected"'; then
    curl -fsS "$HEALTH_URL"
    log "Readiness snapshot (may be not_ready until Phase 8 Ops config):"
    curl -sS "$READY_URL" || true
    log "Phase 7 backend health OK"

    # Trim post-deploy cruft. Safe on live containers — only removes
    # dangling images and BuildKit cache layers; running containers,
    # in-use images, and named volumes are untouched.
    log "Post-deploy cleanup: dangling images + BuildKit cache (keep 3GB)..."
    docker image prune -f >/dev/null 2>&1 || true
    docker buildx prune --force --keep-storage 3GB >/dev/null 2>&1 || true

    # Install daily VPS cleanup script for this client (if not already present)
    log "Installing daily VPS cleanup script..."
    if [ -f "$BACKEND_PATH/scripts/install-vps-cleanup.sh" ]; then
      sudo "$BACKEND_PATH/scripts/install-vps-cleanup.sh" "$CLIENT_ID" "/var/www/$CLIENT_ID" "$CLIENT_ID-frontend" || true
    else
      log "Note: install-vps-cleanup.sh not found in backend/scripts — ensure cleanup is configured manually"
    fi

    exit 0
  fi
  sleep 2
done

docker compose -p "$COMPOSE_PROJECT" "${COMPOSE_FILES[@]}" logs --tail=40 backend
exit 1
