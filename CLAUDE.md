# Catryna Wikinelli

A file-based documentation platform that works for **BOTH** AI coding agents and humans.

## The Key Insight

**Docs are stored as .mdx files in `.docs/` folder.**

- **Claude reads docs directly** - just use the Read tool on `.docs/{path}.mdx`
- **Claude creates docs via MCP** - use `create_doc`, `update_doc` tools
- **Humans view docs** - open in the Vite viewer at `http://localhost:6969`
- **Git-versioned** - docs are committed with your code

This dual-access model means BOTH Claude Code and humans can track how the codebase works.

---

## Claude Code CLI Installation

### Step 1: Clone and Install

```bash
git clone https://github.com/Davidb3l/Catryna-Wikinelli.git
cd Catryna-Wikinelli
bun install
```

### Step 2: Add MCP Server

**Option A: Project-specific** (recommended)

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "catryna": {
      "command": "bun",
      "args": ["run", "C:/path/to/Catryna-Wikinelli/src/index.ts"],
      "cwd": "C:/path/to/Catryna-Wikinelli"
    }
  }
}
```

**Option B: Global (all projects)**

Add to your global config file:
- **Windows:** `%USERPROFILE%\.claude.json`
- **Mac/Linux:** `~/.claude.json`

```json
{
  "mcpServers": {
    "catryna": {
      "command": "bun",
      "args": ["run", "/path/to/Catryna-Wikinelli/src/index.ts"],
      "cwd": "/path/to/Catryna-Wikinelli"
    }
  }
}
```

**Important:** Replace the path with your actual Catryna installation path.

> ⚠️ **Note:** `.claude/settings.json` is ignored by Claude Code! Use `.mcp.json` or `~/.claude.json` instead.

### Step 3: Restart Claude Code

Close and reopen Claude Code (or the terminal running it) to load the MCP server.

### Step 4: Verify Connection

Run `/mcp` in Claude Code. You should see `catryna` listed with 10 tools.

---

## Troubleshooting

### "DATABASE_URL is required" Error

This error means you're running an **old version** of Catryna. The new version uses file-based storage, not a database.

**Fix:**
1. Make sure your `.claude/settings.json` points to the **new** Catryna installation
2. Delete any old `Catryna-Wikinelli` folders you have
3. Pull the latest version: `git pull origin main`
4. Restart Claude Code

### MCP Server Not Showing Up

1. Check the path in `.claude/settings.json` is correct
2. Make sure `bun` is installed and in your PATH
3. Test the server manually:
   ```bash
   cd /path/to/Catryna-Wikinelli
   bun run start
   # Should print: [Catryna] MCP server started on stdio
   ```
4. Restart Claude Code

### Cache Issues

If Claude Code is caching an old version:

1. Close Claude Code completely
2. Delete the Claude Code cache:
   - **Windows:** `%APPDATA%\claude-code\Cache`
   - **Mac:** `~/Library/Caches/claude-code`
3. Restart Claude Code

### Tools Return Errors

If tools like `create_doc` fail:
1. Make sure you're in a directory where Catryna has write access
2. Check that `.docs/` folder exists (it's created automatically)
3. Verify `_index.json` is valid JSON

---

## Quick Start

```bash
# Install dependencies
bun install

# Start MCP server (for Claude Code)
bun run start

# Start frontend viewer (for humans) - in another terminal
cd frontend && bun install && bun run dev
# Opens http://localhost:6969
```

---

## Project Structure

```
catryna-wikinelli/
├── .docs/                    # Documentation files (git-tracked)
│   ├── _index.json           # Index of all docs
│   └── *.mdx                 # Individual doc files
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── storage.ts            # File-based storage layer
│   └── tools/
│       ├── docs.ts           # Document CRUD tools
│       ├── search.ts         # Full-text search
│       ├── diagrams.ts       # React Flow & tldraw
│       └── coverage.ts       # Documentation coverage
├── frontend/                 # Vite viewer for humans (port 6969)
├── package.json
├── tsconfig.json
└── .mcp.json                 # Local MCP config (for this repo)
```

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `create_doc` | Create a new documentation page → `.docs/{path}.mdx` |
| `get_doc` | Retrieve a document by path |
| `list_docs` | List all documents with optional filtering |
| `update_doc` | Update an existing document |
| `delete_doc` | Delete a document |
| `search_docs` | Full-text search across documents |
| `create_diagram` | Create React Flow architecture diagram |
| `create_whiteboard` | Create tldraw whiteboard |
| `get_undocumented_modules` | List source files without docs |
| `get_doc_coverage` | Get documentation coverage report |

### Reading Docs (No MCP Needed!)

Claude can read any doc directly - no tool call required:
```
Read .docs/modules/auth.mdx
```

### Example Usage

```
# List existing docs
> list_docs

# Read a doc directly
> Read .docs/modules/auth.mdx

# Create a new doc
> create_doc path="modules/auth" title="Authentication" content=[...]

# Search for docs
> search_docs query="authentication"
```

---

## Block Types

Documents are composed of blocks:

| Type | Description |
|------|-------------|
| `heading` | H1-H6 headings |
| `text` | Rich text paragraph |
| `code` | Code block with syntax highlighting |
| `callout` | Info/warning/error boxes |
| `mermaid` | Mermaid diagrams |
| `react-flow` | Architecture diagrams |
| `whiteboard` | tldraw canvas |
| `table` | Data tables |
| `divider` | Horizontal rule |

---

## Storage Format

Docs are stored as MDX files with YAML frontmatter:

```mdx
---
id: abc123
title: "Authentication Module"
path: "modules/auth"
tags: ["auth", "security"]
relatedFiles: ["src/auth/index.ts"]
createdAt: 1704067200000
updatedAt: 1704067200000
createdBy: "claude-code"
---

# Authentication Module

This module handles user authentication...
```

---

## Why File-Based?

1. **Claude reads directly** - no MCP round-trip needed for reading
2. **Git-versioned** - docs evolve with your code
3. **Human editable** - can edit MDX files manually
4. **Simple** - no database to configure or corrupt
5. **Portable** - `.docs/` folder travels with your repo

---

## License

MIT
