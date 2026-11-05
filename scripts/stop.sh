#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

echo "=========================================================="
echo " Stopping GitLens-Portal (ProjectViewer) Production Stack "
echo "=========================================================="

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet gitlens-portal.service 2>/dev/null; then
  echo "[+] Stopping via systemd (gitlens-portal.service)..."
  if [ "$(id -u)" -eq 0 ]; then
    systemctl stop gitlens-portal.service
  elif sudo -n true 2>/dev/null; then
    sudo systemctl stop gitlens-portal.service
  else
    echo "[!] sudo requires password or unavailable; stopping directly via docker compose..."
    docker compose down
  fi
else
  echo "[+] Stopping via docker compose..."
  docker compose down
fi

echo "[+] Service stopped successfully."
