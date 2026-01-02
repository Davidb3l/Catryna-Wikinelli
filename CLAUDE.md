# Catryna Wikinelli

A file-based documentation platform that works for **BOTH** AI coding agents and humans.

## The Key Insight

**Docs are stored as .mdx files in `.docs/` folder.**

- **Claude reads docs directly** - just use the Read tool on `.docs/{path}.mdx`
- **Claude creates docs via MCP** - use `create_doc`, `update_doc` tools
- **Humans view docs** - open in the Vite viewer (frontend folder)
- **Git-versioned** - docs are committed with your code

This dual-access model means BOTH Claude Code and humans can track how the codebase works.

## Quick Start

```bash
# Install dependencies
bun install

# Start MCP server
bun run start
```

## Project Structure

```
catryna-wikinelli/
├── .docs/                    # Documentation files (git-tracked)
│   ├── _index.json           # Index of all docs
│   ├── modules/
│   │   └── auth.mdx          # Example: auth module docs
│   └── architecture/
│       └── database.mdx      # Example: database architecture
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── storage.ts            # File-based storage layer
│   └── tools/
│       ├── docs.ts           # Document CRUD tools
│       ├── search.ts         # Full-text search
│       ├── diagrams.ts       # React Flow & tldraw
│       └── coverage.ts       # Documentation coverage
├── frontend/                 # Vite viewer for humans
├── package.json
├── tsconfig.json
└── .mcp.json                 # Claude Code MCP config
```

## Claude Code Integration

### Installation

1. Clone and install:
```bash
git clone https://github.com/Davidb3l/Catryna-Wikinelli.git
cd Catryna-Wikinelli
bun install
```

2. The `.mcp.json` file is already configured. Restart Claude Code to load the server.

3. Verify with `/mcp` command in Claude Code.

### Reading Docs (No MCP Needed!)

Claude can read any doc directly:
```
Read .docs/modules/auth.mdx
```

### MCP Tools (For Writing)

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

### Example Usage

```
# Claude can list all docs
> list_docs

# Claude can read a doc directly
> Read .docs/modules/auth.mdx

# Claude can create a new doc
> create_doc path="modules/auth" title="Authentication" content=[...]

# Claude can search for docs
> search_docs query="authentication"
```

## Block Types

Documents are composed of blocks:

| Type | Description |
|------|-------------|
| `text` | Rich text paragraph |
| `heading` | H1-H6 headings |
| `code` | Code block |
| `code-embed` | Embedded from source file |
| `mermaid` | Mermaid diagrams |
| `react-flow` | Architecture diagrams |
| `whiteboard` | tldraw canvas |
| `table` | Data tables |
| `callout` | Info/warning/error boxes |
| `divider` | Horizontal rule |

## Storage Format

Docs are stored as MDX files with YAML frontmatter:

```mdx
---
id: abc123
title: "Authentication Module"
path: "modules/auth"
tags: ["auth", "security"]
relatedFiles: ["src/auth/index.ts", "src/auth/oauth.ts"]
createdAt: 1704067200000
updatedAt: 1704067200000
createdBy: "claude-code"
---

# Authentication Module

This module handles user authentication...

```typescript
// OAuth flow
async function authenticate() { ... }
```
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| MCP SDK | @modelcontextprotocol/sdk |
| Validation | Zod |
| Storage | File-based (.docs/*.mdx) |
| Index | JSON (.docs/_index.json) |
| Frontend | Vite + React |

## Development

### Adding a New Tool

1. Create handler in `src/tools/your-tool.ts`
2. Use the Zod schema pattern:
```typescript
server.tool(
  "tool_name",
  {
    param: z.string().describe("Description"),
  },
  async ({ param }) => {
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);
```
3. Import and register in `src/index.ts`

### Testing

```bash
# Start server (will log to stderr)
bun run start

# In another terminal, send JSON-RPC request
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | bun run start
```

## Why File-Based?

1. **Claude reads directly** - no MCP round-trip needed for reading
2. **Git-versioned** - docs evolve with your code
3. **Human editable** - can edit MDX files manually
4. **Simple** - no database to configure or corrupt
5. **Portable** - `.docs/` folder travels with your repo

## License

MIT
