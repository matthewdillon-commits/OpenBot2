#!/usr/bin/env bash
#
# Per-boot Cloud Agent start: Postgres, .env, migrations. Returns when ready.
# App, API, and worker stay in environment.json terminals.

set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="${HOME}/.bun/bin:${PATH}"

bash scripts/ensure-dev-env.sh

if ! pg_isready -h localhost -q 2>/dev/null; then
  sudo service postgresql start
fi

for _ in $(seq 1 30); do
  pg_isready -h localhost -q && break
  sleep 1
done
pg_isready -h localhost -q

sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'openbot') THEN
    CREATE ROLE openbot LOGIN PASSWORD 'openbot' SUPERUSER;
  ELSE
    ALTER ROLE openbot WITH LOGIN PASSWORD 'openbot' SUPERUSER;
  END IF;
END
$$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='openbot'" | grep -q 1; then
  sudo -u postgres createdb -O openbot openbot
fi
sudo -u postgres psql -d openbot -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null

# Rewrite bun's hardlink store before migrate. Terminals wait for public.users
# so they do not start until this and migrate have both finished.
bash scripts/ensure-js-deps.sh

(cd server && bun --env-file=../.env drizzle-kit migrate --config=drizzle.config.ts)
