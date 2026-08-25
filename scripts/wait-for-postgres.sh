#!/usr/bin/env bash
# Block until local Postgres accepts connections. Used by run-api and run-worker.
set -euo pipefail
n=0
until pg_isready -h localhost -q; do
  n=$((n + 1))
  if [ "$n" -ge 60 ]; then
    echo "Postgres did not become ready on localhost:5432" >&2
    exit 1
  fi
  sleep 1
done
