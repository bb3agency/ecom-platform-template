#!/usr/bin/env bash
set -euo pipefail

##############################################################################
# dr-backup-offsite.sh — Automated PostgreSQL + Redis Backup with Off-site Copy
#
# Creates timestamped, compressed backups and copies them to an off-site
# destination (local dir or remote via rsync).
#
# Required env vars:
#   DATABASE_URL    — Postgres connection string
#   CLIENT_ID       — Tenant identifier (used in filenames)
#
# Optional env vars:
#   BACKUP_DEST     — Off-site destination path (default: ./backups)
#                     Supports local path or rsync-style remote: user@host:/path
#   REDIS_URL       — Redis URL for RDB export (default: redis://localhost:6379)
#   REDIS_CLI_CMD   — Override redis-cli binary path
#
# Usage:
#   export DATABASE_URL="postgresql://user:pass@localhost:5432/ecom"
#   export CLIENT_ID="acme"
#   bash scripts/dr-backup-offsite.sh
#
# Cron example (daily at 02:00):
#   0 2 * * * cd /opt/ecom && bash scripts/dr-backup-offsite.sh >> /var/log/ecom-backup.log 2>&1
##############################################################################

TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
CLIENT_ID="${CLIENT_ID:?Missing CLIENT_ID env var}"
DATABASE_URL="${DATABASE_URL:?Missing DATABASE_URL env var}"
BACKUP_DEST="${BACKUP_DEST:-./backups}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
REDIS_CLI_CMD="${REDIS_CLI_CMD:-redis-cli}"
EVIDENCE_DIR="./artifacts/dr-drills"

echo "=== DR Backup — ${CLIENT_ID} — ${TIMESTAMP} ==="

# ── Create working directory ─────────────────────────────────────────
WORK_DIR=$(mktemp -d)
trap 'rm -rf "${WORK_DIR}"' EXIT

# ── 1. PostgreSQL Backup ─────────────────────────────────────────────
PG_FILE="${CLIENT_ID}-pg-${TIMESTAMP}.sql.gz"
PG_PATH="${WORK_DIR}/${PG_FILE}"

echo "[1/4] Dumping PostgreSQL..."
pg_dump "${DATABASE_URL}" --no-owner --no-privileges --clean --if-exists | gzip > "${PG_PATH}"

PG_SIZE=$(stat -c%s "${PG_PATH}" 2>/dev/null || stat -f%z "${PG_PATH}" 2>/dev/null || echo 0)
if [ "${PG_SIZE}" -lt 100 ]; then
  echo "ERROR: PostgreSQL backup is suspiciously small (${PG_SIZE} bytes)"
  exit 1
fi
PG_SHA256=$(sha256sum "${PG_PATH}" | cut -d' ' -f1)
echo "  ✅ PostgreSQL backup: ${PG_FILE} (${PG_SIZE} bytes, sha256:${PG_SHA256:0:16}...)"

# ── 2. Redis Backup (best-effort) ────────────────────────────────────
REDIS_FILE="${CLIENT_ID}-redis-${TIMESTAMP}.rdb.gz"
REDIS_PATH="${WORK_DIR}/${REDIS_FILE}"
REDIS_SHA256="n/a"
REDIS_SIZE=0

echo "[2/4] Triggering Redis BGSAVE..."
if command -v "${REDIS_CLI_CMD}" &>/dev/null; then
  ${REDIS_CLI_CMD} -u "${REDIS_URL}" BGSAVE 2>/dev/null || true
  sleep 2

  # Find the RDB file from Redis info
  REDIS_DIR=$(${REDIS_CLI_CMD} -u "${REDIS_URL}" CONFIG GET dir 2>/dev/null | tail -1 || echo "")
  REDIS_DBFILE=$(${REDIS_CLI_CMD} -u "${REDIS_URL}" CONFIG GET dbfilename 2>/dev/null | tail -1 || echo "dump.rdb")

  if [ -n "${REDIS_DIR}" ] && [ -f "${REDIS_DIR}/${REDIS_DBFILE}" ]; then
    gzip -c "${REDIS_DIR}/${REDIS_DBFILE}" > "${REDIS_PATH}"
    REDIS_SIZE=$(stat -c%s "${REDIS_PATH}" 2>/dev/null || stat -f%z "${REDIS_PATH}" 2>/dev/null || echo 0)
    REDIS_SHA256=$(sha256sum "${REDIS_PATH}" | cut -d' ' -f1)
    echo "  ✅ Redis backup: ${REDIS_FILE} (${REDIS_SIZE} bytes, sha256:${REDIS_SHA256:0:16}...)"
  else
    echo "  ⚠️  Redis RDB not found at ${REDIS_DIR}/${REDIS_DBFILE} — skipping Redis backup"
  fi
else
  echo "  ⚠️  redis-cli not found — skipping Redis backup"
fi

# ── 3. Copy to off-site destination ──────────────────────────────────
echo "[3/4] Copying to off-site destination: ${BACKUP_DEST}"

if [[ "${BACKUP_DEST}" == *:* ]]; then
  # Remote destination via rsync
  rsync -avz "${PG_PATH}" "${BACKUP_DEST}/"
  [ "${REDIS_SIZE}" -gt 0 ] && rsync -avz "${REDIS_PATH}" "${BACKUP_DEST}/"
  echo "  ✅ Synced to remote: ${BACKUP_DEST}"
else
  # Local destination
  mkdir -p "${BACKUP_DEST}"
  cp "${PG_PATH}" "${BACKUP_DEST}/"
  [ "${REDIS_SIZE}" -gt 0 ] && cp "${REDIS_PATH}" "${BACKUP_DEST}/"
  echo "  ✅ Copied to local: ${BACKUP_DEST}"
fi

# ── 4. Write evidence JSON ───────────────────────────────────────────
echo "[4/4] Writing evidence..."
mkdir -p "${EVIDENCE_DIR}"
EVIDENCE_FILE="${EVIDENCE_DIR}/backup-${TIMESTAMP}.json"

cat > "${EVIDENCE_FILE}" <<EOF
{
  "type": "offsite-backup",
  "clientId": "${CLIENT_ID}",
  "timestamp": "${TIMESTAMP}",
  "postgres": {
    "file": "${PG_FILE}",
    "sizeBytes": ${PG_SIZE},
    "sha256": "${PG_SHA256}"
  },
  "redis": {
    "file": "${REDIS_FILE}",
    "sizeBytes": ${REDIS_SIZE},
    "sha256": "${REDIS_SHA256}"
  },
  "destination": "${BACKUP_DEST}",
  "pass": true
}
EOF

echo "  ✅ Evidence written to: ${EVIDENCE_FILE}"
echo ""
echo "=== Backup complete ==="
