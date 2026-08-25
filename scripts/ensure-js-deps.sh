#!/usr/bin/env bash
# Repair JS deps after a Cloud Agent snapshot restore, then point bun's
# eventsource export at the CJS build. Bun 1.3 prefers the "bun" export
# (ESM) even from require(), which crashes @modelcontextprotocol/sdk CJS.
set -euo pipefail
export PATH="${HOME}/.bun/bin:${PATH}"
cd "$(dirname "$0")/.."
mkdir -p /tmp
flock /tmp/openbot-bun-install.lock bun install --frozen-lockfile --force
python3 scripts/patch-eventsource-cjs.py
