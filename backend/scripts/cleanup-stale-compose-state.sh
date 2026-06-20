#!/usr/bin/env bash
# =============================================================================
# cleanup-stale-compose-state.sh — operator recovery from Dead-container ghosts
#
# Run on the VPS when `docker compose up -d ...` keeps printing errors like:
#
#   ⠙ Container 1b268e1da8d8   Starting
#   ✘ Container 1b268e1da8d8   Error response from daemon: No such container: ...
#
# even though backend/workers ARE actually running. This means Docker has
# Dead-state tombstones in /var/lib/docker/containers/<id>/ that compose
# picks up via project labels and tries to recreate every `up`.
#
# Background: when an image gets replaced (every deploy rebuilds backend +
# workers) but the old container's image was pruned before the container
# was cleanly removed, Docker marks the container `Dead` and leaves the
# on-disk directory behind. `docker rm -f` reports "No such container"
# because the container is already gone from Docker's runtime — but the
# tombstone keeps showing up in `docker ps -a --filter label=...`. The
# only thing that fully clears these is removing the on-disk directory
# AND restarting the Docker daemon so it re-scans /var/lib/docker.
#
# Usage:
#   bash backend/scripts/cleanup-stale-compose-state.sh [PROJECT]
#
# Arguments:
#   PROJECT  (optional)  The compose project name to clean. If omitted,
#                        derived from CLIENT_ID in the .env in the current
#                        directory. Must match the `-p` flag you've been
#                        using with `docker compose`.
#
# Safety:
#   - Only touches containers labeled `com.docker.compose.project=<PROJECT>`.
#     Other projects on this VPS are unaffected.
#   - Live containers (backend/workers/redis in `running` state) are NOT
#     removed. Only Dead/Exited tombstones are.
#   - Does NOT touch volumes (postgres data, redis AOF, etc.) — those have
#     their own labels and are not in scope here.
#   - Restarts the Docker daemon at the end. Live containers are configured
#     with `restart: unless-stopped` in docker-compose.yml so they come back
#     within a couple of seconds.
#
# After this script completes, redeploy with:
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
#     -p <PROJECT> up -d --remove-orphans backend workers
# (Or rely on `restart: unless-stopped` to do it.)
#
# NOTE: we deliberately do NOT pass `--force-recreate` here. Compose v2's
# force-recreate uses a rename-then-replace path that re-triggers the same
# phantom-start failure mode this script exists to fix. Plain `up` is
# enough after this cleanup because there are no stale containers left.
# =============================================================================

set -uo pipefail

PROJECT="${1:-}"
if [ -z "$PROJECT" ] && [ -f ".env" ]; then
  PROJECT="$(grep -E '^CLIENT_ID=' .env | head -1 | cut -d= -f2- | tr -d '[:space:]' | tr -d '"' | tr -d "'")"
fi
if [ -z "$PROJECT" ]; then
  echo "ERROR: PROJECT not specified and could not be derived from .env CLIENT_ID." >&2
  echo "Usage: bash $(basename "$0") <PROJECT>" >&2
  exit 1
fi

log() { echo "[cleanup] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

log "Cleaning stale compose state for project: $PROJECT"

# ── Step 1: list current state for the project ─────────────────────────────
log "Containers currently labeled with project=$PROJECT:"
docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
  --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}"

# ── Step 2: identify all stale states (Dead, Exited, Created, Removing) ───
# Compose sometimes leaves containers in `created` (never-started) or
# `removing` (hung removal) states too; both produce the same "ghost"
# behaviour as `dead`/`exited` and should be cleaned together.
STALE_IDS="$( {
  docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --filter "status=dead"     --format '{{.ID}}' 2>/dev/null || true
  docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --filter "status=exited"   --format '{{.ID}}' 2>/dev/null || true
  docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --filter "status=created"  --format '{{.ID}}' 2>/dev/null || true
  docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --filter "status=removing" --format '{{.ID}}' 2>/dev/null || true
} | awk 'NF' | sort -u)"

if [ -z "$STALE_IDS" ]; then
  log "No Dead/Exited/Created/Removing containers found for this project. Nothing to clean."
  exit 0
fi

# ── Step 3: capture full IDs (64-char) so we can remove tombstone dirs ────
log "Stale container IDs to remove:"
echo "$STALE_IDS" | sed 's/^/  - /'

FULL_IDS=""
echo "$STALE_IDS" | while read -r cid; do
  [ -z "$cid" ] && continue
  full="$(docker inspect -f '{{.Id}}' "$cid" 2>/dev/null || echo "")"
  [ -z "$full" ] && full="$cid"
  echo "$full" >> /tmp/cleanup-stale-full-ids.$$
done
if [ -f "/tmp/cleanup-stale-full-ids.$$" ]; then
  FULL_IDS="$(cat /tmp/cleanup-stale-full-ids.$$)"
  rm -f "/tmp/cleanup-stale-full-ids.$$"
fi

# ── Step 4: force-remove containers via Docker ─────────────────────────────
log "Force-removing containers via docker rm -f..."
echo "$STALE_IDS" | while read -r cid; do
  [ -z "$cid" ] && continue
  docker rm -f "$cid" 2>&1 | sed 's/^/    /' || true
done

# ── Step 5: remove on-disk tombstone directories ──────────────────────────
log "Removing on-disk tombstone directories from /var/lib/docker/containers/..."
echo "$FULL_IDS" | while read -r full_id; do
  [ -z "$full_id" ] && continue
  dir="/var/lib/docker/containers/$full_id"
  if [ -d "$dir" ]; then
    log "  Removing $dir"
    if [ "$(id -u)" -eq 0 ]; then
      rm -rf "$dir" || log "    Failed to remove $dir"
    else
      sudo rm -rf "$dir" || log "    Failed to remove $dir (need sudo?)"
    fi
  fi
done

# ── Step 6: restart Docker daemon so it re-scans the containers dir ───────
log "Restarting Docker daemon to refresh container index..."
if command -v systemctl >/dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ]; then
    systemctl restart docker
  else
    sudo systemctl restart docker
  fi
else
  log "WARNING: systemctl not found. Restart Docker manually:"
  log "  sudo service docker restart"
  exit 0
fi

# ── Step 7: wait for daemon to come back ──────────────────────────────────
log "Waiting for Docker daemon to come back up..."
for i in $(seq 1 30); do
  if docker info >/dev/null 2>&1; then
    log "Docker daemon ready (attempt $i)"
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    log "ERROR: Docker daemon did not come back after 30 seconds."
    exit 1
  fi
done

# ── Step 8: confirm cleanup ───────────────────────────────────────────────
log "Containers for project=$PROJECT after cleanup:"
docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
  --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}"

log "Cleanup complete. Now redeploy with:"
log "  docker compose -f docker-compose.yml -f docker-compose.prod.yml \\"
log "    -p $PROJECT up -d --remove-orphans backend workers"
log "(Or wait ~5s for restart: unless-stopped to bring live containers back automatically.)"
log ""
log "Do NOT add --force-recreate to that command. Compose v2's --force-recreate"
log "uses a rename-then-replace pattern that re-triggers the same phantom-start"
log "failure this script just cleaned up. After a clean state, plain 'up' is"
log "what you want."
