---
name: catryna
description: Work with this project's living documentation in the .docs/ folder — search it before writing code, read docs directly as files, and create/update docs through the Catryna MCP tools so the knowledge base stays current with the code. Local-first, git-versioned MDX docs readable by both agents and humans.
when_to_use: Use BEFORE implementing or modifying any feature in a repo that has a .docs/ folder — search the docs first to learn existing architecture, patterns, and conventions instead of rediscovering them from source. Also use when the user asks "how does X work", "is there documentation for Y", "document this module/feature/decision", "update the docs", or asks for an architecture diagram — and AFTER you change code that a doc describes, to update that doc in the same session.
---

# Catryna Wikinelli — living project docs

This project keeps its documentation as MDX files in `.docs/` at the repo root,
git-versioned alongside the code. The Catryna MCP server (`mcp__catryna__*`)
provides structured write access, search, and coverage reports. Humans read the
same docs in a local viewer.

## The core reflex

1. **Before coding: search the docs.** `search_docs` with feature keywords, or
   `list_docs` to browse. If the repo has `.docs/`, assume the answer to "how
   does this work / what's the pattern here" is documented before you go
   spelunking through source.
2. **Read docs as plain files — no tool call needed.** Search results include
   the file path; just `Read .docs/<path>.mdx`. MCP is only required for
   writes and search.
3. **After changing code a doc describes: update the doc in the same
   session.** Check each doc's `relatedFiles` frontmatter — if you edited one
   of those files in a way that changes what the doc says, `update_doc` before
   you finish. Stale docs are worse than no docs.

## Tools

| Tool | Use for |
|------|---------|
| `search_docs` | Full-text search; returns paths + snippets |
| `list_docs` | Browse all docs, filter by tag or path prefix |
| `get_doc` | Fetch one doc as structured blocks (prefer Read for plain reading) |
| `create_doc` | New doc → `.docs/{path}.mdx` |
| `update_doc` | Update title/content/tags/relatedFiles of an existing doc |
| `delete_doc` | Remove a doc (prefer updating; delete only if truly obsolete) |
| `create_mermaid_diagram` / `create_diagram` | Mermaid or React Flow architecture diagrams |
| `create_whiteboard` | tldraw freeform canvas |
| `get_doc_coverage` | Coverage report: documented vs undocumented source files |
| `get_undocumented_modules` | List source files with no doc referencing them |

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
    "relatedFiles": ["src/auth/middleware.ts", "src/auth/permissions.ts"]
  }
  ```

- Valid block types if composing individually: `heading`, `text`, `code`,
  `mermaid`, `callout`, `table`, `divider`, `markdown`, `react-flow`,
  `whiteboard`. There is NO `paragraph` or `diagram` type — unknown types
  render as broken comments.
- **Always set `relatedFiles`** to real repo-relative source paths — it is how
  coverage works and how future sessions know which docs your code change
  affects.
- Paths are kebab-case, organized by area (`architecture/`, `features/`,
  `guides/`, per-service folders). Match the project's existing structure
  from `list_docs` before inventing a new top-level folder.
- Write docs for the next agent AND the next human: lead with what/why, keep
  volatile details (counts, versions) out, link related docs by path.

## Coverage discipline

When asked to "document the codebase" or after adding a significant module,
run `get_doc_coverage` first — document the highest-value undocumented modules
rather than duplicating what exists. Prefer one good architecture doc over
many thin per-file stubs.

## Human viewer

Humans browse the same `.docs/` in the Catryna viewer (React app, port 1307,
`cd <catryna-install>/frontend && bun run dev`). Mermaid/React Flow diagrams
you create render there — favor a diagram when explaining flows or topology.
