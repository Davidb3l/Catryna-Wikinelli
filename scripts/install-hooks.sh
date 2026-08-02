#!/bin/sh
# install-hooks.sh — install Catryna's local git hooks.
#
# Everything here is LOCAL. No CI service, no network, nothing phones home —
# consistent with the rest of the project, which is deliberately local-first.
#
# Installs a PRE-PUSH hook (not pre-commit) on purpose: committing should stay
# frictionless while you iterate, and the meaningful checkpoint is the moment
# work leaves your machine. A pre-commit gate on a repo like this mostly teaches
# people to reach for --no-verify, which is worse than no gate at all.
#
# Run from the repo root:  sh scripts/install-hooks.sh
# Uninstall:               rm .git/hooks/pre-push

set -eu

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "install-hooks: not inside a git repository" >&2
  exit 1
}

hook="$repo_root/.git/hooks/pre-push"

cat > "$hook" <<'HOOK'
#!/bin/sh
# Catryna pre-push gate — installed by scripts/install-hooks.sh
#
# Runs `bun run check`: typecheck, tests, doc lint, doc drift.
#
# Skip a single push with:  git push --no-verify
# (Deliberately documented rather than hidden — a gate you cannot bypass in a
# genuine emergency is a gate people uninstall.)

set -eu

if ! command -v bun >/dev/null 2>&1; then
  echo "catryna pre-push: bun not found — skipping checks" >&2
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

echo "catryna pre-push: running checks (typecheck, tests, lint, drift)…" >&2

if bun run check >/dev/null 2>&1; then
  echo "catryna pre-push: all checks passed" >&2
  exit 0
fi

# Re-run without swallowing output so the failure is actually readable.
echo "" >&2
echo "catryna pre-push: FAILED — output below" >&2
echo "" >&2
bun run check >&2 || true
echo "" >&2
echo "Push aborted. Fix the above, or bypass once with: git push --no-verify" >&2
exit 1
HOOK

chmod +x "$hook"
echo "installed: .git/hooks/pre-push"
echo "it runs 'bun run check' (typecheck + tests + lint + drift) before every push."
echo "bypass once with: git push --no-verify"
