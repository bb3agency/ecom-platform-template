#!/bin/bash
# Install VPS Cleanup Script for a Client
#
# Usage: ./install-vps-cleanup.sh <CLIENT_ID> <FRONTEND_PATH> <PM2_PROCESS_NAME>
# Example: ./install-vps-cleanup.sh raghava-organics /var/www/raghava-organics raghava-organics-frontend

set -euo pipefail

CLIENT_ID="${1:-}"
FRONTEND_PATH="${2:-}"
PM2_PROCESS_NAME="${3:-}"

if [ -z "$CLIENT_ID" ] || [ -z "$FRONTEND_PATH" ] || [ -z "$PM2_PROCESS_NAME" ]; then
    echo "Usage: $0 <CLIENT_ID> <FRONTEND_PATH> <PM2_PROCESS_NAME>"
    echo "Example: $0 raghava-organics /var/www/raghava-organics raghava-organics-frontend"
    exit 1
fi

SCRIPT_SOURCE="$(dirname "$0")/vps-cleanup-template.sh"
SCRIPT_DEST="/etc/cron.daily/vps-cleanup-${CLIENT_ID}"

echo "Installing VPS cleanup script for client: ${CLIENT_ID}"

# Check if running as root (required for /etc/cron.daily)
if [ "$EUID" -ne 0 ]; then
    echo "Error: This script must be run as root (sudo)"
    exit 1
fi

# Check if template exists
if [ ! -f "$SCRIPT_SOURCE" ]; then
    echo "Error: Template not found at ${SCRIPT_SOURCE}"
    exit 1
fi

# Copy and customize the template
cp "$SCRIPT_SOURCE" "$SCRIPT_DEST"
sed -i "s|{{CLIENT_ID}}|${CLIENT_ID}|g" "$SCRIPT_DEST"
sed -i "s|{{FRONTEND_PATH}}|${FRONTEND_PATH}|g" "$SCRIPT_DEST"
sed -i "s|{{PM2_PROCESS_NAME}}|${PM2_PROCESS_NAME}|g" "$SCRIPT_DEST"

# Make executable
chmod +x "$SCRIPT_DEST"

echo "✓ Cleanup script installed to: ${SCRIPT_DEST}"
echo "✓ Schedule: Daily at 06:25 AM (system cron)"
echo "✓ Log file: /var/log/vps-cleanup-${CLIENT_ID}.log"

# Test the script
echo ""
echo "Testing cleanup script..."
if "$SCRIPT_DEST"; then
    echo "✓ Script test passed"
else
    echo "⚠ Script test had warnings (check log above)"
fi

echo ""
echo "To verify installation:"
echo "  ls -la /etc/cron.daily/vps-cleanup-${CLIENT_ID}"
echo "  cat /var/log/vps-cleanup-${CLIENT_ID}.log"
