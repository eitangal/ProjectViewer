#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

echo "=========================================================="
echo " Starting GitLens-Portal (ProjectViewer) Production Stack "
echo "=========================================================="

# 1. Pre-flight checks
if [ ! -f .env ]; then
  echo "[-] ERROR: .env file not found in ${PROJECT_ROOT}!"
  echo "    Please create one from .env.example before starting."
  exit 1
fi

if grep -q "JWT_SECRET_KEY=gitlens-portal-super-secret-jwt-signing-key-32-bytes!" .env; then
  echo "[-] ERROR: JWT_SECRET_KEY in .env is still set to the default placeholder!"
  echo "    Please generate a unique secret of at least 32 characters."
  exit 1
fi

if grep -q "MASTER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" .env; then
  echo "[-] ERROR: MASTER_ENCRYPTION_KEY in .env is still set to the default placeholder!"
  echo "    Please set a unique 64-character hex string."
  exit 1
fi

mkdir -p data/repos data/backups

# Check if port 80 is occupied by something outside docker
if command -v ss >/dev/null 2>&1; then
  PORT_80_LISTENER=$(ss -tulpn | grep ':80 ' || true)
  if [ -n "${PORT_80_LISTENER}" ] && ! echo "${PORT_80_LISTENER}" | grep -q "docker"; then
    echo "[-] WARNING: Port 80 appears to be in use by non-docker process:"
    echo "    ${PORT_80_LISTENER}"
  fi
fi

# 2. Start Service
# If systemd unit exists and systemctl is available, use systemctl
if command -v systemctl >/dev/null 2>&1 && [ -f /etc/systemd/system/gitlens-portal.service ]; then
  echo "[+] Starting via systemd (gitlens-portal.service)..."
  if [ "$(id -u)" -eq 0 ]; then
    systemctl start gitlens-portal.service
  elif sudo -n true 2>/dev/null; then
    sudo systemctl start gitlens-portal.service
  else
    echo "[!] sudo requires password or unavailable; starting directly via docker compose..."
    docker compose up -d --remove-orphans
  fi
else
  echo "[+] Starting directly via docker compose..."
  docker compose up -d --remove-orphans
fi

# 3. Wait for Health Check
HEALTH_URL="http://127.0.0.1/api/health"
echo "[+] Waiting for service to become healthy at ${HEALTH_URL}..."
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
  echo "[+] GitLens-Portal is healthy and operational!"
  echo "----------------------------------------------------------"
  echo " Public URL (HTTP):    http://76.13.37.160"
  echo " Local URL (HTTP):     http://127.0.0.1"
  echo " Direct Backend (API): http://127.0.0.1:3000/api/health"
  echo "----------------------------------------------------------"
else
  echo "[-] WARNING: Service did not respond with 200 OK after ${MAX_RETRIES}s (Last HTTP code: ${HTTP_CODE})."
  echo "    Check logs using: ${SCRIPT_DIR}/logs.sh"
  exit 1
fi
