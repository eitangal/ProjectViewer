#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

echo "=========================================================="
echo " Restarting GitLens-Portal (ProjectViewer) Production Stack"
echo "=========================================================="

if command -v systemctl >/dev/null 2>&1 && [ -f /etc/systemd/system/gitlens-portal.service ]; then
  echo "[+] Restarting via systemd (gitlens-portal.service)..."
  if [ "$(id -u)" -eq 0 ]; then
    systemctl restart gitlens-portal.service
  elif sudo -n true 2>/dev/null; then
    sudo systemctl restart gitlens-portal.service
  else
    "${SCRIPT_DIR}/stop.sh"
    "${SCRIPT_DIR}/start.sh"
    exit 0
  fi
else
  "${SCRIPT_DIR}/stop.sh"
  "${SCRIPT_DIR}/start.sh"
  exit 0
fi

# Validate health after restart
HEALTH_URL="http://127.0.0.1/api/health"
echo "[+] Validating health at ${HEALTH_URL}..."
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
  echo "[+] GitLens-Portal restart completed successfully."
else
  echo "[-] WARNING: Health check failed after restart (HTTP code: ${HTTP_CODE})."
  echo "    Check logs using: ${SCRIPT_DIR}/logs.sh"
  exit 1
fi
