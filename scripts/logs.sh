#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# Allows filtering by service, e.g. ./scripts/logs.sh app or ./scripts/logs.sh caddy
docker compose logs -f --tail=100 "$@"
