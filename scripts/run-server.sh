#!/usr/bin/env bash
# Launch the Catryna MCP server from wherever the plugin is installed.
#
# Key contract: the server's cwd MUST stay the user's project directory —
# storage resolves .docs/ from process.cwd(). So we install deps into the
# plugin root if missing, but never cd before exec.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "[catryna] bun is required but not on PATH — install from https://bun.sh" >&2
  exit 1
fi

# Self-heal: first run after plugin install has no node_modules yet.
if [ ! -d "$ROOT/node_modules" ]; then
  echo "[catryna] installing server dependencies (first run)..." >&2
  (cd "$ROOT" && bun install --silent) >&2
fi

exec bun run "$ROOT/src/index.ts"
