#!/usr/bin/env bash
#
# Per-boot Cloud Agent start: Postgres, then migrations.
# Idempotent. Does not launch the API or Vite; those belong in environment.json terminals.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

if [ ! -S /var/run/docker.sock ] && [ -z "${DOCKER_HOST:-}" ]; then
  if curl -fsS --max-time 2 http://127.0.0.1:2375/version >/dev/null 2>&1; then
    export DOCKER_HOST=tcp://127.0.0.1:2375
  fi
fi

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
fi

# The API refuses to boot without these four. Empty values from .env.example are enough
# to start the UI; chat/CopilotKit stays unlicensed until real keys are supplied.
fill_if_empty() {
  local name="$1" value="$2"
  if grep -qE "^${name}=$" "$ROOT/.env"; then
    local tmp
    tmp="$(mktemp)"
    grep -vE "^${name}=$" "$ROOT/.env" >"$tmp"
    printf '%s=%s\n' "$name" "$value" >>"$tmp"
    mv "$tmp" "$ROOT/.env"
  fi
}

fill_if_empty INTELLIGENCE_API_KEY cpk-preview-placeholder
fill_if_empty COPILOTKIT_LICENSE_TOKEN preview-placeholder-license
fill_if_empty OPENAI_API_KEY sk-preview-placeholder

if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' "docker CLI is missing. Run scripts/cloud-install.sh first." >&2
  exit 1
fi

docker compose up -d postgres
for _ in $(seq 1 40); do
  if docker compose exec -T postgres pg_isready -U openbot -d openbot >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker compose exec -T postgres pg_isready -U openbot -d openbot >/dev/null 2>&1; then
  printf '%s\n' "Postgres never became ready." >&2
  exit 1
fi

bun run --filter server db:migrate
bun run generate:app-config
