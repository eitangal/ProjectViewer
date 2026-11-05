#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

echo "=========================================================="
echo " Upgrading GitLens-Portal (ProjectViewer) Production Stack"
echo "=========================================================="

# 1. Verify Git status
CURRENT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
echo "[+] Current branch: ${CURRENT_BRANCH} (commit: ${CURRENT_COMMIT})"

# 2. Automated SQLite Pre-Upgrade Backup
mkdir -p data/backups
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_PATH="data/backups/portal-pre-upgrade-${TIMESTAMP}.db"

if [ -f data/portal.db ]; then
  echo "[+] Creating atomic SQLite backup at ${BACKUP_PATH}..."
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 data/portal.db ".backup '${BACKUP_PATH}'"
  else
    # Fallback to copy if sqlite3 CLI not present
    cp -p data/portal.db "${BACKUP_PATH}"
    [ -f data/portal.db-wal ] && cp -p data/portal.db-wal "${BACKUP_PATH}-wal" || true
    [ -f data/portal.db-shm ] && cp -p data/portal.db-shm "${BACKUP_PATH}-shm" || true
  fi
  BACKUP_SIZE=$(du -h "${BACKUP_PATH}" | awk '{print $1}')
  echo "[+] Backup successfully created (${BACKUP_SIZE})."
else
  echo "[!] No existing data/portal.db found; skipping backup."
fi

# 3. Pull latest Git updates (if working tree clean or --skip-pull passed)
SKIP_PULL=false
for arg in "$@"; do
  if [ "$arg" = "--skip-pull" ]; then
    SKIP_PULL=true
  fi
done

if [ "${SKIP_PULL}" = false ]; then
  echo "[+] Fetching and pulling latest changes from git remote..."
  if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    echo "[-] WARNING: Uncommitted local changes detected in working tree."
    echo "    Stashing local changes before pull..."
    git stash
  fi
  git pull --ff-only || {
    echo "[-] Git pull failed. Aborting upgrade to avoid broken state."
    exit 1
  }
  NEW_COMMIT=$(git rev-parse --short HEAD)
  echo "[+] Updated to commit: ${NEW_COMMIT}"
else
  echo "[!] Skipping git pull (--skip-pull flag specified)."
fi

# 4. Rebuild Docker Images
echo "[+] Rebuilding production Docker containers..."
docker compose build --pull || {
  echo "[-] ERROR: Docker image build failed!"
  echo "    Your database is safe at ${BACKUP_PATH}."
  exit 1
}

# 5. Restart Container Stack
echo "[+] Restarting service with updated containers..."
if command -v systemctl >/dev/null 2>&1 && [ -f /etc/systemd/system/gitlens-portal.service ]; then
  if [ "$(id -u)" -eq 0 ]; then
    systemctl restart gitlens-portal.service
  elif sudo -n true 2>/dev/null; then
    sudo systemctl restart gitlens-portal.service
  else
    docker compose up -d --remove-orphans
  fi
else
  docker compose up -d --remove-orphans
fi

# 6. Verify Health Post-Upgrade
HEALTH_URL="http://127.0.0.1/api/health"
echo "[+] Validating health endpoint at ${HEALTH_URL}..."
MAX_RETRIES=30
RETRY_COUNT=0
HEALTHY=false

while [ ${RETRY_COUNT} -lt ${MAX_RETRIES} ]; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${HEALTH_URL}" || true)
  if [ "${HTTP_CODE}" = "200" ]; then
    HEALTHY=true
    break
  fi
  sleep 1
done

if [ "${HEALTHY}" = true ]; then
  echo "[+] Post-upgrade health check PASSED!"
else
  echo "[-] CRITICAL: Post-upgrade health check failed (HTTP code: ${HTTP_CODE})!"
  echo "    Backup available at: ${BACKUP_PATH}"
  echo "    Review error logs with: ${SCRIPT_DIR}/logs.sh"
  exit 1
fi

# 7. Clean up dangling images
echo "[+] Pruning dangling build images..."
docker image prune -f >/dev/null 2>&1 || true

echo "=========================================================="
echo " GitLens-Portal Upgrade Complete!                         "
echo " Active Commit:  $(git rev-parse --short HEAD 2>/dev/null || echo 'current')"
echo " Backup Saved:   ${BACKUP_PATH}"
echo " Service Health: Operational (200 OK)"
echo "=========================================================="
