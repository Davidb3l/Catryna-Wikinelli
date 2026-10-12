#!/usr/bin/env bash
# Launch the Catryna MCP server from a POSIX shell (manual / legacy configs).
#
# The plugin itself does NOT use this: plugin.json runs scripts/run-server.ts
# with `bun` directly, because on Windows a bare `bash` can resolve to the WSL
# launcher and never start the server. This shim delegates to the same launcher
# so the self-heal and cwd contract live in one place.
#
# Key contract: the server's cwd MUST stay the user's project directory —
# storage resolves .docs/ from process.cwd(). Never cd before exec.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "[catryna] bun is required but not on PATH — install from https://bun.sh" >&2
  exit 1
fi

exec bun run "$ROOT/scripts/run-server.ts"
