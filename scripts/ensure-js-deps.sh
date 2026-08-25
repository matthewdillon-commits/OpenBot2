#!/usr/bin/env bash
# Repair JS deps after a Cloud Agent snapshot restore. bun's node_modules
# layout can lose the files that distinguish CJS/ESM exports, which then
# crashes the API on `require()` of eventsource.
set -euo pipefail
export PATH="${HOME}/.bun/bin:${PATH}"
cd "$(dirname "$0")/.."
mkdir -p /tmp
flock /tmp/openbot-bun-install.lock bun install --frozen-lockfile
