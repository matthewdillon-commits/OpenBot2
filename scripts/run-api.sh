#!/usr/bin/env bash
set -euo pipefail
export PATH="${HOME}/.bun/bin:${PATH}"
cd "$(dirname "$0")/.."
bash scripts/ensure-js-deps.sh
bash scripts/ensure-dev-env.sh
bash scripts/wait-for-postgres.sh
cd server
exec bun --env-file=../.env src/index.ts
