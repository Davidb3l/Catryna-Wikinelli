# Catryna Wikinelli

**A local-first code wiki that your AI coding agent writes and your team reads — docs live as MDX files in a `.docs/` folder, versioned with your code.**

Every project accumulates knowledge that lives nowhere: why the auth flow works the way it does, which module owns what, the diagram someone drew once on a whiteboard. Wikis in Notion or Confluence drift out of date because updating them is a separate chore from writing code. Catryna fixes the incentive problem: your coding agent (Claude Code, or anything that speaks MCP) creates and updates the docs *as part of the coding session*, and because the docs are plain files in your repo, the agent also reads them back before touching code — so the knowledge actually gets used, and stale docs get caught in review like any other diff.

## How it works

- Docs are `.mdx` files with YAML frontmatter in `.docs/` at your project root — no database, no cloud, git-versioned with your code.
- **Agents read docs directly** as files (`Read .docs/backend/storage.mdx`) — no tool round-trip needed.
- **Agents write docs via MCP tools** (`create_doc`, `update_doc`, `search_docs`, coverage reports, diagrams).
- **Humans browse the same docs** in a local React viewer at `http://localhost:1307`, with search, Mermaid/React Flow diagrams, tldraw whiteboards, and a doc-coverage report.

## Quickstart

**Prerequisites:** [Bun](https://bun.sh) v1.0+ and Git.

### Claude Code plugin (recommended)

Inside Claude Code:

```
/plugin marketplace add Davidb3l/Catryna-Wikinelli
/plugin install catryna@catryna-wikinelli
```

This registers the MCP server (it installs its own dependencies on first run and stores docs in the `.docs/` folder of whichever project you're working in), an Agent Skill that teaches Claude to search `.docs/` before coding and update docs after changing code, and a `/catryna:viewer` command that starts the human viewer.

Restart Claude Code, then run `/mcp` — you should see `catryna` connected.

### Manual install (other MCP clients / development)

```bash
git clone https://github.com/Davidb3l/Catryna-Wikinelli.git
cd Catryna-Wikinelli
bun install
```

Register the server with your MCP client. For Claude Code, add `.mcp.json` to your project root (or the same block to `~/.claude.json` for all projects):

```json
{
  "mcpServers": {
    "catryna": {
      "command": "bun",
      "args": ["run", "/path/to/Catryna-Wikinelli/src/index.ts"]
    }
  }
}
```

The server stores docs in `.docs/` under the directory it's launched from (your project), creating it on first write.

### Human viewer

```bash
cd Catryna-Wikinelli/frontend
bun install
bun run dev   # http://localhost:1307
```

The viewer scans for sibling projects with `.docs/` folders (set `PROJECTS_ROOT` to point it elsewhere) and lets you switch between them.

## What a session looks like

```
> search_docs query="storage"
  { results: [{ file: ".docs/backend/storage.mdx", title: "Storage Layer",
    snippet: "...file-based storage resolves .docs/ from cwd..." }], count: 1 }

> Read .docs/backend/storage.mdx        # plain file read, no MCP call

  ... make code changes ...

> update_doc path="backend/storage" content=[...]
  { success: true, file: ".docs/backend/storage.mdx" }

> get_doc_coverage
  { documentedModules: 12, totalModules: 18, coveragePercent: 67,
    undocumentedFiles: ["src/tools/diagrams.ts", ...] }
```

Each doc is an MDX file your whole team can read, diff, and edit by hand:

```mdx
---
title: "Storage Layer"
path: "backend/storage"
tags: ["backend"]
relatedFiles: ["src/storage.ts"]
---

# Storage Layer
Docs are written as blocks (text, code, mermaid, react-flow, whiteboard, ...)
```

## MCP tools

| Tool | Description |
|------|-------------|
| `create_doc` / `update_doc` / `delete_doc` | Write docs as `.docs/{path}.mdx` |
| `get_doc` / `list_docs` | Fetch one doc as blocks / browse and filter all docs |
| `search_docs` | Full-text search, returns paths + snippets |
| `create_mermaid_diagram` / `create_diagram` | Mermaid or React Flow architecture diagrams |
| `create_whiteboard` | tldraw freeform canvas |
| `get_doc_coverage` / `get_undocumented_modules` | Which source files have docs, which don't |

## Docs

This repo documents itself with Catryna — browse [`.docs/`](.docs/) for real examples:

- [`.docs/getting-started.mdx`](.docs/getting-started.mdx) — intro walkthrough
- [`.docs/architecture/overview.mdx`](.docs/architecture/overview.mdx) — system architecture
- [`.docs/backend/`](.docs/backend/) — MCP server, storage, and tools internals
- [`skills/catryna/SKILL.md`](skills/catryna/SKILL.md) — the Agent Skill shipped with the plugin
- [`CLAUDE.md`](CLAUDE.md) — block types reference and troubleshooting

## Status & license

Early-stage (v1.0.0) and moving fast; issues and PRs welcome. MIT licensed.
