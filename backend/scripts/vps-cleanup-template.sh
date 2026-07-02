#!/bin/bash
# VPS Daily Cleanup Script Template
# 
# PURPOSE: Automated daily cleanup to prevent disk space exhaustion on multi-client VPS
# INSTALL: Copy this to /etc/cron.daily/vps-cleanup-<CLIENT_ID> on the VPS
# SCHEDULE: Runs daily via system cron (typically 06:25 AM)
#
# WARNING: This script performs GLOBAL cleanup affecting ALL clients on the VPS.
# Docker prune removes unused resources across ALL containers.
# For dedicated single-client VPS, this is ideal.
# For multi-client VPS, consider client-specific cleanup strategies.
#
# TEMPLATE VARIABLES (replace during setup):
# - {{CLIENT_ID}}: Client identifier (e.g., <client-id>)
# - {{FRONTEND_PATH}}: Path to frontend deployment (e.g., /var/www/{{CLIENT_ID}}/frontend)
# - {{PM2_PROCESS_NAME}}: PM2 process name (e.g., {{CLIENT_ID}}-frontend)

set -euo pipefail

# Configuration (set these during VPS setup)
CLIENT_ID="{{CLIENT_ID}}"
FRONTEND_PATH="{{FRONTEND_PATH}}"
PM2_PROCESS_NAME="{{PM2_PROCESS_NAME}}"
LOG_FILE="/var/log/vps-cleanup-${CLIENT_ID}.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Starting VPS cleanup for client: ${CLIENT_ID} ==="

# 1. Docker cleanup (SAFE: only removes dangling/unused, keeps running containers)
# Note: This affects all clients on the VPS. Use carefully in multi-tenant setups.
log "Step 1: Docker system cleanup..."
if command -v docker &> /dev/null; then
    # Remove only dangling images, stopped containers, unused networks (safer than -a)
    docker system prune -f >> "$LOG_FILE" 2>&1 || log "Docker prune completed with warnings"
    
    # Clean build cache specifically (high churn, safe to clear). Use `docker builder prune`
    # (the dockerd BuildKit cache that `docker compose build` fills) — NOT `docker buildx prune`,
    # which can target a different builder and leave the real cache uncapped (that's how ~18 GB
    # of build cache accumulated on the shared host despite a daily cleanup).
    docker builder prune --force --keep-storage 5GB >> "$LOG_FILE" 2>&1 || log "Builder prune completed"
else
    log "Docker not found, skipping..."
fi

# 2. PM2 log rotation for this client's process only
log "Step 2: PM2 log cleanup for ${PM2_PROCESS_NAME}..."
if command -v pm2 &> /dev/null; then
    # Check if process exists before flushing
    if pm2 describe "$PM2_PROCESS_NAME" &> /dev/null; then
        pm2 flush "$PM2_PROCESS_NAME" >> "$LOG_FILE" 2>&1 || log "PM2 flush completed"
        
        # Rotate logs (keep last 5 backups)
        pm2 reloadLogs >> "$LOG_FILE" 2>&1 || true
    else
        log "PM2 process ${PM2_PROCESS_NAME} not found, skipping..."
    fi
else
    log "PM2 not found, skipping..."
fi

# 3. Client-specific Next.js cache cleanup
log "Step 3: Frontend build cache cleanup..."
if [ -d "$FRONTEND_PATH/.next/cache" ]; then
    rm -rf "${FRONTEND_PATH}/.next/cache/"* >> "$LOG_FILE" 2>&1 || true
    log "Cleared Next.js cache at ${FRONTEND_PATH}/.next/cache"
else
    log "No Next.js cache found at ${FRONTEND_PATH}, skipping..."
fi

# 4. Clean old rotated logs (keep 7 days)
log "Step 4: Cleaning old log files..."
find /var/log -name "*.gz" -mtime +7 -delete 2>/dev/null || true
find /var/log -name "*.old" -mtime +7 -delete 2>/dev/null || true

# 5. Clean package manager caches (npm) - global cleanup
log "Step 5: NPM cache cleanup..."
if command -v npm &> /dev/null; then
    npm cache clean --force >> "$LOG_FILE" 2>&1 || log "NPM cache cleanup completed"
else
    log "NPM not found, skipping..."
fi

# 6. Journal cleanup (system-wide, capped at 200MB)
log "Step 6: System journal cleanup..."
if command -v journalctl &> /dev/null; then
    journalctl --vacuum-size=200M --quiet >> "$LOG_FILE" 2>&1 || true
fi

# 7. GitHub Actions self-hosted runner cleanup (safe: only removes old build artifacts/tools)
log "Step 7: GitHub Actions self-hosted runner cleanup..."
for user_home in /home/*; do
    if [ -d "$user_home" ]; then
        # Check per-client runner dir
        CLIENT_RUNNER_DIR="${user_home}/actions-runner-${CLIENT_ID}"
        if [ -d "$CLIENT_RUNNER_DIR" ]; then
            log "Clearing runner work/tool cache at ${CLIENT_RUNNER_DIR}..."
            rm -rf "${CLIENT_RUNNER_DIR}/_work/"* >> "$LOG_FILE" 2>&1 || true
            rm -rf "${CLIENT_RUNNER_DIR}/_tool/"* >> "$LOG_FILE" 2>&1 || true
        fi

        # Check legacy global runner dir (clean if present on this host)
        LEGACY_RUNNER_DIR="${user_home}/actions-runner"
        if [ -d "$LEGACY_RUNNER_DIR" ]; then
            log "Clearing legacy runner work/tool cache at ${LEGACY_RUNNER_DIR}..."
            rm -rf "${LEGACY_RUNNER_DIR}/_work/"* >> "$LOG_FILE" 2>&1 || true
            rm -rf "${LEGACY_RUNNER_DIR}/_tool/"* >> "$LOG_FILE" 2>&1 || true
        fi
    fi
done

# Report disk usage after cleanup
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
log "=== Cleanup completed. Current disk usage: ${DISK_USAGE}% ==="

# Alert if disk usage is still high (>80%)
if [ "$DISK_USAGE" -gt 80 ]; then
    log "WARNING: Disk usage is still high (${DISK_USAGE}%). Manual intervention may be needed."
fi

exit 0
