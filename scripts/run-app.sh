#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="${HOME}/.bun/bin:${PATH}"
cd app
exec bun run dev --host 0.0.0.0 --port 3010 --strictPort
