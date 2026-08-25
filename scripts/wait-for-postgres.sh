#!/usr/bin/env bash
# Block until the app can log in as openbot and the schema is migrated.
# pg_isready is not enough: terminals otherwise start before the role exists
# or before drizzle-kit has created public.users.
set -euo pipefail
n=0
until PGPASSWORD=openbot psql -h localhost -U openbot -d openbot -tAc "select to_regclass('public.users')" 2>/dev/null | grep -q '^users$'; do
  n=$((n + 1))
  if [ "$n" -ge 90 ]; then
    echo "Postgres did not present public.users for openbot@localhost" >&2
    exit 1
  fi
  sleep 1
done
