---
name: catryna
description: Work with this project's living documentation in the .docs/ folder — search it before writing code, read docs directly as files, create/update docs through the Catryna MCP tools, and use drift detection (catryna drift / check_drift) to find and repair docs the code has outgrown. Local-first, git-versioned MDX docs readable by both agents and humans.
when_to_use: Use BEFORE implementing or modifying any feature in a repo that has a .docs/ folder — search the docs first to learn existing architecture, patterns, and conventions instead of rediscovering them from source. Also use when the user asks "how does X work", "is there documentation for Y", "document this module/feature/decision", "update the docs", "which docs are out of date", or asks for an architecture diagram — and AFTER you change code that a doc describes, to update and re-verify that doc in the same session.
---

# Catryna Wikinelli — living project docs

This project keeps its documentation as MDX files in `.docs/` at the repo root,
git-versioned alongside the code. The Catryna MCP server (`mcp__catryna__*`)
provides structured write access, search, and drift detection. The `catryna`
CLI does the same from a shell. Humans read the same docs in a local viewer.

The point of Catryna is not authoring docs — it is keeping them **true**. A doc
that contradicts the code is worse than no doc, because an agent will believe it.

## The core reflex

1. **Before coding: search the docs.** `search_docs` with feature keywords, or
   `list_docs` to browse. If the repo has `.docs/`, assume the answer to "how
   does this work / what's the pattern here" is documented before you go
   spelunking through source.
2. **Read docs as plain files — no tool call needed.** Search results include
   the file path; just `Read .docs/<path>.mdx`. MCP is only required for
   writes, search, and drift.
3. **Distrust a doc whose code has moved.** Before relying on a doc, glance at
   its `verifiedCommit` frontmatter and `driftSuspectSince`. `check_drift` tells
   you which docs are contradicted right now — a `drifted` or `broken` doc is a
   claim to verify against source, not a fact.
4. **After changing code a doc describes: fix the doc, then re-verify.** Check
   each doc's `relatedFiles`/`anchors` — if you edited an anchored file in a way
   that changes what the doc says, `update_doc`, then `verify_doc` (or
   `catryna verify <path>`) to re-baseline it. Leaving it drifted hands the next
   agent a lie.

## Tools

| Tool | Use for |
|------|---------|
| `search_docs` | Full-text search; returns paths + snippets |
| `list_docs` | Browse all docs, filter by tag or path prefix |
| `get_doc` | Fetch one doc as structured blocks (prefer Read for plain reading) |
| `create_doc` | New doc → `.docs/{path}.mdx` |
| `update_doc` | Update title/content/tags/relatedFiles/anchors of an existing doc |
| `delete_doc` | Remove a doc (prefer updating; delete only if truly obsolete) |
| `check_drift` | Which docs the code has outgrown (drifted / broken / unverified / clean) |
| `verify_doc` | Re-baseline a doc against HEAD after you've made it accurate again |
| `propose_doc_repair` | Get a repair bundle: the doc's content + the git diff of each changed anchor |
| `create_mermaid_diagram` / `create_diagram` | Mermaid or React Flow architecture diagrams |
| `create_whiteboard` | Freeform whiteboard canvas |
| `get_doc_coverage` | Coverage report: documented vs undocumented source files |
| `get_undocumented_modules` | List source files with no doc referencing them |

Equivalent CLI (any shell, no MCP needed): `catryna drift`, `catryna verify <path>...`,
`catryna repair <path>`, `catryna lint`, `catryna doctor`, `catryna consume`. All accept
`--json` (exactly one JSON object on stdout). `catryna drift` exits **3** when anything is
drifted or broken, so it works as a CI gate.

For a whole backlog of drifted docs — repairing in waves, fanning out across
agents, re-baselining a set — use the **`catryna-maintenance`** skill instead.
It covers the traps this one doesn't: uncommitted code being invisible to drift,
anchors that never flag, and blanket-verifying prose nobody read.

## Anchors — how drift knows what a doc covers

