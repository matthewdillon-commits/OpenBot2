#!/usr/bin/env bash
# Repair JS deps after a Cloud Agent snapshot restore. bun stores packages as
# hardlinks; a snapshot that does not preserve them leaves eventsource's CJS
# file unusable, and the API then require()s the ESM build and crashes.
set -euo pipefail
export PATH="${HOME}/.bun/bin:${PATH}"
cd "$(dirname "$0")/.."
mkdir -p /tmp
flock /tmp/openbot-bun-install.lock bun install --frozen-lockfile --force
