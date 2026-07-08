#!/bin/sh
# check-catryna.sh — SessionStart status check for the Catryna plugin.
#
# Catryna ships as a Bun-run MCP server (scripts/run-server.sh), not a compiled
# binary, so unlike its suite siblings there is nothing to download: the only
# hard requirement is Bun itself. This check reports that requirement, and — in
# repos that already use the suite — nudges toward the missing companion tools.
#
# Exit codes: 0 ready, 3 bun missing (mirrors install-hayven.sh --check).

set -eu

log() { printf '%s\n' "$*" >&2; }

have() { command -v "$1" >/dev/null 2>&1; }

# suite_repo: true when the cwd already uses any suite tool. This hook runs in
# EVERY repo; the nudge stays quiet outside suite repos so it never nags
# unrelated projects.
suite_repo() {
  # .docs/ alone is too generic a name; require Catryna's index file.
  [ -d .sirius ] || [ -d .ametrite ] || [ -d .hayven ] || [ -f .docs/_index.json ]
}

# Catryna is the wiki of the suite: Ametrite holds the board, Hayvenhurst the
# code graph, Sirius the foreman loop. One short block, only when something is
# missing — full fleet control needs all four.
suite_hint() {
  s_missing=""
  have amt    || s_missing="$s_missing Ametrite"
  have hayven || s_missing="$s_missing Hayvenhurst"
  have sirius || s_missing="$s_missing Sirius"
  if [ -z "$s_missing" ]; then return 0; fi
  log ""
  log "fleet suite: missing:$s_missing. Catryna is the suite's wiki; for full fleet control install the whole suite:"
  case "$s_missing" in *Hayvenhurst*) log "  Hayvenhurst (code graph): /plugin marketplace add Davidb3l/Hayvenhurst-dev, /plugin install hayvenhurst@hayvenhurst, then /hayvenhurst:install-binary" ;; esac
  case "$s_missing" in *Sirius*)      log "  Sirius Forester (fleet foreman): /plugin marketplace add Davidb3l/Sirius-Forester, /plugin install sirius@sirius-forester, then /sirius:install-binary" ;; esac
  case "$s_missing" in *Ametrite*)    log "  Ametrite (task board): ask Claude to \"ametrite this repo\" — the skill bootstraps the amt CLI" ;; esac
}

if have bun; then
  log "catryna: ready (MCP server runs via bun; docs live in .docs/)"
  if suite_repo; then suite_hint; fi
  exit 0
fi

log "catryna: bun not found — the Catryna MCP server needs Bun. Install it: curl -fsSL https://bun.sh/install | bash"
if suite_repo; then suite_hint; fi
exit 3
