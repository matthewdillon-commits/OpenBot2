#!/usr/bin/env bash
# Wait for local Postgres, then exec. Used by environment.json terminals.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="${HOME}/.bun/bin:${PATH}"
bash scripts/ensure-dev-env.sh
n=0
until pg_isready -h localhost -q; do
  n=$((n + 1))
  if [ "$n" -ge 60 ]; then
    echo "Postgres did not become ready on localhost:5432" >&2
    exit 1
  fi
  sleep 1
done
