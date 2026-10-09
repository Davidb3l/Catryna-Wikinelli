<!--
Thanks for contributing to Catryna. Please fill in the sections below.
Every commit in this PR must be signed off via `git commit -s` per our DCO
policy (see CONTRIBUTING.md).
-->

## Summary

What does this change do, and why?

## Related issue

Closes #<issue-number> (or "n/a" if this is a small drive-by fix).

## Changes

- Bullet list of the meaningful changes in this PR.
-
-

## Checklist

- [ ] Tests added or updated (`bun test`); a bug fix includes a test that fails without it.
- [ ] Gate passes locally: `bunx tsc --noEmit -p .` and `bun run check`.
- [ ] Docs in `.docs/` updated where behavior changed, and re-verified (`bun run src/cli.ts verify <path>`).
- [ ] Line added to `CHANGELOG.md` under "Unreleased"; breaking changes called out below.
- [ ] All commits are signed off (`git commit -s`).
- [ ] CI is green on this PR.

## Breaking changes

List any breaking changes to the CLI, MCP tools, doc format (`.mdx`
frontmatter, `_index.json`), or the suite event spine. If there are none,
write "None".

## Notes for reviewers

Anything you want a reviewer to look at especially carefully (tricky logic,
unusual dependencies, places you're unsure about).
