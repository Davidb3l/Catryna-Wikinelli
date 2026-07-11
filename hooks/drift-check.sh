#!/bin/sh
# drift-check.sh — Claude Code Stop hook for the Catryna plugin.
#
# When a coding session ENDS, remind the agent (via stderr) if any anchored docs
# have drifted from the code they document — "a session that touched anchored
# files ends with 'update the affected docs'" (PRODUCT_ROADMAP Phase 1).
#
# INFORMATIONAL + NON-BLOCKING by contract:
#   - always exit 0 (a Stop hook that exits non-zero can block the session; this
#     one must never do that);
#   - stay SILENT when there is no drift, no Catryna index, no git repo, or no
#     bun — it never nags an unrelated project;
#   - stay CHEAP — it short-circuits before spawning bun unless this is a git
#     repo that actually has a Catryna doc index.
#
# Deliberately does NOT use `set -e`: a no-match grep (exit 1) or a failed drift
# run must degrade to a silent exit 0, never abort mid-script.

log() { printf '%s\n' "$*" >&2; }

# Nothing anchored here → nothing to check.
[ -f .docs/_index.json ] || exit 0

# Drift is a git diff; outside a work tree there is no baseline to compare.
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# The drift check runs through the Catryna CLI (Bun). No bun → skip silently.
command -v bun >/dev/null 2>&1 || exit 0

CLI="${CLAUDE_PLUGIN_ROOT:-.}/src/cli.ts"
[ -f "$CLI" ] || exit 0

# `drift --json` prints exactly one JSON object and always exits 0; we only read
# summary.drifted. Any failure degrades to a silent exit 0.
json=$(bun run "$CLI" drift --json 2>/dev/null) || exit 0

# summary.drifted is the FIRST `"drifted":<number>` in the object. The top-level
# `"drifted":[` array key has a `[` (not a digit) after the colon, so requiring
# a digit excludes it — leaving only the summary count. The optional whitespace
# class tolerates a pretty-printed `"drifted": N` too, so this survives a future
# formatting change in buildDriftJson (which today emits no-space JSON).
count=$(printf '%s' "$json" | grep -o '"drifted":[[:space:]]*[0-9][0-9]*' | head -n1 | grep -o '[0-9][0-9]*')

# No parseable count (e.g. gitRepo:false, empty output) → nothing to say.
[ -n "$count" ] || exit 0
[ "$count" -gt 0 ] 2>/dev/null || exit 0

if [ "$count" -eq 1 ]; then
  log "catryna: 1 doc drifted from the code it documents — run \`catryna repair\` (or update the affected doc, then \`catryna verify\`)."
else
  log "catryna: $count docs drifted from the code they document — run \`catryna repair\` (or update the affected docs, then \`catryna verify\`)."
fi

# Informational only — never block the session.
exit 0
