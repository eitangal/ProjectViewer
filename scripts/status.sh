#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

echo "=========================================================="
echo " GitLens-Portal (ProjectViewer) Production Status         "
echo "=========================================================="

# 1. Systemd Service Status
echo "--- [1] Systemd Service (gitlens-portal.service) ---"
if command -v systemctl >/dev/null 2>&1 && [ -f /etc/systemd/system/gitlens-portal.service ]; then
  SYSTEMD_ACTIVE=$(systemctl is-active gitlens-portal.service 2>/dev/null || echo "inactive")
  SYSTEMD_ENABLED=$(systemctl is-enabled gitlens-portal.service 2>/dev/null || echo "disabled")
  echo "State:   ${SYSTEMD_ACTIVE}"
  echo "Enabled: ${SYSTEMD_ENABLED} (survives VM reboots)"
else
  echo "Systemd unit not installed or systemctl unavailable."
fi
echo ""

# 2. Docker Containers
echo "--- [2] Docker Container Status ---"
docker compose ps
echo ""

# 3. HTTP Health Check
echo "--- [3] Health Endpoint Check ---"
HEALTH_URL="http://127.0.0.1/api/health"
HEALTH_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "${HEALTH_URL}" 2>/dev/null || echo "FAILED")
if echo "${HEALTH_RESPONSE}" | grep -q "HTTP_STATUS:200"; then
  echo "[OK] ${HEALTH_URL} responded 200 OK"
  echo "Body: $(echo "${HEALTH_RESPONSE}" | head -n -1)"
else
  echo "[FAIL] ${HEALTH_URL} did not return 200 OK. Response: ${HEALTH_RESPONSE}"
fi
echo ""

# 4. Active Ports
echo "--- [4] Listening Ports ---"
if command -v ss >/dev/null 2>&1; then
  ss -tulpn | grep -E ':80|:3000' || echo "No listeners found on :80 or :3000"
fi
echo ""

# 5. Database & Storage Status
echo "--- [5] Storage & Database Status ---"
if [ -f data/portal.db ]; then
  DB_SIZE=$(du -h data/portal.db | awk '{print $1}')
  echo "Database (data/portal.db): ${DB_SIZE}"
fi
if [ -d data/repos ]; then
  REPO_COUNT=$(find data/repos -maxdepth 1 -mindepth 1 -type d | wc -l)
  REPOS_SIZE=$(du -sh data/repos 2>/dev/null | awk '{print $1}')
  echo "Bare Repositories:        ${REPO_COUNT} repos (${REPOS_SIZE})"
fi
if [ -d data/backups ]; then
  BACKUP_COUNT=$(find data/backups -maxdepth 1 -name "*.db" | wc -l)
  echo "Available DB Backups:     ${BACKUP_COUNT}"
fi
echo ""

# 6. Recent Logs
echo "--- [6] Recent Application Logs (last 10 lines) ---"
docker compose logs --tail=10 || true
echo "=========================================================="
