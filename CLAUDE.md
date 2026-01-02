# Catryna Wikinelli

A local-first MCP server for AI-assisted documentation generation. Claude Code creates and manages living documentation with diagrams, whiteboards, and structured content blocks.

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
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── db.ts             # SQLite database
│   └── tools/
│       ├── docs.ts       # Document CRUD tools
│       ├── search.ts     # Full-text search
│       ├── diagrams.ts   # React Flow & tldraw
│       └── coverage.ts   # Documentation coverage
├── package.json
├── tsconfig.json
├── .mcp.json             # Claude Code MCP config
└── catryna.db            # SQLite database (auto-created)
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

### MCP Tools

| Tool | Description |
|------|-------------|
| `create_doc` | Create a new documentation page |
| `get_doc` | Retrieve a document by path |
| `list_docs` | List all documents with optional filtering |
| `update_doc` | Update an existing document |
| `delete_doc` | Delete a document |
| `search_docs` | Full-text search across documents |
| `create_diagram` | Create React Flow architecture diagram |
| `create_whiteboard` | Create tldraw whiteboard |
| `get_undocumented_modules` | List source files without docs |
| `get_doc_coverage` | Get documentation coverage report |

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

## Database

- **File**: `./catryna.db` (created automatically on first run)
- **Engine**: Bun's native SQLite (`bun:sqlite`)
- **Mode**: WAL (Write-Ahead Logging) for concurrency

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| MCP SDK | @modelcontextprotocol/sdk |
| Validation | Zod |
| Database | SQLite (bun:sqlite) |

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

## License

MIT
