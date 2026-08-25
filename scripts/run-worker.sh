#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/wait-for-postgres.sh
. scripts/wait-for-postgres.sh
cd worker
exec bun --env-file=../.env src/index.ts
