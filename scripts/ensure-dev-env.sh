#!/usr/bin/env bash
#
# Create or refresh .env for local / Cloud Agent development.
# Copies .env.example when missing, overlays secrets already in the process
# environment, and fills boot-only placeholders so the API can start.
# Does not print secret values.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
fi

python3 - "$ROOT/.env" <<'PY'
import os
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()

overlay = [
    "INTELLIGENCE_API_KEY",
    "COPILOTKIT_LICENSE_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "TAVILY_API_KEY",
    "COMPOSIO_API_KEY",
    "COMPUTER_TOKEN",
    "SUPERVISOR_TOKEN",
    "MANAGED_AGENT_TOKEN",
    "AGENT_TOOL_TOKEN",
    "BETTER_AUTH_SECRET",
    "KEY_ENCRYPTION_KEY",
]

placeholders = {
    "INTELLIGENCE_API_KEY": "dev-not-a-real-key",
    "COPILOTKIT_LICENSE_TOKEN": "dev-not-a-real-licence",
    "COMPUTER_TOKEN": "openbot-dev-computer-token",
    "SUPERVISOR_TOKEN": "openbot-dev-supervisor-token",
}


def set_var(name: str, value: str) -> None:
    global text
    line = f"{name}={value}"
    if re.search(rf"^{re.escape(name)}=", text, re.M):
        text = re.sub(rf"^{re.escape(name)}=.*$", line, text, count=1, flags=re.M)
    else:
        if not text.endswith("\n"):
            text += "\n"
        text += line + "\n"


for name in overlay:
    value = os.environ.get(name)
    if value:
        set_var(name, value)

for name, fallback in placeholders.items():
    match = re.search(rf"^{re.escape(name)}=(.*)$", text, re.M)
    current = match.group(1).strip().strip('"').strip("'") if match else ""
    if not current:
        set_var(name, fallback)

path.write_text(text)
PY