A doc's anchors are the source files it describes. Drift flags the doc when
those files change after its last verification.

- **`relatedFiles`** — file-level anchors: `["src/auth/middleware.ts"]`. Any
  change to the file drifts the doc.
- **`anchors`** — precise anchors: `[{"file":"src/auth.ts","symbol":"login"}]`
  or `{"file":"src/db.ts","lines":[40,80]}`. Only changes touching that
  symbol/range drift the doc — far less noise on large files.

Rules that matter:

- **Always set anchors.** An unanchored doc is invisible to drift and will rot
  silently. This is the single most common mistake.
- **Anchor what the doc actually describes** — the real modules and entry
  points. Avoid anchoring `CLAUDE.md`-style instruction files: they churn for
  unrelated reasons and produce constant false drift.
- **Use forward slashes**, always, on every OS. Anchors are matched against git
  output, and git speaks `/` even on Windows. A backslash path resolves to
  nothing on macOS/Linux and reports the doc `broken`.
- An anchored file that is deleted or renamed away makes the doc **`broken`** —
  the highest-severity state. Fix those first: re-point the anchors and update
  whatever the doc said about the vanished code.

## Repairing a drifted doc

```
check_drift                          → which docs, and which anchored files changed
propose_doc_repair { doc: "<path>" } → that doc's content + the diff of each changed anchor
   … read both, judge whether the doc actually contradicts the code …
update_doc                           → fix only what's genuinely wrong
verify_doc { path: "<path>" }        → re-baseline; it now reports clean
```

Two judgment calls the tool cannot make for you:

- **Not every flag is a real contradiction.** A file-level anchor fires when
  *anything* in the file changes, including changes the doc never covered. Say
  so and move on rather than inventing edits.
- **Verify claims against source you actually read.** A diff shows what changed,
  not what is true now. Read the current file before writing a claim about it.

Request one doc at a time from `propose_doc_repair` — asking for `"all"` on a
large corpus returns a multi-megabyte bundle.

## Writing docs correctly

- **Use a single `markdown` block for the whole document** (headings, prose,
  code fences, ` ```mermaid ` fences, tables all inline). This is the
  recommended format and avoids block-type errors:

  ```json
  {
    "path": "architecture/auth-flow",
    "title": "Authentication Flow",
    "content": [
      { "type": "markdown", "data": { "content": "# Authentication Flow\n\n..." } }
    ],
    "tags": ["auth", "architecture"],
    "relatedFiles": ["src/auth/middleware.ts"],
    "anchors": [{ "file": "src/auth/permissions.ts", "symbol": "hasPermission" }]
  }
  ```

- Valid block types if composing individually: `heading`, `text`, `code`,
  `mermaid`, `callout`, `table`, `divider`, `markdown`, `react-flow`,
  `whiteboard`. There is NO `paragraph` or `diagram` type — unknown types
  render as broken comments.
- Paths are kebab-case, organized by area (`architecture/`, `features/`,
  `guides/`, per-service folders). Match the project's existing structure
  from `list_docs` before inventing a new top-level folder.
- Write docs for the next agent AND the next human: lead with what/why, keep
  volatile details (counts, versions) out — they are the first thing to rot —
  and link related docs by path.
- `evidence` and `refs` accept suite URIs (`sirius:receipt/89`, `amt:decision/7`)
  and are stored opaquely — useful for recording *why* a doc is trusted.

## Coverage discipline

When asked to "document the codebase" or after adding a significant module, run
`get_doc_coverage` first — document the highest-value undocumented modules
rather than duplicating what exists. Prefer one good architecture doc over many
thin per-file stubs. Then `verify_doc` what you wrote so it starts tracking.

## Human viewer

Humans browse the same `.docs/` in the Catryna viewer (React app, default port
1307, `cd <catryna-install>/frontend && bun run dev`; override with
`CATRYNA_VIEWER_PORT`). Mermaid/React Flow diagrams you create render there —
favor a diagram when explaining flows or topology.
