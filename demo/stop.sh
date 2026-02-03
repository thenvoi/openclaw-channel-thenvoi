#!/usr/bin/env bash
#
# Stop the OpenClaw + Thenvoi demo container
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Stopping OpenClaw container..."
docker compose down

echo "Container stopped."
