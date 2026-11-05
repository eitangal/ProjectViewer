#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[-] ERROR: Node.js is required but not installed or not in PATH."
  exit 1
fi

npx tsx scripts/publish-local.ts "$@"
