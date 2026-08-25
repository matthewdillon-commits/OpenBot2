#!/usr/bin/env bash
#
# Idempotent Cloud Agent install: Bun (the version package.json pins), Docker CLI
# if the daemon is already there, workspace dependencies, and the generated app config.
# Does not start services. Safe to rerun.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

BUN_VERSION="$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
BUN_VERSION="${BUN_VERSION:-1.3.14}"

ensure_path() {
  export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
}

install_bun() {
  if command -v bun >/dev/null 2>&1; then
    local current
    current="$(bun --version)"
    if [ "$current" = "$BUN_VERSION" ]; then
      return 0
    fi
  fi
  curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
}

install_docker_cli() {
  if command -v docker >/dev/null 2>&1; then
    return 0
  fi
  # The Cloud Agent snapshot often has a daemon on TCP 2375 without a client binary.
  mkdir -p "$HOME/.local/bin" "$HOME/.docker/cli-plugins"
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz" -o "$tmp/docker.tgz"
  tar -xzf "$tmp/docker.tgz" -C "$tmp"
  cp "$tmp/docker/docker" "$HOME/.local/bin/docker"
  chmod +x "$HOME/.local/bin/docker"
  curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64" \
    -o "$HOME/.docker/cli-plugins/docker-compose"
  chmod +x "$HOME/.docker/cli-plugins/docker-compose"
  rm -rf "$tmp"
}

ensure_env_file() {
  if [ ! -f "$ROOT/.env" ]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
  fi
}

ensure_path
install_bun
ensure_path
install_docker_cli
ensure_env_file
bun install
bun run generate:app-config
