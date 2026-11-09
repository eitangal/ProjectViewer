#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
fi

echo "=========================================================="
echo " Synchronizing All Projects in GitLens-Portal             "
echo "=========================================================="

npx tsx scripts/sync-all.ts "$@"
