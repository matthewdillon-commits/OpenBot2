#!/usr/bin/env bash
# Block until the app's Postgres role accepts a TCP login, not merely until
# the postmaster is up. Cloud Agent terminals can start as soon as pg_isready
# passes, which is before cloud-start.sh has created the openbot role.
set -euo pipefail
n=0
until PGPASSWORD=openbot psql -h localhost -U openbot -d openbot -c 'select 1' >/dev/null 2>&1; do
  n=$((n + 1))
  if [ "$n" -ge 60 ]; then
    echo "Postgres did not accept openbot@localhost/openbot" >&2
    exit 1
  fi
  sleep 1
done
