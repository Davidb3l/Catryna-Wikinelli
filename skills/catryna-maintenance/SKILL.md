---
name: catryna-maintenance
description: Repair drifted Catryna docs so the prose matches the code — the drift → repair → verify loop, including the traps that silently produce wrong-but-verified docs.
when_to_use: Use when `catryna drift` reports drifted docs, before merging a branch that changed code the docs describe, or when the user asks to "fix the docs", "repair drift", or "re-verify the docs". Also read this BEFORE fanning repair work out across parallel agents — several of the rules below exist because the naive parallel approach produces docs that are confidently wrong.
---

# Repairing drifted docs

`catryna drift` flags docs whose anchored code changed since the doc was last
verified. Repair means making the prose true again — then re-baselining.

This is a different job from the `catryna` skill, which is about authoring: search
the docs before coding, update the doc you invalidate. This one starts when the
docs have already gone stale.

## The loop

```bash
catryna drift --json
```

```bash
catryna repair <path> --json
```

Read the real source at HEAD, judge, edit `.docs/<path>.mdx` where the prose is
actually wrong, then re-baseline:

```bash
catryna verify <path>
```

Several docs re-baseline in one command — `catryna verify a b c`, or
`catryna verify --all-drifted` for everything currently flagged. Prefer that
over a shell loop; see "Fanning out" below.

## Rules that are not obvious

**Commit code before repairing docs.** `drift` walks git history from each doc's
`verifiedCommit`, so it cannot see uncommitted work. Repairing against a dirty
tree means working from memory with no tool check behind you. In one real pass,
drift reported 3 drifted docs; after committing the same work it reported 20, and
11 of those had been invisible to three repair agents that had just finished.
`drift` and `repair` now print a `note:` line with the uncommitted file count —
if you see it, stop and commit first. `catryna drift --dirty-is-error` turns that
into a CI gate.

**`verify` does not read prose — it only stamps HEAD.** Blanket-verifying a
backlog marks every doc clean while leaving the text wrong, which is strictly
worse than an honest ✗. Judge each doc individually. `--all-drifted` is an
ergonomic shortcut for the docs you have *already* judged, not a way to skip
judging them.

**Never pass `--since` to `drift` or `repair` on a corpus that has been verified
before.** Each doc carries its own recorded `verifiedCommit`; `--since` discards
those baselines and re-reports already-correct docs as stale. It exists for the
first run on a corpus that has never been verified at all.

**Always pass a path to `repair`.** Bare `catryna repair` emits the full context
— doc content plus every anchor diff — for every drifted doc at once, which on a
real backlog is megabytes.

**Drift only sees a doc's anchors.** A doc that describes a file it doesn't list
in `relatedFiles`/`anchors` will never flag, no matter how wrong it gets. When
you find a doc that was stale but reported clean, fix its anchors — that is a
repair in itself, and often the more valuable one.

`verify` reconciles the `.mdx` frontmatter into `_index.json`, so editing the
frontmatter is enough — but **write the list as a single-line JSON array**,
`relatedFiles: ["src/a.ts", "src/b.ts"]`, which is the form the serializer
emits. A YAML block sequence (`relatedFiles:` then `- src/a.ts` on its own line)
is not readable by the frontmatter parser; `verify` refuses to sync it and warns
`could not read frontmatter relatedFiles`. If you see that warning, the anchors
did **not** change. Older Catryna versions did not sync at all, so on an
unfamiliar install confirm the anchor landed in `.docs/_index.json`.

**Fence balance is not fence content.** A doc can be structurally perfect and
almost entirely hollow — headings and prose wrapped around blank code boxes.
`catryna lint` reports those as an `empty-fence` **warning**, so it does not
gate: read the warnings section rather than skimming for the ✓.

## Fanning out across parallel agents

Repairing a large backlog in parallel is the right instinct. Two things make it
safe:

- **Give each agent a disjoint set of doc paths.** Two agents editing the same
  `.mdx` will clobber each other; nothing prevents that.
- **`verify` is safe to run concurrently** — writes to the shared
  `.docs/_index.json` are serialized by a lock. Still prefer having the
  orchestrator run one `catryna verify <path>...` over the whole finished set:
  one command, one place to read the result, and no shell loop to get subtly
  wrong. (A `while read` loop over a file with no trailing newline silently skips
  the last path. That has happened — `ok=31` reported for 32 docs.)

Read what each agent actually shipped. An agent that reports "doc repaired" and
an agent that rewrote a claim it never checked against source look identical in
a summary.

## Judging a doc

Every drifted doc is one of two things, and both are valid outcomes:

- **Contradicted** — the prose now disagrees with the code. Edit it. Quote the
  wrong sentence and cite the `file:line` that disproves it.
- **Anchor-only** — the anchored file moved but the prose still holds. No edit.
  Say why: which part changed, and why the doc doesn't depend on it.

A file-level anchor fires when *anything* in the file changes, so anchor-only is
common and is not a failure to find something.

`broken` docs — an anchored file deleted or renamed away — are the highest
severity and come first. There is no diff to read; the fix is to re-point the
anchors and update whatever the doc said about the vanished code.

Read the real source at HEAD, not just the diff `repair` hands you. The diff
shows what changed; it doesn't show what the file says now.

**Do not write a claim you did not verify against source.** A confidently-worded
wrong doc carrying a fresh `verifiedCommit` is the worst possible output of this
process — worse than the drifted doc you started with, because the ✗ that would
have warned the next reader is gone.

## Reporting back

Say which docs you edited and which you deliberately left alone, and why. "20
docs verified" is not a result; "14 edited, 6 anchor-only (listed)" is. If you
could not judge a doc — the source was ambiguous, the anchor pointed somewhere
you couldn't reach — leave it drifted and say so. An honest ✗ is the whole
value of the tool.
