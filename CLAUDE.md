# Catryna Wikinelli

A local-first, open-source documentation platform that automatically generates and maintains living documentation for codebases. AI coding agents (starting with Claude Code) create interactive docs with diagrams, whiteboards, and code embeds that stay synchronized with your code.

## Quick Start

```bash
# Install dependencies
bun install

# Start development (both server and frontend)
bun run dev

# Or run individually:
cd apps/server && bun run dev  # Backend on http://localhost:4567
cd apps/web && bun run dev     # Frontend on http://localhost:8081
```

## Project Structure

```
catryna-wikinelli/
├── apps/
│   ├── server/                  # Bun backend (GraphQL Yoga)
│   │   ├── src/
│   │   │   ├── db/              # Drizzle ORM schema & client
│   │   │   ├── graphql/         # GraphQL schema & resolvers
│   │   │   ├── mcp/             # MCP tool handlers
│   │   │   ├── watcher/         # File watcher
│   │   │   ├── regeneration/    # Git hooks integration
│   │   │   └── cache/           # DragonflyDB caching
│   │   └── drizzle.config.ts
│   │
│   └── web/                     # Vite + React frontend
│       └── src/
│           ├── components/      # UI components
│           ├── routes/          # TanStack Router pages
│           └── lib/             # GraphQL client, hooks
│
├── packages/
│   ├── shared/                  # Shared types & utilities
│   └── mcp-client/              # MCP client for AI agents
│
├── catryna.config.yaml          # Configuration
├── turbo.json                   # Turborepo config
└── package.json
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Runtime | Bun | Fast JS runtime, native file watching |
| ORM | Drizzle | Type-safe SQL (Postgres + SQLite) |
| Frontend | Vite + React | Fast HMR, modern build |
| Routing | TanStack Router | Type-safe file-based routing |
| Data Fetching | TanStack Query | Caching, optimistic updates |
| API | GraphQL Yoga | Flexible queries, subscriptions |
| Database | Postgres / SQLite | Postgres for server, SQLite for local |
| Cache | DragonflyDB | Render cache, pub/sub (server mode) |
| Diagrams | React Flow | Node-based architecture diagrams |
| Whiteboard | tldraw | Canvas with sketchy style option |
| Rich Text | TipTap | Block-based editing |
| Charts | Mermaid | Code-defined diagrams |

## MCP Tools for Claude Code

The following tools are available for Claude Code integration:

### Document Operations
- `create_doc` - Create a new documentation page
- `update_doc` - Update an existing page
- `get_doc` - Retrieve a page by path
- `list_docs` - List all pages with filtering
- `search_docs` - Full-text search
- `delete_doc` - Delete a page

### Diagram Operations
- `create_diagram` - Create React Flow diagram
- `create_whiteboard` - Create tldraw whiteboard

### Introspection
- `get_undocumented_modules` - List modules without docs
- `get_doc_coverage` - Get coverage report

## Block Types

Documents are composed of blocks:

| Type | Description |
|------|-------------|
| `text` | Rich text paragraph |
| `heading` | H1-H6 headings |
| `code` | Inline code block |
| `code-embed` | Embedded from source file |
| `mermaid` | Mermaid diagrams |
| `react-flow` | Architecture diagrams |
| `whiteboard` | tldraw canvas |
| `table` | Data tables |
| `callout` | Info/warning/error boxes |
| `divider` | Horizontal rule |

## Configuration

Edit `catryna.config.yaml`:

```yaml
# Run mode
mode: local  # local (SQLite) | server (Postgres)

# File watching
watch:
  enabled: true
  include:
    - "src/**/*.{ts,tsx,js,jsx}"
  exclude:
    - "**/*.test.*"
    - "**/node_modules/**"
  debounce_ms: 2000

# Auto-regeneration
regeneration:
  trigger: auto  # auto | manual | hook-only
  scope: affected
  agent: claude-code

# Code linking
code_links:
  external:
    provider: github
    branch: main
  editor:
    scheme: vscode  # vscode | cursor | idea
```

## GraphQL API

The server exposes a GraphQL API at `/graphql`:

```graphql
# Get a document
query {
  doc(path: "modules/auth") {
    id
    title
    blocks { id type data }
    versions { id createdAt summary }
  }
}

# Search documents
query {
  search(query: "authentication") {
    results {
      doc { path title }
      score
      highlights { field snippet }
    }
  }
}

# Create a document
mutation {
  createDoc(input: {
    path: "modules/auth"
    title: "Authentication"
    blocks: [
      { type: HEADING, data: { level: 1, content: "Auth" } }
      { type: TEXT, data: { content: "OAuth implementation..." } }
    ]
  }) {
    id
    path
  }
}
```

## Database

### Local Mode (SQLite)
- Database file: `./catryna.db`
- No external dependencies

### Server Mode (Postgres)
Set environment variables:
```bash
DATABASE_URL=postgres://user:pass@host:5432/catryna
DRAGONFLY_URL=redis://localhost:6379
```

### Migrations
```bash
bun run db:generate  # Generate migrations
bun run db:migrate   # Run migrations
bun run db:push      # Push schema (dev)
```

## Development

### Adding a New Block Type

1. Add type to `packages/shared/src/types/block.ts`
2. Add renderer in `apps/web/src/components/blocks/BlockRenderer.tsx`
3. Update GraphQL schema in `apps/server/src/graphql/schema.ts`

### Adding a New MCP Tool

1. Add tool definition in `apps/server/src/mcp/server.ts`
2. Create handler in `apps/server/src/mcp/handlers/`
3. Export from `packages/mcp-client/src/tools.ts`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CATRYNA_MODE` | `local` or `server` | `local` |
| `DATABASE_URL` | Postgres connection URL | - |
| `DRAGONFLY_URL` | Redis/Dragonfly URL | - |
| `PORT` | Server port | `4567` |

## Deployment

### Docker
```bash
docker compose up -d
```

### Manual
```bash
bun run build
cd apps/server && bun run start
```

## License

MIT
