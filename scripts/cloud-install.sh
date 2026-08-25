#!/usr/bin/env bash
#
# Idempotent Cloud Agent install: toolchain, Postgres packages, and JS deps.
# Must terminate. Does not start servers.

set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="${HOME}/.bun/bin:${PATH}"
export DEBIAN_FRONTEND=noninteractive
BUN_VERSION="${BUN_VERSION:-1.3.14}"

if ! command -v bun >/dev/null 2>&1 || [ "$(bun --version 2>/dev/null || true)" != "$BUN_VERSION" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
  export PATH="${HOME}/.bun/bin:${PATH}"
fi

if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq unzip xz-utils postgresql postgresql-contrib postgresql-16-pgvector lsof
fi

if [ ! -f .env ]; then
  cp .env.example .env
fi

bun install --frozen-lockfile

# Not a workspace member. CI and startup tests spawn this entrypoint.
if [ -f agent-bot/package.json ]; then
  (cd agent-bot && bun install --frozen-lockfile)
fi

bun run generate:app-config
