#!/usr/bin/env python3
"""Point bun's eventsource export at the CJS build.

Bun 1.3 resolves the "bun" export even from require(). eventsource 3's bun
export is ESM, which crashes @modelcontextprotocol/sdk's CJS SSE client.
"""
from pathlib import Path
import json

root = Path("node_modules")
if not root.is_dir():
    raise SystemExit(0)

for path in root.rglob("eventsource/package.json"):
    data = json.loads(path.read_text())
    exports = data.get("exports")
    if not isinstance(exports, dict):
        continue
    entry = exports.get(".")
    if not isinstance(entry, dict):
        continue
    bun = entry.get("bun")
    require = entry.get("require") or "./dist/index.cjs"
    if bun == require:
        continue
    if bun == "./dist/index.js" or (
        isinstance(bun, str) and bun.endswith("/index.js")
    ):
        entry["bun"] = require
        path.write_text(json.dumps(data, indent=2) + "\n")
