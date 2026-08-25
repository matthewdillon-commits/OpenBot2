#!/bin/sh
# Apply Drizzle migrations before the API starts.
#
# This image is one replica: Railway, Render, Fly, and `docker run` start a
# single process. Running migrate here is what makes an external DATABASE_URL
# work. Skipping it (the old EMBEDDED_POSTGRES-only guard) left the API crashing
# on missing tables.
#
# Two replicas starting together would race. Stay at one replica, or run migrate
# as a release step before the new processes start. drizzle-kit's journal makes
# a second apply a no-op once the first has recorded it; a crash mid-statement
# is the remaining risk.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "migrate: DATABASE_URL is not set" >&2
  exit 1
fi

# postgres-init may still be coming up (embedded), or the managed instance may
# not accept connections on the first attempt.
PG_ISREADY=/usr/lib/postgresql/16/bin/pg_isready
if [ ! -x "$PG_ISREADY" ]; then
  PG_ISREADY="$(command -v pg_isready || true)"
fi
if [ -z "$PG_ISREADY" ]; then
  echo "migrate: pg_isready not found" >&2
  exit 1
fi

i=0
while ! "$PG_ISREADY" -d "$DATABASE_URL" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 90 ]; then
    echo "migrate: database never became ready" >&2
    exit 1
  fi
  sleep 1
done

cd /app/server
exec s6-setuidgid pwuser /usr/local/bin/bun x drizzle-kit migrate --config=drizzle.config.ts
